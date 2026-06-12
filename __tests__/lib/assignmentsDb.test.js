import {
  dbDelete,
  dbDeleteSeries,
  dbFetch,
  dbInsert,
  dbInsertMany,
  dbUpdate,
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
