import { useCallback, useMemo } from 'react';
import {
  cancelReminders,
  getAllScheduledNotificationIds,
  loadReminderIdsFor,
  loadReminderMap,
  makeReminderEntry,
  mergeReminderIds,
  reminderEntryIds,
  reminderEntrySig,
  reminderMapsEqual,
  reminderSig,
  requestNotificationPermission,
  saveReminderMap,
  scheduleReminders,
  scheduleRemindersBatch,
  storeDeviceTimezone,
} from '../lib/notifications';

// Thin, userId-parameterized orchestration layer over the lib/notifications
// primitives. It owns NO React state and performs NO setState/commitLocal.
// Every operation re-loads the on-disk reminder map (`reminder_ids_${userId}`)
// before its read-modify-write, treating disk as the single authoritative
// source — the load effect, AppState effect, realtime handlers, and mutations
// all touch the whole map concurrently on different ids, so an in-memory cache
// would clobber. State commits, stale-fetch guards, self-mutation markers,
// tombstones, and the per-id queue all stay in useAssignments.js.
//
// All callbacks are memoized on [userId] and the returned object is memoized,
// so consumers can safely depend on the whole `reminders` object without
// re-running effects more often than the underlying userId changes.
export function useReminderOrchestration(userId) {
  // Schedule (or refresh) reminders for ONE assignment.
  // - Loads the map, then schedules fresh reminders FIRST — before touching
  //   any existing on-disk ids for this id — and only cancels the old ones
  //   once the new schedule is confirmed. This ordering matters: scheduling
  //   can legitimately produce fewer/zero ids (a trigger already passed, the
  //   iOS pending-cap was hit), but it can also fail transiently (permission
  //   revoked mid-session, a one-off OS scheduling error — see
  //   scheduleRemindersForBudget's swallowed catch in lib/notifications.js).
  //   Cancelling old ids BEFORE confirming the replacement worked meant a
  //   transient failure during an edit could silently delete working
  //   reminders and leave nothing in their place. Scheduling first means a
  //   failure leaves the old ones exactly as they were — nothing lost yet —
  //   and lets the empty-result-but-content-unchanged check below decide
  //   whether to trust the empty result or preserve what's already working.
  // - Writes a {ids, sig} map entry when ids are non-empty, else deletes it.
  // Returns the new reminder id array (or the preserved old ones — see below).
  // Unifies insert's schedule+map, update's schedule+cancel-old+map, and the
  // realtime reconcileRemoteUpsert path.
  //
  // `shouldCancel` is optional and only the realtime upsert path passes it.
  // Realtime events fire unpredictably and can land exactly as the user logs
  // out / switches accounts; in that window we must cancel the just-scheduled
  // OS notifications so we don't leak reminders for a signed-out user. The
  // user-initiated insert/update paths deliberately omit it — they're expected
  // to run to completion.
  const scheduleFor = useCallback(async (assignment, shouldCancel) => {
    // Already torn down before we touched anything: leave the existing
    // reminders AND the map untouched — they're still consistent with disk.
    if (shouldCancel && shouldCancel()) return [];

    const map = await loadReminderMap(userId);
    const oldEntry = map[assignment.id];
    const oldIds = reminderEntryIds(oldEntry ?? []);
    // Pass oldIds.length as reservedSlots: these old reminders are about to
    // be cancelled once the new schedule is confirmed, so they shouldn't
    // count against the very iOS budget snapshot this call takes (which is
    // read BEFORE they're cancelled, since cancelling now happens after —
    // see scheduleReminders' reservedSlots doc for why).
    const reminderIds = assignment.status !== 'completed'
      ? await scheduleReminders(assignment, oldIds.length)
      : [];

    if (shouldCancel && shouldCancel()) {
      // Torn down mid-flight. The old ids and the map were never touched —
      // still exactly consistent with what's actually on the OS — so there's
      // nothing to prune; just undo whatever we just scheduled so it doesn't
      // leak for a signed-out user.
      if (reminderIds.length > 0) await cancelReminders(reminderIds).catch(() => {});
      return [];
    }

    // A non-completed row that HAD working reminders, whose scheduling-
    // relevant content (dueDate/dueTime/title/course) is UNCHANGED from
    // what's already on disk, but scheduling just produced nothing — almost
    // certainly the transient-failure case above, not a legitimate "nothing
    // to schedule" outcome (every trigger time already passed, or the iOS
    // pending-cap was hit — either would require something to have changed
    // since the LAST successful schedule, since neither the due date nor
    // reservedSlots' own-slot accounting moved). Preserve the still-valid
    // old reminders rather than silently leaving the assignment with none;
    // the next successful edit or reconcileOnLoad pass will retry.
    if (
      assignment.status !== 'completed' &&
      reminderIds.length === 0 &&
      oldIds.length > 0 &&
      reminderEntrySig(oldEntry) === reminderSig(assignment)
    ) {
      return oldIds;
    }

    await cancelReminders(oldIds);
    if (reminderIds.length > 0) {
      map[assignment.id] = makeReminderEntry(reminderIds, reminderSig(assignment));
    } else {
      delete map[assignment.id];
    }
    await saveReminderMap(userId, map);
    return reminderIds;
  }, [userId]);

  // Schedule reminders for MANY fresh assignments against one shared iOS slot
  // budget. No pre-cancel (these are brand-new inserts). Returns a list of id
  // arrays in input order. Used by insertMany.
  const scheduleBatchFor = useCallback(async assignments => {
    const reminderIdsList = await scheduleRemindersBatch(assignments);
    const map = await loadReminderMap(userId);
    assignments.forEach((a, i) => {
      const ids = reminderIdsList[i] ?? [];
      if (ids.length > 0) map[a.id] = makeReminderEntry(ids, reminderSig(a));
    });
    await saveReminderMap(userId, map);
    return reminderIdsList;
  }, [userId]);

  // Cancel all reminders for one id and prune its map entry. Reads the
  // on-disk ids (canonical source). Used by remove and reconcileRemoteDelete.
  const cancelFor = useCallback(async id => {
    const oldIds = await loadReminderIdsFor(userId, id);
    await cancelReminders(oldIds);
    const map = await loadReminderMap(userId);
    delete map[id];
    await saveReminderMap(userId, map);
  }, [userId]);

  // Post-fetch reconciliation (load effect Block 2), moved here verbatim.
  //   Phase A — cancel reminders for rows deleted remotely or now completed,
  //             prune the map, flush cleanup to disk.
  //   Phase B — request permission, then (re)schedule rows that are new or
  //             whose sig changed (cancelling stale ids first), save the map,
  //             seed the stored device TZ.
  // `shouldCancel` replaces the inline `if (cancelled) return;` bails — the
  // caller passes a predicate (e.g. () => cancelled || thisFetch < dataVersion)
  // that is checked at the SAME points. On cancel we return early; the caller
  // won't use the return value in that case. Returns the final withReminders
  // array so the caller does setAssignments + cache write under its own guard.
  const reconcileOnLoad = useCallback(async (merged, reminderMap, shouldCancel) => {
    // Phase A — stale-reminder cleanup (no OS permission required).
    const updatedMap = { ...reminderMap };
    const freshIds = new Set(merged.map(a => a.id));

    // 1. Rows in the map but absent from the fresh fetch → deleted remotely.
    for (const id of Object.keys(updatedMap)) {
      if (!freshIds.has(id)) {
        await cancelReminders(reminderEntryIds(updatedMap[id]));
        delete updatedMap[id];
      }
    }
    if (shouldCancel()) return;

    // 2. Rows now completed that still have reminder IDs in the map.
    for (const a of merged) {
      if (a.status === 'completed' && updatedMap[a.id]) {
        await cancelReminders(reminderEntryIds(updatedMap[a.id]));
        delete updatedMap[a.id];
      }
    }
    if (shouldCancel()) return;

    // Rebuild merged so completed rows carry reminderIds: [] going forward.
    const reconciled = merged.map(a =>
      a.status === 'completed' && !updatedMap[a.id]
        ? { ...a, reminderIds: [] }
        : a
    );

    // Flush cleanup to disk now so a crash between here and Phase B
    // doesn't leave stale IDs in the map.
    if (!reminderMapsEqual(updatedMap, reminderMap)) {
      await saveReminderMap(userId, updatedMap);
    }
    if (shouldCancel()) return;

    // Phase A.5 — orphan cleanup: cancel any OS-scheduled notification that
    // the (now-pruned) map no longer accounts for. These are leftovers from
    // a previous install/session whose tracking was lost — left alone they'd
    // fire forever with stale content. Surgical (vs. a blanket
    // cancelAllReminders) so sig-matching rows in Phase B below are never
    // touched and don't get needlessly rescheduled.
    const trackedIds = new Set(Object.values(updatedMap).flatMap(reminderEntryIds));
    const allScheduledIds = await getAllScheduledNotificationIds();
    const orphanIds = allScheduledIds.filter(id => !trackedIds.has(id));
    if (orphanIds.length > 0) await cancelReminders(orphanIds);
    if (shouldCancel()) return;

    // Phase B — schedule new reminders (requires OS permission).
    await requestNotificationPermission();

    const toSchedule = [];
    const staleEntryIds = new Map(); // id → old notification IDs to cancel

    for (const a of reconciled) {
      if (a.status === 'completed') continue;
      const mapEntry = updatedMap[a.id];
      const existingIds = reminderEntryIds(mapEntry ?? []);
      if (existingIds.length === 0) {
        toSchedule.push(a);
      } else {
        const storedSig = reminderEntrySig(mapEntry);
        if (storedSig === null || storedSig !== reminderSig(a)) {
          staleEntryIds.set(a.id, existingIds);
          toSchedule.push(a);
        }
      }
    }

    // Cancel stale notifications before rescheduling.
    for (const [, ids] of staleEntryIds) {
      await cancelReminders(ids);
    }
    if (shouldCancel()) return;

    // Remove stale entries from the map so Phase B's save below
    // doesn't resurrect them.
    for (const id of staleEntryIds.keys()) {
      delete updatedMap[id];
    }

    // For rows being rescheduled, clear their in-memory reminderIds so
    // the state we commit below is consistent with the new map entries.
    const reschedulingIds = new Set(staleEntryIds.keys());
    const reconciledReady = reconciled.map(a =>
      reschedulingIds.has(a.id) ? { ...a, reminderIds: [] } : a
    );

    // Schedule in a single batch against one shared iOS slot budget.
    const newIdsList = await scheduleRemindersBatch(toSchedule);
    const newIdsById = new Map(
      toSchedule.map((a, i) => [a.id, newIdsList[i]])
    );
    const withReminders = reconciledReady.map(a => {
      if (!newIdsById.has(a.id)) return a;
      const ids = newIdsById.get(a.id);
      if (ids.length > 0) updatedMap[a.id] = makeReminderEntry(ids, reminderSig(a));
      return { ...a, reminderIds: ids };
    });
    if (shouldCancel()) return;

    if (!reminderMapsEqual(updatedMap, reminderMap)) {
      await saveReminderMap(userId, updatedMap);
    }

    // Seed the stored device TZ now that we have a known-good schedule.
    await storeDeviceTimezone(userId);

    return withReminders;
  }, [userId]);

  // AppState TZ-change reschedule. Cancels every incomplete row's on-disk
  // reminders, reschedules against one shared iOS budget, updates+saves the
  // map. Includes the "cancelled mid-flight → cancel just-scheduled ids to
  // avoid leaking OS notifications" cleanup. Returns a Map<id, string[]> of
  // new ids so the caller does commitLocal. The caller owns the
  // detectTimezoneChanged check, the no-incomplete branch, the final
  // commitLocal, and the closing storeDeviceTimezone.
  const rescheduleAll = useCallback(async (incomplete, shouldCancel) => {
    // Cancel all currently-scheduled reminders for incomplete rows.
    // Read the on-disk map as the canonical source.
    const map = await loadReminderMap(userId);
    if (shouldCancel()) return null;

    // Work on a copy. As each row's old OS ids are cancelled, drop its entry
    // from the copy so the persisted map never points at cancelled ids. On a
    // mid-flight teardown we flush this copy, leaving every already-cancelled
    // row with NO entry. This matters specially here: a TZ change does NOT
    // alter reminderSig, so a surviving stale entry would be seen as valid by
    // the next reconcileOnLoad and skipped — silently leaving the row with no
    // OS reminders. Pruning forces a reschedule on next load instead.
    const newMap = { ...map };
    let pruned = false;
    for (const a of incomplete) {
      const ids = reminderEntryIds(map[a.id] ?? []);
      if (ids.length > 0) {
        await cancelReminders(ids);
        delete newMap[a.id];
        pruned = true;
      }
      if (shouldCancel()) {
        if (pruned) await saveReminderMap(userId, newMap);
        return null;
      }
    }

    // Reschedule with one shared budget (the batch helper handles it).
    const newIdsList = await scheduleRemindersBatch(incomplete);
    if (shouldCancel()) {
      // Clean up just-scheduled IDs if we got torn down mid-flight so
      // we don't leak OS notifications, and flush the pruned map so the
      // cancelled old ids are no longer recorded as valid.
      for (const ids of newIdsList) {
        if (Array.isArray(ids) && ids.length > 0) {
          await cancelReminders(ids).catch(() => {});
        }
      }
      if (pruned) await saveReminderMap(userId, newMap);
      return null;
    }

    // Update the map: set new IDs where present, drop entries that came
    // back empty (e.g. iOS cap exhausted or the trigger is now past).
    incomplete.forEach((a, i) => {
      const ids = newIdsList[i] ?? [];
      if (ids.length > 0) newMap[a.id] = makeReminderEntry(ids, reminderSig(a));
      else delete newMap[a.id];
    });
    if (!reminderMapsEqual(newMap, map)) {
      await saveReminderMap(userId, newMap);
    }
    if (shouldCancel()) return null;

    // Return the per-id new ids so the caller reflects them into state.
    return new Map(incomplete.map((a, i) => [a.id, newIdsList[i] ?? []]));
  }, [userId]);

  return useMemo(() => ({
    scheduleFor,
    scheduleBatchFor,
    cancelFor,
    reconcileOnLoad,
    rescheduleAll,
  }), [scheduleFor, scheduleBatchFor, cancelFor, reconcileOnLoad, rescheduleAll]);
}
