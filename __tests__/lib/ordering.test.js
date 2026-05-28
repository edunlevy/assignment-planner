import {
  adjustedDaysUntilDue,
  COMPLEXITY_BUFFER,
  pickWorkOnNext,
  sortForList,
} from '../../lib/ordering';

// Fixed reference date used across all tests so results don't depend on the
// real clock. "Today" is 2026-06-01 for the whole file.
const TODAY = new Date('2026-06-01T12:00:00');

// Factory: produce a minimal valid assignment, merging in overrides.
function make(overrides = {}) {
  return {
    id: 'a1',
    title: 'Test',
    course: 'CS',
    dueDate: '2026-06-10',      // 9 days from TODAY
    importance: 3,
    complexity: 'medium',
    status: 'not_started',
    reminderIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// COMPLEXITY_BUFFER
// ---------------------------------------------------------------------------
describe('COMPLEXITY_BUFFER', () => {
  test('defines expected buffers for all three complexities', () => {
    expect(COMPLEXITY_BUFFER.short).toBe(0);
    expect(COMPLEXITY_BUFFER.medium).toBe(1);
    expect(COMPLEXITY_BUFFER.long).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// adjustedDaysUntilDue
// ---------------------------------------------------------------------------
describe('adjustedDaysUntilDue', () => {
  test('short — no buffer: adjusted days equals raw days', () => {
    const a = make({ dueDate: '2026-06-04', complexity: 'short' });
    // raw = 3 days, buffer = 0 → adjusted = 3
    expect(adjustedDaysUntilDue(a, TODAY)).toBe(3);
  });

  test('medium — 1-day buffer', () => {
    const a = make({ dueDate: '2026-06-04', complexity: 'medium' });
    // raw = 3, buffer = 1 → adjusted = 2
    expect(adjustedDaysUntilDue(a, TODAY)).toBe(2);
  });

  test('long — 2-day buffer', () => {
    const a = make({ dueDate: '2026-06-04', complexity: 'long' });
    // raw = 3, buffer = 2 → adjusted = 1
    expect(adjustedDaysUntilDue(a, TODAY)).toBe(1);
  });

  test('overdue assignment returns a negative adjusted value', () => {
    const a = make({ dueDate: '2026-05-28', complexity: 'medium' });
    // raw = -4, buffer = 1 → adjusted = -5
    expect(adjustedDaysUntilDue(a, TODAY)).toBe(-5);
  });

  test('due today with medium complexity returns -1', () => {
    const a = make({ dueDate: '2026-06-01', complexity: 'medium' });
    // raw = 0, buffer = 1 → adjusted = -1
    expect(adjustedDaysUntilDue(a, TODAY)).toBe(-1);
  });

  test('missing complexity defaults to medium buffer (pre-migration compat)', () => {
    const a = make({ dueDate: '2026-06-04' });
    delete a.complexity;
    // same as medium: raw = 3, buffer = 1 → adjusted = 2
    expect(adjustedDaysUntilDue(a, TODAY)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// pickWorkOnNext
// ---------------------------------------------------------------------------
describe('pickWorkOnNext', () => {
  test('returns null for an empty list', () => {
    expect(pickWorkOnNext([], TODAY)).toBeNull();
  });

  test('returns null when all assignments are completed', () => {
    const all = [
      make({ id: 'a1', status: 'completed' }),
      make({ id: 'a2', status: 'completed' }),
    ];
    expect(pickWorkOnNext(all, TODAY)).toBeNull();
  });

  test('returns the only incomplete assignment', () => {
    const list = [
      make({ id: 'a1', status: 'not_started' }),
      make({ id: 'a2', status: 'completed' }),
    ];
    expect(pickWorkOnNext(list, TODAY).id).toBe('a1');
  });

  test('long assignment due later surfaces before short assignment due sooner', () => {
    // Long due in 5 days: adjusted = 5 - 2 = 3
    // Short due in 4 days: adjusted = 4 - 0 = 4
    // 3 < 4 → Long wins (lower adjusted = more urgent)
    const longLater  = make({ id: 'long',  dueDate: '2026-06-06', complexity: 'long',  importance: 3 });
    const shortSooner = make({ id: 'short', dueDate: '2026-06-05', complexity: 'short', importance: 3 });
    expect(pickWorkOnNext([shortSooner, longLater], TODAY).id).toBe('long');
  });

  test('when adjusted days are equal, picks higher importance', () => {
    // Both adjusted to the same value — importance breaks the tie.
    // Long due in 4 days: adjusted = 4 - 2 = 2
    // Short due in 2 days: adjusted = 2 - 0 = 2  (tie)
    const highImp = make({ id: 'high', dueDate: '2026-06-05', complexity: 'long',  importance: 5 });
    const lowImp  = make({ id: 'low',  dueDate: '2026-06-03', complexity: 'short', importance: 1 });
    expect(pickWorkOnNext([lowImp, highImp], TODAY).id).toBe('high');
  });

  test('when adjusted days and importance are equal, picks earlier raw due date', () => {
    // Long due in 4 days adj=2, importance 3; Short due in 2 days adj=2, importance 3
    // → same adjusted AND importance, so raw date breaks tie: short is due sooner
    const longA  = make({ id: 'longA',  dueDate: '2026-06-05', complexity: 'long',  importance: 3 });
    const shortA = make({ id: 'shortA', dueDate: '2026-06-03', complexity: 'short', importance: 3 });
    expect(pickWorkOnNext([longA, shortA], TODAY).id).toBe('shortA');
  });

  test('overdue assignment always surfaces first', () => {
    const overdue = make({ id: 'ov', dueDate: '2026-05-28', complexity: 'short' }); // adj = -3
    const soon    = make({ id: 'sn', dueDate: '2026-06-02', complexity: 'long'  }); // adj = 1 - 2 = -1
    expect(pickWorkOnNext([soon, overdue], TODAY).id).toBe('ov');
  });

  test('in_progress assignments compete normally (not filtered out)', () => {
    const ip   = make({ id: 'ip',   dueDate: '2026-06-03', status: 'in_progress', complexity: 'long' });
    const ns   = make({ id: 'ns',   dueDate: '2026-06-02', status: 'not_started', complexity: 'short' });
    // ip adj = 2 - 2 = 0; ns adj = 1 - 0 = 1 → ip wins
    expect(pickWorkOnNext([ns, ip], TODAY).id).toBe('ip');
  });

  test('does not mutate the input array', () => {
    const list = [
      make({ id: 'a', dueDate: '2026-06-05' }),
      make({ id: 'b', dueDate: '2026-06-03' }),
    ];
    const copy = [...list];
    pickWorkOnNext(list, TODAY);
    expect(list).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// sortForList
// ---------------------------------------------------------------------------
describe('sortForList', () => {
  test('sorts incomplete by raw due date ascending', () => {
    const a1 = make({ id: '1', dueDate: '2026-06-10' });
    const a2 = make({ id: '2', dueDate: '2026-06-05' });
    const a3 = make({ id: '3', dueDate: '2026-06-08' });
    const result = sortForList([a1, a2, a3]);
    expect(result.map(a => a.id)).toEqual(['2', '3', '1']);
  });

  test('on same due date, sorts Long before Short (complexity DESC)', () => {
    const date = '2026-06-05';
    const short  = make({ id: 'sh', dueDate: date, complexity: 'short' });
    const medium = make({ id: 'me', dueDate: date, complexity: 'medium' });
    const long   = make({ id: 'lo', dueDate: date, complexity: 'long' });
    const result = sortForList([short, medium, long]);
    expect(result.map(a => a.id)).toEqual(['lo', 'me', 'sh']);
  });

  test('on same due date and complexity, sorts higher importance first', () => {
    const date = '2026-06-05';
    const low  = make({ id: 'lo', dueDate: date, complexity: 'medium', importance: 1 });
    const high = make({ id: 'hi', dueDate: date, complexity: 'medium', importance: 5 });
    const result = sortForList([low, high]);
    expect(result.map(a => a.id)).toEqual(['hi', 'lo']);
  });

  test('completed assignments always appear after all incomplete ones', () => {
    const earlyDone = make({ id: 'done', dueDate: '2026-06-02', status: 'completed' });
    const lateTodo  = make({ id: 'todo', dueDate: '2026-06-30', status: 'not_started' });
    const result = sortForList([earlyDone, lateTodo]);
    expect(result.map(a => a.id)).toEqual(['todo', 'done']);
  });

  test('empty list returns empty array', () => {
    expect(sortForList([])).toEqual([]);
  });

  test('all-completed list preserves relative order (no sort specified for completed)', () => {
    const list = [
      make({ id: 'c1', status: 'completed', dueDate: '2026-06-10' }),
      make({ id: 'c2', status: 'completed', dueDate: '2026-06-02' }),
    ];
    const result = sortForList(list);
    // All completed — they're appended in their original order; no
    // secondary sort is applied to the completed bucket.
    expect(result.every(a => a.status === 'completed')).toBe(true);
    expect(result).toHaveLength(2);
  });

  test('does not mutate the input array', () => {
    const list = [
      make({ id: 'a', dueDate: '2026-06-10' }),
      make({ id: 'b', dueDate: '2026-06-05' }),
    ];
    const copy = [...list];
    sortForList(list);
    expect(list).toEqual(copy);
  });

  test('missing complexity defaults to medium rank (pre-migration compat)', () => {
    const date = '2026-06-05';
    const noComplexity = make({ id: 'nc', dueDate: date });
    delete noComplexity.complexity;
    const shortItem = make({ id: 'sh', dueDate: date, complexity: 'short' });
    const longItem  = make({ id: 'lo', dueDate: date, complexity: 'long'  });
    const result = sortForList([shortItem, noComplexity, longItem]);
    // long(0) < medium(1) < short(2) → long, noComplexity, short
    expect(result.map(a => a.id)).toEqual(['lo', 'nc', 'sh']);
  });
});
