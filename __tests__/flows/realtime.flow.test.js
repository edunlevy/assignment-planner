// Integration flow: realtime events from ANOTHER device.
// These are genuine remote changes (not our own echoes), so they must be
// applied — the mirror image of the self-echo suppression in create/edit.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { createFakeSupabase } from '../helpers/fakeSupabase';
import { renderHook, flushMicrotasks } from '../helpers/renderHook';
import { act } from 'react-test-renderer';

const h = vi.hoisted(() => ({ fake: null }));
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, prop) => h.fake.supabase[prop] }),
  startAuthAutoRefresh: () => ({ remove() {} }),
}));

import { useAssignments } from '../../hooks/useAssignments';

const USER_ID = 'user-1';
const NOW = new Date('2026-05-15T08:00:00').getTime();

function dbRow(overrides = {}) {
  return {
    id: 'remote-1', user_id: USER_ID, title: 'Remote', class_name: 'BIO 101',
    due_date: '2026-05-20', importance: 3, status: 'not_started',
    complexity: 'medium', series_id: null, due_time: null, ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  h.fake = createFakeSupabase();

  Notifications.scheduleNotificationAsync.mockReset();
  Notifications.scheduleNotificationAsync.mockResolvedValue('rem-x');
  Notifications.cancelScheduledNotificationAsync.mockReset();
  Notifications.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
  Notifications.getAllScheduledNotificationsAsync.mockReset();
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  Notifications.getPermissionsAsync.mockReset();
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
});

afterEach(() => { Date.now.mockRestore(); });

async function mountHook() {
  const handle = renderHook(() => useAssignments(USER_ID));
  await flushMicrotasks();
  return handle;
}

describe('realtime flow (remote events)', () => {
  test('a remote INSERT is mapped through fromDb and added to state', async () => {
    const { result } = await mountHook();
    expect(result.current.assignments).toEqual([]);

    await act(async () => {
      h.fake.emit('INSERT', dbRow({ id: 'r1', title: 'From other device', class_name: 'CHEM 101' }));
      await flushMicrotasks();
    });

    expect(result.current.assignments).toHaveLength(1);
    const row = result.current.assignments[0];
    expect(row.title).toBe('From other device');
    expect(row.course).toBe('CHEM 101'); // class_name → course mapping ran
  });

  test('a remote UPDATE to a known row is applied', async () => {
    const { result } = await mountHook();
    await act(async () => {
      h.fake.emit('INSERT', dbRow({ id: 'r2', title: 'Before' }));
      await flushMicrotasks();
    });
    expect(result.current.assignments[0].title).toBe('Before');

    await act(async () => {
      h.fake.emit('UPDATE', dbRow({ id: 'r2', title: 'After', status: 'in_progress' }));
      await flushMicrotasks();
    });

    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.assignments[0].title).toBe('After');
    expect(result.current.assignments[0].status).toBe('in_progress');
  });

  test('a remote DELETE removes the row and cancels its reminders', async () => {
    const { result } = await mountHook();
    await act(async () => {
      h.fake.emit('INSERT', dbRow({ id: 'r3' }));
      await flushMicrotasks();
    });
    expect(result.current.assignments).toHaveLength(1);

    Notifications.cancelScheduledNotificationAsync.mockClear();
    await act(async () => {
      h.fake.emit('DELETE', dbRow({ id: 'r3' }));
      await flushMicrotasks();
    });

    expect(result.current.assignments).toEqual([]);
    // The remote INSERT scheduled reminders (id 'rem-x'); the DELETE cancels them.
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-x');
  });
});
