import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createEventFor,
  deleteAssignmentCalendar,
  deleteEventFor,
  ensureAssignmentCalendar,
  requestCalendarAccess,
  updateEventFor,
} from '../lib/calendarSync';
import { createUserKeyedLock } from '../lib/userKeyedLock';

// Opt-in, per-device sync of assignments to a dedicated native calendar.
// One-way (app → calendar) and LOCAL ONLY: the { assignmentId -> eventId }
// map lives in AsyncStorage, not the server, because calendar event ids are
// OS-local — a second device or a reinstall has no way to know about events
// created elsewhere and will build its own set from scratch if enabled
// there too. The on/off flag is local for the same reason (no shared place
// to store it that would actually mean anything cross-device).

function enabledKey(userId) {
  return `calendar_sync_enabled_${userId}`;
}
function eventMapKey(userId) {
  return `calendar_events_${userId}`;
}

async function loadEventMap(userId) {
  try {
    const json = await AsyncStorage.getItem(eventMapKey(userId));
    if (!json) return {};
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean = {};
    for (const [id, eventId] of Object.entries(parsed)) {
      if (typeof eventId === 'string') clean[id] = eventId;
    }
    return clean;
  } catch {
    return {};
  }
}

async function saveEventMap(userId, map) {
  try {
    await AsyncStorage.setItem(eventMapKey(userId), JSON.stringify(map));
  } catch {
    // Non-fatal — the calendar event still exists, we just can't find it by
    // id next time. reconcileOnLoad's "missing from map" check will treat
    // it as unsynced and create a duplicate; an acceptable degrade.
  }
}

// Per-userId serialization for the calendar_events_${userId} map — prevents the
// lost-update race where a mutation's scheduleFor, a realtime echo's
// scheduleFor, and a load-time backfill overlap and one overwrites another's
// map write. See lib/userKeyedLock.js for the full rationale.
const withEventMapLock = createUserKeyedLock();

// The authoritative "is sync on" signal for anything running inside
// withEventMapLock. NOT the same as the hook's in-memory syncEnabledRef,
// which only reflects this hook instance's own React state and can be
// stale relative to a disableSync call whose flag write already landed but
// whose own lock turn (the calendar delete / map clear) hasn't run yet.
async function isSyncEnabledOnDisk(userId) {
  return (await AsyncStorage.getItem(enabledKey(userId))) === 'true';
}

// Create an event for every assignment missing one. Deliberately a plain
// function (not a hook callback) so it never depends on component state —
// called both from reconcileOnLoad (gated on syncEnabled) and directly from
// enableSync (which must run unconditionally: enableSync flips syncEnabled
// via setState, and setState doesn't take effect until the next render, so
// a syncEnabled-gated callback invoked synchronously inside enableSync
// would see the STALE pre-toggle value and no-op).
async function backfillMissingEvents(userId, assignments) {
  return withEventMapLock(userId, async () => {
    // Check BEFORE touching the calendar at all — not just before the
    // final map write. Covers the disableSync race: if sync was turned off
    // while this backfill sat queued behind the lock, bail here so a
    // deleted calendar never gets silently recreated and repopulated with
    // events nothing would ever track or clean up. An earlier version of
    // this fix checked only right before the map write, which skipped
    // recording the new events but let the native creates (and any
    // calendar recreation) happen anyway — orphaning them instead of
    // preventing them.
    if (!(await isSyncEnabledOnDisk(userId))) return;

    const map = await loadEventMap(userId);
    const missing = assignments.filter(a => !map[a.id]);
    if (missing.length === 0) return;

    const calendarId = await ensureAssignmentCalendar();
    for (const a of missing) {
      // eslint-disable-next-line no-await-in-loop
      const newId = await createEventFor(a, calendarId);
      if (newId) map[a.id] = newId;
    }
    await saveEventMap(userId, map);
  });
}

export function useCalendarOrchestration(userId) {
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Latest syncEnabled, read by scheduleFor/scheduleBatchFor/reconcileOnLoad
  // below WITHOUT being one of their useCallback dependencies. syncEnabled
  // flips asynchronously shortly after mount (once the AsyncStorage read in
  // the effect below resolves) — if these callbacks depended on it directly,
  // each one's identity (and the memoized return object below) would change
  // right after that first settle, and any consumer whose OWN effect depends
  // on the whole returned object (useAssignments' load effect depends on
  // `calendar`) would silently re-run a second time on every mount. Mirrors
  // the assignmentsRef pattern in hooks/useAssignments.js.
  const syncEnabledRef = useRef(syncEnabled);
  useEffect(() => { syncEnabledRef.current = syncEnabled; }, [syncEnabled]);

  useEffect(() => {
    if (!userId) {
      setSyncEnabled(false);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(enabledKey(userId));
        if (!cancelled) setSyncEnabled(stored === 'true');
      } catch {
        // Read failure — default to off; the user can re-enable manually.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Create-or-update ONE assignment's event. A no-op when sync is off.
  //
  // Unlike reminders, completed assignments are NOT removed from the
  // calendar here — a calendar is a historical record as much as a to-do
  // list, so a completed event just stays in place until the assignment
  // itself is deleted (see cancelFor, called from useAssignments' remove).
  const scheduleFor = useCallback(async assignment => {
    if (!userId || !syncEnabledRef.current) return;
    return withEventMapLock(userId, async () => {
      // Authoritative (on-disk) re-check after acquiring the lock, not the
      // in-memory ref — sync may have been turned off, including a
      // disableSync whose flag write already landed but whose own lock
      // turn (calendar delete / map clear) hasn't run yet, while this call
      // sat queued. See backfillMissingEvents for why this must happen
      // before any calendar mutation, not just before the map write.
      if (!(await isSyncEnabledOnDisk(userId))) return;
      const map = await loadEventMap(userId);
      const existingId = map[assignment.id];

      if (existingId) {
        const updated = await updateEventFor(existingId, assignment);
        if (updated) return;
        // updateEventFor returning false covers both "event genuinely
        // deleted" (the common real-world case — expo-calendar's error
        // doesn't reliably distinguish "not found" from other failures) and
        // rarer transient errors. Recreating on every failure risks an
        // occasional duplicate on a transient error, but leaving a
        // genuinely-deleted event permanently unsynced is the worse
        // failure mode for what's meant to be a self-healing mirror —
        // accepted tradeoff, not fixed further here.
      }

      const calendarId = await ensureAssignmentCalendar();
      const newId = await createEventFor(assignment, calendarId);
      if (newId) {
        map[assignment.id] = newId;
      } else {
        delete map[assignment.id];
      }
      await saveEventMap(userId, map);
    });
  }, [userId]);

  // Create events for many NEW assignments at once (e.g. a recurring
  // series), sharing ONE ensureAssignmentCalendar() lookup instead of one
  // per item — mirrors reminders' scheduleBatchFor for the same reason.
  const scheduleBatchFor = useCallback(async assignments => {
    if (!userId || !syncEnabledRef.current || assignments.length === 0) return;
    return withEventMapLock(userId, async () => {
      if (!(await isSyncEnabledOnDisk(userId))) return;
      const map = await loadEventMap(userId);
      const calendarId = await ensureAssignmentCalendar();
      for (const a of assignments) {
        // eslint-disable-next-line no-await-in-loop
        const newId = await createEventFor(a, calendarId);
        if (newId) map[a.id] = newId;
      }
      await saveEventMap(userId, map);
    });
  }, [userId]);

  // Delete one assignment's event and prune its map entry. Not gated on
  // syncEnabled — if an event exists (sync was on when it was created,
  // then turned off), a delete should still go through so it doesn't
  // linger forever after the assignment itself is gone.
  //
  // Only prunes the map entry once deletion is CONFIRMED. This is called
  // from useAssignments' remove/removeSeries with no error UI plumbed
  // through and no throw here (unlike disableSync, which has ProfileModal
  // to surface a warning) — a calendar failure must never block deleting
  // an assignment. But silently pruning on an unconfirmed failure would
  // orphan the real device event with no record left to ever find it
  // again (unlike reminders, calendar has no orphan-sweep on load). Best
  // effort: leave the entry in place so at least the on-disk map doesn't
  // lie about what's confirmed gone.
  const cancelFor = useCallback(async id => {
    if (!userId) return;
    return withEventMapLock(userId, async () => {
      const map = await loadEventMap(userId);
      const eventId = map[id];
      if (!eventId) return;
      const confirmed = await deleteEventFor(eventId);
      if (!confirmed) return;
      delete map[id];
      await saveEventMap(userId, map);
    });
  }, [userId]);

  // Backfill any assignment missing an event. Called after every fetch
  // (covers assignments created on another device while sync was off here).
  const reconcileOnLoad = useCallback(async assignments => {
    if (!userId || !syncEnabledRef.current) return;
    await backfillMissingEvents(userId, assignments);
  }, [userId]);

  // Turn sync on: request access, ensure the calendar exists, backfill
  // every current assignment, THEN flip the enabled flag. Returns
  // { ok: true } on success, or { ok: false, reason } (leaving sync off)
  // where reason is one of:
  //   'denied'       — no calendar access
  //   'writeOnly'    — iOS "Add Events Only"; full access needed (see
  //                    lib/calendarSync.js header for why)
  //   'createFailed' — access granted but the dedicated calendar couldn't
  //                    be created (e.g. no usable calendar source)
  // The reasons let ProfileModal show an actionable message per case
  // instead of one generic failure.
  const enableSync = useCallback(async assignments => {
    if (!userId) return { ok: false, reason: 'denied' };
    const access = await requestCalendarAccess();
    if (access !== 'granted') {
      return { ok: false, reason: access === 'writeOnly' ? 'writeOnly' : 'denied' };
    }

    try {
      await ensureAssignmentCalendar();
    } catch (e) {
      console.warn('[calendarSync] could not create the assignment calendar', e);
      return { ok: false, reason: 'createFailed' };
    }
    // The on-disk flag must flip BEFORE the backfill runs — backfill's
    // lock-guarded isSyncEnabledOnDisk check bails when it reads 'false'.
    // But that ordering means a backfill failure would strand the flag at
    // 'true' while React state (and the toggle) stay off, and the next
    // launch would silently read sync back on — so roll the flag back if
    // anything past this point throws.
    try {
      await AsyncStorage.setItem(enabledKey(userId), 'true');
      await backfillMissingEvents(userId, assignments);
    } catch (e) {
      console.warn('[calendarSync] enabling sync failed part-way; rolling back', e);
      try {
        await AsyncStorage.setItem(enabledKey(userId), 'false');
      } catch {
        // Rollback write failed too — nothing further to do; the reconcile
        // paths re-check the flag on every run, so a stale 'true' degrades
        // to a re-backfill attempt, not corruption.
      }
      return { ok: false, reason: 'createFailed' };
    }
    setSyncEnabled(true);
    return { ok: true };
  }, [userId]);

  // Turn sync off. `deleteEvents` controls whether the dedicated calendar
  // (and everything in it) is removed, or left behind for the user to keep.
  const disableSync = useCallback(async deleteEvents => {
    if (!userId) return;
    setSyncEnabled(false);
    // Flip the on-disk flag first, immediately (not queued behind the
    // lock) — it's the authoritative signal isSyncEnabledOnDisk reads for
    // every other locked operation. A backfill or scheduleFor that hasn't
    // yet reached its own check sees 'false' the moment it does and bails
    // before touching the calendar.
    await AsyncStorage.setItem(enabledKey(userId), 'false');
    return withEventMapLock(userId, async () => {
      if (deleteEvents) {
        const calendarId = await ensureAssignmentCalendar();
        const confirmed = await deleteAssignmentCalendar(calendarId);
        if (!confirmed) {
          // Deletion could not be confirmed — leave the event map intact
          // rather than forgetting about events that might still be on
          // the device. Clearing it here regardless of outcome (the
          // previous behavior) meant a failed delete plus a cleared map
          // would silently orphan those events: a future re-enable's
          // backfill sees an empty map, assumes nothing is synced, and
          // creates a whole new duplicate set alongside the leftovers.
          // Throwing lets the caller (ProfileModal) surface this instead
          // of reporting success — see its calendarError handling.
          const err = new Error('Calendar deletion could not be confirmed');
          err.code = 'CALENDAR_DELETE_UNCONFIRMED';
          throw err;
        }
      }
      // Either deleteEvents was false (nothing to confirm), or it was true
      // and confirmed — safe to clear in both cases.
      await saveEventMap(userId, {});
    });
  }, [userId]);

  // Memoized so consumers (useAssignments) can depend on the whole `calendar`
  // object without every effect/callback that touches it re-running on
  // every render — mirrors useReminderOrchestration's return. Without this,
  // a fresh object identity every render would make the load effect's
  // `[userId, reminders, calendar]` dependency array retrigger constantly.
  return useMemo(() => ({
    syncEnabled,
    loaded,
    scheduleFor,
    scheduleBatchFor,
    cancelFor,
    reconcileOnLoad,
    enableSync,
    disableSync,
  }), [syncEnabled, loaded, scheduleFor, scheduleBatchFor, cancelFor, reconcileOnLoad, enableSync, disableSync]);
}
