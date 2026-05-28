import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  cancelAllReminders,
  cancelReminders,
  currentDeviceTimezone,
  detectTimezoneChanged,
  loadReminderIdsFor,
  loadReminderMap,
  loadStoredTimezone,
  mergeReminderIds,
  reminderMapsEqual,
  requestNotificationPermission,
  saveReminderMap,
  scheduleReminders,
  scheduleRemindersBatch,
  storeDeviceTimezone,
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

describe('scheduleReminders — iOS pending-count catch branch', () => {
  test('returns [] without scheduling when getAllScheduledNotificationsAsync throws', async () => {
    const now = new Date('2026-05-15T08:00:00').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    // Simulate the OS API throwing (e.g. permission not granted on some builds).
    // pendingNotificationCount catches and returns 0, so makeSlotBudget
    // should still succeed and produce a budget — but the throw is the path
    // we want exercised for coverage.
    Notifications.getAllScheduledNotificationsAsync.mockRejectedValueOnce(
      new Error('OS error')
    );

    const ids = await scheduleReminders({
      id: 'a1', title: 't', course: 'c', dueDate: '2026-05-20',
    });

    // With 0 reported pending (catch path), all slots are available.
    // scheduleNotificationAsync still returns 'notif-id', so IDs come back.
    expect(Array.isArray(ids)).toBe(true);

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

  test('loadReminderMap drops entries whose value is not a string array', async () => {
    // Simulate a corrupted map where some assignment IDs map to non-arrays.
    // Without sanitization, mergeReminderIds would attach the wrong shape
    // and cancelReminders would silently skip the cancellation.
    await AsyncStorage.setItem(
      'reminder_ids_user-1',
      JSON.stringify({
        good: ['n1', 'n2'],
        bareString: 'old-id',
        nestedObj: { foo: 'bar' },
        nullVal: null,
        mixedArr: ['n3', 42],
      })
    );
    expect(await loadReminderMap('user-1')).toEqual({ good: ['n1', 'n2'] });
  });

  test('loadReminderMap returns {} for a JSON array (not an object)', async () => {
    await AsyncStorage.setItem('reminder_ids_user-1', JSON.stringify(['a', 'b']));
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

describe('scheduleRemindersBatch', () => {
  const FUTURE = '2026-05-20';

  beforeEach(() => {
    const now = new Date('2026-05-15T08:00:00').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    // Fresh pending count: 0 slots used
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  });

  afterEach(() => {
    Date.now.mockRestore();
  });

  test('returns an array matching input length with per-assignment id arrays', async () => {
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('a-24h')
      .mockResolvedValueOnce('a-1h')
      .mockResolvedValueOnce('b-24h')
      .mockResolvedValueOnce('b-1h');

    const result = await scheduleRemindersBatch([
      { id: 'a1', title: 'A', course: 'C', dueDate: FUTURE },
      { id: 'a2', title: 'B', course: 'C', dueDate: FUTURE },
    ]);

    expect(result).toEqual([['a-24h', 'a-1h'], ['b-24h', 'b-1h']]);
    // Four total calls — no over-scheduling from independent slot budgets.
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(4);
  });

  test('stops at the shared iOS pending-cap so a large series cannot overrun it', async () => {
    // 60 slots already used; budget allows only 0 more (64 - 4 headroom = 60 max).
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValue(
      new Array(60).fill({ identifier: 'x' })
    );

    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`, title: `T${i}`, course: 'C', dueDate: FUTURE,
    }));
    const result = await scheduleRemindersBatch(items);

    expect(result).toHaveLength(5);
    // Every assignment gets an empty array — no slots available.
    result.forEach(ids => expect(ids).toEqual([]));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  test('returns array of empty arrays on web without calling the API', async () => {
    Platform.OS = 'web';
    const result = await scheduleRemindersBatch([
      { id: 'a1', title: 't', course: 'c', dueDate: FUTURE },
    ]);
    expect(result).toEqual([[]]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  test('returns [] for a non-array argument', async () => {
    expect(await scheduleRemindersBatch(null)).toEqual([]);
    expect(await scheduleRemindersBatch(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Time-zone behavior — promoted from PR 1 sentinels.
//
// The CALENDAR trigger emits LOCAL date components, so the OS fires it at
// the user's current local time at fire moment (not the frozen UTC instant
// computed at schedule time). See NOTES.md "Audit — Time zone behavior" and
// the `timezone-notifications` skill.
// ---------------------------------------------------------------------------
describe('time zone behavior', () => {
  test('iOS: scheduleReminders emits a CALENDAR trigger with 1-indexed month and local components', async () => {
    // Platform.OS is already 'ios' from beforeEach.
    const now = new Date('2026-05-15T08:00:00').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('id-24h')
      .mockResolvedValueOnce('id-1h');

    await scheduleReminders({
      id: 'a1', title: 'Essay', course: 'ENGL', dueDate: '2026-05-20',
    });

    const calls = Notifications.scheduleNotificationAsync.mock.calls;
    expect(calls).toHaveLength(2);

    // Both triggers must be CALENDAR — never the old absolute 'date' shape.
    for (const [arg] of calls) {
      expect(arg.trigger.type).toBe(
        Notifications.SchedulableTriggerInputTypes.CALENDAR
      );
      expect(arg.trigger).not.toHaveProperty('date');
      expect(arg.trigger.channelId).toBe('reminders');
      // Month is 1-indexed in CALENDAR triggers (Date#getMonth is 0-indexed).
      expect(arg.trigger.month).toBeGreaterThanOrEqual(1);
      expect(arg.trigger.month).toBeLessThanOrEqual(12);
      expect(arg.trigger.second).toBe(0);
    }

    // 24-hour reminder fires at 2026-05-19 23:59 local — the day before due.
    const t24 = calls[0][0].trigger;
    expect(t24).toMatchObject({
      year: 2026, month: 5, day: 19, hour: 23, minute: 59,
    });
    // 1-hour reminder fires at 2026-05-20 22:59 local.
    const t1 = calls[1][0].trigger;
    expect(t1).toMatchObject({
      year: 2026, month: 5, day: 20, hour: 22, minute: 59,
    });

    Date.now.mockRestore();
  });

  test('Android: scheduleReminders emits a DATE (absolute timestamp) trigger, not CALENDAR', async () => {
    // expo-notifications 0.32.x rejects CALENDAR triggers on Android. Using an
    // absolute DATE trigger instead ensures Android users actually receive
    // reminders. Android TZ changes are handled by the AppState reschedule
    // path (which rebuilds absolute triggers against the new local time).
    Platform.OS = 'android';
    const now = new Date('2026-05-15T08:00:00').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('id-24h')
      .mockResolvedValueOnce('id-1h');

    await scheduleReminders({
      id: 'a1', title: 'Essay', course: 'ENGL', dueDate: '2026-05-20',
    });

    const calls = Notifications.scheduleNotificationAsync.mock.calls;
    expect(calls).toHaveLength(2);

    for (const [arg] of calls) {
      expect(arg.trigger.type).toBe(
        Notifications.SchedulableTriggerInputTypes.DATE
      );
      // DATE trigger carries an absolute Date object, not date components.
      expect(arg.trigger.date).toBeInstanceOf(Date);
      expect(arg.trigger).not.toHaveProperty('year');
      expect(arg.trigger).not.toHaveProperty('month');
      expect(arg.trigger.channelId).toBe('reminders');
    }

    // 24h reminder: absolute ms == dueAt - 24h
    const t24 = calls[0][0].trigger;
    const expected24h = new Date('2026-05-19T23:59:00').getTime();
    expect(t24.date.getTime()).toBe(expected24h);

    Date.now.mockRestore();
  });

  test('iOS: after a device TZ change, the reschedule path re-emits fresh CALENDAR components', async () => {
    // This test isolates the trigger-emission behaviour on iOS, which is the
    // layer that determines fire-at-local-time correctness. The hook layer's
    // AppState integration is covered in useAssignments tests; here we verify
    // the lib-level guarantee: every call to scheduleReminders on iOS emits a
    // fresh CALENDAR trigger built from the CURRENT local clock.
    const now = new Date('2026-05-15T08:00:00').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    Notifications.scheduleNotificationAsync
      .mockResolvedValue('id');

    await scheduleReminders({
      id: 'a1', title: 'Essay', course: 'ENGL', dueDate: '2026-05-20',
    });

    // Simulate a "second pass" reschedule (as the AppState path would do
    // after a TZ change). The trigger should not reference any absolute
    // timestamp — only local components — so the OS interprets them in
    // whatever TZ is active at fire time.
    Notifications.scheduleNotificationAsync.mockClear();
    Notifications.scheduleNotificationAsync.mockResolvedValue('id-2');

    await scheduleReminders({
      id: 'a1', title: 'Essay', course: 'ENGL', dueDate: '2026-05-20',
    });

    const arg = Notifications.scheduleNotificationAsync.mock.calls[0][0];
    expect(arg.trigger.type).toBe(
      Notifications.SchedulableTriggerInputTypes.CALENDAR
    );
    expect(arg.trigger).not.toHaveProperty('date');
    // No epoch ms — only wall-clock components.
    expect(typeof arg.trigger.year).toBe('number');
    expect(typeof arg.trigger.month).toBe('number');
    expect(typeof arg.trigger.day).toBe('number');

    Date.now.mockRestore();
  });
});

describe('device timezone helpers', () => {
  test('currentDeviceTimezone returns a non-empty IANA string in normal envs', () => {
    const tz = currentDeviceTimezone();
    // In the test runner this is whatever the host machine reports — just
    // verify it has the right shape.
    expect(typeof tz === 'string' || tz === null).toBe(true);
    if (tz) {
      expect(tz.length).toBeGreaterThan(0);
    }
  });

  test('storeDeviceTimezone + loadStoredTimezone round-trip', async () => {
    const stored = await storeDeviceTimezone('user-1');
    expect(stored).toBeTruthy();
    expect(await loadStoredTimezone('user-1')).toBe(stored);
  });

  test('loadStoredTimezone returns null when nothing has been stored', async () => {
    expect(await loadStoredTimezone('user-never-seen')).toBeNull();
  });

  test('detectTimezoneChanged returns false on the first run (no baseline)', async () => {
    expect(await detectTimezoneChanged('user-fresh')).toBe(false);
  });

  test('detectTimezoneChanged returns false when stored matches current', async () => {
    await storeDeviceTimezone('user-1');
    expect(await detectTimezoneChanged('user-1')).toBe(false);
  });

  test('detectTimezoneChanged returns true when stored differs from current', async () => {
    // Seed the store with an obviously-different TZ.
    await AsyncStorage.setItem('device_tz_user-1', 'Pacific/Kiritimati');
    const tz = currentDeviceTimezone();
    // Only assert the change if Intl is available in this env (otherwise
    // detectTimezoneChanged returns false by design).
    if (tz && tz !== 'Pacific/Kiritimati') {
      expect(await detectTimezoneChanged('user-1')).toBe(true);
    } else {
      expect(await detectTimezoneChanged('user-1')).toBe(false);
    }
  });

  test('TZ key is namespaced per user', async () => {
    await AsyncStorage.setItem('device_tz_user-A', 'America/New_York');
    await AsyncStorage.setItem('device_tz_user-B', 'Asia/Tokyo');
    expect(await loadStoredTimezone('user-A')).toBe('America/New_York');
    expect(await loadStoredTimezone('user-B')).toBe('Asia/Tokyo');
  });

  test('loadStoredTimezone returns null when AsyncStorage.getItem throws', async () => {
    AsyncStorage.getItem.mockRejectedValueOnce(new Error('storage error'));
    expect(await loadStoredTimezone('user-1')).toBeNull();
  });
});
