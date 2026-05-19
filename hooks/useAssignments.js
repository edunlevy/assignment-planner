import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dbDelete,
  dbInsert,
  dbInsertMany,
  dbFetch,
  dbUpdate,
} from '../lib/assignmentsDb';
import {
  cancelReminders,
  loadReminderIdsFor,
  loadReminderMap,
  mergeReminderIds,
  reminderMapsEqual,
  requestNotificationPermission,
  saveReminderMap,
  scheduleReminders,
} from '../lib/notifications';

// AsyncStorage key for the cached assignment list.
// One key per userId so accounts don't cross-contaminate.
function storageKey(userId) {
  return `assignments_${userId}`;
}

const VALID_STATUSES = new Set(['not_started', 'in_progress', 'completed']);

function isValidDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function sanitizeAssignment(a) {
  if (!a || typeof a !== 'object') return null;
  if (!a.id || !a.title || !a.course || !a.dueDate) return null;
  if (!isValidDate(a.dueDate)) return null;
  return {
    ...a,
    importance: (Number.isInteger(a.importance) && a.importance >= 1 && a.importance <= 5)
      ? a.importance
      : 3,
    status: VALID_STATUSES.has(a.status) ? a.status : 'not_started',
    reminderIds: Array.isArray(a.reminderIds) ? a.reminderIds : [],
  };
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

      try {
        const [fresh, reminderMap] = await Promise.all([
          dbFetch(userId),
          loadReminderMap(userId),
        ]);
        if (cancelled) return;

        // Stale-fetch guard: a local write has overtaken this fetch.
        if (thisFetch < dataVersionRef.current) {
          setLoaded(true);
          return;
        }

        const merged = mergeReminderIds(fresh, reminderMap);

        // Ensure permission is granted before scheduling; without this,
        // the reschedule pass silently fails on fresh installs where the
        // permission prompt hasn't resolved yet.
        await requestNotificationPermission();

        const updatedMap = { ...reminderMap };
        const withReminders = await Promise.all(
          merged.map(async a => {
            if (a.status === 'completed' || a.reminderIds.length > 0) return a;
            const ids = await scheduleReminders(a);
            if (ids.length > 0) updatedMap[a.id] = ids;
            return { ...a, reminderIds: ids };
          })
        );
        if (cancelled) return;
        if (thisFetch < dataVersionRef.current) {
          setLoaded(true);
          return;
        }

        if (!reminderMapsEqual(updatedMap, reminderMap)) {
          await saveReminderMap(userId, updatedMap);
        }
        dataVersionRef.current = thisFetch;
        setAssignments(withReminders);
        AsyncStorage.setItem(storageKey(userId), JSON.stringify(withReminders))
          .catch(() => {});
      } catch {
        if (!cancelled) {
          setSyncError('Could not reach the server. Showing cached data.');
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // --- Mutations -----------------------------------------------------------

  const insert = useCallback(async assignment => {
    const saved = await dbInsert(assignment, userId);
    const reminderIds = await scheduleReminders(saved);
    const map = await loadReminderMap(userId);
    map[saved.id] = reminderIds;
    await saveReminderMap(userId, map);
    const withReminders = { ...saved, reminderIds };
    commitLocal(prev => [withReminders, ...prev]);
    return withReminders;
  }, [userId, commitLocal]);

  const insertMany = useCallback(async drafts => {
    const saved = await dbInsertMany(drafts, userId);
    const withReminders = await Promise.all(
      saved.map(async a => ({ ...a, reminderIds: await scheduleReminders(a) }))
    );
    const map = await loadReminderMap(userId);
    for (const a of withReminders) map[a.id] = a.reminderIds;
    await saveReminderMap(userId, map);
    commitLocal(prev => [...withReminders, ...prev]);
    return withReminders;
  }, [userId, commitLocal]);

  const update = useCallback(async (id, changes) => {
    // DB update first — only touch reminders if it succeeds.
    const updated = await dbUpdate(id, userId, changes);

    // Always cancel using the on-disk map. In-memory state may be stale
    // (e.g. user opened the edit modal before the network fetch finished
    // merging reminder IDs in), which would silently leak notifications.
    const oldIds = await loadReminderIdsFor(userId, id);
    await cancelReminders(oldIds);

    const reminderIds = updated.status !== 'completed'
      ? await scheduleReminders(updated)
      : [];

    const map = await loadReminderMap(userId);
    map[id] = reminderIds;
    await saveReminderMap(userId, map);

    const withReminders = { ...updated, reminderIds };
    commitLocal(prev => prev.map(a => a.id === id ? withReminders : a));
    return withReminders;
  }, [userId, commitLocal]);

  const remove = useCallback(async id => {
    await dbDelete(id, userId);
    const oldIds = await loadReminderIdsFor(userId, id);
    await cancelReminders(oldIds);
    const map = await loadReminderMap(userId);
    delete map[id];
    await saveReminderMap(userId, map);
    commitLocal(prev => prev.filter(a => a.id !== id));
  }, [userId, commitLocal]);

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

export { isValidDate, sanitizeAssignment };
