// PR 3 — useAssignments lifecycle tests
// Load effect, stale-fetch guard, remote realtime events (true cross-device,
// not self-echoes), and AppState TZ reschedule.
//
// Mutation tests live in useAssignments.test.js (PR 2).

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { act } from 'react-test-renderer';

vi.mock('../../lib/assignmentsDb', () => ({
  fromDb: row => row,
  dbFetch: vi.fn(async () => []),
  dbInsert: vi.fn(),
  dbInsertMany: vi.fn(),
  dbUpdate: vi.fn(),
  dbDelete: vi.fn(),
}));

import { useAssignments } from '../../hooks/useAssignments';
import { dbFetch, dbInsert } from '../../lib/assignmentsDb';
import { currentDeviceTimezone } from '../../lib/notifications';
import { supabase } from '../../lib/supabase';
import { renderHook, flushMicrotasks } from '../helpers/renderHook';

const USER_ID = 'user-1';
const NOW = new Date('2026-05-15T08:00:00').getTime();

// Pick a TZ different from whatever the test host uses, so detectTimezoneChanged
// reliably returns true when we seed AsyncStorage with it.
const CURRENT_TZ = currentDeviceTimezone();
const DIFFERENT_TZ = CURRENT_TZ === 'UTC' ? 'America/Los_Angeles' : 'UTC';

// Captured Supabase realtime + AppState callbacks for tests that simulate
// events from outside the hook.
let realtimeCallback = null;
let appStateCallback = null;

async function emitRealtime(payload) {
  if (!realtimeCallback) throw new Error('realtime not subscribed yet');
  await act(async () => {
    realtimeCallback(payload);
    await flushMicrotasks();
  });
}

async function fireAppState(state) {
  if (!appStateCallback) throw new Error('AppState listener not registered yet');
  await act(async () => {
    await appStateCallback(state);
    await flushMicrotasks();
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);

  dbFetch.mockReset();
  dbFetch.mockResolvedValue([]);
  dbInsert.mockReset();

  Notifications.scheduleNotificationAsync.mockReset();
  Notifications.scheduleNotificationAsync.mockResolvedValue('notif-id');
  Notifications.cancelScheduledNotificationAsync.mockReset();
  Notifications.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
  Notifications.getAllScheduledNotificationsAsync.mockReset();
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  Notifications.getPermissionsAsync.mockReset();
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });

  realtimeCallback = null;
  supabase.channel.mockReset();
  supabase.channel.mockImplementation(() => {
    const ch = {
      on: vi.fn((_event, _filter, cb) => {
        realtimeCallback = cb;
        return ch;
      }),
      subscribe: vi.fn(() => ch),
      unsubscribe: vi.fn(async () => {}),
    };
    return ch;
  });
  supabase.removeChannel.mockReset();
  supabase.removeChannel.mockResolvedValue(undefined);

  appStateCallback = null;
  AppState.addEventListener.mockReset();
  AppState.addEventListener.mockImplementation((event, cb) => {
    if (event === 'change') appStateCallback = cb;
    return { remove: vi.fn() };
  });
});

afterEach(() => {
  Date.now.mockRestore();
});

// Test fixture: a freshly-fetched row from Supabase.
function dbRow(overrides = {}) {
  return {
    id: 'remote-id',
    title: 'Remote assignment',
    course: 'BIO 101',
    dueDate: '2026-05-20',
    importance: 3,
    status: 'not_started',
    complexity: 'medium',
    ...overrides,
  };
}

// ===========================================================================
// Load effect — cache + fetch
// ===========================================================================
describe('load effect', () => {
  test('shows cached data immediately, then overlays the fresh fetch result', async () => {
    // Seed the cache as if a previous session wrote it.
    const cached = [dbRow({ id: 'cached-1', title: 'From cache' })];
    await AsyncStorage.setItem(`assignments_${USER_ID}`, JSON.stringify(cached));

    // Hold the fetch open so we can assert state mid-load.
    let resolveFetch;
    dbFetch.mockImplementation(() => new Promise(r => { resolveFetch = r; }));

    const { result } = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();

    // Cache is rendered before the fetch completes.
    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.assignments[0].title).toBe('From cache');
    expect(result.current.loaded).toBe(false);

    // Now resolve the fetch with a different row → it overlays the cache.
    await act(async () => {
      resolveFetch([dbRow({ id: 'fresh-1', title: 'From server' })]);
      await flushMicrotasks();
    });

    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.assignments[0].title).toBe('From server');
    expect(result.current.loaded).toBe(true);
    expect(result.current.syncError).toBe('');
  });

  test('fetch error: keeps cached data on screen and sets syncError', async () => {
    const cached = [dbRow({ id: 'c1', title: 'Cached row' })];
    await AsyncStorage.setItem(`assignments_${USER_ID}`, JSON.stringify(cached));

    dbFetch.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();

    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.assignments[0].title).toBe('Cached row');
    expect(result.current.loaded).toBe(true);
    expect(result.current.syncError).toMatch(/Could not reach the server/i);
  });

  test('empty userId: state cleared, no fetch attempted', async () => {
    const { result } = renderHook(() => useAssignments(null));
    await flushMicrotasks();
    expect(result.current.assignments).toEqual([]);
    expect(result.current.loaded).toBe(false);
    expect(dbFetch).not.toHaveBeenCalled();
  });

  test('corrupt cache does not block the network fetch', async () => {
    await AsyncStorage.setItem(`assignments_${USER_ID}`, '{not valid json');
    dbFetch.mockResolvedValue([dbRow({ id: 'fresh', title: 'OK' })]);

    const { result } = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();

    expect(result.current.loaded).toBe(true);
    expect(result.current.assignments[0].title).toBe('OK');
    expect(result.current.syncError).toBe('');
  });

  test('on successful load: completed assignments end with empty reminderIds', async () => {
    // Even if disk had a reminder map entry for a completed row, Phase A
    // cleanup should remove it and clear reminderIds.
    await AsyncStorage.setItem(
      `reminder_ids_${USER_ID}`,
      JSON.stringify({ 'done-1': ['leftover-id'] }),
    );
    dbFetch.mockResolvedValue([dbRow({ id: 'done-1', status: 'completed' })]);

    const { result } = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();

    // Reminder for the completed row was cancelled
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('leftover-id');
    // State carries empty reminderIds for the completed row
    const completedRow = result.current.assignments.find(a => a.id === 'done-1');
    expect(completedRow.reminderIds).toEqual([]);
    // Map entry pruned
    const map = JSON.parse(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`));
    expect(map['done-1']).toBeUndefined();
  });
});

// ===========================================================================
// Stale-fetch guard
// ===========================================================================
describe('stale-fetch guard', () => {
  test('local insert during in-flight fetch is not clobbered when fetch resolves stale', async () => {
    // Hold the fetch open
    let resolveFetch;
    dbFetch.mockImplementation(() => new Promise(r => { resolveFetch = r; }));

    const { result } = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();

    // Insert while the fetch is still pending. This bumps dataVersionRef
    // ahead of the in-flight fetch's thisFetch value.
    dbInsert.mockImplementation(async row => ({ ...row }));
    let inserted;
    await act(async () => {
      inserted = await result.current.insert({
        title: 'Mid-fetch insert',
        course: 'CS',
        dueDate: '2026-05-20',
        importance: 3,
        status: 'not_started',
        complexity: 'medium',
      });
    });
    expect(result.current.assignments).toHaveLength(1);

    // NOW resolve the fetch with stale data (empty array, as if the server
    // hadn't seen our insert yet). The guard should drop this result.
    await act(async () => {
      resolveFetch([]);
      await flushMicrotasks();
    });

    // Inserted row survives.
    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.assignments[0].id).toBe(inserted.id);
  });
});

// ===========================================================================
// Remote realtime events (from another device)
// ===========================================================================
describe('remote realtime events', () => {
  test('remote INSERT: adds row to state and schedules reminders', async () => {
    const { result } = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();
    expect(result.current.assignments).toEqual([]);

    // Reset notification mock so we can count the realtime-handler's schedule calls.
    Notifications.scheduleNotificationAsync.mockReset();
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('remote-24h')
      .mockResolvedValueOnce('remote-1h');

    const incomingRow = dbRow({ id: 'from-other-device', title: 'Their row' });
    await emitRealtime({ eventType: 'INSERT', new: incomingRow });

    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.assignments[0].id).toBe('from-other-device');
    expect(result.current.assignments[0].reminderIds).toEqual(['remote-24h', 'remote-1h']);

    // Reminder map updated — new format stores { ids, sig }
    const map = JSON.parse(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`));
    expect(map['from-other-device'].ids).toEqual(['remote-24h', 'remote-1h']);
  });

  test('remote UPDATE: cancels old reminders, schedules new ones, updates state', async () => {
    // Seed an existing row from the initial fetch
    dbFetch.mockResolvedValue([dbRow({ id: 'shared', title: 'Original' })]);
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('old-24h')
      .mockResolvedValueOnce('old-1h');

    const { result } = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();

    expect(result.current.assignments[0].title).toBe('Original');

    // Reset to track only the realtime path's schedule/cancel calls.
    Notifications.scheduleNotificationAsync.mockReset();
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('new-24h')
      .mockResolvedValueOnce('new-1h');
    Notifications.cancelScheduledNotificationAsync.mockClear();

    await emitRealtime({
      eventType: 'UPDATE',
      new: dbRow({ id: 'shared', title: 'Updated remotely', importance: 5 }),
      old: dbRow({ id: 'shared', title: 'Original' }),
    });

    // Old reminders cancelled
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-1h');

    // State reflects the remote update
    expect(result.current.assignments[0].title).toBe('Updated remotely');
    expect(result.current.assignments[0].reminderIds).toEqual(['new-24h', 'new-1h']);
  });

  test('remote UPDATE with status=completed: cancels old reminders, schedules NO new ones', async () => {
    dbFetch.mockResolvedValue([dbRow({ id: 'shared', title: 'Active' })]);
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('old-24h')
      .mockResolvedValueOnce('old-1h');

    const { result } = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();

    Notifications.scheduleNotificationAsync.mockReset();
    Notifications.scheduleNotificationAsync.mockResolvedValue('would-not-be-used');
    Notifications.cancelScheduledNotificationAsync.mockClear();

    await emitRealtime({
      eventType: 'UPDATE',
      new: dbRow({ id: 'shared', title: 'Active', status: 'completed' }),
      old: dbRow({ id: 'shared', title: 'Active' }),
    });

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-24h');
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(result.current.assignments[0].status).toBe('completed');
    expect(result.current.assignments[0].reminderIds).toEqual([]);
  });

  test('remote DELETE: removes row from state, cancels reminders, prunes map', async () => {
    dbFetch.mockResolvedValue([dbRow({ id: 'doomed', title: 'Will be deleted' })]);
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('d-24h')
      .mockResolvedValueOnce('d-1h');

    const { result } = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();
    expect(result.current.assignments).toHaveLength(1);

    Notifications.cancelScheduledNotificationAsync.mockClear();

    await emitRealtime({
      eventType: 'DELETE',
      old: dbRow({ id: 'doomed' }),
    });

    expect(result.current.assignments).toEqual([]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('d-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('d-1h');

    const map = JSON.parse(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`));
    expect(map['doomed']).toBeUndefined();
  });

  test('regression P1: remote UPDATE for a row not yet in local state adds the row (missed INSERT)', async () => {
    // Scenario: this device came online after the original INSERT was delivered.
    // It never received the INSERT event, so its local state is empty.
    // A subsequent UPDATE arrives — it should add the row so it becomes visible.
    const { result } = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();
    expect(result.current.assignments).toEqual([]); // device has no rows yet

    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('missed-24h')
      .mockResolvedValueOnce('missed-1h');

    await emitRealtime({
      eventType: 'UPDATE',
      new: dbRow({ id: 'missed-insert', title: 'Created while offline' }),
      old: dbRow({ id: 'missed-insert', title: 'Created while offline' }),
    });

    // Row is now visible, with reminders scheduled — not silently dropped.
    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.assignments[0].id).toBe('missed-insert');
    expect(result.current.assignments[0].reminderIds).toEqual(['missed-24h', 'missed-1h']);
  });
});

// ===========================================================================
// AppState — timezone change reschedule
// ===========================================================================
describe('AppState TZ reschedule', () => {
  // Set up: a row exists in state with reminders on disk. We then fire
  // AppState 'active' and assert the reschedule behavior based on whether the
  // stored TZ matches the current one.
  async function mountWithOneIncompleteRow() {
    dbFetch.mockResolvedValue([dbRow({ id: 'tz-row', title: 'Active task' })]);
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('orig-24h')
      .mockResolvedValueOnce('orig-1h');

    const handle = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();
    return handle;
  }

  test('TZ changed: cancels old reminders, schedules new ones, updates stored TZ', async () => {
    const { result } = await mountWithOneIncompleteRow();
    expect(result.current.assignments[0].reminderIds).toEqual(['orig-24h', 'orig-1h']);

    // Seed disk TZ that differs from the host's current TZ → detectTimezoneChanged returns true.
    await AsyncStorage.setItem(`device_tz_${USER_ID}`, DIFFERENT_TZ);

    // Reset notification mocks to count only the reschedule path's calls.
    Notifications.scheduleNotificationAsync.mockReset();
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('post-tz-24h')
      .mockResolvedValueOnce('post-tz-1h');
    Notifications.cancelScheduledNotificationAsync.mockClear();

    await fireAppState('active');

    // Old reminders cancelled from disk (read from the persisted map)
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('orig-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('orig-1h');

    // New reminders scheduled
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();

    // State reflects new ids
    expect(result.current.assignments[0].reminderIds).toEqual(['post-tz-24h', 'post-tz-1h']);

    // Stored TZ refreshed to the current host TZ
    const newStoredTz = await AsyncStorage.getItem(`device_tz_${USER_ID}`);
    expect(newStoredTz).toBe(CURRENT_TZ);
  });

  test('TZ unchanged: no cancel, no schedule, no state mutation', async () => {
    const { result } = await mountWithOneIncompleteRow();
    const stateBefore = JSON.stringify(result.current.assignments);

    Notifications.scheduleNotificationAsync.mockReset();
    Notifications.cancelScheduledNotificationAsync.mockClear();

    // Stored TZ already matches the current TZ → no change.
    // (After mount, storeDeviceTimezone() has already seeded device_tz_${USER_ID}
    // with the current TZ as part of the load effect's Phase B.)
    await fireAppState('active');

    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(JSON.stringify(result.current.assignments)).toBe(stateBefore);
  });

  test('non-active AppState transitions are ignored', async () => {
    await mountWithOneIncompleteRow();
    await AsyncStorage.setItem(`device_tz_${USER_ID}`, DIFFERENT_TZ);

    Notifications.cancelScheduledNotificationAsync.mockClear();
    Notifications.scheduleNotificationAsync.mockReset();

    await fireAppState('background');
    await fireAppState('inactive');

    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  test('TZ changed but no incomplete assignments: just refreshes stored TZ', async () => {
    // Mount with only a completed row → nothing to reschedule.
    dbFetch.mockResolvedValue([dbRow({ id: 'done', status: 'completed' })]);
    const { result } = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();
    expect(result.current.assignments[0].status).toBe('completed');

    await AsyncStorage.setItem(`device_tz_${USER_ID}`, DIFFERENT_TZ);
    Notifications.scheduleNotificationAsync.mockReset();
    Notifications.cancelScheduledNotificationAsync.mockClear();

    await fireAppState('active');

    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    // But the stored TZ IS refreshed so the next change is detected from
    // the new baseline.
    expect(await AsyncStorage.getItem(`device_tz_${USER_ID}`)).toBe(CURRENT_TZ);
  });
});
