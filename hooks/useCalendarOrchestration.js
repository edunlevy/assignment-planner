import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createEventFor,
  deleteAssignmentCalendar,
  deleteEventFor,
  ensureAssignmentCalendar,
  requestCalendarPermission,
  updateEventFor,
} from '../lib/calendarSync';

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

// AsyncStorage has no atomic read-modify-write primitive, and several call
// sites below can legitimately run concurrently for the SAME userId — a
// mutation's scheduleFor, a realtime echo's scheduleFor, and a load-time
// backfill can all overlap. Without serializing them, a classic lost-update
// race can drop one call's map entry: it reads the map before another call's
// write lands, then overwrites that write with its own stale copy, orphaning
// the dropped call's event (never deleted) and producing a duplicate on the
// next backfill (which sees the id as "missing" again). Keyed by userId, not
// per-assignment-id like useAssignments' enqueueForId — the underlying
// AsyncStorage key is per-user, not per-assignment, so that's the correct
// serialization granularity here.
const eventMapLocks = new Map();
function withEventMapLock(userId, fn) {
  const prev = eventMapLocks.get(userId) ?? Promise.resolve();
  const settled = prev.then(fn, fn);
  const cleanup = settled.catch(() => {});
  eventMapLocks.set(userId, cleanup);
  return settled;
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
    const map = await loadEventMap(userId);
    const missing = assignments.filter(a => !map[a.id]);
    if (missing.length === 0) return;

    const calendarId = await ensureAssignmentCalendar();
    for (const a of missing) {
      // eslint-disable-next-line no-await-in-loop
      const newId = await createEventFor(a, calendarId);
      if (newId) map[a.id] = newId;
    }

    // Re-check the authoritative on-disk flag (not the in-memory
    // syncEnabledRef, which only lives in the calling hook instance) right
    // before writing. Covers the disableSync race: if sync was turned off
    // while this backfill sat queued behind the lock — including the case
    // where disableSync's own map-clear already ran and is about to run
    // again on its next turn — discard this batch rather than resurrecting
    // events for a sync session that's already being torn down. When
    // backfill instead wins the race and runs first, this reads 'true' and
    // proceeds normally; disableSync's clear (queued behind this same lock)
    // still runs afterward and ends up as the final, correct state either way.
    const stillEnabled = (await AsyncStorage.getItem(enabledKey(userId))) === 'true';
    if (!stillEnabled) return;

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
      // Re-check after acquiring the lock: sync may have been turned off
      // while this call sat queued behind another in-flight write.
      if (!syncEnabledRef.current) return;
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
      if (!syncEnabledRef.current) return;
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
  const cancelFor = useCallback(async id => {
    if (!userId) return;
    return withEventMapLock(userId, async () => {
      const map = await loadEventMap(userId);
      const eventId = map[id];
      if (!eventId) return;
      await deleteEventFor(eventId);
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

  // Turn sync on: request permission, ensure the calendar exists, backfill
  // every current assignment, THEN flip the enabled flag. Returns false
  // (leaving sync off) if permission was denied.
  const enableSync = useCallback(async assignments => {
    if (!userId) return false;
    const granted = await requestCalendarPermission();
    if (!granted) return false;

    await ensureAssignmentCalendar();
    await AsyncStorage.setItem(enabledKey(userId), 'true');
    await backfillMissingEvents(userId, assignments);
    setSyncEnabled(true);
    return true;
  }, [userId]);

  // Turn sync off. `deleteEvents` controls whether the dedicated calendar
  // (and everything in it) is removed, or left behind for the user to keep.
  // Either way the local event map is cleared — a re-enable starts fresh.
  const disableSync = useCallback(async deleteEvents => {
    if (!userId) return;
    setSyncEnabled(false);
    // Flip the on-disk flag first, immediately (not queued behind the
    // lock) — it's the authoritative signal backfillMissingEvents re-reads
    // right before its own write. Whichever of the two runs first through
    // the lock below, the flag is already 'false' by the time either one
    // checks it: a backfill still mid-flight discards its results instead
    // of resurrecting events for a sync session that's being torn down,
    // and this function's own clear always runs (now or once its lock
    // turn arrives), so the map ends up empty either way.
    await AsyncStorage.setItem(enabledKey(userId), 'false');
    return withEventMapLock(userId, async () => {
      if (deleteEvents) {
        const calendarId = await ensureAssignmentCalendar();
        await deleteAssignmentCalendar(calendarId);
      }
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
