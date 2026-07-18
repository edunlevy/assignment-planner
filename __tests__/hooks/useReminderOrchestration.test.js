// PR 2.2 — useReminderOrchestration tests
// Directly exercises the thin async orchestration layer extracted from
// useAssignments: scheduleFor, scheduleBatchFor, cancelFor, reconcileOnLoad,
// rescheduleAll. Each test drives the hook's returned callback and asserts on
// the OS notification mock calls + the on-disk reminder map + the device-TZ
// write. Mirrors the mock setup style of the existing hook tests.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { useReminderOrchestration } from '../../hooks/useReminderOrchestration';
import { currentDeviceTimezone, reminderSig } from '../../lib/notifications';
import { renderHook, flushMicrotasks } from '../helpers/renderHook';

const USER_ID = 'user-1';
const MAP_KEY = `reminder_ids_${USER_ID}`;
const TZ_KEY = `device_tz_${USER_ID}`;
const CURRENT_TZ = currentDeviceTimezone();

// Reference "now" far before the fixtures' due dates so triggers are future.
const NOW = new Date('2026-05-15T08:00:00').getTime();

function row(overrides = {}) {
  return {
    id: 'a1',
    title: 'Essay',
    course: 'ENGL 200',
    dueDate: '2026-05-20',
    importance: 4,
    status: 'not_started',
    complexity: 'long',
    ...overrides,
  };
}

async function readMap() {
  const json = await AsyncStorage.getItem(MAP_KEY);
  return json ? JSON.parse(json) : null;
}

async function writeMap(map) {
  await AsyncStorage.setItem(MAP_KEY, JSON.stringify(map));
}

// Mount the hook and return its current API object.
function mount() {
  const { result } = renderHook(() => useReminderOrchestration(USER_ID));
  return result;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);

  Notifications.scheduleNotificationAsync.mockReset();
  Notifications.scheduleNotificationAsync.mockResolvedValue('notif-id');
  Notifications.getAllScheduledNotificationsAsync.mockReset();
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  Notifications.cancelScheduledNotificationAsync.mockReset();
  Notifications.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
  Notifications.getPermissionsAsync.mockReset();
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Notifications.requestPermissionsAsync.mockReset();
  Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
});

afterEach(() => {
  Date.now.mockRestore();
});

// ===========================================================================
// scheduleFor
// ===========================================================================
describe('scheduleFor', () => {
  test('fresh insert: schedules reminders, writes {ids, sig} map entry, no OS cancels', async () => {
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('r-24h')
      .mockResolvedValueOnce('r-1h');

    const api = mount();
    const a = row();

    let ids;
    await flushMicrotasks();
    ids = await api.current.scheduleFor(a);

    expect(ids).toEqual(['r-24h', 'r-1h']);
    // No pre-existing disk entry → cancel is a no-op.
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();

    const map = await readMap();
    expect(map[a.id].ids).toEqual(['r-24h', 'r-1h']);
    expect(typeof map[a.id].sig).toBe('string');
  });

  test('update path: cancels pre-existing DISK ids, schedules new, rewrites map', async () => {
    // Seed disk with old ids for this id.
    await writeMap({ a1: { ids: ['old-24h', 'old-1h'], sig: 'stale-sig' } });
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('new-24h')
      .mockResolvedValueOnce('new-1h');

    const api = mount();
    await flushMicrotasks();
    const ids = await api.current.scheduleFor(row({ title: 'Edited' }));

    // Old DISK ids cancelled.
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-1h');

    expect(ids).toEqual(['new-24h', 'new-1h']);
    const map = await readMap();
    expect(map.a1.ids).toEqual(['new-24h', 'new-1h']);
  });

  test('near the iOS pending-notification cap, reserves the row\'s OWN still-scheduled old slots so its replacement schedule is not blocked by itself', async () => {
    // 61 pending notifications include this row's own 2 old ones, which are
    // about to be freed once the new schedule is confirmed. Without
    // reserving them, makeSlotBudget's snapshot (taken before the old ones
    // are cancelled, since cancelling now happens AFTER scheduling) would
    // see remaining = max(0, 64-4-61) = 0 and fail to schedule replacements
    // for a row that isn't actually contributing net-new load.
    const pending = Array.from({ length: 61 }, (_, i) => ({ identifier: `pending-${i}` }));
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValue(pending);
    await writeMap({ a1: { ids: ['old-24h', 'old-1h'], sig: 'stale' } });
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('new-24h')
      .mockResolvedValueOnce('new-1h');

    const api = mount();
    await flushMicrotasks();
    const ids = await api.current.scheduleFor(row({ title: 'Edited' }));

    expect(ids).toEqual(['new-24h', 'new-1h']);
  });

  test('completed: cancels old ids, schedules nothing, deletes map entry', async () => {
    await writeMap({ a1: { ids: ['old-24h', 'old-1h'], sig: 's' } });

    const api = mount();
    await flushMicrotasks();
    const ids = await api.current.scheduleFor(row({ status: 'completed' }));

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-24h');
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(ids).toEqual([]);
    const map = await readMap();
    expect(map.a1).toBeUndefined();
  });

  test('schedule failure on a fresh insert (no pre-existing reminders): returns empty ids, writes no map entry', async () => {
    Notifications.scheduleNotificationAsync.mockRejectedValue(new Error('OS denied'));

    const api = mount();
    await flushMicrotasks();
    const ids = await api.current.scheduleFor(row());

    expect(ids).toEqual([]);
    const map = await readMap();
    expect(map.a1).toBeUndefined();
  });

  test('transient scheduling failure during an UPDATE preserves the still-valid old reminders instead of losing them', async () => {
    // Regression test for a silent-data-loss bug: previously old ids were
    // cancelled BEFORE the new ones were confirmed scheduled, so a transient
    // OS/permission failure during an edit could delete working reminders
    // and leave nothing in their place. importance isn't part of the
    // scheduling-relevant sig, so the stored sig still matches — a strong
    // signal that an empty result here is a failure, not a legitimate
    // "nothing to schedule".
    const original = row();
    await writeMap({ a1: { ids: ['old-24h', 'old-1h'], sig: reminderSig(original) } });
    Notifications.scheduleNotificationAsync.mockRejectedValue(new Error('OS denied'));

    const api = mount();
    await flushMicrotasks();
    const ids = await api.current.scheduleFor(row({ importance: 5 }));

    expect(ids).toEqual(['old-24h', 'old-1h']);
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(await readMap()).toEqual({ a1: { ids: ['old-24h', 'old-1h'], sig: reminderSig(original) } });
  });

  test('a due date that legitimately moved into the past still clears old reminders even though scheduling returns empty', async () => {
    // Distinguishes the fix above from silently NEVER clearing reminders:
    // when the reminder-relevant content actually changed (dueDate here),
    // an empty result is trusted as legitimate — every trigger for the new
    // due date really is in the past — and old reminders are cleared.
    await writeMap({ a1: { ids: ['old-24h', 'old-1h'], sig: 'some-other-sig' } });

    const api = mount();
    await flushMicrotasks();
    const ids = await api.current.scheduleFor(row({ dueDate: '2020-01-01' }));

    expect(ids).toEqual([]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-1h');
    expect(await readMap()).toEqual({});
  });

  test('torn down mid-schedule (realtime path): cancels just-scheduled ids, no leak', async () => {
    // The realtime upsert path passes a shouldCancel predicate. If teardown
    // (logout / user switch) lands while scheduling, the just-scheduled OS
    // notifications must be cancelled so they don't leak for a signed-out user.
    // Predicate returns false at the pre-schedule check, true after scheduling.
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('leak-24h')
      .mockResolvedValueOnce('leak-1h');

    const api = mount();
    await flushMicrotasks();
    let calls = 0;
    const ids = await api.current.scheduleFor(row(), () => calls++ > 0);

    expect(ids).toEqual([]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('leak-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('leak-1h');
    // No pre-existing entry, so nothing to prune: map stays empty.
    expect(await readMap()).toBeNull();
  });

  test('torn down BEFORE pre-cancel: leaves existing reminders and map untouched', async () => {
    // Teardown already true on the first check → bail before cancelling the
    // old ids or scheduling. The existing OS notifications and map entry stay
    // valid (they're still consistent with disk).
    await writeMap({ a1: { ids: ['old-24h', 'old-1h'], sig: 'keep' } });

    const api = mount();
    await flushMicrotasks();
    const ids = await api.current.scheduleFor(row(), () => true);

    expect(ids).toEqual([]);
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(await readMap()).toEqual({ a1: { ids: ['old-24h', 'old-1h'], sig: 'keep' } });
  });

  test('torn down mid-flight during an UPDATE: cancels just-scheduled new ids, leaves the pre-existing old ones and map untouched', async () => {
    // With the schedule-before-cancel ordering, a mid-flight teardown means
    // the old (still-valid, still-tracked) reminders were never touched —
    // the edit simply didn't happen. That's a cleaner outcome than the old
    // cancel-old-then-teardown-then-prune dance and needs no special map
    // recovery: what's on disk already matches what's actually scheduled.
    await writeMap({ a1: { ids: ['old-24h', 'old-1h'], sig: 'stale' } });
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('new-24h')
      .mockResolvedValueOnce('new-1h');

    const api = mount();
    await flushMicrotasks();
    let calls = 0;
    const ids = await api.current.scheduleFor(row(), () => calls++ > 0);

    expect(ids).toEqual([]);
    // Old ids were never touched — the edit was aborted before the swap.
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('old-24h');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('old-1h');
    // New ids cancelled by the teardown cleanup so they don't leak.
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('new-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('new-1h');
    // Map untouched — still matches the old (still-scheduled) ids.
    expect(await readMap()).toEqual({ a1: { ids: ['old-24h', 'old-1h'], sig: 'stale' } });
  });
});

// ===========================================================================
// scheduleBatchFor
// ===========================================================================
describe('scheduleBatchFor', () => {
  test('schedules many under shared budget, writes a map entry per row', async () => {
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('a-24h').mockResolvedValueOnce('a-1h')
      .mockResolvedValueOnce('b-24h').mockResolvedValueOnce('b-1h');

    const api = mount();
    await flushMicrotasks();

    const a = row({ id: 'a', dueDate: '2026-05-20' });
    const b = row({ id: 'b', dueDate: '2026-05-27' });
    const out = await api.current.scheduleBatchFor([a, b]);

    expect(out).toEqual([['a-24h', 'a-1h'], ['b-24h', 'b-1h']]);
    const map = await readMap();
    expect(map.a.ids).toEqual(['a-24h', 'a-1h']);
    expect(map.b.ids).toEqual(['b-24h', 'b-1h']);
  });

  test('no pre-cancel for fresh batch', async () => {
    const api = mount();
    await flushMicrotasks();
    await api.current.scheduleBatchFor([row({ id: 'x' })]);
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// cancelFor
// ===========================================================================
describe('cancelFor', () => {
  test('cancels disk ids and prunes the map entry', async () => {
    await writeMap({ a1: { ids: ['c-24h', 'c-1h'], sig: 's' }, other: { ids: ['x'], sig: 's' } });

    const api = mount();
    await flushMicrotasks();
    await api.current.cancelFor('a1');

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('c-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('c-1h');
    const map = await readMap();
    expect(map.a1).toBeUndefined();
    // Unrelated entry untouched.
    expect(map.other.ids).toEqual(['x']);
  });

  test('no map entry: no-op cancel, still saves clean map', async () => {
    const api = mount();
    await flushMicrotasks();
    await api.current.cancelFor('missing');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// reconcileOnLoad
// ===========================================================================
describe('reconcileOnLoad', () => {
  const noCancel = () => false;

  test('Phase A: prunes reminders for rows deleted remotely and now-completed', async () => {
    const reminderMap = {
      gone: { ids: ['gone-1'], sig: 's' },       // not in merged → deleted remotely
      done: { ids: ['done-1'], sig: 's' },       // present but completed
    };
    await writeMap(reminderMap);

    const merged = [
      { ...row({ id: 'done', status: 'completed' }), reminderIds: ['done-1'] },
    ];

    const api = mount();
    await flushMicrotasks();
    const out = await api.current.reconcileOnLoad(merged, reminderMap, noCancel);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('gone-1');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('done-1');

    const completed = out.find(a => a.id === 'done');
    expect(completed.reminderIds).toEqual([]);

    const map = await readMap();
    expect(map.gone).toBeUndefined();
    expect(map.done).toBeUndefined();
  });

  test('Phase B: schedules new (no ids) rows and stores device TZ', async () => {
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('new-24h')
      .mockResolvedValueOnce('new-1h');

    const reminderMap = {};
    const merged = [{ ...row({ id: 'fresh' }), reminderIds: [] }];

    const api = mount();
    await flushMicrotasks();
    const out = await api.current.reconcileOnLoad(merged, reminderMap, noCancel);

    expect(out.find(a => a.id === 'fresh').reminderIds).toEqual(['new-24h', 'new-1h']);
    const map = await readMap();
    expect(map.fresh.ids).toEqual(['new-24h', 'new-1h']);
    // Device TZ seeded at the end.
    expect(await AsyncStorage.getItem(TZ_KEY)).toBe(CURRENT_TZ);
  });

  test('stale-sig: cancels old reminders then reschedules', async () => {
    const reminderMap = { s1: { ids: ['stale-24h', 'stale-1h'], sig: 'OLD-SIG' } };
    await writeMap(reminderMap);
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('fresh-24h')
      .mockResolvedValueOnce('fresh-1h');

    const merged = [{ ...row({ id: 's1', title: 'New Title' }), reminderIds: ['stale-24h', 'stale-1h'] }];

    const api = mount();
    await flushMicrotasks();
    const out = await api.current.reconcileOnLoad(merged, reminderMap, noCancel);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('stale-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('stale-1h');
    expect(out.find(a => a.id === 's1').reminderIds).toEqual(['fresh-24h', 'fresh-1h']);
    const map = await readMap();
    expect(map.s1.ids).toEqual(['fresh-24h', 'fresh-1h']);
  });

  test('matching sig: no reschedule, ids preserved', async () => {
    // Build a sig that matches the row so it is NOT rescheduled.
    const a = row({ id: 'keep' });
    const { reminderSig } = await import('../../lib/notifications');
    const reminderMap = { keep: { ids: ['keep-24h', 'keep-1h'], sig: reminderSig(a) } };
    await writeMap(reminderMap);

    const merged = [{ ...a, reminderIds: ['keep-24h', 'keep-1h'] }];

    const api = mount();
    await flushMicrotasks();
    await api.current.reconcileOnLoad(merged, reminderMap, noCancel);

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  test('Phase A.5: cancels orphaned OS notifications not tracked in the map', async () => {
    const a = row({ id: 'keep' });
    const { reminderSig } = await import('../../lib/notifications');
    const reminderMap = { keep: { ids: ['keep-24h', 'keep-1h'], sig: reminderSig(a) } };
    await writeMap(reminderMap);

    Notifications.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      { identifier: 'keep-24h' },
      { identifier: 'keep-1h' },
      { identifier: 'orphan-1' },
    ]);

    const merged = [{ ...a, reminderIds: ['keep-24h', 'keep-1h'] }];

    const api = mount();
    await flushMicrotasks();
    await api.current.reconcileOnLoad(merged, reminderMap, noCancel);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('orphan-1');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('keep-24h');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('keep-1h');
    // Sig still matches → no reschedule (Phase A.5 is surgical, not a blanket cancel).
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  test('Phase A.5 orphan cleanup runs before Phase B scheduling', async () => {
    const callOrder = [];
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      { identifier: 'orphan-1' },
    ]);
    Notifications.cancelScheduledNotificationAsync.mockImplementation(async id => {
      callOrder.push(`cancel:${id}`);
    });
    Notifications.scheduleNotificationAsync.mockImplementation(async () => {
      callOrder.push('schedule');
      return 'new-id';
    });

    const reminderMap = {};
    const merged = [{ ...row({ id: 'fresh' }), reminderIds: [] }];

    const api = mount();
    await flushMicrotasks();
    await api.current.reconcileOnLoad(merged, reminderMap, noCancel);

    expect(callOrder[0]).toBe('cancel:orphan-1');
    expect(callOrder).toContain('schedule');
  });

  test('shouldCancel bails early before Phase B scheduling', async () => {
    const reminderMap = {};
    const merged = [{ ...row({ id: 'fresh' }), reminderIds: [] }];

    const api = mount();
    await flushMicrotasks();
    // Cancel immediately → returns undefined, no scheduling, no TZ write.
    const out = await api.current.reconcileOnLoad(merged, reminderMap, () => true);

    expect(out).toBeUndefined();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(TZ_KEY)).toBeNull();
  });
});

// ===========================================================================
// rescheduleAll
// ===========================================================================
describe('rescheduleAll', () => {
  const noCancel = () => false;

  test('cancels disk ids, reschedules, updates map, returns id map', async () => {
    await writeMap({ r1: { ids: ['orig-24h', 'orig-1h'], sig: 's' } });
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('post-24h')
      .mockResolvedValueOnce('post-1h');

    const incomplete = [row({ id: 'r1' })];

    const api = mount();
    await flushMicrotasks();
    const idsById = await api.current.rescheduleAll(incomplete, noCancel);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('orig-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('orig-1h');
    expect(idsById.get('r1')).toEqual(['post-24h', 'post-1h']);

    const map = await readMap();
    expect(map.r1.ids).toEqual(['post-24h', 'post-1h']);
  });

  test('cancelled mid-flight after scheduling: cleans up just-scheduled ids, prunes map, returns null', async () => {
    await writeMap({ r1: { ids: ['orig-24h'], sig: 's' } });
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('leak-24h')
      .mockResolvedValueOnce('leak-1h');

    const incomplete = [row({ id: 'r1' })];

    // Flip cancelled true only AFTER the cancel-loop + schedule have run.
    // The predicate is checked: (1) after loadReminderMap, (2) after each
    // cancel, (3) after scheduleRemindersBatch. We let it pass until the
    // post-schedule check by counting calls.
    let calls = 0;
    const shouldCancel = () => {
      calls += 1;
      // First checks (map load + per-id cancel) pass; the post-schedule
      // check (after orig cancel + batch) trips the cleanup branch.
      return calls >= 3;
    };

    const api = mount();
    await flushMicrotasks();
    const out = await api.current.rescheduleAll(incomplete, shouldCancel);

    expect(out).toBeNull();
    // Just-scheduled ids cancelled to avoid leaking.
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('leak-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('leak-1h');
    // The stale r1 entry (old ids already cancelled) must be pruned — a TZ
    // change doesn't alter the sig, so leaving it would make the next load
    // skip rescheduling and silently lose the reminder.
    expect(await readMap()).toEqual({});
  });

  test('cancelled mid cancel-loop: prunes entries already cancelled, leaves the rest, returns null', async () => {
    // r1 gets cancelled, then teardown trips before r2 is touched. r1's stale
    // entry must be pruned; r2's entry (its OS reminders still live) must stay.
    await writeMap({
      r1: { ids: ['r1-24h'], sig: 's' },
      r2: { ids: ['r2-24h'], sig: 's' },
    });

    const incomplete = [row({ id: 'r1' }), row({ id: 'r2' })];

    // Checked: (1) after loadReminderMap, (2) after cancelling r1. Trip on (2).
    let calls = 0;
    const shouldCancel = () => {
      calls += 1;
      return calls >= 2;
    };

    const api = mount();
    await flushMicrotasks();
    const out = await api.current.rescheduleAll(incomplete, shouldCancel);

    expect(out).toBeNull();
    // r1's old reminder cancelled; r2 never touched (teardown bailed first).
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('r1-24h');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('r2-24h');
    // Nothing rescheduled.
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    // r1 pruned (its ids are dead), r2 preserved (its reminders still live).
    expect(await readMap()).toEqual({ r2: { ids: ['r2-24h'], sig: 's' } });
  });
});
