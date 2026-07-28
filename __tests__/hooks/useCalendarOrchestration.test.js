// vi.mock is hoisted above the import of useCalendarOrchestration by vitest.
// Mocking the lib/calendarSync layer (rather than expo-calendar directly)
// keeps these tests focused on the hook's orchestration policy — the native
// API details are covered separately in __tests__/lib/calendarSync.test.js.
vi.mock('../../lib/calendarSync', () => ({
  requestCalendarAccess: vi.fn(),
  ensureAssignmentCalendar: vi.fn(),
  createEventFor: vi.fn(),
  updateEventFor: vi.fn(),
  deleteEventFor: vi.fn(),
  deleteAssignmentCalendar: vi.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from 'react-test-renderer';
import { useCalendarOrchestration } from '../../hooks/useCalendarOrchestration';
import {
  createEventFor,
  deleteAssignmentCalendar,
  deleteEventFor,
  ensureAssignmentCalendar,
  requestCalendarAccess,
  updateEventFor,
} from '../../lib/calendarSync';
import { renderHook, flushMicrotasks } from '../helpers/renderHook';

const USER_ID = 'user-1';

function makeAssignment(id, overrides = {}) {
  return { id, title: 'Essay', course: 'ENGL', dueDate: '2026-06-15', status: 'not_started', ...overrides };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  vi.clearAllMocks();
  requestCalendarAccess.mockResolvedValue('granted');
  ensureAssignmentCalendar.mockResolvedValue('cal-1');
  createEventFor.mockResolvedValue('event-new');
  updateEventFor.mockResolvedValue(true);
  deleteEventFor.mockResolvedValue(true);
  deleteAssignmentCalendar.mockResolvedValue(true);
});

describe('useCalendarOrchestration — initial load', () => {
  test('starts disabled and unloaded before a userId is available', () => {
    const { result } = renderHook(() => useCalendarOrchestration(null));
    expect(result.current.syncEnabled).toBe(false);
    expect(result.current.loaded).toBe(false);
  });

  test('defaults to disabled with loaded=true when nothing is persisted', async () => {
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();
    expect(result.current.syncEnabled).toBe(false);
    expect(result.current.loaded).toBe(true);
  });

  test('adopts a previously-persisted enabled flag', async () => {
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'true');
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();
    expect(result.current.syncEnabled).toBe(true);
  });
});

describe('scheduleFor', () => {
  test('is a no-op when sync is off', async () => {
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();
    await act(async () => { await result.current.scheduleFor(makeAssignment('a1')); });
    expect(createEventFor).not.toHaveBeenCalled();
    expect(updateEventFor).not.toHaveBeenCalled();
  });

  test('creates a new event for an unsynced assignment when enabled', async () => {
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'true');
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    await act(async () => { await result.current.scheduleFor(makeAssignment('a1')); });

    expect(ensureAssignmentCalendar).toHaveBeenCalled();
    expect(createEventFor).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), 'cal-1');
    const map = JSON.parse(await AsyncStorage.getItem(`calendar_events_${USER_ID}`));
    expect(map).toEqual({ a1: 'event-new' });
  });

  test('updates the existing event in place instead of recreating it', async () => {
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'true');
    await AsyncStorage.setItem(`calendar_events_${USER_ID}`, JSON.stringify({ a1: 'event-existing' }));
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    await act(async () => { await result.current.scheduleFor(makeAssignment('a1', { title: 'Updated' })); });

    expect(updateEventFor).toHaveBeenCalledWith('event-existing', expect.objectContaining({ title: 'Updated' }));
    expect(createEventFor).not.toHaveBeenCalled();
  });

  test('recreates the event when the update fails (event deleted externally)', async () => {
    updateEventFor.mockResolvedValue(false);
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'true');
    await AsyncStorage.setItem(`calendar_events_${USER_ID}`, JSON.stringify({ a1: 'event-gone' }));
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    await act(async () => { await result.current.scheduleFor(makeAssignment('a1')); });

    expect(createEventFor).toHaveBeenCalled();
    const map = JSON.parse(await AsyncStorage.getItem(`calendar_events_${USER_ID}`));
    expect(map.a1).toBe('event-new');
  });
});

describe('cancelFor', () => {
  test('deletes the mapped event and prunes the entry, even when sync is off', async () => {
    await AsyncStorage.setItem(`calendar_events_${USER_ID}`, JSON.stringify({ a1: 'event-1', a2: 'event-2' }));
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    await act(async () => { await result.current.cancelFor('a1'); });

    expect(deleteEventFor).toHaveBeenCalledWith('event-1');
    const map = JSON.parse(await AsyncStorage.getItem(`calendar_events_${USER_ID}`));
    expect(map).toEqual({ a2: 'event-2' });
  });

  test('no-ops when the id has no mapped event', async () => {
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();
    await act(async () => { await result.current.cancelFor('unknown'); });
    expect(deleteEventFor).not.toHaveBeenCalled();
  });

  test('leaves the map entry in place when deletion could not be confirmed, rather than silently orphaning it', async () => {
    // deleteEventFor never throws (expo-calendar ambiguity), so cancelFor
    // can't tell "confirmed gone" from "still there" except via the
    // returned boolean. Pruning regardless would make the on-disk map lie
    // about what's actually deleted, with no later pass to ever notice —
    // unlike reminders, calendar has no orphan-sweep on load.
    await AsyncStorage.setItem(`calendar_events_${USER_ID}`, JSON.stringify({ a1: 'event-1' }));
    deleteEventFor.mockResolvedValue(false);
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    await act(async () => { await result.current.cancelFor('a1'); });

    expect(deleteEventFor).toHaveBeenCalledWith('event-1');
    const map = JSON.parse(await AsyncStorage.getItem(`calendar_events_${USER_ID}`));
    expect(map).toEqual({ a1: 'event-1' });
  });
});

describe('reconcileOnLoad', () => {
  test('is a no-op when sync is off', async () => {
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();
    await act(async () => { await result.current.reconcileOnLoad([makeAssignment('a1')]); });
    expect(createEventFor).not.toHaveBeenCalled();
  });

  test('backfills only assignments missing an event', async () => {
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'true');
    await AsyncStorage.setItem(`calendar_events_${USER_ID}`, JSON.stringify({ a1: 'event-1' }));
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    await act(async () => {
      await result.current.reconcileOnLoad([makeAssignment('a1'), makeAssignment('a2')]);
    });

    expect(createEventFor).toHaveBeenCalledTimes(1);
    expect(createEventFor).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }), 'cal-1');
  });
});

describe('enableSync', () => {
  test("returns { ok: false, reason: 'denied' } and stays disabled when access is denied", async () => {
    requestCalendarAccess.mockResolvedValue('denied');
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    let outcome;
    await act(async () => { outcome = await result.current.enableSync([]); });

    expect(outcome).toEqual({ ok: false, reason: 'denied' });
    expect(result.current.syncEnabled).toBe(false);
    expect(ensureAssignmentCalendar).not.toHaveBeenCalled();
  });

  test("surfaces write-only access (iOS 'Add Events Only') as its own reason", async () => {
    requestCalendarAccess.mockResolvedValue('writeOnly');
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    let outcome;
    await act(async () => { outcome = await result.current.enableSync([]); });

    expect(outcome).toEqual({ ok: false, reason: 'writeOnly' });
    expect(result.current.syncEnabled).toBe(false);
    expect(ensureAssignmentCalendar).not.toHaveBeenCalled();
  });

  test("returns { ok: false, reason: 'createFailed' } and stays disabled when the calendar cannot be created", async () => {
    // The real-world SDK 57 regression path: access granted, but
    // ensureAssignmentCalendar throws. Must not flip the enabled flag —
    // otherwise every later scheduleFor would keep failing silently.
    ensureAssignmentCalendar.mockRejectedValue(new Error('native failure'));
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    let outcome;
    await act(async () => { outcome = await result.current.enableSync([makeAssignment('a1')]); });

    expect(outcome).toEqual({ ok: false, reason: 'createFailed' });
    expect(result.current.syncEnabled).toBe(false);
    expect(createEventFor).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(`calendar_sync_enabled_${USER_ID}`)).not.toBe('true');
  });

  test('grants: ensures the calendar, backfills, and flips syncEnabled', async () => {
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    let outcome;
    await act(async () => {
      outcome = await result.current.enableSync([makeAssignment('a1'), makeAssignment('a2')]);
    });

    expect(outcome).toEqual({ ok: true });
    expect(result.current.syncEnabled).toBe(true);
    expect(ensureAssignmentCalendar).toHaveBeenCalled();
    expect(createEventFor).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem(`calendar_sync_enabled_${USER_ID}`)).toBe('true');
  });

  test('backfill runs even though syncEnabled state has not re-rendered yet (no stale-closure no-op)', async () => {
    // Regression guard: backfillMissingEvents is a plain function, not a
    // syncEnabled-gated callback, specifically so this call inside
    // enableSync can't see a stale pre-toggle `syncEnabled=false` closure.
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();
    await act(async () => { await result.current.enableSync([makeAssignment('solo')]); });
    expect(createEventFor).toHaveBeenCalledWith(expect.objectContaining({ id: 'solo' }), 'cal-1');
  });
});

describe('disableSync', () => {
  test('keeps events by default: flips syncEnabled off without deleting the calendar', async () => {
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'true');
    await AsyncStorage.setItem(`calendar_events_${USER_ID}`, JSON.stringify({ a1: 'event-1' }));
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    await act(async () => { await result.current.disableSync(false); });

    expect(result.current.syncEnabled).toBe(false);
    expect(deleteAssignmentCalendar).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(`calendar_sync_enabled_${USER_ID}`)).toBe('false');
    expect(JSON.parse(await AsyncStorage.getItem(`calendar_events_${USER_ID}`))).toEqual({});
  });

  test('deleteEvents=true removes the whole calendar', async () => {
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'true');
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    await act(async () => { await result.current.disableSync(true); });

    expect(deleteAssignmentCalendar).toHaveBeenCalledWith('cal-1');
  });

  test('deleteEvents=true with unconfirmed deletion: throws a distinguishable error and leaves the event map intact instead of orphaning events', async () => {
    // Regression test: previously the map was cleared unconditionally
    // regardless of whether the native delete actually succeeded, so a
    // failed deletion plus a cleared map would silently orphan those
    // events — a future re-enable's backfill would see an empty map,
    // assume nothing was synced, and create a duplicate set alongside the
    // leftovers. syncEnabled still flips off either way (the user's intent
    // to stop syncing is honored); only the map-clear is now conditional.
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'true');
    await AsyncStorage.setItem(`calendar_events_${USER_ID}`, JSON.stringify({ a1: 'event-1' }));
    deleteAssignmentCalendar.mockResolvedValue(false);
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    await act(async () => {
      await expect(result.current.disableSync(true)).rejects.toMatchObject({
        code: 'CALENDAR_DELETE_UNCONFIRMED',
      });
    });

    expect(result.current.syncEnabled).toBe(false);
    expect(await AsyncStorage.getItem(`calendar_sync_enabled_${USER_ID}`)).toBe('false');
    expect(JSON.parse(await AsyncStorage.getItem(`calendar_events_${USER_ID}`))).toEqual({ a1: 'event-1' });
  });
});

describe('event map concurrency', () => {
  test('concurrent scheduleFor calls for different assignments do not clobber each other\'s map entries', async () => {
    // Regression test for a lost-update race: without serializing the
    // shared calendar_events_<userId> AsyncStorage key, two concurrent
    // read-modify-write sequences could each read the map before the
    // other's write landed, and the second write would silently drop the
    // first call's entry.
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'true');
    createEventFor.mockImplementation(async a => `event-${a.id}`);
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();

    await act(async () => {
      await Promise.all([
        result.current.scheduleFor(makeAssignment('a1')),
        result.current.scheduleFor(makeAssignment('a2')),
        result.current.scheduleFor(makeAssignment('a3')),
      ]);
    });

    const map = JSON.parse(await AsyncStorage.getItem(`calendar_events_${USER_ID}`));
    expect(map).toEqual({ a1: 'event-a1', a2: 'event-a2', a3: 'event-a3' });
  });

  test('a backfill never touches the calendar if the on-disk flag is already off when it runs, even with a stale in-memory ref', async () => {
    // Regression test for the disableSync race, fixed version: the
    // authoritative on-disk flag is checked BEFORE any calendar mutation
    // (not just before the final map write — an earlier, incomplete fix
    // checked only there, which let a deleted calendar get silently
    // recreated and repopulated with untracked, orphaned events before the
    // write was skipped). Simulates disableSync's flag write landing
    // without going through disableSync itself, so the in-memory ref still
    // thinks sync is on (passing reconcileOnLoad's outer guard) while the
    // disk — the authoritative source the inner check reads — says off.
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'true');
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'false');

    await act(async () => { await result.current.reconcileOnLoad([makeAssignment('a1')]); });

    expect(ensureAssignmentCalendar).not.toHaveBeenCalled();
    expect(createEventFor).not.toHaveBeenCalled();
    const stored = await AsyncStorage.getItem(`calendar_events_${USER_ID}`);
    expect(stored === null ? {} : JSON.parse(stored)).toEqual({});
  });

  test('scheduleFor never touches the calendar under the same stale-ref/authoritative-disk mismatch', async () => {
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'true');
    const { result } = renderHook(() => useCalendarOrchestration(USER_ID));
    await flushMicrotasks();
    await AsyncStorage.setItem(`calendar_sync_enabled_${USER_ID}`, 'false');

    await act(async () => { await result.current.scheduleFor(makeAssignment('a1')); });

    expect(ensureAssignmentCalendar).not.toHaveBeenCalled();
    expect(createEventFor).not.toHaveBeenCalled();
    const stored = await AsyncStorage.getItem(`calendar_events_${USER_ID}`);
    expect(stored === null ? {} : JSON.parse(stored)).toEqual({});
  });
});
