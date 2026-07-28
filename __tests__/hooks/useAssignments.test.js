// PR 2 — useAssignments mutation tests
// Covers: insert, insertMany, update, remove + their interaction with
// self-mutation markers and the tombstone (i.e. self-echo suppression).
//
// Remote-event tests (load effect, AppState TZ, true cross-device events)
// live in PR 3 — see useAssignments.realtime.test.js (forthcoming).

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Calendar from 'expo-calendar/legacy';
import { act } from 'react-test-renderer';
import { addDays, format, parseISO } from 'date-fns';

// IMPORTANT: vi.mock is hoisted by vitest to the top of the file, BEFORE the
// import of useAssignments. Mocking the lib/assignmentsDb layer (rather than
// the supabase chain) keeps tests focused on hook behavior.
vi.mock('../../lib/assignmentsDb', () => ({
  fromDb: row => row, // identity — incoming row already in app shape in tests
  dbFetch: vi.fn(async () => []),
  dbInsert: vi.fn(),
  dbInsertMany: vi.fn(),
  dbUpdate: vi.fn(),
  dbDelete: vi.fn(),
  dbDeleteSeries: vi.fn(),
  dbUpdateSeriesFrom: vi.fn(),
}));

import { useAssignments } from '../../hooks/useAssignments';
import {
  dbDelete,
  dbDeleteSeries,
  dbFetch,
  dbInsert,
  dbInsertMany,
  dbUpdate,
  dbUpdateSeriesFrom,
} from '../../lib/assignmentsDb';
import { supabase } from '../../lib/supabase';
import { renderHook, flushMicrotasks } from '../helpers/renderHook';

const USER_ID = 'user-1';

// Reference time so reminder scheduling produces deterministic triggers.
// Far enough before the test fixtures' dueDate that reminders are always future.
const NOW = new Date('2026-05-15T08:00:00').getTime();

// Captured realtime callback. The `useAssignments` hook subscribes to
// supabase.channel(...).on('postgres_changes', filter, cb). We replace the
// default mock so `cb` is stashed for tests that need to simulate realtime
// events (e.g. own-echo suppression).
let realtimeCallback = null;

// Captured subscribe() status callback. The hook calls
// .subscribe((status, err) => ...) to surface channel errors into syncError.
let subscribeStatusCallback = null;

// Dispatch a realtime event as if it came from Supabase, then flush.
async function emitRealtime(payload) {
  if (!realtimeCallback) throw new Error('realtime channel not subscribed yet');
  await act(async () => {
    realtimeCallback(payload);
    await flushMicrotasks();
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();

  vi.spyOn(Date, 'now').mockReturnValue(NOW);

  dbFetch.mockReset();
  dbFetch.mockResolvedValue([]);
  dbInsert.mockReset();
  dbInsertMany.mockReset();
  dbUpdate.mockReset();
  dbDelete.mockReset();
  dbDeleteSeries.mockReset();
  dbUpdateSeriesFrom.mockReset();

  Notifications.scheduleNotificationAsync.mockReset();
  Notifications.scheduleNotificationAsync.mockResolvedValue('notif-id');
  Notifications.getAllScheduledNotificationsAsync.mockReset();
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  Notifications.cancelScheduledNotificationAsync.mockReset();
  Notifications.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
  Notifications.getPermissionsAsync.mockReset();
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });

  // Re-wire supabase.channel to capture the realtime callback.
  realtimeCallback = null;
  subscribeStatusCallback = null;
  supabase.channel.mockReset();
  supabase.channel.mockImplementation(() => {
    const ch = {
      on: vi.fn((_event, _filter, cb) => {
        realtimeCallback = cb;
        return ch;
      }),
      subscribe: vi.fn(statusCb => {
        subscribeStatusCallback = statusCb;
        return ch;
      }),
      unsubscribe: vi.fn(async () => {}),
    };
    return ch;
  });
  supabase.removeChannel.mockReset();
  supabase.removeChannel.mockResolvedValue(undefined);
});

afterEach(() => {
  Date.now.mockRestore();
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const VALID_DRAFT = {
  title: 'Essay',
  course: 'ENGL 200',
  dueDate: '2026-05-20',
  importance: 4,
  status: 'not_started',
  complexity: 'long',
};

// Mount the hook and wait for its load effect to finish.
async function mountHook() {
  const handle = renderHook(() => useAssignments(USER_ID));
  await flushMicrotasks();
  return handle;
}

// Convenience: configure dbInsert to echo back the row it was given. Mirrors
// what a real DB row would look like after the server has filled defaults.
function dbInsertEchoesBack() {
  dbInsert.mockImplementation(async row => ({ ...row }));
}

// ===========================================================================
// insert
// ===========================================================================
describe('insert', () => {
  test('mints a UUID, calls dbInsert, schedules reminders, persists map, updates state', async () => {
    dbInsertEchoesBack();
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('reminder-24h')
      .mockResolvedValueOnce('reminder-1h');

    const { result } = await mountHook();

    let inserted;
    await act(async () => {
      inserted = await result.current.insert(VALID_DRAFT);
    });

    // dbInsert called with a client-minted UUID + userId
    expect(dbInsert).toHaveBeenCalledTimes(1);
    const [arg, userId] = dbInsert.mock.calls[0];
    expect(userId).toBe(USER_ID);
    expect(arg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab]/);
    expect(arg.title).toBe('Essay');

    // Returned row carries the new reminder ids
    expect(inserted.reminderIds).toEqual(['reminder-24h', 'reminder-1h']);

    // State holds the row
    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.assignments[0].id).toBe(inserted.id);

    // Reminder map persisted to disk — new format stores { ids, sig }
    const map = JSON.parse(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`));
    expect(map[inserted.id].ids).toEqual(['reminder-24h', 'reminder-1h']);
    expect(typeof map[inserted.id].sig).toBe('string');
  });

  test('DB error: rejects, leaves state empty, no reminder map entry', async () => {
    dbInsert.mockRejectedValue(new Error('network down'));

    const { result } = await mountHook();

    await act(async () => {
      await expect(result.current.insert(VALID_DRAFT)).rejects.toThrow('network down');
    });

    expect(result.current.assignments).toEqual([]);
    expect(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`)).toBeNull();
  });

  test('reminder scheduling failure does not poison the insert (returns with empty reminderIds)', async () => {
    // scheduleNotificationAsync rejects → scheduleReminders catches and returns []
    dbInsertEchoesBack();
    Notifications.scheduleNotificationAsync.mockRejectedValue(new Error('OS denied'));

    const { result } = await mountHook();

    let inserted;
    await act(async () => {
      inserted = await result.current.insert(VALID_DRAFT);
    });

    // Insert still succeeded — row is in state, just with no reminder ids.
    expect(result.current.assignments).toHaveLength(1);
    expect(inserted.reminderIds).toEqual([]);
  });

  test('self-echo: realtime INSERT for our own row does not duplicate state', async () => {
    dbInsertEchoesBack();
    const { result } = await mountHook();

    let inserted;
    await act(async () => {
      inserted = await result.current.insert(VALID_DRAFT);
    });

    expect(result.current.assignments).toHaveLength(1);

    // Now simulate the realtime echo of our own write.
    await emitRealtime({
      eventType: 'INSERT',
      new: { ...inserted, reminderIds: undefined },
    });

    // No duplicate, no second reconcile.
    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.assignments[0].id).toBe(inserted.id);
  });
});

// ===========================================================================
// insertMany (weekly recurring series path)
// ===========================================================================
describe('insertMany', () => {
  test('inserts batch, schedules reminders per row, all rows in state', async () => {
    // Echo back with stable ids matching the input drafts
    dbInsertMany.mockImplementation(async drafts => drafts.map(d => ({ ...d })));
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('r1-24h').mockResolvedValueOnce('r1-1h')
      .mockResolvedValueOnce('r2-24h').mockResolvedValueOnce('r2-1h');

    const { result } = await mountHook();

    const drafts = [
      { ...VALID_DRAFT, title: 'Week 1', dueDate: '2026-05-20' },
      { ...VALID_DRAFT, title: 'Week 2', dueDate: '2026-05-27' },
    ];

    let saved;
    await act(async () => {
      saved = await result.current.insertMany(drafts);
    });

    expect(dbInsertMany).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(2);
    expect(saved[0].reminderIds).toEqual(['r1-24h', 'r1-1h']);
    expect(saved[1].reminderIds).toEqual(['r2-24h', 'r2-1h']);

    expect(result.current.assignments).toHaveLength(2);

    // Reminder map records all ids — new format stores { ids, sig }
    const map = JSON.parse(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`));
    expect(map[saved[0].id].ids).toEqual(['r1-24h', 'r1-1h']);
    expect(map[saved[1].id].ids).toEqual(['r2-24h', 'r2-1h']);
  });

  test('DB error: rejects, state unchanged, no reminder map entries', async () => {
    dbInsertMany.mockRejectedValue(new Error('batch failed'));

    const { result } = await mountHook();

    await act(async () => {
      await expect(result.current.insertMany([VALID_DRAFT, VALID_DRAFT])).rejects.toThrow('batch failed');
    });

    expect(result.current.assignments).toEqual([]);
    expect(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`)).toBeNull();
  });

  test('client-minted UUIDs are passed to dbInsertMany', async () => {
    dbInsertMany.mockImplementation(async drafts => drafts.map(d => ({ ...d })));
    const { result } = await mountHook();

    await act(async () => {
      await result.current.insertMany([
        { ...VALID_DRAFT, title: 'A' },
        { ...VALID_DRAFT, title: 'B' },
      ]);
    });

    const sentDrafts = dbInsertMany.mock.calls[0][0];
    expect(sentDrafts).toHaveLength(2);
    for (const d of sentDrafts) {
      expect(d.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    }
    expect(sentDrafts[0].id).not.toBe(sentDrafts[1].id);
  });
});

// ===========================================================================
// update
// ===========================================================================
describe('update', () => {
  // Helper: insert one row to set up state + reminder map, then return its id.
  async function seedOneAssignment(result, overrides = {}) {
    dbInsertEchoesBack();
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('old-24h')
      .mockResolvedValueOnce('old-1h');
    let inserted;
    await act(async () => {
      inserted = await result.current.insert({ ...VALID_DRAFT, ...overrides });
    });
    Notifications.scheduleNotificationAsync.mockReset();
    Notifications.scheduleNotificationAsync.mockResolvedValue('notif-id');
    Notifications.cancelScheduledNotificationAsync.mockClear();
    return inserted;
  }

  test('happy path: dbUpdate called with changes, old reminders cancelled, new ones scheduled', async () => {
    const { result } = await mountHook();
    const row = await seedOneAssignment(result);

    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('new-24h')
      .mockResolvedValueOnce('new-1h');
    // The server row echoes back a recurrenceRule the client's `changes`
    // payload never mentioned (pinning that committed state comes from the
    // FULL server row dbUpdate resolves to, not from the client's changes —
    // see the "self-echo signature pinning" note in the updateSeriesFrom
    // describe below for the fuller rationale).
    const RECURRENCE_RULE = { freq: 'weekly', interval: 1, byWeekday: [2], end: { count: 10 } };
    dbUpdate.mockImplementation(async (id, userId, changes) => ({
      ...row,
      ...changes,
      recurrenceRule: RECURRENCE_RULE,
    }));

    await act(async () => {
      await result.current.update(row.id, { title: 'Updated essay', importance: 5 });
    });

    expect(dbUpdate).toHaveBeenCalledWith(row.id, USER_ID, {
      title: 'Updated essay',
      importance: 5,
    });

    // Old reminders cancelled from on-disk ids
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-1h');

    // State reflects the new title & new reminder ids
    expect(result.current.assignments[0].title).toBe('Updated essay');
    expect(result.current.assignments[0].reminderIds).toEqual(['new-24h', 'new-1h']);
    // ...and carries the recurrenceRule from the full server row.
    expect(result.current.assignments[0].recurrenceRule).toEqual(RECURRENCE_RULE);

    // Map updated — new format stores { ids, sig }
    const map = JSON.parse(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`));
    expect(map[row.id].ids).toEqual(['new-24h', 'new-1h']);
  });

  test('reads OLD reminder ids from disk, not from in-memory state', async () => {
    // This is the property that prevents leaked notifications when an edit
    // modal opened before the fetch finished merging reminder ids in.
    const { result } = await mountHook();
    const row = await seedOneAssignment(result);

    // Tamper: overwrite disk with different ids than what state holds.
    // The hook should cancel the DISK ids, not the in-memory ones.
    await AsyncStorage.setItem(
      `reminder_ids_${USER_ID}`,
      JSON.stringify({ [row.id]: ['disk-only-1', 'disk-only-2'] }),
    );

    dbUpdate.mockImplementation(async () => ({ ...row, title: 'X' }));
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('new-24h')
      .mockResolvedValueOnce('new-1h');

    await act(async () => {
      await result.current.update(row.id, { title: 'X' });
    });

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('disk-only-1');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('disk-only-2');
    // And the in-memory `old-24h` / `old-1h` are NOT what we cancelled.
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('old-24h');
  });

  test('status=completed: cancels old reminders, schedules NO new ones, removes map entry', async () => {
    const { result } = await mountHook();
    const row = await seedOneAssignment(result);

    dbUpdate.mockImplementation(async (id, userId, changes) => ({
      ...row,
      ...changes,
    }));

    await act(async () => {
      await result.current.update(row.id, { status: 'completed' });
    });

    // Old cancelled
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-24h');
    // None scheduled — the mock should NOT be called
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    // State has empty reminderIds, map entry removed
    expect(result.current.assignments[0].reminderIds).toEqual([]);
    const map = JSON.parse(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`));
    expect(map[row.id]).toBeUndefined();
  });

  test('DB error: rejects; state and reminder map unchanged', async () => {
    const { result } = await mountHook();
    const row = await seedOneAssignment(result);

    const beforeState = JSON.stringify(result.current.assignments);
    const beforeMap = await AsyncStorage.getItem(`reminder_ids_${USER_ID}`);

    dbUpdate.mockRejectedValue(new Error('update failed'));

    await act(async () => {
      await expect(result.current.update(row.id, { title: 'Y' })).rejects.toThrow('update failed');
    });

    expect(JSON.stringify(result.current.assignments)).toBe(beforeState);
    expect(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`)).toBe(beforeMap);
    // No reminder cancellation either (we only cancel after dbUpdate succeeds)
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  test('self-echo: realtime UPDATE matching our signature is suppressed', async () => {
    const { result } = await mountHook();
    const row = await seedOneAssignment(result);

    const updatedRow = { ...row, title: 'After update', importance: 5 };
    dbUpdate.mockResolvedValue(updatedRow);

    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('new-24h')
      .mockResolvedValueOnce('new-1h');

    await act(async () => {
      await result.current.update(row.id, { title: 'After update', importance: 5 });
    });

    // Snapshot the state — echoed event should not change it.
    const reminderIdsBeforeEcho = result.current.assignments[0].reminderIds;
    const scheduleCallsBeforeEcho = Notifications.scheduleNotificationAsync.mock.calls.length;

    // Emit the realtime echo — matches the signature we stored.
    await emitRealtime({
      eventType: 'UPDATE',
      new: updatedRow,
      old: row,
    });

    // No re-reconcile: same reminderIds, no extra schedule calls.
    expect(result.current.assignments[0].reminderIds).toEqual(reminderIdsBeforeEcho);
    expect(Notifications.scheduleNotificationAsync.mock.calls.length).toBe(scheduleCallsBeforeEcho);
  });

  test('self-mutation TTL expiry: an UPDATE echo with the same signature is applied once the 8s marker TTL elapses', async () => {
    const { result } = await mountHook();
    const row = await seedOneAssignment(result);

    const updatedRow = { ...row, title: 'After update', importance: 5 };
    dbUpdate.mockResolvedValue(updatedRow);

    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('new-24h')
      .mockResolvedValueOnce('new-1h');

    await act(async () => {
      await result.current.update(row.id, { title: 'After update', importance: 5 });
    });

    // The marker was settled at NOW with expiresAt = NOW + 8000ms. Advance the
    // clock past the TTL so the marker is considered expired. isOwnEcho will
    // then delete it and treat the matching-signature echo as a genuine remote
    // event that must be reconciled (not suppressed).
    Date.now.mockReturnValue(NOW + 8001);

    Notifications.cancelScheduledNotificationAsync.mockClear();
    Notifications.scheduleNotificationAsync.mockReset();
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('echo-24h')
      .mockResolvedValueOnce('echo-1h');

    // Same-signature echo arrives AFTER the TTL — it is no longer ours.
    await emitRealtime({
      eventType: 'UPDATE',
      new: updatedRow,
      old: row,
    });

    // The echo went through: the upsert reconcile cancelled the old reminders
    // and scheduled fresh ones, leaving the new reminder ids on the row.
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();
    expect(result.current.assignments[0].reminderIds).toEqual(['echo-24h', 'echo-1h']);
    expect(result.current.assignments[0].title).toBe('After update');

    const map = JSON.parse(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`));
    expect(map[row.id].ids).toEqual(['echo-24h', 'echo-1h']);
  });
});

// ===========================================================================
// updateSeriesFrom ("edit this and all future occurrences" — F3b)
// ===========================================================================
describe('updateSeriesFrom', () => {
  const SERIES_ID = 'series-1';

  // Seed a 4-row series (Week 0..3) plus one standalone row belonging to a
  // DIFFERENT series, so tests can assert untouched rows stay untouched.
  // Week 0 (2026-05-25) sits BEFORE the tests' edited row (2026-06-01 or
  // 2026-06-15) — proves an earlier row in the SAME series is spared.
  async function seedSeriesWithEarlierRow(result) {
    dbInsertMany.mockImplementation(async drafts => drafts.map(d => ({ ...d })));
    Notifications.scheduleNotificationAsync.mockResolvedValue('seed-notif');

    const drafts = [
      { ...VALID_DRAFT, title: 'Week 0', dueDate: '2026-05-25', seriesId: SERIES_ID },
      { ...VALID_DRAFT, title: 'Week 1', dueDate: '2026-06-01', seriesId: SERIES_ID },
      { ...VALID_DRAFT, title: 'Week 2', dueDate: '2026-06-08', seriesId: SERIES_ID },
      { ...VALID_DRAFT, title: 'Week 3', dueDate: '2026-06-15', seriesId: SERIES_ID },
      { ...VALID_DRAFT, title: 'Other Series', dueDate: '2026-06-10', seriesId: 'series-2' },
    ];

    let saved;
    await act(async () => { saved = await result.current.insertMany(drafts); });

    Notifications.scheduleNotificationAsync.mockReset();
    Notifications.scheduleNotificationAsync.mockResolvedValue('notif-id');
    Notifications.cancelScheduledNotificationAsync.mockClear();

    return Object.fromEntries(saved.map(a => [a.title, a]));
  }

  test("happy path: only rows with the same seriesId AND dueDate >= the target's ORIGINAL dueDate are replaced", async () => {
    const { result } = await mountHook();
    const rows = await seedSeriesWithEarlierRow(result);
    const target = rows['Week 1']; // dueDate 2026-06-01 — the row being edited

    const changes = {
      title: 'Weekly Quiz (moved)', course: 'CS999', dueDate: '2026-06-03',
      importance: 5, complexity: 'short', dueTime: '10:00',
    };

    // Server returns the 3 affected rows (Week 1/2/3), each shifted by the
    // 2-day delta (2026-06-01 -> 2026-06-03) and carrying the new base fields.
    dbUpdateSeriesFrom.mockImplementation(async (seriesId, fromDate, dayDelta, base) => (
      [rows['Week 1'], rows['Week 2'], rows['Week 3']].map(r => ({
        ...r,
        title: base.title,
        course: base.course,
        importance: base.importance,
        complexity: base.complexity,
        dueTime: base.dueTime,
        dueDate: format(addDays(parseISO(r.dueDate), dayDelta), 'yyyy-MM-dd'),
      }))
    ));

    let count;
    await act(async () => {
      count = await result.current.updateSeriesFrom(target.id, changes);
    });

    expect(count).toBe(3);
    expect(dbUpdateSeriesFrom).toHaveBeenCalledWith(SERIES_ID, '2026-06-01', 2, changes);

    const byId = Object.fromEntries(result.current.assignments.map(a => [a.id, a]));

    // Affected rows updated + shifted.
    expect(byId[rows['Week 1'].id].title).toBe('Weekly Quiz (moved)');
    expect(byId[rows['Week 1'].id].dueDate).toBe('2026-06-03');
    expect(byId[rows['Week 2'].id].dueDate).toBe('2026-06-10');
    expect(byId[rows['Week 2'].id].course).toBe('CS999');
    expect(byId[rows['Week 3'].id].dueDate).toBe('2026-06-17');
    expect(byId[rows['Week 3'].id].complexity).toBe('short');

    // Earlier row in the SAME series, and a row in a DIFFERENT series, are untouched.
    expect(byId[rows['Week 0'].id]).toEqual(rows['Week 0']);
    expect(byId[rows['Other Series'].id]).toEqual(rows['Other Series']);
  });

  test('day-delta reaches dbUpdateSeriesFrom correctly (edited row 2026-06-15 -> changes.dueDate 2026-06-17 => delta 2)', async () => {
    const { result } = await mountHook();
    const rows = await seedSeriesWithEarlierRow(result);
    const target = rows['Week 3']; // dueDate 2026-06-15, last row in the series

    dbUpdateSeriesFrom.mockResolvedValue([{ ...target, dueDate: '2026-06-17' }]);

    await act(async () => {
      await result.current.updateSeriesFrom(target.id, { ...VALID_DRAFT, dueDate: '2026-06-17' });
    });

    const [seriesIdArg, fromDateArg, dayDeltaArg] = dbUpdateSeriesFrom.mock.calls[0];
    expect(seriesIdArg).toBe(SERIES_ID);
    expect(fromDateArg).toBe('2026-06-15');
    expect(dayDeltaArg).toBe(2);
  });

  test('schedules reminders and calendar events exactly once per row returned by dbUpdateSeriesFrom', async () => {
    const { result } = await mountHook();
    const rows = await seedSeriesWithEarlierRow(result);
    const target = rows['Week 1'];

    // Turn calendar sync on so calendarScheduleFor actually touches the
    // native calendar module instead of no-op'ing (it defaults to off).
    // enableCalendarSync backfills every CURRENT assignment first — clear
    // that noise before the assertion below.
    await act(async () => { await result.current.enableCalendarSync(); });
    Calendar.createEventAsync.mockClear();
    Calendar.updateEventAsync.mockClear();

    const updatedRows = [rows['Week 1'], rows['Week 2'], rows['Week 3']];
    dbUpdateSeriesFrom.mockResolvedValue(updatedRows);

    Notifications.scheduleNotificationAsync.mockClear();
    Notifications.scheduleNotificationAsync.mockResolvedValue('notif-id');

    await act(async () => {
      await result.current.updateSeriesFrom(target.id, { ...VALID_DRAFT, dueDate: '2026-06-03' });
    });

    // Reminders: 2 offsets (24h/1h before due) per row, scheduled sequentially.
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(updatedRows.length * 2);

    // Calendar: each row already has a backfilled event id (from
    // enableCalendarSync above), so scheduleFor takes the update branch —
    // one updateEventAsync call per returned row, no new creates.
    expect(Calendar.updateEventAsync).toHaveBeenCalledTimes(updatedRows.length);
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
  });

  test('DB error: rejects, state unchanged, nothing scheduled', async () => {
    const { result } = await mountHook();
    const rows = await seedSeriesWithEarlierRow(result);
    const target = rows['Week 1'];

    const beforeState = JSON.stringify(result.current.assignments);

    dbUpdateSeriesFrom.mockRejectedValue(new Error('series update failed'));
    Notifications.scheduleNotificationAsync.mockClear();

    await act(async () => {
      await expect(
        result.current.updateSeriesFrom(target.id, { ...VALID_DRAFT, dueDate: '2026-06-03' })
      ).rejects.toThrow('series update failed');
    });

    expect(JSON.stringify(result.current.assignments)).toBe(beforeState);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  test('rejects when the target row has no seriesId (not a series row)', async () => {
    const { result } = await mountHook();
    dbInsertEchoesBack();
    let inserted;
    await act(async () => { inserted = await result.current.insert(VALID_DRAFT); });

    await act(async () => {
      await expect(
        result.current.updateSeriesFrom(inserted.id, { ...VALID_DRAFT, dueDate: '2026-06-03' })
      ).rejects.toThrow('Not a series row');
    });

    expect(dbUpdateSeriesFrom).not.toHaveBeenCalled();
  });

  test('rejects when the id does not exist in state at all', async () => {
    const { result } = await mountHook();

    await act(async () => {
      await expect(
        result.current.updateSeriesFrom('nonexistent-id', { ...VALID_DRAFT, dueDate: '2026-06-03' })
      ).rejects.toThrow('Not a series row');
    });

    expect(dbUpdateSeriesFrom).not.toHaveBeenCalled();
  });

  // Review-mandated prerequisite: pin that committed state/signatures come
  // from the FULL server row dbUpdateSeriesFrom resolves to, not from the
  // client's `changes` payload — `changes` never carries a recurrenceRule
  // (see useAssignmentForm.js's chooseSeriesEditScope: onUpdateSeries is
  // called with `base`, which has no recurrenceRule key at all), yet the
  // committed rows must still carry whatever recurrenceRule the server sends
  // back. See also the single-row `update` happy-path test above, which pins
  // the identical property for the non-series update path.
  test('self-echo signature pinning: committed rows carry recurrenceRule from the FULL server row, not from `changes`', async () => {
    const { result } = await mountHook();
    const rows = await seedSeriesWithEarlierRow(result);
    const target = rows['Week 1'];

    const RULE = { freq: 'weekly', interval: 1, byWeekday: [1], end: { count: 12 } };
    const changes = { ...VALID_DRAFT, dueDate: '2026-06-03' }; // no recurrenceRule field at all

    dbUpdateSeriesFrom.mockResolvedValue([
      { ...rows['Week 1'], dueDate: '2026-06-03', recurrenceRule: RULE },
      { ...rows['Week 2'], dueDate: '2026-06-10', recurrenceRule: RULE },
      { ...rows['Week 3'], dueDate: '2026-06-17', recurrenceRule: RULE },
    ]);

    await act(async () => {
      await result.current.updateSeriesFrom(target.id, changes);
    });

    const byId = Object.fromEntries(result.current.assignments.map(a => [a.id, a]));
    expect(byId[rows['Week 1'].id].recurrenceRule).toEqual(RULE);
    expect(byId[rows['Week 2'].id].recurrenceRule).toEqual(RULE);
    expect(byId[rows['Week 3'].id].recurrenceRule).toEqual(RULE);
  });
});

// ===========================================================================
// remove
// ===========================================================================
describe('remove', () => {
  async function seedOneAssignment(result) {
    dbInsertEchoesBack();
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('rem-24h')
      .mockResolvedValueOnce('rem-1h');
    let inserted;
    await act(async () => {
      inserted = await result.current.insert(VALID_DRAFT);
    });
    Notifications.cancelScheduledNotificationAsync.mockClear();
    return inserted;
  }

  test('happy path: dbDelete called, reminders cancelled, state filtered, map cleaned', async () => {
    dbDelete.mockResolvedValue(undefined);
    const { result } = await mountHook();
    const row = await seedOneAssignment(result);

    await act(async () => {
      await result.current.remove(row.id);
    });

    expect(dbDelete).toHaveBeenCalledWith(row.id, USER_ID);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rem-1h');

    expect(result.current.assignments).toEqual([]);

    const map = JSON.parse(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`));
    expect(map[row.id]).toBeUndefined();
  });

  test('DB error: rejects, state and reminders unchanged', async () => {
    dbDelete.mockRejectedValue(new Error('delete failed'));
    const { result } = await mountHook();
    const row = await seedOneAssignment(result);

    await act(async () => {
      await expect(result.current.remove(row.id)).rejects.toThrow('delete failed');
    });

    expect(result.current.assignments).toHaveLength(1);
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  test('tombstone: a subsequent realtime UPDATE for the same id is dropped (no resurrection)', async () => {
    dbDelete.mockResolvedValue(undefined);
    const { result } = await mountHook();
    const row = await seedOneAssignment(result);

    await act(async () => {
      await result.current.remove(row.id);
    });
    expect(result.current.assignments).toEqual([]);

    // Now another device emits an UPDATE that committed BEFORE our delete
    // (server applied UPDATE then DELETE). Without the tombstone, our
    // realtime handler would resurrect this row.
    await emitRealtime({
      eventType: 'UPDATE',
      new: { ...row, title: 'Stale remote update' },
      old: row,
    });

    expect(result.current.assignments).toEqual([]);
  });

  test('tombstone: DELETE event from another device for the same id still removes (no-op idempotent)', async () => {
    dbDelete.mockResolvedValue(undefined);
    const { result } = await mountHook();
    const row = await seedOneAssignment(result);

    await act(async () => {
      await result.current.remove(row.id);
    });

    // A duplicate DELETE event for the same row arriving after the tombstone
    // is set must still be allowed through (it's a no-op on state).
    await emitRealtime({
      eventType: 'DELETE',
      old: row,
    });

    // State is still empty; no crash.
    expect(result.current.assignments).toEqual([]);
  });
});

// ===========================================================================
// removeSeries
// ===========================================================================
describe('removeSeries', () => {
  async function seedSeries(result) {
    dbInsertMany.mockImplementation(async drafts => drafts.map(d => ({ ...d })));
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('s1-24h').mockResolvedValueOnce('s1-1h')
      .mockResolvedValueOnce('s2-24h').mockResolvedValueOnce('s2-1h');

    const seriesId = 'series-1';
    const drafts = [
      { ...VALID_DRAFT, title: 'Week 1', dueDate: '2026-05-20', seriesId },
      { ...VALID_DRAFT, title: 'Week 2', dueDate: '2026-05-27', seriesId },
    ];

    let saved;
    await act(async () => {
      saved = await result.current.insertMany(drafts);
    });

    Notifications.cancelScheduledNotificationAsync.mockClear();
    return { seriesId, saved };
  }

  test('happy path: dbDeleteSeries called, both rows removed, reminders cancelled, map cleared', async () => {
    dbDeleteSeries.mockResolvedValue(undefined);
    const { result } = await mountHook();
    const { seriesId, saved } = await seedSeries(result);

    expect(result.current.assignments).toHaveLength(2);

    await act(async () => {
      await result.current.removeSeries(seriesId);
    });

    expect(dbDeleteSeries).toHaveBeenCalledWith(seriesId, USER_ID);

    expect(result.current.assignments).toEqual([]);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('s1-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('s1-1h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('s2-24h');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('s2-1h');

    const map = JSON.parse(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`));
    expect(map[saved[0].id]).toBeUndefined();
    expect(map[saved[1].id]).toBeUndefined();
  });

  test('DB error: rejects, state and reminder map unchanged', async () => {
    dbDeleteSeries.mockRejectedValue(new Error('series delete failed'));
    const { result } = await mountHook();
    const { seriesId, saved } = await seedSeries(result);

    await act(async () => {
      await expect(result.current.removeSeries(seriesId)).rejects.toThrow('series delete failed');
    });

    expect(result.current.assignments).toHaveLength(2);
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();

    const map = JSON.parse(await AsyncStorage.getItem(`reminder_ids_${USER_ID}`));
    expect(map[saved[0].id].ids).toEqual(['s1-24h', 's1-1h']);
    expect(map[saved[1].id].ids).toEqual(['s2-24h', 's2-1h']);
  });

  test('tombstone: a realtime UPDATE for one of the deleted ids is dropped after removeSeries', async () => {
    dbDeleteSeries.mockResolvedValue(undefined);
    const { result } = await mountHook();
    const { seriesId, saved } = await seedSeries(result);

    await act(async () => {
      await result.current.removeSeries(seriesId);
    });
    expect(result.current.assignments).toEqual([]);

    const row = saved[0];
    await emitRealtime({
      eventType: 'UPDATE',
      new: { ...row, title: 'Stale' },
      old: row,
    });

    expect(result.current.assignments).toEqual([]);
  });

  test('no-op when no assignments match the seriesId', async () => {
    const { result } = await mountHook();

    let returned;
    await act(async () => {
      returned = await result.current.removeSeries('nonexistent-series');
    });

    expect(returned).toBeUndefined();
    expect(dbDeleteSeries).not.toHaveBeenCalled();
    expect(result.current.assignments).toEqual([]);
  });
});

// ===========================================================================
// Realtime subscription status / error handling
// ===========================================================================
describe('realtime subscription status', () => {
  test('CHANNEL_ERROR status surfaces a syncError and does not throw', async () => {
    const { result } = await mountHook();

    expect(typeof subscribeStatusCallback).toBe('function');
    expect(result.current.syncError).toBe('');

    await act(async () => {
      subscribeStatusCallback('CHANNEL_ERROR', undefined);
      await flushMicrotasks();
    });

    expect(result.current.syncError).toMatch(/sync/i);
  });

  test('a non-null err from subscribe surfaces a syncError', async () => {
    const { result } = await mountHook();

    await act(async () => {
      subscribeStatusCallback('TIMED_OUT', new Error('boom'));
      await flushMicrotasks();
    });

    expect(result.current.syncError).not.toBe('');
  });

  test('SUBSCRIBED status leaves syncError untouched', async () => {
    const { result } = await mountHook();

    await act(async () => {
      subscribeStatusCallback('SUBSCRIBED', undefined);
      await flushMicrotasks();
    });

    expect(result.current.syncError).toBe('');
  });
});

// ===========================================================================
// Per-id queue serialization
// ===========================================================================
describe('per-id queue serialization', () => {
  // Helper mirrors the update describe block's seed.
  async function seedOneAssignment(result, overrides = {}) {
    dbInsertEchoesBack();
    Notifications.scheduleNotificationAsync
      .mockResolvedValueOnce('old-24h')
      .mockResolvedValueOnce('old-1h');
    let inserted;
    await act(async () => {
      inserted = await result.current.insert({ ...VALID_DRAFT, ...overrides });
    });
    Notifications.scheduleNotificationAsync.mockReset();
    Notifications.scheduleNotificationAsync.mockResolvedValue('notif-id');
    Notifications.cancelScheduledNotificationAsync.mockClear();
    return inserted;
  }

  test('two un-awaited update() calls on the same id serialize their ENTIRE async workflow', async () => {
    const { result } = await mountHook();
    const row = await seedOneAssignment(result);

    // Shared event log proving ordering. We assert that the SECOND dbUpdate
    // does not start until the FIRST call's full enqueued chain (reminder
    // scheduling + map save + commit) has finished — not merely until the
    // first dbUpdate promise resolved.
    const events = [];

    // Gate the first dbUpdate so its promise stays pending until we release it.
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });

    dbUpdate.mockImplementation(async (id, _userId, changes) => {
      if (changes.title === 'A') {
        events.push('dbUpdate-A-start');
        await firstGate;
        events.push('dbUpdate-A-resolve');
        return { ...row, ...changes };
      }
      events.push('dbUpdate-B-start');
      return { ...row, ...changes };
    });

    // saveReminderMap (called near the END of each update's chain) writes the
    // reminder-map key to AsyncStorage. Tagging that write lets us prove call
    // A's WHOLE workflow finished before B started — not merely that A's
    // dbUpdate promise resolved. We delegate to the original mock impl (the
    // in-memory store) so the real write still happens; capturing it via
    // getMockImplementation avoids re-entering the spy (no recursion).
    const mapKey = `reminder_ids_${USER_ID}`;
    const origSetItem = AsyncStorage.setItem.getMockImplementation();
    const spy = vi.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, val) => {
      if (key === mapKey) {
        const m = JSON.parse(val);
        if (m[row.id]?.sig) events.push('mapSave');
      }
      return origSetItem(key, val);
    });

    await act(async () => {
      // Fire BOTH without awaiting between them.
      const pA = result.current.update(row.id, { title: 'A' });
      const pB = result.current.update(row.id, { title: 'B' });

      // Let the queue advance: A should have started, B must be blocked
      // behind the queue (its dbUpdate not yet called).
      await flushMicrotasks();
      expect(events).toContain('dbUpdate-A-start');
      expect(events).not.toContain('dbUpdate-B-start');

      // Release A; now its full chain runs, THEN B begins.
      releaseFirst();
      await Promise.all([pA, pB]);
    });

    spy.mockRestore();

    // The serialized order: A starts, A's whole chain (incl. map save) finishes,
    // and only THEN does B's dbUpdate start.
    const aStart = events.indexOf('dbUpdate-A-start');
    const aMapSave = events.indexOf('mapSave');
    const bStart = events.indexOf('dbUpdate-B-start');

    expect(aStart).toBeGreaterThanOrEqual(0);
    expect(aMapSave).toBeGreaterThan(aStart);
    expect(bStart).toBeGreaterThan(aMapSave);

    // Final state reflects the LAST write (B) — proving both ran in order.
    expect(result.current.assignments[0].title).toBe('B');
    expect(dbUpdate).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// Cleanup (unmount)
// ===========================================================================
describe('unmount', () => {
  test('unmounting unsubscribes the realtime channel and removes AppState listener', async () => {
    const { unmount } = renderHook(() => useAssignments(USER_ID));
    await flushMicrotasks();

    // Grab the channel that was subscribed during mount.
    const channel = supabase.channel.mock.results[0].value;

    unmount();
    await act(async () => { await Promise.resolve(); });

    // The realtime cleanup `return () => { cancelled=true; supabase.removeChannel(channel) }`
    // should have fired.
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });
});

// ===========================================================================
// Sync-error API surface (reportSyncError / clearSyncError)
// ===========================================================================
describe('sync error API', () => {
  test('reportSyncError sets the banner text and clearSyncError clears it', async () => {
    const { result } = await mountHook();
    expect(result.current.syncError).toBe('');

    act(() => { result.current.reportSyncError('Could not save.'); });
    expect(result.current.syncError).toBe('Could not save.');

    act(() => { result.current.clearSyncError(); });
    expect(result.current.syncError).toBe('');
  });
});

// ===========================================================================
// Calendar-sync wrappers (enableCalendarSync / disableCalendarSync)
//
// These thin wrappers in useAssignments close over the current assignments and
// delegate to the calendar orchestration. Verify they flip the persisted
// enable flag + exposed syncEnabled in both directions.
// ===========================================================================
describe('calendar sync wrappers', () => {
  const enabledKey = `calendar_sync_enabled_${USER_ID}`;

  test('enableCalendarSync forwards current assignments to the backfill; disableCalendarSync turns it off', async () => {
    dbInsertEchoesBack();
    Calendar.createEventAsync.mockClear();
    const { result } = await mountHook();

    // Put a real assignment in state so enabling has something to back-fill —
    // this is the whole reason the wrapper closes over `assignments`.
    await act(async () => { await result.current.insert(VALID_DRAFT); });
    expect(result.current.calendarSyncEnabled).toBe(false);

    await act(async () => { await result.current.enableCalendarSync(); });
    expect(result.current.calendarSyncEnabled).toBe(true);
    expect(await AsyncStorage.getItem(enabledKey)).toBe('true');
    // The wrapper forwarded the current assignment list: backfill created an
    // event for it. (Fails if enableCalendarSync dropped its assignments arg.)
    expect(Calendar.createEventAsync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: VALID_DRAFT.title }),
    );

    // deleteEvents=false → no calendar removal, just clear the event map + flag.
    await act(async () => { await result.current.disableCalendarSync(false); });
    expect(result.current.calendarSyncEnabled).toBe(false);
    expect(await AsyncStorage.getItem(enabledKey)).toBe('false');
  });
});

// ===========================================================================
// Tombstone expiry
//
// The active-tombstone case (a realtime UPDATE dropped right after a delete)
// is covered in the `remove` describe above. This covers the OTHER side: once
// the tombstone's TTL has elapsed, isTombstoned prunes the stale entry and a
// later UPDATE for that id is applied normally rather than being dropped.
// ===========================================================================
describe('tombstone expiry', () => {
  test('a realtime UPDATE after the tombstone TTL is applied, not dropped', async () => {
    dbInsertEchoesBack();
    dbDelete.mockResolvedValue(undefined);
    const { result } = await mountHook();

    let created;
    await act(async () => { created = await result.current.insert(VALID_DRAFT); });
    const { id } = created;

    await act(async () => { await result.current.remove(id); });
    expect(result.current.assignments).toHaveLength(0);

    // Advance the clock past both the self-mutation TTL (8s) and the tombstone
    // TTL (30s) so neither suppression path applies to the incoming echo.
    Date.now.mockReturnValue(NOW + 31_000);

    await emitRealtime({
      eventType: 'UPDATE',
      new: { ...VALID_DRAFT, id, title: 'Back from the dead' },
    });

    // Tombstone expired → isTombstoned pruned it and returned false → the
    // upsert reconciles the row back into state.
    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.assignments[0].title).toBe('Back from the dead');
  });
});

// ===========================================================================
// Realtime teardown — isCancelled guards
//
// A realtime event can land after the user logs out / the hook unmounts (the
// captured channel callback outlives the effect). The reconcile handlers must
// bail on their isCancelled() checks rather than scheduling reminders or
// writing to a torn-down user's state.
// ===========================================================================
describe('realtime teardown', () => {
  test('an INSERT that arrives after unmount schedules nothing', async () => {
    const { unmount } = await mountHook();
    unmount(); // realtime cleanup flips cancelled → true

    Notifications.scheduleNotificationAsync.mockClear();
    await emitRealtime({
      eventType: 'INSERT',
      new: { ...VALID_DRAFT, id: 'post-teardown', title: 'Too late' },
    });

    // No reminders are scheduled for a torn-down user. This is defense in
    // depth: enqueueUpsert's entry isCancelled() guard AND scheduleFor's own
    // teardown check both enforce it; the mid-flight test below isolates the
    // post-scheduleFor guard specifically.
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  test('a DELETE that arrives after unmount does not cancel existing reminders', async () => {
    const { unmount } = await mountHook();
    // Seed a reminder-map entry for the id so cancelFor WOULD cancel a real
    // notification if onDelete ran — that way the assertion actually gates the
    // isCancelled() guard instead of passing because there was nothing to cancel.
    await AsyncStorage.setItem(
      `reminder_ids_${USER_ID}`,
      JSON.stringify({ 'post-teardown': ['seeded-notif'] }),
    );
    unmount();

    Notifications.cancelScheduledNotificationAsync.mockClear();
    await emitRealtime({ eventType: 'DELETE', old: { id: 'post-teardown' } });

    // onDelete's first isCancelled() short-circuits before cancelFor runs, so
    // the seeded reminder is left untouched. (Fails if the guard is removed.)
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('seeded-notif');
  });

  test('an INSERT whose scheduling finishes after teardown is not committed to the cache', async () => {
    const { unmount } = await mountHook();

    // Gate the iOS slot-budget read so scheduleFor blocks mid-flight.
    let releasePending;
    Notifications.getAllScheduledNotificationsAsync.mockReturnValue(
      new Promise(r => { releasePending = r; }),
    );

    // Bare call (no act): this only enqueues async work that immediately blocks
    // on the gated read — no React state update happens yet.
    realtimeCallback({
      eventType: 'INSERT',
      new: { ...VALID_DRAFT, id: 'midflight', title: 'Racing teardown' },
    });
    await act(async () => { await flushMicrotasks(); }); // park at the gated await

    // Tear down while scheduling is in flight, then let scheduling finish.
    unmount();
    await act(async () => {
      releasePending([]);
      await flushMicrotasks();
    });

    // The post-scheduleFor isCancelled() guard bails before commitLocal, so the
    // torn-down user's cached list never gains the row.
    const raw = await AsyncStorage.getItem(`assignments_${USER_ID}`);
    const cached = raw ? JSON.parse(raw) : [];
    expect(cached.find(a => a.id === 'midflight')).toBeUndefined();
  });
});
