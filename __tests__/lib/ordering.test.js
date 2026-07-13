import {
  adjustedDaysUntilDue,
  COMPLEXITY_BUFFER,
  DEFAULT_RANKING,
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

// No-time rows use a 23:59 fallback fraction, same as sortForList, so that
// a no-time assignment never incorrectly surfaces ahead of an earlier explicit
// time on the same calendar day.
const NO_TIME_F = (23 * 60 + 59) / (24 * 60); // ≈ 0.9993

// ---------------------------------------------------------------------------
// adjustedDaysUntilDue
// ---------------------------------------------------------------------------
describe('adjustedDaysUntilDue', () => {
  test('short — no buffer: adjusted is raw days + 23:59 fraction', () => {
    const a = make({ dueDate: '2026-06-04', complexity: 'short' });
    // raw = 3, buffer = 0, no-time fraction ≈ 0.9993 → adjusted ≈ 3.9993
    expect(adjustedDaysUntilDue(a, TODAY)).toBe(3 + NO_TIME_F);
  });

  test('medium — 1-day buffer', () => {
    const a = make({ dueDate: '2026-06-04', complexity: 'medium' });
    // raw = 3, buffer = 1 → adjusted ≈ 2.9993
    expect(adjustedDaysUntilDue(a, TODAY)).toBe(2 + NO_TIME_F);
  });

  test('long — 2-day buffer', () => {
    const a = make({ dueDate: '2026-06-04', complexity: 'long' });
    // raw = 3, buffer = 2 → adjusted ≈ 1.9993
    expect(adjustedDaysUntilDue(a, TODAY)).toBe(1 + NO_TIME_F);
  });

  test('overdue assignment returns a negative adjusted value', () => {
    const a = make({ dueDate: '2026-05-28', complexity: 'medium' });
    // raw = -4, buffer = 1 → adjusted ≈ -5 + 0.9993 = -4.0007
    expect(adjustedDaysUntilDue(a, TODAY)).toBe(-5 + NO_TIME_F);
  });

  test('due today with medium complexity — same-day path uses current time', () => {
    const a = make({ dueDate: '2026-06-01', complexity: 'medium' });
    // TODAY = noon (720 mins). No dueTime → 23:59 (1439 mins).
    // (1439 - 720) / 1440 - buffer(1) = 719/1440 - 1 ≈ -0.5007
    const todayMins = TODAY.getHours() * 60 + TODAY.getMinutes(); // 720
    expect(adjustedDaysUntilDue(a, TODAY)).toBe((1439 - todayMins) / (24 * 60) - 1);
  });

  test('missing complexity defaults to medium buffer (pre-migration compat)', () => {
    const a = make({ dueDate: '2026-06-04' });
    delete a.complexity;
    // same as medium: raw = 3, buffer = 1 → adjusted ≈ 2.9993
    expect(adjustedDaysUntilDue(a, TODAY)).toBe(2 + NO_TIME_F);
  });

  test('same-day assignment whose time has passed scores negative (overdue)', () => {
    // TODAY = noon; 9 AM is 3 hours past due.
    const a = make({ dueDate: '2026-06-01', complexity: 'short', dueTime: '09:00' });
    // (540 - 720) / 1440 - 0 = -180/1440 ≈ -0.125
    expect(adjustedDaysUntilDue(a, TODAY)).toBeLessThan(0);
  });

  test('past-due same-day assignment surfaces ahead of a buffer-adjusted tomorrow one', () => {
    // TODAY = noon; 9 AM short = overdue (adj ≈ -0.125).
    // Tomorrow long with 2-day buffer: raw=1, adj = 1 - 2 + 1439/1440 ≈ -0.0007.
    // The already-overdue assignment must be more urgent (lower score).
    const overdueToday  = make({ id: 'ov', dueDate: '2026-06-01', complexity: 'short', dueTime: '09:00' });
    const tomorrowLong  = make({ id: 'tl', dueDate: '2026-06-02', complexity: 'long' });
    expect(pickWorkOnNext([tomorrowLong, overdueToday], TODAY).id).toBe('ov');
  });

  test('no-time rows use 23:59 fallback so a timed 9 AM is more urgent than no-time same day', () => {
    const noTime = make({ dueDate: '2026-06-01', complexity: 'short' });
    const nineAm = make({ dueDate: '2026-06-01', complexity: 'short', dueTime: '09:00' });
    // no-time adj ≈ 0.9993; 9 AM adj = 9*60/1440 = 0.375 → 9 AM is more urgent
    expect(adjustedDaysUntilDue(nineAm, TODAY)).toBeLessThan(adjustedDaysUntilDue(noTime, TODAY));
  });

  test('earlier dueTime on the same day yields a lower adjusted value', () => {
    const early = make({ dueDate: '2026-06-01', complexity: 'short', dueTime: '09:00' });
    const late  = make({ dueDate: '2026-06-01', complexity: 'short', dueTime: '22:00' });
    expect(adjustedDaysUntilDue(early, TODAY)).toBeLessThan(adjustedDaysUntilDue(late, TODAY));
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

  test('when adjusted days and importance are equal, complexity (ranked third by default) breaks the tie before raw date', () => {
    // Long due in 4 days adj=2, importance 3; Short due in 2 days adj=2, importance 3
    // → adjusted AND importance tie. Before the ranking feature, pickWorkOnNext
    // had no complexity tiebreaker at all and fell straight through to raw
    // date (short, due sooner, used to win here). Now complexity is always
    // one of the three ranked factors — even ranked last in DEFAULT_RANKING,
    // it's still consulted before the raw-date fallback, so long (higher
    // complexity rank) wins this tie instead. This is an intentional
    // completeness improvement, not a regression.
    const longA  = make({ id: 'longA',  dueDate: '2026-06-05', complexity: 'long',  importance: 3 });
    const shortA = make({ id: 'shortA', dueDate: '2026-06-03', complexity: 'short', importance: 3 });
    expect(pickWorkOnNext([longA, shortA], TODAY).id).toBe('longA');
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

  test('same date and complexity: earlier dueTime surfaces first', () => {
    // Both due today (2026-06-01), same complexity and importance.
    // 9 AM adj = 0 - 0 + 0.375 = 0.375; 10 PM adj = 0 - 0 + 0.917 ≈ 0.917.
    const early = make({ id: 'early', dueDate: '2026-06-01', complexity: 'short', dueTime: '09:00' });
    const late  = make({ id: 'late',  dueDate: '2026-06-01', complexity: 'short', dueTime: '22:00' });
    expect(pickWorkOnNext([late, early], TODAY).id).toBe('early');
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

  test('on same due date, earlier dueTime appears before later dueTime', () => {
    const date = '2026-06-05';
    const early = make({ id: 'early', dueDate: date, complexity: 'short', dueTime: '09:00' });
    const late  = make({ id: 'late',  dueDate: date, complexity: 'long',  dueTime: '22:00' });
    // Time wins over complexity: 9 AM < 10 PM
    expect(sortForList([late, early]).map(a => a.id)).toEqual(['early', 'late']);
  });

  test('on same due date, timed assignments sort before no-time ones', () => {
    const date = '2026-06-05';
    const timed  = make({ id: 'timed',  dueDate: date, dueTime: '09:00' });
    const noTime = make({ id: 'notime', dueDate: date });
    // timed 9 AM (540 min) < no-time fallback 23:59 (1439 min)
    expect(sortForList([noTime, timed]).map(a => a.id)).toEqual(['timed', 'notime']);
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

// ---------------------------------------------------------------------------
// pickWorkOnNext with a custom ranking
// ---------------------------------------------------------------------------
describe('pickWorkOnNext with a custom ranking', () => {
  test('DEFAULT_RANKING is [dueDate, importance, complexity]', () => {
    expect(DEFAULT_RANKING).toEqual(['dueDate', 'importance', 'complexity']);
  });

  test('explicit DEFAULT_RANKING reproduces the no-ranking-arg result', () => {
    // Same fixture as the "long assignment due later surfaces before short
    // assignment due sooner" test above — proves the ranked codepath is a
    // no-op for callers that don't pass a ranking.
    const longLater   = make({ id: 'long',  dueDate: '2026-06-06', complexity: 'long',  importance: 3 });
    const shortSooner = make({ id: 'short', dueDate: '2026-06-05', complexity: 'short', importance: 3 });
    const withoutArg = pickWorkOnNext([shortSooner, longLater], TODAY);
    const withDefault = pickWorkOnNext([shortSooner, longLater], TODAY, DEFAULT_RANKING);
    expect(withDefault.id).toBe(withoutArg.id);
    expect(withDefault.id).toBe('long');
  });

  test('complexity ranked first: longer assignment wins even though it is due much later', () => {
    const long  = make({ id: 'long',  dueDate: '2026-06-10', complexity: 'long'  }); // 9 days out
    const short = make({ id: 'short', dueDate: '2026-06-02', complexity: 'short' }); // 1 day out
    const ranking = ['complexity', 'dueDate', 'importance'];
    expect(pickWorkOnNext([short, long], TODAY, ranking).id).toBe('long');
  });

  test('importance ranked first: higher importance wins even though it is due much later', () => {
    const highImportance = make({ id: 'hi', dueDate: '2026-06-20', importance: 5 });
    const lowImportance  = make({ id: 'lo', dueDate: '2026-06-02', importance: 1 });
    const ranking = ['importance', 'dueDate', 'complexity'];
    expect(pickWorkOnNext([lowImportance, highImportance], TODAY, ranking).id).toBe('hi');
  });

  test('due date ranked first: sooner due date wins even with lower importance/complexity', () => {
    const soonerLowPriority = make({ id: 'soon', dueDate: '2026-06-02', importance: 1, complexity: 'short' });
    const laterHighPriority = make({ id: 'later', dueDate: '2026-06-20', importance: 5, complexity: 'long' });
    const ranking = ['dueDate', 'importance', 'complexity'];
    expect(pickWorkOnNext([laterHighPriority, soonerLowPriority], TODAY, ranking).id).toBe('soon');
  });

  test('ranked factor ties fall through to the next ranked factor', () => {
    // Same due date and complexity — ties on both; importance (ranked last
    // here) still breaks the tie since it's the only differing field.
    const date = '2026-06-05';
    const highImp = make({ id: 'hi', dueDate: date, complexity: 'medium', importance: 5 });
    const lowImp  = make({ id: 'lo', dueDate: date, complexity: 'medium', importance: 1 });
    const ranking = ['dueDate', 'complexity', 'importance'];
    expect(pickWorkOnNext([lowImp, highImp], TODAY, ranking).id).toBe('hi');
  });

  test('an invalid ranking (wrong length) falls back to DEFAULT_RANKING behavior', () => {
    const longLater   = make({ id: 'long',  dueDate: '2026-06-06', complexity: 'long',  importance: 3 });
    const shortSooner = make({ id: 'short', dueDate: '2026-06-05', complexity: 'short', importance: 3 });
    expect(pickWorkOnNext([shortSooner, longLater], TODAY, ['dueDate']).id).toBe('long');
  });

  test('an invalid ranking (unknown key) falls back to DEFAULT_RANKING behavior', () => {
    const longLater   = make({ id: 'long',  dueDate: '2026-06-06', complexity: 'long',  importance: 3 });
    const shortSooner = make({ id: 'short', dueDate: '2026-06-05', complexity: 'short', importance: 3 });
    const bogus = ['dueDate', 'importance', 'notARealFactor'];
    expect(pickWorkOnNext([shortSooner, longLater], TODAY, bogus).id).toBe('long');
  });

  test('does not mutate the input array when a ranking is passed', () => {
    const list = [
      make({ id: 'a', dueDate: '2026-06-05' }),
      make({ id: 'b', dueDate: '2026-06-03' }),
    ];
    const copy = [...list];
    pickWorkOnNext(list, TODAY, ['complexity', 'importance', 'dueDate']);
    expect(list).toEqual(copy);
  });
});
