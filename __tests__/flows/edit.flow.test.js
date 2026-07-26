// Integration flow: edit an assignment.
// Real useAssignments + orchestration + lib/assignmentsDb + lib/notifications
// over the in-memory fakeSupabase (only the network boundary is stubbed).

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
  title: 'Essay', course: 'ENGL 200', dueDate: '2026-05-20', dueTime: '14:30',
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

async function mountWithOneRow() {
  const handle = renderHook(() => useAssignments(USER_ID));
  await flushMicrotasks();
  let created;
  await act(async () => { created = await handle.result.current.insert(DRAFT); });
  return { ...handle, created };
}

describe('edit flow', () => {
  test('updating fields maps through changesToDb and suppresses the echo', async () => {
    const { result, created } = await mountWithOneRow();

    // Count only the update's own scheduling from here.
    Notifications.scheduleNotificationAsync.mockClear();

    await act(async () => {
      await result.current.update(created.id, { importance: 2, complexity: 'short' });
      await flushMicrotasks(); // let the UPDATE echo land
    });

    const row = result.current.assignments[0];
    expect(result.current.assignments).toHaveLength(1);
    expect(row.importance).toBe(2);
    expect(row.complexity).toBe('short');

    const stored = h.fake.getStore()[0];
    expect(stored.importance).toBe(2);
    expect(stored.complexity).toBe('short');

    // The signature-matched echo was dropped before re-running scheduleFor:
    // only the update itself rescheduled (2 reminders), not the echo (would be 4).
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  test('changing the due date reschedules reminders (cancel old, schedule new)', async () => {
    const { result, created } = await mountWithOneRow();
    expect(result.current.assignments[0].reminderIds).toEqual(['rem-24h', 'rem-1h']);

    Notifications.scheduleNotificationAsync.mockReset();
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('new-24h').mockResolvedValueOnce('new-1h');
    Notifications.cancelScheduledNotificationAsync.mockClear();

    await act(async () => { await result.current.update(created.id, { dueDate: '2026-05-25' }); });

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-1h');
    expect(result.current.assignments[0].reminderIds).toEqual(['new-24h', 'new-1h']);
  });

  test('marking an assignment completed cancels its reminders and schedules none', async () => {
    const { result, created } = await mountWithOneRow();

    Notifications.scheduleNotificationAsync.mockClear();
    Notifications.cancelScheduledNotificationAsync.mockClear();

    await act(async () => { await result.current.update(created.id, { status: 'completed' }); });

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-1h');
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(result.current.assignments[0].reminderIds).toEqual([]);

    const map = JSON.parse((await AsyncStorage.getItem(`reminder_ids_${USER_ID}`)) ?? '{}');
    expect(map[created.id]).toBeUndefined();
  });
});
