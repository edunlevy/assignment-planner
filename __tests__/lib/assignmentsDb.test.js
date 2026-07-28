import {
  dbDelete,
  dbDeleteSeries,
  dbFetch,
  dbInsert,
  dbInsertMany,
  dbUpdate,
  dbUpdateSeriesFrom,
  fromDb,
} from '../../lib/assignmentsDb';
import { supabase } from '../../lib/supabase';

// Build a one-off chainable mock that resolves to { data, error } when
// awaited at the right terminal. We rebuild per test to keep call counts clean.
function chainResolving({ data = null, error = null, single = false } = {}) {
  const settled = Promise.resolve({ data, error });
  const c = {};
  c.select = jest.fn(() => c);
  c.insert = jest.fn(() => c);
  c.update = jest.fn(() => c);
  c.delete = jest.fn(() => c);
  c.eq = jest.fn(() => c);
  c.order = jest.fn(() => c);
  c.single = jest.fn(() => settled);
  // Allow `await c` for non-single terminals like order() / delete().eq().eq().
  c.then = (resolve, reject) => settled.then(resolve, reject);
  return c;
}

beforeEach(() => {
  supabase.from.mockReset();
});

describe('fromDb', () => {
  test('maps DB columns to app fields and preserves id', () => {
    const row = {
      id: 'row-1',
      title: 'Essay',
      class_name: 'ENGL 200',
      due_date: '2026-09-01',
      importance: 4,
      status: 'in_progress',
      series_id: 'series-9',
    };
    expect(fromDb(row)).toEqual({
      id: 'row-1',
      title: 'Essay',
      course: 'ENGL 200',
      dueDate: '2026-09-01',
      importance: 4,
      status: 'in_progress',
      seriesId: 'series-9',
    });
  });

  test('omits nullable seriesId when DB has null', () => {
    const out = fromDb({
      id: 'r',
      title: 't',
      class_name: 'c',
      due_date: '2026-01-01',
      importance: 3,
      status: 'not_started',
      series_id: null,
    });
    expect(out.seriesId).toBeUndefined();
  });
});

describe('fromDb / toDb — dueTime field', () => {
  test('fromDb extracts dueTime when due_time is set', () => {
    const out = fromDb({
      id: 'r1', title: 't', class_name: 'c', due_date: '2026-01-01',
      importance: 3, status: 'not_started', series_id: null,
      due_time: '14:30',
    });
    expect(out.dueTime).toBe('14:30');
  });

  test('fromDb omits dueTime when due_time is null', () => {
    const out = fromDb({
      id: 'r1', title: 't', class_name: 'c', due_date: '2026-01-01',
      importance: 3, status: 'not_started', series_id: null,
      due_time: null,
    });
    expect(out.dueTime).toBeUndefined();
  });

  test('dbInsert sends due_time: null when dueTime is omitted', async () => {
    const c = chainResolving({
      data: {
        id: 'new-id', title: 't', class_name: 'c', due_date: '2026-02-02',
        importance: 3, status: 'not_started', complexity: 'medium',
        series_id: null, due_time: null,
      },
      single: true,
    });
    supabase.from.mockReturnValueOnce(c);

    await dbInsert(
      { title: 't', course: 'c', dueDate: '2026-02-02', importance: 3, status: 'not_started', complexity: 'medium' },
      'user-1'
    );

    expect(c.insert).toHaveBeenCalledWith(
      expect.objectContaining({ due_time: null })
    );
  });

  test('dbInsert passes through a set dueTime', async () => {
    const c = chainResolving({
      data: {
        id: 'new-id', title: 't', class_name: 'c', due_date: '2026-02-02',
        importance: 3, status: 'not_started', complexity: 'medium',
        series_id: null, due_time: '09:00',
      },
      single: true,
    });
    supabase.from.mockReturnValueOnce(c);

    const result = await dbInsert(
      { title: 't', course: 'c', dueDate: '2026-02-02', importance: 3, status: 'not_started', complexity: 'medium', dueTime: '09:00' },
      'user-1'
    );

    expect(c.insert).toHaveBeenCalledWith(
      expect.objectContaining({ due_time: '09:00' })
    );
    expect(result.dueTime).toBe('09:00');
  });

  test('dbUpdate maps dueTime to due_time', async () => {
    const c = chainResolving({
      data: {
        id: 'r1', title: 't', class_name: 'c', due_date: '2026-04-04',
        importance: 3, status: 'not_started', series_id: null, due_time: '23:59',
      },
      single: true,
    });
    supabase.from.mockReturnValueOnce(c);

    await dbUpdate('r1', 'user-1', { dueTime: '23:59' });

    expect(c.update).toHaveBeenCalledWith({ due_time: '23:59' });
  });
});

describe('fromDb / toDb / dbUpdate — recurrenceRule field', () => {
  const RULE = { freq: 'weekly', interval: 2, byWeekday: [1, 3], end: { count: 10 } };

  test('fromDb extracts recurrenceRule when recurrence_rule is set', () => {
    const out = fromDb({
      id: 'r1', title: 't', class_name: 'c', due_date: '2026-01-01',
      importance: 3, status: 'not_started', series_id: 's1',
      recurrence_rule: RULE,
    });
    expect(out.recurrenceRule).toEqual(RULE);
  });

  test('fromDb omits recurrenceRule when recurrence_rule is null', () => {
    const out = fromDb({
      id: 'r1', title: 't', class_name: 'c', due_date: '2026-01-01',
      importance: 3, status: 'not_started', series_id: null,
      recurrence_rule: null,
    });
    expect(out.recurrenceRule).toBeUndefined();
  });

  test('dbInsert maps recurrenceRule to recurrence_rule, and to null when absent', async () => {
    const c = chainResolving({
      data: {
        id: 'r1', title: 't', class_name: 'c', due_date: '2026-01-01',
        importance: 3, status: 'not_started', series_id: 's1',
        recurrence_rule: RULE,
      },
      single: true,
    });
    supabase.from.mockReturnValueOnce(c);
    await dbInsert({
      title: 't', course: 'c', dueDate: '2026-01-01',
      importance: 3, status: 'not_started', seriesId: 's1', recurrenceRule: RULE,
    }, 'user-1');
    expect(c.insert).toHaveBeenCalledWith(expect.objectContaining({ recurrence_rule: RULE }));

    const c2 = chainResolving({
      data: {
        id: 'r2', title: 't', class_name: 'c', due_date: '2026-01-01',
        importance: 3, status: 'not_started', series_id: null,
      },
      single: true,
    });
    supabase.from.mockReturnValueOnce(c2);
    await dbInsert({
      title: 't', course: 'c', dueDate: '2026-01-01',
      importance: 3, status: 'not_started',
    }, 'user-1');
    expect(c2.insert).toHaveBeenCalledWith(expect.objectContaining({ recurrence_rule: null }));
  });

  test("dbUpdate WITHOUT recurrenceRule sends no recurrence_rule key — an occurrence edit must never null out its series' stored rule", async () => {
    // Load-bearing invariant: changesToDb deliberately skips undefined and
    // ignores the nullable flag (unlike toDb). "Harmonizing" it with toDb's
    // nullable-to-null branch would silently wipe recurrence_rule off every
    // series row on the first single-occurrence edit, with green CI — this
    // exact-payload assertion is what turns that mistake into a red test.
    const c = chainResolving({
      data: {
        id: 'r1', title: 'new', class_name: 'c', due_date: '2026-01-01',
        importance: 3, status: 'not_started', series_id: 's1',
        recurrence_rule: RULE,
      },
      single: true,
    });
    supabase.from.mockReturnValueOnce(c);
    await dbUpdate('r1', 'user-1', { title: 'new' });
    expect(c.update).toHaveBeenCalledWith({ title: 'new' });
  });

  test('dbUpdate WITH recurrenceRule maps it through (F3b rule editing)', async () => {
    const c = chainResolving({
      data: {
        id: 'r1', title: 't', class_name: 'c', due_date: '2026-01-01',
        importance: 3, status: 'not_started', series_id: 's1',
        recurrence_rule: RULE,
      },
      single: true,
    });
    supabase.from.mockReturnValueOnce(c);
    await dbUpdate('r1', 'user-1', { recurrenceRule: RULE });
    expect(c.update).toHaveBeenCalledWith({ recurrence_rule: RULE });
  });
});

describe('dbFetch', () => {
  test('queries assignments for the user and maps rows', async () => {
    const rows = [
      {
        id: 'r1',
        title: 't1',
        class_name: 'c1',
        due_date: '2026-01-01',
        importance: 3,
        status: 'not_started',
        series_id: null,
      },
    ];
    const c = chainResolving({ data: rows });
    supabase.from.mockReturnValueOnce(c);

    const result = await dbFetch('user-1');

    expect(supabase.from).toHaveBeenCalledWith('assignments');
    expect(c.select).toHaveBeenCalledWith('*');
    expect(c.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(c.order).toHaveBeenCalledWith('due_date', { ascending: true });
    expect(result).toEqual([
      {
        id: 'r1',
        title: 't1',
        course: 'c1',
        dueDate: '2026-01-01',
        importance: 3,
        status: 'not_started',
      },
    ]);
  });

  test('throws when Supabase returns an error', async () => {
    supabase.from.mockReturnValueOnce(
      chainResolving({ error: { message: 'boom' } })
    );
    await expect(dbFetch('user-1')).rejects.toEqual({ message: 'boom' });
  });
});

describe('fromDb — complexity field', () => {
  test('maps complexity from the DB row', () => {
    const row = {
      id: 'r1', title: 't', class_name: 'c', due_date: '2026-01-01',
      importance: 3, status: 'not_started', series_id: null,
      complexity: 'long',
    };
    expect(fromDb(row).complexity).toBe('long');
  });
});

describe('dbInsert', () => {
  test('passes mapped row + user_id and returns mapped row', async () => {
    const c = chainResolving({
      data: {
        id: 'new-id',
        title: 't',
        class_name: 'c',
        due_date: '2026-02-02',
        importance: 3,
        status: 'not_started',
        complexity: 'medium',
        series_id: null,
      },
      single: true,
    });
    supabase.from.mockReturnValueOnce(c);

    const result = await dbInsert(
      { title: 't', course: 'c', dueDate: '2026-02-02', importance: 3, status: 'not_started', complexity: 'medium' },
      'user-1'
    );

    expect(c.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        title: 't',
        class_name: 'c',
        due_date: '2026-02-02',
        importance: 3,
        status: 'not_started',
        complexity: 'medium',
        series_id: null,
      })
    );
    expect(result.id).toBe('new-id');
    expect(result.course).toBe('c');
    expect(result.complexity).toBe('medium');
  });

  test('passes through a client-supplied id in the insert payload', async () => {
    // Covers the `if (a.id !== undefined) out.id = a.id` branch in toDb.
    const c = chainResolving({
      data: {
        id: 'client-uuid',
        title: 't', class_name: 'c', due_date: '2026-02-02',
        importance: 3, status: 'not_started', complexity: 'short', series_id: null,
      },
      single: true,
    });
    supabase.from.mockReturnValueOnce(c);

    await dbInsert(
      { id: 'client-uuid', title: 't', course: 'c', dueDate: '2026-02-02',
        importance: 3, status: 'not_started', complexity: 'short' },
      'user-1'
    );

    expect(c.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'client-uuid', user_id: 'user-1' })
    );
  });

  test('throws when Supabase returns an error', async () => {
    supabase.from.mockReturnValueOnce(
      chainResolving({ error: { message: 'insert failed' }, single: true })
    );
    await expect(
      dbInsert({ title: 't', course: 'c', dueDate: '2026-02-02', importance: 3, status: 'not_started' }, 'user-1')
    ).rejects.toEqual({ message: 'insert failed' });
  });
});

describe('dbInsertMany', () => {
  test('maps each draft and returns mapped rows', async () => {
    const c = chainResolving({
      data: [
        {
          id: 'r1',
          title: 't1',
          class_name: 'c',
          due_date: '2026-03-01',
          importance: 3,
          status: 'not_started',
          series_id: 'S',
        },
        {
          id: 'r2',
          title: 't2',
          class_name: 'c',
          due_date: '2026-03-08',
          importance: 3,
          status: 'not_started',
          series_id: 'S',
        },
      ],
    });
    supabase.from.mockReturnValueOnce(c);

    const drafts = [
      { title: 't1', course: 'c', dueDate: '2026-03-01', seriesId: 'S' },
      { title: 't2', course: 'c', dueDate: '2026-03-08', seriesId: 'S' },
    ];
    const result = await dbInsertMany(drafts, 'user-1');

    expect(c.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ user_id: 'user-1', series_id: 'S' }),
      ])
    );
    expect(result.map(r => r.id)).toEqual(['r1', 'r2']);
  });

  test('throws when Supabase returns an error', async () => {
    supabase.from.mockReturnValueOnce(
      chainResolving({ error: { message: 'batch insert failed' } })
    );
    await expect(
      dbInsertMany([{ title: 't', course: 'c', dueDate: '2026-03-01' }], 'user-1')
    ).rejects.toEqual({ message: 'batch insert failed' });
  });
});

describe('dbUpdate', () => {
  test('only sends the changed fields and scopes by id + user_id', async () => {
    const c = chainResolving({
      data: {
        id: 'r1',
        title: 't1',
        class_name: 'c',
        due_date: '2026-04-04',
        importance: 5,
        status: 'completed',
        series_id: null,
      },
      single: true,
    });
    supabase.from.mockReturnValueOnce(c);

    const result = await dbUpdate('r1', 'user-1', {
      status: 'completed',
      importance: 5,
    });

    expect(c.update).toHaveBeenCalledWith({
      status: 'completed',
      importance: 5,
    });
    // Two .eq calls: ('id', 'r1') and ('user_id', 'user-1').
    expect(c.eq).toHaveBeenCalledWith('id', 'r1');
    expect(c.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(result.status).toBe('completed');
  });

  test('throws when Supabase returns an error', async () => {
    supabase.from.mockReturnValueOnce(
      chainResolving({ error: { message: 'nope' }, single: true })
    );
    await expect(dbUpdate('r1', 'u', { title: 'x' })).rejects.toEqual({
      message: 'nope',
    });
  });
});

describe('dbDelete', () => {
  test('scopes delete by id and user_id', async () => {
    const c = chainResolving({ data: null });
    supabase.from.mockReturnValueOnce(c);

    await dbDelete('r1', 'user-1');

    expect(c.delete).toHaveBeenCalled();
    expect(c.eq).toHaveBeenCalledWith('id', 'r1');
    expect(c.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  test('throws when Supabase returns an error', async () => {
    supabase.from.mockReturnValueOnce(
      chainResolving({ error: { message: 'fail' } })
    );
    await expect(dbDelete('r1', 'u')).rejects.toEqual({ message: 'fail' });
  });
});

describe('dbDeleteSeries', () => {
  test('scopes delete by series_id and user_id', async () => {
    const c = chainResolving({ data: null });
    supabase.from.mockReturnValueOnce(c);

    await dbDeleteSeries('series-1', 'user-1');

    expect(c.delete).toHaveBeenCalled();
    expect(c.eq).toHaveBeenCalledWith('series_id', 'series-1');
    expect(c.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  test('throws when Supabase returns an error', async () => {
    supabase.from.mockReturnValueOnce(
      chainResolving({ error: { message: 'fail' } })
    );
    await expect(dbDeleteSeries('series-1', 'u')).rejects.toEqual({ message: 'fail' });
  });
});

// F3b — "edit this and all future occurrences". One atomic RPC call over the
// tail of a series (see db/migrations/2026-07-28_update_series_from.sql).
// supabase.rpc is mocked wholesale in jest.setup.js (`jest.fn(async () => ({
// data: null, error: null }))`), matching the pattern ProfileModal.test.js
// uses for the delete_user RPC — override per test with mockResolvedValueOnce.
describe('dbUpdateSeriesFrom', () => {
  beforeEach(() => {
    supabase.rpc.mockReset();
  });

  const BASE = {
    title: 'Weekly Quiz',
    course: 'CS101',
    importance: 4,
    complexity: 'long',
    dueTime: '09:00',
    status: 'in_progress',
  };

  test('calls update_series_from with the exact mapped payload (course -> p_class_name)', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    await dbUpdateSeriesFrom('series-1', '2026-06-15', 2, 'target-1', BASE);

    expect(supabase.rpc).toHaveBeenCalledWith('update_series_from', {
      p_series_id: 'series-1',
      p_from_date: '2026-06-15',
      p_day_delta: 2,
      p_title: 'Weekly Quiz',
      p_class_name: 'CS101',
      p_importance: 4,
      p_complexity: 'long',
      p_due_time: '09:00',
      p_target_id: 'target-1',
      p_status: 'in_progress',
    });
  });

  test('null-coalesces a missing/undefined dueTime to p_due_time: null', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    await dbUpdateSeriesFrom('series-1', '2026-06-15', 0, 'target-1', { ...BASE, dueTime: undefined });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'update_series_from',
      expect.objectContaining({ p_due_time: null })
    );
  });

  test('a null dueTime on base also maps to p_due_time: null', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    await dbUpdateSeriesFrom('series-1', '2026-06-15', 0, 'target-1', { ...BASE, dueTime: null });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'update_series_from',
      expect.objectContaining({ p_due_time: null })
    );
  });

  test('maps returned rows through fromDb', async () => {
    const rows = [
      {
        id: 'r1', title: 'Weekly Quiz', class_name: 'CS101', due_date: '2026-06-17',
        importance: 4, status: 'not_started', complexity: 'long', series_id: 'series-1',
        due_time: '09:00',
      },
      {
        id: 'r2', title: 'Weekly Quiz', class_name: 'CS101', due_date: '2026-06-24',
        importance: 4, status: 'completed', complexity: 'long', series_id: 'series-1',
        due_time: '09:00',
      },
    ];
    supabase.rpc.mockResolvedValueOnce({ data: rows, error: null });

    const result = await dbUpdateSeriesFrom('series-1', '2026-06-15', 2, 'target-1', BASE);

    expect(result).toEqual([
      {
        id: 'r1', title: 'Weekly Quiz', course: 'CS101', dueDate: '2026-06-17',
        importance: 4, status: 'not_started', complexity: 'long', seriesId: 'series-1',
        dueTime: '09:00',
      },
      {
        id: 'r2', title: 'Weekly Quiz', course: 'CS101', dueDate: '2026-06-24',
        importance: 4, status: 'completed', complexity: 'long', seriesId: 'series-1',
        dueTime: '09:00',
      },
    ]);
  });

  test('null data resolves to []', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await dbUpdateSeriesFrom('series-1', '2026-06-15', 0, 'target-1', BASE);

    expect(result).toEqual([]);
  });

  test('throws when Supabase returns an error', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } });

    await expect(
      dbUpdateSeriesFrom('series-1', '2026-06-15', 0, 'target-1', BASE)
    ).rejects.toEqual({ message: 'rpc failed' });
  });
});
