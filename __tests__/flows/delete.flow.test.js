// Integration flow: delete an assignment / series, and the tombstone guard.
// Real stack over the in-memory fakeSupabase.

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
const DRAFT = {
  title: 'Essay', course: 'ENGL 200', dueDate: '2026-05-20',
  importance: 4, status: 'not_started', complexity: 'long',
};

beforeEach(async () => {
  await AsyncStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  h.fake = createFakeSupabase();

  Notifications.scheduleNotificationAsync.mockReset();
  Notifications.scheduleNotificationAsync
    .mockResolvedValueOnce('rem-24h').mockResolvedValueOnce('rem-1h')
    .mockResolvedValue('rem-x');
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

describe('delete flow', () => {
  test('deleting removes the row from state, the store, and cancels its reminders', async () => {
    const { result } = await mountHook();
    let created;
    await act(async () => { created = await result.current.insert(DRAFT); });

    Notifications.cancelScheduledNotificationAsync.mockClear();
    await act(async () => { await result.current.remove(created.id); });

    expect(result.current.assignments).toEqual([]);
    expect(h.fake.getStore()).toHaveLength(0);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-1h');
  });

  test('a late UPDATE echo for a just-deleted row is dropped (tombstone guard, no resurrection)', async () => {
    const { result } = await mountHook();
    let created;
    await act(async () => { created = await result.current.insert(DRAFT); });
    await act(async () => { await result.current.remove(created.id); });
    expect(result.current.assignments).toEqual([]);

    // Another device's UPDATE that committed just before our delete arrives
    // after it. The tombstone must keep it from re-adding the row.
    await act(async () => {
      h.fake.emit('UPDATE', {
        id: created.id, user_id: USER_ID, title: 'Zombie', class_name: 'ENGL 200',
        due_date: '2026-05-20', importance: 4, status: 'not_started', complexity: 'long',
        series_id: null, due_time: null,
      });
      await flushMicrotasks();
    });

    expect(result.current.assignments).toEqual([]);
  });

  test('deleting a series removes every assignment in it', async () => {
    const { result } = await mountHook();
    const seriesId = 'series-1';
    const drafts = [
      { ...DRAFT, title: 'Wk1', dueDate: '2026-05-20', seriesId },
      { ...DRAFT, title: 'Wk2', dueDate: '2026-05-27', seriesId },
    ];
    await act(async () => { await result.current.insertMany(drafts); });
    expect(result.current.assignments).toHaveLength(2);
    expect(h.fake.getStore()).toHaveLength(2);

    await act(async () => { await result.current.removeSeries(seriesId); });

    expect(result.current.assignments).toEqual([]);
    expect(h.fake.getStore()).toHaveLength(0);
  });
});
