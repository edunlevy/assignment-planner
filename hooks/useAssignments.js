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
  dbInsert,
  dbInsertMany,
  dbFetch,
  dbUpdate,
  fromDb,
} from '../lib/assignmentsDb';
import {
  cancelReminders,
  detectTimezoneChanged,
  loadReminderIdsFor,
  loadReminderMap,
  mergeReminderIds,
  reminderMapsEqual,
  requestNotificationPermission,
  saveReminderMap,
  scheduleReminders,
  scheduleRemindersBatch,
  storeDeviceTimezone,
} from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { uuidv4 } from '../lib/uuid';

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

      // Block 2 — best-effort reminder rescheduling.
      // Runs only when the fetch succeeded (merged is set). Isolated so any
      // failure (permission denied, iOS cap hit, AsyncStorage error) is
      // swallowed here and never surfaces as a sync/fetch error.
      // Asks for permission here so the OS prompt appears after the user has
      // seen their assignments. Subsequent calls return the cached status
      // instantly — no repeated prompts.
      if (!cancelled && merged) {
        try {
          // Phase A — stale-reminder cleanup (no OS permission required).
          // Cancellation is the inverse of scheduling and must happen even if
          // the user has denied notification permission. Running it before
          // requestNotificationPermission() ensures a slow or failed permission
          // prompt cannot block the cleanup of deleted/completed rows.
          const updatedMap = { ...reminderMap };
          const freshIds = new Set(merged.map(a => a.id));

          // 1. Rows in the map but absent from the fresh fetch → deleted remotely.
          for (const id of Object.keys(updatedMap)) {
            if (!freshIds.has(id)) {
              await cancelReminders(updatedMap[id]);
              delete updatedMap[id];
            }
          }
          if (cancelled) return;

          // 2. Rows now completed that still have reminder IDs in the map.
          for (const a of merged) {
            if (a.status === 'completed' && updatedMap[a.id]) {
              await cancelReminders(updatedMap[a.id]);
              delete updatedMap[a.id];
            }
          }
          if (cancelled) return;

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
          if (cancelled) return;

          // Phase B — schedule new reminders (requires OS permission).
          // Gated separately so a denied/erroring permission prompt can never
          // prevent Phase A cleanup from completing.
          // Asks for permission after data is rendered; iOS caches the answer
          // so subsequent calls return immediately without prompting again.
          await requestNotificationPermission();

          // Schedule in a single batch against one shared iOS slot budget so
          // concurrent schedules can't collectively overrun the 64-pending cap.
          const needsScheduling = reconciled.filter(
            a => a.status !== 'completed' && a.reminderIds.length === 0
          );
          const newIdsList = await scheduleRemindersBatch(needsScheduling);
          const newIdsById = new Map(
            needsScheduling.map((a, i) => [a.id, newIdsList[i]])
          );
          const withReminders = reconciled.map(a => {
            if (!newIdsById.has(a.id)) return a;
            const ids = newIdsById.get(a.id);
            if (ids.length > 0) updatedMap[a.id] = ids;
            return { ...a, reminderIds: ids };
          });
          if (cancelled || thisFetch < dataVersionRef.current) return;

          if (!reminderMapsEqual(updatedMap, reminderMap)) {
            await saveReminderMap(userId, updatedMap);
          }
          setAssignments(withReminders);
          AsyncStorage.setItem(storageKey(userId), JSON.stringify(withReminders))
            .catch(() => {});

          // Seed the stored device TZ now that we have a known-good schedule.
          // The AppState listener compares against this on foreground.
          await storeDeviceTimezone(userId);
        } catch {
          // Permission or scheduling failed — assignments are already rendered.
        }
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

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

        // Cancel all currently-scheduled reminders for incomplete rows.
        // Read the on-disk map as the canonical source (matches the
        // CRUD path's cancel-from-disk discipline).
        const map = await loadReminderMap(userId);
        if (cancelled) return;
        for (const a of incomplete) {
          const ids = map[a.id] ?? [];
          if (ids.length > 0) await cancelReminders(ids);
          if (cancelled) return;
        }

        // Reschedule with one shared budget (the batch helper handles it).
        const newIdsList = await scheduleRemindersBatch(incomplete);
        if (cancelled) {
          // Clean up just-scheduled IDs if we got torn down mid-flight so
          // we don't leak OS notifications.
          for (const ids of newIdsList) {
            if (Array.isArray(ids) && ids.length > 0) {
              await cancelReminders(ids).catch(() => {});
            }
          }
          return;
        }

        // Update the map: set new IDs where present, drop entries that came
        // back empty (e.g. iOS cap exhausted or the trigger is now past).
        const newMap = { ...map };
        incomplete.forEach((a, i) => {
          const ids = newIdsList[i] ?? [];
          if (ids.length > 0) newMap[a.id] = ids;
          else delete newMap[a.id];
        });
        if (!reminderMapsEqual(newMap, map)) {
          await saveReminderMap(userId, newMap);
        }
        if (cancelled) return;

        // Reflect new reminder IDs in state (and cache).
        const idsById = new Map(incomplete.map((a, i) => [a.id, newIdsList[i] ?? []]));
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
  }, [userId, commitLocal]);

  // --- Realtime sync -------------------------------------------------------
  // Subscribe to assignments-table changes filtered by user_id so a write
  // on Device A is reflected on Device B within ~1s, and reminders are
  // (re)scheduled or cancelled on this device accordingly. Self-echoes are
  // suppressed via the selfMutationsRef set so we don't double-apply the
  // mutation that originated locally.
  //
  // Requires the table to be in the supabase_realtime publication:
  //   alter publication supabase_realtime add table public.assignments;
  // See NOTES.md.
  useEffect(() => {
    if (!userId) return;

    // `cancelled` flips on logout / user switch. Every handler checks it
    // before doing reminder work AND before committing state, so a slow
    // handler that started under user A can't write to user B's state or
    // bump the data-version refs and starve user B's fetch.
    let cancelled = false;

    async function reconcileRemoteUpsert(row) {
      const oldIds = await loadReminderIdsFor(userId, row.id);
      if (cancelled) return null;
      await cancelReminders(oldIds);
      if (cancelled) return null;
      const reminderIds = row.status !== 'completed'
        ? await scheduleReminders(row)
        : [];
      if (cancelled) {
        // Don't leak the just-scheduled OS notifications if we're tearing
        // down — cancel them before bailing.
        await cancelReminders(reminderIds).catch(() => {});
        return null;
      }
      const map = await loadReminderMap(userId);
      if (cancelled) return null;
      if (reminderIds.length > 0) map[row.id] = reminderIds;
      else delete map[row.id];
      await saveReminderMap(userId, map);
      return { ...row, reminderIds };
    }

    async function reconcileRemoteDelete(id) {
      const oldIds = await loadReminderIdsFor(userId, id);
      if (cancelled) return;
      await cancelReminders(oldIds);
      if (cancelled) return;
      const map = await loadReminderMap(userId);
      if (cancelled) return;
      delete map[id];
      await saveReminderMap(userId, map);
    }

    const channel = supabase
      .channel(`assignments:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignments', filter: `user_id=eq.${userId}` },
        payload => {
          const event = payload.eventType;
          const id = payload.new?.id ?? payload.old?.id;
          if (!id) return;
          const incomingRow = payload.new ? fromDb(payload.new) : null;

          // Fast-path: an INSERT echo is provably ours if any marker for
          // this id exists (the UUID is client-generated and unique to us).
          // Cheap to skip without enqueuing.
          if (event === 'INSERT' && isOwnEcho(id, event, incomingRow)) return;

          // For UPDATE/DELETE we MUST defer the isOwnEcho check until the
          // queued work runs — if a local update is in flight, its marker
          // is not installed yet but its own queue entry is already ahead
          // of us. By the time we run, the marker is settled and the
          // signature comparison will catch our own echo.
          enqueueForId(id, async () => {
            if (cancelled) return;
            if (isOwnEcho(id, event, incomingRow)) return;
            // Drop non-DELETE events for rows we just deleted. The DB has
            // already serialized the writes; whichever order they hit,
            // the final state is gone. Applying a stale UPDATE/INSERT
            // here would re-add a phantom row + schedule reminders for
            // a record the server no longer has.
            if (event !== 'DELETE' && isTombstoned(id)) return;

            if (event === 'DELETE') {
              await reconcileRemoteDelete(id);
              if (cancelled) return;
              commitLocal(prev => prev.filter(a => a.id !== id));
              return;
            }

            const withReminders = await reconcileRemoteUpsert(incomingRow);
            if (cancelled || !withReminders) return;

            commitLocal(prev => {
              if (prev.some(a => a.id === id)) {
                return prev.map(a => a.id === id ? withReminders : a);
              }
              // Row not in local state: always add it, regardless of event type.
              // An UPDATE can arrive for a row we haven't seen when this device
              // came online after the original INSERT was delivered (e.g. the
              // channel subscription missed the INSERT event). Treating the
              // upsert as authoritative ensures the row is visible and its
              // reminders — already scheduled above — are reachable.
              return [withReminders, ...prev];
            });
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId, commitLocal, isOwnEcho, enqueueForId, isTombstoned]);

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
      const reminderIds = await scheduleReminders(saved);
      const map = await loadReminderMap(userId);
      if (reminderIds.length > 0) map[saved.id] = reminderIds;
      await saveReminderMap(userId, map);
      const withReminders = { ...saved, reminderIds };
      commitLocal(prev => prev.some(a => a.id === saved.id)
        ? prev.map(a => a.id === saved.id ? withReminders : a)
        : [withReminders, ...prev]
      );
      return withReminders;
    });
  }, [userId, commitLocal, markPendingInsert, settleSelfMutation, clearSelfMutation, enqueueForId]);

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
      const reminderIdsList = await scheduleRemindersBatch(saved);
      const withReminders = saved.map((a, i) => ({ ...a, reminderIds: reminderIdsList[i] }));
      const map = await loadReminderMap(userId);
      for (const a of withReminders) {
        if (a.reminderIds.length > 0) map[a.id] = a.reminderIds;
      }
      await saveReminderMap(userId, map);
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
  }, [userId, commitLocal, markPendingInsert, settleSelfMutation, clearSelfMutation, enqueueForId]);

  const update = useCallback((id, changes) => enqueueForId(id, async () => {
    // The whole UPDATE flow runs inside the per-id queue. That way an
    // echo for the SAME id can't race us — it enqueues after our work and
    // runs only once we've settled the signature marker. Other devices'
    // UPDATE/DELETE events for unrelated ids still process in parallel.
    const updated = await dbUpdate(id, userId, changes);
    settleSelfMutation(id, updated);

    // Always cancel using the on-disk map. In-memory state may be stale
    // (e.g. user opened the edit modal before the network fetch finished
    // merging reminder IDs in), which would silently leak notifications.
    const oldIds = await loadReminderIdsFor(userId, id);
    await cancelReminders(oldIds);

    const reminderIds = updated.status !== 'completed'
      ? await scheduleReminders(updated)
      : [];

    const map = await loadReminderMap(userId);
    if (reminderIds.length > 0) map[id] = reminderIds;
    else delete map[id];
    await saveReminderMap(userId, map);

    const withReminders = { ...updated, reminderIds };
    commitLocal(prev => prev.map(a => a.id === id ? withReminders : a));
    return withReminders;
  }), [userId, commitLocal, settleSelfMutation, enqueueForId]);

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
    const oldIds = await loadReminderIdsFor(userId, id);
    await cancelReminders(oldIds);
    const map = await loadReminderMap(userId);
    delete map[id];
    await saveReminderMap(userId, map);
    commitLocal(prev => prev.filter(a => a.id !== id));
  }), [userId, commitLocal, enqueueForId, markTombstone]);

  const clearSyncError = useCallback(() => setSyncError(''), []);
  const reportSyncError = useCallback(msg => setSyncError(msg), []);

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
  };
}

// Re-exported so existing callers don't need immediate import-path changes.
export { isValidDate, sanitizeAssignment };
