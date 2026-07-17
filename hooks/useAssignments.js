import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  VALID_STATUSES,
  isValidDate,
  rowsMatch,
  sanitizeAssignment,
} from '../lib/assignment';
import {
  dbDelete,
  dbDeleteSeries,
  dbInsert,
  dbInsertMany,
  dbFetch,
  dbUpdate,
} from '../lib/assignmentsDb';
import {
  detectTimezoneChanged,
  loadReminderMap,
  mergeReminderIds,
  storeDeviceTimezone,
} from '../lib/notifications';
import { uuidv4 } from '../lib/uuid';
import { useCalendarOrchestration } from './useCalendarOrchestration';
import { useReminderOrchestration } from './useReminderOrchestration';
import { useRealtimeSync } from './useRealtimeSync';

// AsyncStorage key for the cached assignment list.
// One key per userId so accounts don't cross-contaminate.
function storageKey(userId) {
  return `assignments_${userId}`;
}

// Owns the full assignment lifecycle for a logged-in user:
//   - Hybrid load: AsyncStorage cache shown first, Supabase fetch overlays.
//   - Stale-fetch guard: writes that land mid-fetch are not clobbered.
//   - CRUD: insert / insertMany / update / remove, each keeping the cache,
//     the on-disk reminder map, and OS-scheduled notifications consistent.
//   - Reminders: cancellation always reads from the on-disk map (the
//     authoritative source) rather than possibly-stale in-memory state.
export function useAssignments(userId) {
  const [assignments, setAssignments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState('');

  // Reminder orchestration: a thin async layer over lib/notifications that
  // owns all OS-notification scheduling/cancellation + reminder-map
  // persistence. It holds no React state; every commit stays here.
  const reminders = useReminderOrchestration(userId);

  // Calendar sync orchestration: same shape as `reminders`, but for the
  // opt-in native-calendar mirror (see hooks/useCalendarOrchestration.js).
  // Every one of its methods is internally gated on syncEnabled, so calling
  // them unconditionally alongside the reminder calls below is safe and
  // matches how `reminders` is already called unconditionally.
  const calendar = useCalendarOrchestration(userId);
  // Destructured because `calendar` itself is NOT a stable reference the way
  // `reminders` is — it carries syncEnabled/loaded React state that changes
  // asynchronously shortly after mount, so the whole object gets a fresh
  // identity right after that settles. These four methods, individually,
  // ARE stable per-userId (see useCalendarOrchestration.js). Effects and
  // callbacks below depend on these specific functions, never on `calendar`
  // as a whole — depending on the whole object would re-run the load effect
  // (and thus re-fetch + re-schedule everything) a second time on every
  // mount, right when syncEnabled/loaded finish loading from disk.
  const {
    scheduleFor: calendarScheduleFor,
    scheduleBatchFor: calendarScheduleBatchFor,
    cancelFor: calendarCancelFor,
    reconcileOnLoad: calendarReconcileOnLoad,
    enableSync: calendarEnableSync,
    disableSync: calendarDisableSync,
  } = calendar;

  // Monotonic counter for fetch attempts. Each successful local write also
  // bumps it so an in-flight fetch result older than the latest write is dropped.
  const fetchSeqRef = useRef(0);
  // The latest "data version" we trust. Fetch results <= this are ignored.
  const dataVersionRef = useRef(0);

  // Self-mutation tracking. The goal is to suppress only the realtime echo
  // of OUR write — never to drop a genuine concurrent change from another
  // device. Approach varies per event kind:
  //
  //   INSERT — we mint the id client-side, so any INSERT echo for that id
  //   is necessarily ours (no other device can have produced this UUID).
  //   The marker has a `pending` phase (no TTL, lives until dbInsert
  //   settles) so a slow network can't expire it before the echo arrives.
  //
  //   UPDATE — concurrent updates from other devices can target the same
  //   id, so we cannot suppress by id alone. After dbUpdate settles we
  //   store the returned row as a `signature`; an UPDATE echo is treated
  //   as ours only when its (id, mapped fields) match. Anything else is a
  //   real remote write and goes through.
  //
  //   DELETE — applying a DELETE twice is a no-op for both state and the
  //   reminder map, so there is no need to suppress at all. Even better:
  //   not suppressing means a concurrent same-id delete from another
  //   device can never be silently dropped.
  //
  // `clearSelfMutation` is called on DB failure so a stale marker doesn't
  // outlive a doomed write and block real remote events from another
  // device targeting that id.
  const selfMutationsRef = useRef(new Map());
  const SELF_MUTATION_TTL_MS = 8000;

  // Tombstones: ids of rows we DELETED on this device, kept for a short
  // window. The race they prevent: another device commits an UPDATE
  // *before* our DELETE lands at the DB, but its realtime event arrives
  // at us *after* our delete completes. That event is real (the server
  // saw it), but applying it would resurrect a row whose final server
  // state is "deleted". The tombstone tells the realtime handler to
  // drop UPDATE/INSERT events for that id until the TTL elapses (by
  // which time any in-flight echoes have surely landed).
  const tombstonesRef = useRef(new Map());
  const TOMBSTONE_TTL_MS = 30000;
  const markTombstone = useCallback(id => {
    tombstonesRef.current.set(id, Date.now() + TOMBSTONE_TTL_MS);
  }, []);
  const isTombstoned = useCallback(id => {
    const exp = tombstonesRef.current.get(id);
    if (!exp) return false;
    if (Date.now() > exp) {
      tombstonesRef.current.delete(id);
      return false;
    }
    return true;
  }, []);
  const markPendingInsert = useCallback(id => {
    selfMutationsRef.current.set(id, { phase: 'pending', signature: null, expiresAt: null });
  }, []);
  const settleSelfMutation = useCallback((id, signature) => {
    selfMutationsRef.current.set(id, {
      phase: 'settled',
      signature,
      expiresAt: Date.now() + SELF_MUTATION_TTL_MS,
    });
  }, []);
  const clearSelfMutation = useCallback(id => {
    selfMutationsRef.current.delete(id);
  }, []);
  // Returns true if this realtime event matches a write WE issued, by the
  // narrowest criterion we can prove for that event kind. Anything else
  // is treated as a remote event and processed.
  const isOwnEcho = useCallback((id, event, incomingRow) => {
    const marker = selfMutationsRef.current.get(id);
    if (!marker) return false;
    if (marker.phase === 'settled' && Date.now() > marker.expiresAt) {
      selfMutationsRef.current.delete(id);
      return false;
    }
    if (event === 'INSERT') {
      // Brand-new UUID; if we have any marker for it, the event is ours.
      return true;
    }
    if (event === 'UPDATE') {
      return marker.phase === 'settled' && rowsMatch(marker.signature, incomingRow);
    }
    // DELETE: never suppress — both our local delete and another device's
    // delete of the same row converge on the same final state.
    return false;
  }, []);

  // Shared per-id promise chain used by BOTH the local UPDATE path and
  // the realtime handler. Two reasons it must be shared:
  //   1. The realtime echo of a local UPDATE can arrive before dbUpdate's
  //      await resolves; if both ran concurrently they would race on the
  //      reminder map and leak the loser's scheduled OS notifications.
  //   2. Real concurrent UPDATE/DELETE events from other devices targeting
  //      the same id must still be serialized in arrival order (already
  //      enforced by the queue) and must not be dropped by a too-coarse
  //      suppression filter (the isOwnEcho check is rerun inside the
  //      queued work, AFTER any in-flight local mutation has settled).
  // Returned promise resolves/rejects with the wrapped fn's outcome so
  // callers (e.g. App.js's runMutation) still see the real result.
  const queuesRef = useRef(new Map());
  const enqueueForId = useCallback((id, fn) => {
    const chain = queuesRef.current.get(id) ?? Promise.resolve();
    const result = chain.then(fn);
    const cleanup = result.catch(() => {});
    queuesRef.current.set(id, cleanup);
    cleanup.then(() => {
      if (queuesRef.current.get(id) === cleanup) queuesRef.current.delete(id);
    });
    return result;
  }, []);

  // Apply a state update + write-through to AsyncStorage.
  // Also bumps the data version so any in-flight fetch can't overwrite it.
  const commitLocal = useCallback(updater => {
    setAssignments(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (userId) {
        AsyncStorage.setItem(storageKey(userId), JSON.stringify(next)).catch(() => {});
      }
      dataVersionRef.current = fetchSeqRef.current + 1;
      fetchSeqRef.current = dataVersionRef.current;
      return next;
    });
  }, [userId]);

  // Load: cache first, network second. Reschedules reminders for
  // incomplete assignments that have no IDs on disk (e.g. after sign-out).
  useEffect(() => {
    if (!userId) {
      setAssignments([]);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    fetchSeqRef.current += 1;
    const thisFetch = fetchSeqRef.current;

    setLoaded(false);
    setSyncError('');

    (async () => {
      // Show cached data immediately. Isolated try so a corrupt cache
      // never blocks the network fetch.
      try {
        const cached = await AsyncStorage.getItem(storageKey(userId));
        if (!cancelled && cached && thisFetch >= dataVersionRef.current) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            setAssignments(parsed.map(sanitizeAssignment).filter(Boolean));
          }
        }
      } catch {
        // Cache unreadable — proceed to Supabase fetch regardless
      }

      // Fetch and reminder scheduling are split into two try blocks so a
      // notification permission/scheduling failure can't mask a successful fetch.
      // Block 1 — DB fetch + immediate state commit.
      // Reminder work is intentionally excluded here: a permission prompt or
      // scheduling failure must never mask a successful fetch or produce a
      // misleading "could not reach server" banner.
      let merged;
      let reminderMap;
      try {
        const [fresh, loadedMap] = await Promise.all([
          dbFetch(userId),
          loadReminderMap(userId),
        ]);
        if (cancelled) return;

        if (thisFetch < dataVersionRef.current) {
          setLoaded(true);
          return;
        }

        reminderMap = loadedMap;
        merged = mergeReminderIds(fresh, reminderMap);

        dataVersionRef.current = thisFetch;
        setAssignments(merged);
        AsyncStorage.setItem(storageKey(userId), JSON.stringify(merged))
          .catch(() => {});
      } catch {
        if (!cancelled) {
          setSyncError('Could not reach the server. Showing cached data.');
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }

      // Block 2 — best-effort reminder rescheduling. Runs only when the fetch
      // succeeded (merged is set). Isolated so any reminder failure is
      // swallowed and never surfaces as a sync/fetch error. The orchestration
      // layer does Phase A cleanup + Phase B (re)scheduling + the device-TZ
      // seed; the shouldCancel predicate folds in BOTH the teardown flag and
      // the stale-fetch guard so the same bail points fire as before.
      if (!cancelled && merged) {
        try {
          const withReminders = await reminders.reconcileOnLoad(
            merged,
            reminderMap,
            () => cancelled || thisFetch < dataVersionRef.current,
          );
          if (cancelled || thisFetch < dataVersionRef.current || !withReminders) return;

          setAssignments(withReminders);
          AsyncStorage.setItem(storageKey(userId), JSON.stringify(withReminders))
            .catch(() => {});
        } catch {
          // Permission or scheduling failed — assignments are already rendered.
        }
      }

      // Block 3 — best-effort calendar backfill. Separate from Block 2 and
      // independently try/caught so a calendar failure can never mask a
      // reminder-scheduling failure or vice versa. Uses `merged` (the raw
      // fetched rows) rather than reminders' `withReminders` — calendar
      // sync doesn't touch reminderIds, so it doesn't need to wait on or
      // depend on Block 2 succeeding. A no-op internally when sync is off.
      if (!cancelled && merged && thisFetch >= dataVersionRef.current) {
        try {
          await calendarReconcileOnLoad(merged);
        } catch {
          // Permission or calendar-API failure — assignments already rendered.
        }
      }
    })();

    return () => { cancelled = true; };
  }, [userId, reminders, calendarReconcileOnLoad]);

  // Keep a ref to the latest assignments list so the AppState listener can
  // read the current state without being recreated on every change. Using a
  // ref (instead of a dep) avoids tearing down + re-subscribing the OS
  // listener every time a user types in the form.
  const assignmentsRef = useRef(assignments);
  useEffect(() => { assignmentsRef.current = assignments; }, [assignments]);

  // --- AppState — TZ-change reschedule -------------------------------------
  // When the app foregrounds, compare device TZ to the persisted value. If
  // it changed (e.g. user travelled, manual settings change), cancel and
  // reschedule every incomplete-assignment reminder against ONE shared iOS
  // slot budget. CALENDAR triggers should self-adjust on iOS, but this
  // belt-and-suspenders pass guarantees correctness on Android (AlarmManager
  // behaviour is less reliable across TZ changes) and acts as a recovery
  // path if the OS dropped any reminders while the app was backgrounded.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const sub = AppState.addEventListener('change', async nextState => {
      if (nextState !== 'active') return;
      if (cancelled) return;
      try {
        const changed = await detectTimezoneChanged(userId);
        if (cancelled || !changed) return;

        const incomplete = assignmentsRef.current
          .filter(a => a.status !== 'completed');

        // No active reminders to fix; just refresh the stored TZ so the next
        // change is detected against the new baseline.
        if (incomplete.length === 0) {
          await storeDeviceTimezone(userId);
          return;
        }

        // Cancel + reschedule all incomplete rows against one shared iOS
        // budget, updating the on-disk map. Returns a Map<id, newIds> (or
        // null if torn down mid-flight, in which case it already cleaned up
        // any just-scheduled OS notifications).
        const idsById = await reminders.rescheduleAll(incomplete, () => cancelled);
        if (cancelled || !idsById) return;

        // Reflect new reminder IDs in state (and cache).
        commitLocal(prev => prev.map(a => (
          idsById.has(a.id) ? { ...a, reminderIds: idsById.get(a.id) } : a
        )));

        await storeDeviceTimezone(userId);
      } catch {
        // Reschedule failed — assignments still render. The stored TZ is
        // intentionally NOT updated, so we'll retry on the next foreground.
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [userId, commitLocal, reminders]);

  // --- Realtime sync -------------------------------------------------------
  // The subscription LIFECYCLE (channel setup, payload decode, teardown,
  // error surfacing) lives in useRealtimeSync. The reconcile POLICY below
  // stays here because it shares the per-id queue, self-mutation markers, and
  // tombstones with the local mutation paths — splitting them would break the
  // serialization that suppresses a local write's own echo.

  // Apply a decoded remote upsert (INSERT or UPDATE) for `row`. Runs inside
  // the per-id queue so a concurrent local mutation for the same id (or its
  // echo) serializes against it. `isCancelled` is the realtime hook's
  // teardown predicate (flips on logout / user switch / unmount).
  const enqueueUpsert = useCallback((event, row, isCancelled) => (
    enqueueForId(row.id, async () => {
      if (isCancelled()) return;
      if (isOwnEcho(row.id, event, row)) return;
      // Drop non-DELETE events for rows we just deleted. Applying a stale
      // UPDATE/INSERT here would re-add a phantom row + schedule reminders
      // for a record the server no longer has.
      if (isTombstoned(row.id)) return;

      // Cancel-from-disk + (re)schedule + map persist for the upserted row,
      // then reflect the new ids into state. Pass isCancelled as scheduleFor's
      // teardown predicate so a logout landing mid-schedule cancels the
      // just-scheduled OS notifications instead of leaking them.
      const reminderIds = await reminders.scheduleFor(row, isCancelled);
      if (isCancelled()) return;
      const withReminders = { ...row, reminderIds };

      // Calendar sync has no teardown-cancellation param, unlike reminders:
      // a stray calendar event surviving a mid-flight logout is a single
      // extra row the next reconcileOnLoad pass would just leave alone (no
      // 64-slot OS cap to protect, unlike notifications), so the added
      // complexity of a cancel-aware path isn't worth it here. Internally
      // gated on syncEnabled — safe to call unconditionally.
      await calendarScheduleFor(row);
      if (isCancelled()) return;

      commitLocal(prev => {
        if (prev.some(a => a.id === row.id)) {
          return prev.map(a => a.id === row.id ? withReminders : a);
        }
        // Row not in local state: always add it, regardless of event type.
        // An UPDATE can arrive for a row we haven't seen when this device
        // came online after the original INSERT was delivered (e.g. the
        // channel subscription missed the INSERT event). Treating the
        // upsert as authoritative ensures the row is visible and its
        // reminders — already scheduled above — are reachable.
        return [withReminders, ...prev];
      });
    })
  ), [enqueueForId, isOwnEcho, isTombstoned, reminders, calendarScheduleFor, commitLocal]);

  const onInsert = useCallback((row, isCancelled) => {
    // Fast-path: an INSERT echo is provably ours if any marker for this id
    // exists (the UUID is client-generated and unique to us). Skip without
    // enqueuing.
    if (isOwnEcho(row.id, 'INSERT', row)) return;
    enqueueUpsert('INSERT', row, isCancelled);
  }, [isOwnEcho, enqueueUpsert]);

  const onUpdate = useCallback((row, isCancelled) => {
    // For UPDATE we defer the isOwnEcho check until the queued work runs — if
    // a local update is in flight, its marker isn't installed yet but its
    // queue entry is already ahead of us; by the time we run, the marker is
    // settled and the signature comparison catches our own echo.
    enqueueUpsert('UPDATE', row, isCancelled);
  }, [enqueueUpsert]);

  const onDelete = useCallback((id, isCancelled) => (
    enqueueForId(id, async () => {
      if (isCancelled()) return;
      // DELETE is never suppressed as a self-echo — both our local delete and
      // another device's delete of the same row converge on the same final
      // state, so isOwnEcho('DELETE', …) always returns false. The tombstone
      // check does not apply to DELETE.
      if (isOwnEcho(id, 'DELETE', null)) return;
      await reminders.cancelFor(id);
      await calendarCancelFor(id);
      if (isCancelled()) return;
      commitLocal(prev => prev.filter(a => a.id !== id));
    })
  ), [enqueueForId, isOwnEcho, reminders, calendarCancelFor, commitLocal]);

  const onError = useCallback(msg => setSyncError(msg), []);

  useRealtimeSync({ userId, onInsert, onUpdate, onDelete, onError });

  // --- Mutations -----------------------------------------------------------

  const insert = useCallback(assignment => {
    // Mint the id and pending-mark BEFORE we enqueue, then run the entire
    // dbInsert + reminder + commit flow inside the per-id queue. That way
    // any realtime UPDATE/DELETE for this row from another device (which
    // can arrive between dbInsert resolving and our commit) queues behind
    // us and can't race on the reminder map or state.
    const id = uuidv4();
    markPendingInsert(id);
    return enqueueForId(id, async () => {
      let saved;
      try {
        saved = await dbInsert({ ...assignment, id }, userId);
      } catch (err) {
        clearSelfMutation(id);
        throw err;
      }
      settleSelfMutation(saved.id, saved);
      const reminderIds = await reminders.scheduleFor(saved);
      await calendarScheduleFor(saved);
      const withReminders = { ...saved, reminderIds };
      commitLocal(prev => prev.some(a => a.id === saved.id)
        ? prev.map(a => a.id === saved.id ? withReminders : a)
        : [withReminders, ...prev]
      );
      return withReminders;
    });
  }, [userId, commitLocal, markPendingInsert, settleSelfMutation, clearSelfMutation, enqueueForId, reminders, calendarScheduleFor]);

  const insertMany = useCallback(drafts => {
    const withIds = drafts.map(d => ({ ...d, id: uuidv4() }));
    for (const d of withIds) markPendingInsert(d.id);

    // Run the whole batch inside ONE async task, then enqueue that same
    // task under every id's queue. The first enqueue actually executes;
    // the rest just await the shared promise. Result: realtime events for
    // ANY of the new ids must wait until the batch finishes — no race on
    // the reminder map or state.
    const batchWork = async () => {
      let saved;
      try {
        saved = await dbInsertMany(withIds, userId);
      } catch (err) {
        for (const d of withIds) clearSelfMutation(d.id);
        throw err;
      }
      for (const a of saved) settleSelfMutation(a.id, a);
      // Use the batch helper so all assignments in the series share one iOS
      // pending-slot budget — avoids overcounting when parallel calls each
      // read the same pending count and collectively overrun the 64-cap.
      const reminderIdsList = await reminders.scheduleBatchFor(saved);
      await calendarScheduleBatchFor(saved);
      const withReminders = saved.map((a, i) => ({ ...a, reminderIds: reminderIdsList[i] }));
      commitLocal(prev => {
        const byId = new Map(prev.map(a => [a.id, a]));
        for (const r of withReminders) {
          if (!byId.has(r.id)) byId.set(r.id, r);
        }
        const existed = new Set(prev.map(a => a.id));
        const fresh = withReminders.filter(r => !existed.has(r.id));
        return [...fresh, ...prev];
      });
      return withReminders;
    };

    let primary;
    for (const d of withIds) {
      if (primary === undefined) {
        primary = enqueueForId(d.id, batchWork);
      } else {
        // Subsequent ids just await the shared batch result. We swallow
        // errors here so a failed batch doesn't reject every per-id chain
        // with the same error (the original caller still sees it via the
        // returned `primary` promise).
        enqueueForId(d.id, () => primary.catch(() => {}));
      }
    }
    return primary;
  }, [userId, commitLocal, markPendingInsert, settleSelfMutation, clearSelfMutation, enqueueForId, reminders, calendarScheduleBatchFor]);

  const update = useCallback((id, changes) => enqueueForId(id, async () => {
    // The whole UPDATE flow runs inside the per-id queue. That way an
    // echo for the SAME id can't race us — it enqueues after our work and
    // runs only once we've settled the signature marker. Other devices'
    // UPDATE/DELETE events for unrelated ids still process in parallel.
    const updated = await dbUpdate(id, userId, changes);
    settleSelfMutation(id, updated);

    // scheduleFor cancels the OLD reminders read from the on-disk map (NOT
    // in-memory state, which may be stale), schedules new ones unless the
    // row is now completed, and persists/prunes the map entry.
    const reminderIds = await reminders.scheduleFor(updated);
    await calendarScheduleFor(updated);

    const withReminders = { ...updated, reminderIds };
    commitLocal(prev => prev.map(a => a.id === id ? withReminders : a));
    return withReminders;
  }), [userId, commitLocal, settleSelfMutation, enqueueForId, reminders, calendarScheduleFor]);

  const remove = useCallback(id => enqueueForId(id, async () => {
    // Still no self-mutation marker — DELETE is idempotent on state and
    // the reminder map, so a concurrent delete from another device can
    // safely flow through. Queueing forces any in-flight remote UPDATE
    // for this id to either land before us, or after our delete has
    // cleared the slate.
    //
    // After dbDelete succeeds we mark a tombstone. That covers the
    // inverse race: another device's UPDATE that committed *before* our
    // delete (server applied it, then applied our delete on top) can
    // emit a realtime event we receive *after* our delete completes.
    // Without the tombstone, that event would reconcile and resurrect
    // the row. With it, the realtime handler drops UPDATE/INSERT events
    // for this id during the TTL window.
    await dbDelete(id, userId);
    markTombstone(id);
    await reminders.cancelFor(id);
    await calendarCancelFor(id);
    commitLocal(prev => prev.filter(a => a.id !== id));
  }), [userId, commitLocal, enqueueForId, markTombstone, reminders, calendarCancelFor]);

  // Delete every assignment in a recurring series at once. Shares ONE
  // batch task across the per-id queues of ALL affected ids — same
  // reasoning as insertMany's shared-batch pattern — so a concurrent
  // realtime event for any row in the series serializes against the
  // series deletion rather than racing it. On DB error nothing is
  // tombstoned, no reminders are cancelled, and no rows are removed from
  // state: the throw happens before any side effects.
  const removeSeries = useCallback(seriesId => {
    const ids = assignments.filter(a => a.seriesId === seriesId).map(a => a.id);
    if (ids.length === 0) return Promise.resolve();

    const batchWork = async () => {
      await dbDeleteSeries(seriesId, userId);
      for (const id of ids) {
        markTombstone(id);
        await reminders.cancelFor(id);
        await calendarCancelFor(id);
      }
      commitLocal(prev => prev.filter(a => a.seriesId !== seriesId));
    };

    let primary;
    for (const id of ids) {
      if (primary === undefined) {
        primary = enqueueForId(id, batchWork);
      } else {
        enqueueForId(id, () => primary.catch(() => {}));
      }
    }
    return primary;
  }, [assignments, userId, commitLocal, enqueueForId, markTombstone, reminders, calendarCancelFor]);

  const clearSyncError = useCallback(() => setSyncError(''), []);
  const reportSyncError = useCallback(msg => setSyncError(msg), []);

  // Thin wrappers that close over the current `assignments` state so callers
  // (ProfileModal, via App.js) don't need to pass the list themselves —
  // backfilling every current assignment on enable is an implementation
  // detail of "turning sync on", not something the UI layer should own.
  const enableCalendarSync = useCallback(
    () => calendarEnableSync(assignments),
    [calendarEnableSync, assignments],
  );
  const disableCalendarSync = useCallback(
    deleteEvents => calendarDisableSync(deleteEvents),
    [calendarDisableSync],
  );

  return {
    assignments,
    loaded,
    syncError,
    clearSyncError,
    reportSyncError,
    insert,
    insertMany,
    update,
    remove,
    removeSeries,
    calendarSyncEnabled: calendar.syncEnabled,
    calendarSyncLoaded: calendar.loaded,
    enableCalendarSync,
    disableCalendarSync,
  };
}

// Re-exported so existing callers don't need immediate import-path changes.
export { isValidDate, sanitizeAssignment };
