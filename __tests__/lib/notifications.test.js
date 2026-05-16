import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  cancelAllReminders,
  cancelReminders,
  loadReminderIdsFor,
  loadReminderMap,
  mergeReminderIds,
  reminderMapsEqual,
  requestNotificationPermission,
  saveReminderMap,
  scheduleReminders,
} from '../../lib/notifications';

beforeEach(async () => {
  await AsyncStorage.clear();
  Notifications.scheduleNotificationAsync.mockReset();
  Notifications.scheduleNotificationAsync.mockResolvedValue('notif-id');
  Notifications.cancelScheduledNotificationAsync.mockClear();
  Notifications.cancelAllScheduledNotificationsAsync.mockClear();
  Notifications.getAllScheduledNotificationsAsync.mockReset();
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  Notifications.getPermissionsAsync.mockReset();
  Notifications.requestPermissionsAsync.mockReset();
  Platform.OS = 'ios';
});

describe('requestNotificationPermission', () => {
  test('returns true when already granted (no re-prompt)', async () => {
    Notifications.getPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    expect(await requestNotificationPermission()).toBe(true);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  test('asks the OS when not yet granted', async () => {
    Notifications.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' });
    Notifications.requestPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    expect(await requestNotificationPermission()).toBe(true);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
  });

  test('returns false when user denies', async () => {
    Notifications.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' });
    Notifications.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    expect(await requestNotificationPermission()).toBe(false);
  });

  test('returns false on web without touching native APIs', async () => {
    Platform.OS = 'web';
    expect(await requestNotificationPermission()).toBe(false);
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('scheduleReminders', () => {
  test('schedules 24h and 1h reminders for a future due date', async () => {
    // Pin "now" so 11:59 PM on dueDate is comfortably in the future.
    const now = new Date('2026-05-15T08:00:00').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('id-24h')
      .mockResolvedValueOnce('id-1h');

    const ids = await scheduleReminders({
      id: 'a1',
      title: 'Essay',
      course: 'ENGL',
      dueDate: '2026-05-20',
    });

    expect(ids).toEqual(['id-24h', 'id-1h']);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    const firstCall = Notifications.scheduleNotificationAsync.mock.calls[0][0];
    expect(firstCall.content.data).toEqual({ assignmentId: 'a1' });

    Date.now.mockRestore();
  });

  test('skips both reminders when the trigger is already past', async () => {
    const now = new Date('2030-01-01T00:00:00').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const ids = await scheduleReminders({
      id: 'a1',
      title: 't',
      course: 'c',
      dueDate: '2026-01-01',
    });
    expect(ids).toEqual([]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    Date.now.mockRestore();
  });

  test('stops scheduling on iOS when the pending-cap headroom is exhausted', async () => {
    const now = new Date('2026-05-15T08:00:00').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    // 61 pending → limit 64 - headroom 4 = 60 allowed; 61 pending leaves 0 slots.
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValueOnce(
      new Array(61).fill({ identifier: 'x' })
    );

    const ids = await scheduleReminders({
      id: 'a1',
      title: 't',
      course: 'c',
      dueDate: '2026-05-20',
    });
    expect(ids).toEqual([]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    Date.now.mockRestore();
  });

  test('returns [] on web without scheduling', async () => {
    Platform.OS = 'web';
    const ids = await scheduleReminders({
      id: 'a1', title: 't', course: 'c', dueDate: '2099-01-01',
    });
    expect(ids).toEqual([]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  test('swallows scheduling errors and returns the partial list', async () => {
    const now = new Date('2026-05-15T08:00:00').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    Notifications.scheduleNotificationAsync
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce('id-1h');

    const ids = await scheduleReminders({
      id: 'a1', title: 't', course: 'c', dueDate: '2026-05-20',
    });
    expect(ids).toEqual(['id-1h']);

    Date.now.mockRestore();
  });
});

describe('cancelReminders / cancelAllReminders', () => {
  test('cancels each id passed', async () => {
    await cancelReminders(['a', 'b']);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('a');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('b');
  });

  test('is a no-op for empty / non-array input', async () => {
    await cancelReminders([]);
    await cancelReminders(undefined);
    await cancelReminders(null);
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  test('cancelAllReminders calls the bulk API', async () => {
    await cancelAllReminders();
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
  });
});

describe('reminder map persistence', () => {
  test('save → load round-trips the map', async () => {
    await saveReminderMap('user-1', { a1: ['n1', 'n2'], a2: ['n3'] });
    const loaded = await loadReminderMap('user-1');
    expect(loaded).toEqual({ a1: ['n1', 'n2'], a2: ['n3'] });
  });

  test('loadReminderMap returns {} for an empty store', async () => {
    expect(await loadReminderMap('user-x')).toEqual({});
  });

  test('loadReminderMap survives corrupt JSON', async () => {
    await AsyncStorage.setItem('reminder_ids_user-1', '{not json');
    expect(await loadReminderMap('user-1')).toEqual({});
  });

  test('loadReminderIdsFor reads from the on-disk map', async () => {
    await saveReminderMap('user-1', { a1: ['n1'] });
    expect(await loadReminderIdsFor('user-1', 'a1')).toEqual(['n1']);
    expect(await loadReminderIdsFor('user-1', 'nope')).toEqual([]);
  });

  test('keys are namespaced per user', async () => {
    await saveReminderMap('user-A', { x: ['A1'] });
    await saveReminderMap('user-B', { x: ['B1'] });
    expect(await loadReminderMap('user-A')).toEqual({ x: ['A1'] });
    expect(await loadReminderMap('user-B')).toEqual({ x: ['B1'] });
  });
});

describe('mergeReminderIds', () => {
  test('attaches reminderIds from the map, defaulting to []', () => {
    const merged = mergeReminderIds(
      [{ id: 'a1', title: 't' }, { id: 'a2', title: 'u' }],
      { a1: ['n1', 'n2'] }
    );
    expect(merged[0].reminderIds).toEqual(['n1', 'n2']);
    expect(merged[1].reminderIds).toEqual([]);
  });
});

describe('reminderMapsEqual', () => {
  test('returns true for identical maps', () => {
    expect(reminderMapsEqual({ a: ['x', 'y'] }, { a: ['x', 'y'] })).toBe(true);
  });

  test('returns false when ids differ', () => {
    expect(reminderMapsEqual({ a: ['x'] }, { a: ['y'] })).toBe(false);
  });

  test('returns false when key sets differ', () => {
    expect(reminderMapsEqual({ a: ['x'] }, { b: ['x'] })).toBe(false);
    expect(reminderMapsEqual({ a: ['x'] }, { a: ['x'], b: [] })).toBe(false);
  });

  test('returns false when array lengths differ', () => {
    expect(reminderMapsEqual({ a: ['x'] }, { a: ['x', 'y'] })).toBe(false);
  });
});
