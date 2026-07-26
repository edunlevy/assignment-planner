// Integration flow: create a single assignment.
//
// Runs the REAL stack — useAssignments + orchestration hooks + lib/assignmentsDb
// (toDb/fromDb column mapping) + lib/notifications — over the in-memory
// fakeSupabase. Only the network boundary (lib/supabase) is stubbed, so this
// exercises contracts the unit tests (which mock lib/assignmentsDb) don't:
// the app-field ↔ DB-column round-trip and the realtime self-echo suppression.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { createFakeSupabase } from '../helpers/fakeSupabase';
import { renderHook, flushMicrotasks } from '../helpers/renderHook';
import { act } from 'react-test-renderer';

// Hoisted holder so the (hoisted) vi.mock factory can reach the per-test fake.
const h = vi.hoisted(() => ({ fake: null }));

vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, prop) => h.fake.supabase[prop] }),
  startAuthAutoRefresh: () => ({ remove() {} }),
}));

import { useAssignments } from '../../hooks/useAssignments';

const USER_ID = 'user-1';
const NOW = new Date('2026-05-15T08:00:00').getTime();

const DRAFT = {
  title: 'Essay',
  course: 'ENGL 200',
  dueDate: '2026-05-20',
  dueTime: '14:30',
  importance: 4,
  status: 'not_started',
  complexity: 'long',
};

beforeEach(async () => {
  await AsyncStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  h.fake = createFakeSupabase();

  Notifications.scheduleNotificationAsync.mockReset();
  Notifications.scheduleNotificationAsync
    .mockResolvedValueOnce('rem-24h')
    .mockResolvedValueOnce('rem-1h')
    .mockResolvedValue('rem-x');
  Notifications.getAllScheduledNotificationsAsync.mockReset();
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  Notifications.getPermissionsAsync.mockReset();
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
});

afterEach(() => {
  Date.now.mockRestore();
});

async function mountHook() {
  const handle = renderHook(() => useAssignments(USER_ID));
  await flushMicrotasks();
  return handle;
}

describe('create flow', () => {
  test('insert round-trips through the DB column mapping into state and the store', async () => {
    const { result } = await mountHook();

    let created;
    await act(async () => { created = await result.current.insert(DRAFT); });

    // In-memory state reflects the app-shaped row.
    expect(result.current.assignments).toHaveLength(1);
    const row = result.current.assignments[0];
    expect(row.title).toBe('Essay');
    expect(row.course).toBe('ENGL 200');
    expect(row.dueDate).toBe('2026-05-20');
    expect(row.dueTime).toBe('14:30');
    expect(row.importance).toBe(4);
    expect(row.complexity).toBe('long');

    // The persisted DB row used snake_case columns (toDb mapping ran for real).
    const stored = h.fake.getStore();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: created.id,
      user_id: USER_ID,
      class_name: 'ENGL 200',
      due_date: '2026-05-20',
      due_time: '14:30',
      series_id: null,
    });
  });

  test('reminders are scheduled and their ids persisted to the reminder map', async () => {
    const { result } = await mountHook();

    let created;
    await act(async () => { created = await result.current.insert(DRAFT); });

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();
    expect(result.current.assignments[0].reminderIds).toEqual(['rem-24h', 'rem-1h']);

    const map = JSON.parse(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`));
    expect(map[created.id].ids).toEqual(['rem-24h', 'rem-1h']);
  });

  test("the insert's own realtime echo is suppressed (not re-processed)", async () => {
    const { result } = await mountHook();

    await act(async () => {
      await result.current.insert(DRAFT);
      // Let the fake's asynchronously-delivered INSERT echo land.
      await flushMicrotasks();
    });

    // No duplicate row — but that alone is weak (the echo carries the same
    // client-minted id, so re-applying would replace, not duplicate). The
    // load-bearing signal is that the echo was DROPPED before re-running
    // scheduleFor: exactly the 2 reminders from the original insert were
    // scheduled. If isOwnEcho's INSERT branch were broken, the echo would
    // re-schedule and this would be 4.
    expect(result.current.assignments).toHaveLength(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });
});
