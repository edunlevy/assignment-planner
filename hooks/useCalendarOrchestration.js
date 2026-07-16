import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

// Create an event for every assignment missing one. Deliberately a plain
// function (not a hook callback) so it never depends on component state —
// called both from reconcileOnLoad (gated on syncEnabled) and directly from
// enableSync (which must run unconditionally: enableSync flips syncEnabled
// via setState, and setState doesn't take effect until the next render, so
// a syncEnabled-gated callback invoked synchronously inside enableSync
// would see the STALE pre-toggle value and no-op).
async function backfillMissingEvents(userId, assignments) {
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
}

export function useCalendarOrchestration(userId) {
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
    if (!userId || !syncEnabled) return;
    const map = await loadEventMap(userId);
    const existingId = map[assignment.id];

    if (existingId) {
      const updated = await updateEventFor(existingId, assignment);
      if (updated) return;
      // Event is gone (e.g. user deleted it manually in their calendar
      // app) — fall through and recreate rather than leaving it unsynced.
    }

    const calendarId = await ensureAssignmentCalendar();
    const newId = await createEventFor(assignment, calendarId);
    if (newId) {
      map[assignment.id] = newId;
    } else {
      delete map[assignment.id];
    }
    await saveEventMap(userId, map);
  }, [userId, syncEnabled]);

  // Create events for many NEW assignments at once (e.g. a recurring
  // series), sharing ONE ensureAssignmentCalendar() lookup instead of one
  // per item — mirrors reminders' scheduleBatchFor for the same reason.
  const scheduleBatchFor = useCallback(async assignments => {
    if (!userId || !syncEnabled || assignments.length === 0) return;
    const map = await loadEventMap(userId);
    const calendarId = await ensureAssignmentCalendar();
    for (const a of assignments) {
      // eslint-disable-next-line no-await-in-loop
      const newId = await createEventFor(a, calendarId);
      if (newId) map[a.id] = newId;
    }
    await saveEventMap(userId, map);
  }, [userId, syncEnabled]);

  // Delete one assignment's event and prune its map entry. Not gated on
  // syncEnabled — if an event exists (sync was on when it was created,
  // then turned off), a delete should still go through so it doesn't
  // linger forever after the assignment itself is gone.
  const cancelFor = useCallback(async id => {
    if (!userId) return;
    const map = await loadEventMap(userId);
    const eventId = map[id];
    if (!eventId) return;
    await deleteEventFor(eventId);
    delete map[id];
    await saveEventMap(userId, map);
  }, [userId]);

  // Backfill any assignment missing an event. Called after every fetch
  // (covers assignments created on another device while sync was off here).
  const reconcileOnLoad = useCallback(async assignments => {
    if (!userId || !syncEnabled) return;
    await backfillMissingEvents(userId, assignments);
  }, [userId, syncEnabled]);

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
    await AsyncStorage.setItem(enabledKey(userId), 'false');
    if (deleteEvents) {
      const calendarId = await ensureAssignmentCalendar();
      await deleteAssignmentCalendar(calendarId);
    }
    await saveEventMap(userId, {});
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
