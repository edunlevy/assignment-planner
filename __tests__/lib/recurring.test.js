import { MAX_OCCURRENCES, buildSeries, countOccurrences } from '../../lib/recurring';

// All weekday/calendar-day claims below were verified against actual JS Date
// arithmetic (new Date(y, m-1, d).getDay()), not assumed:
//   2026-01-05 Mon   2026-06-01 Mon   2026-06-03 Wed   2026-06-05 Fri
//   2026-06-08 Mon   2026-06-16 Tue   2026-06-17 Wed   2026-06-29 Mon
//   2026-07-01 Wed   2026-07-13 Mon   2026-07-15 Wed   2026-09-01 Tue
//   2026-09-04 Fri   2026-01-09 Fri   2026-01-10 Sat
// And month lengths: 2026-02=28 (not a leap year), 2026-04=30, 2026-06=30,
// 2028-02=29 (2028 is a leap year).

const BASE = { title: 'Reading', course: 'HIST', importance: 2, complexity: 'medium', status: 'not_started' };

// Build a series and return just the dueDate list, for concise table-driven
// assertions. seriesId/recurrenceRule/base-field propagation are checked
// separately (drafts shouldn't need re-verifying in every row).
function seriesDates(startISO, rule) {
  return buildSeries({ startISO, base: BASE, seriesId: 'series-1', rule }).map(d => d.dueDate);
}

describe('occurrence dates — table-driven', () => {
  const cases = [
    [
      'weekly, no byWeekday: same weekday as start, every interval week (parity with old behavior)',
      '2026-01-05',
      { freq: 'weekly', interval: 1, end: { count: 4 } },
      ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'],
    ],
    [
      'weekly, no byWeekday, biweekly interval: only every other calendar week matches',
      '2026-01-05',
      { freq: 'weekly', interval: 2, end: { count: 3 } },
      ['2026-01-05', '2026-01-19', '2026-02-02'],
    ],
    [
      'weekly, byWeekday includes start weekday: start date itself is the first occurrence',
      '2026-06-01', // Monday
      { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5], end: { count: 4 } },
      ['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-08'],
    ],
    [
      'weekly, byWeekday excludes start weekday: start date is NOT an occurrence, next matching weekday in the same week is',
      '2026-09-01', // Tuesday; Mon of that week (Aug 31) is before start and excluded
      { freq: 'weekly', interval: 1, byWeekday: [1, 5], end: { count: 2 } },
      // Fri of the start week, then Mon of the following week (2026-09-07).
      ['2026-09-04', '2026-09-07'],
    ],
    [
      'weekly, interval 0 is clamped to 1',
      '2026-01-05',
      { freq: 'weekly', interval: 0, end: { count: 3 } },
      ['2026-01-05', '2026-01-12', '2026-01-19'],
    ],
    [
      'weekly, interval undefined is clamped to 1',
      '2026-01-05',
      { freq: 'weekly', end: { count: 3 } },
      ['2026-01-05', '2026-01-12', '2026-01-19'],
    ],
    [
      'monthly: repeats on start day-of-month every interval months',
      '2026-03-15',
      { freq: 'monthly', interval: 1, end: { count: 3 } },
      ['2026-03-15', '2026-04-15', '2026-05-15'],
    ],
    [
      'monthly, interval 0 is clamped to 1',
      '2026-03-15',
      { freq: 'monthly', interval: 0, end: { count: 2 } },
      ['2026-03-15', '2026-04-15'],
    ],
    [
      'monthly day-29: Feb (28 days, non-leap 2026) is skipped, March (31 days) matches',
      '2026-01-29',
      { freq: 'monthly', interval: 1, end: { count: 2 } },
      ['2026-01-29', '2026-03-29'],
    ],
    [
      'monthly day-29 in a leap year: Feb 2028 has 29 days, so it is NOT skipped',
      '2028-01-29',
      { freq: 'monthly', interval: 1, end: { count: 2 } },
      ['2028-01-29', '2028-02-29'],
    ],
    [
      'monthly day-30: Feb (28 days) is skipped, March (31 days) matches',
      '2026-01-30',
      { freq: 'monthly', interval: 1, end: { count: 2 } },
      ['2026-01-30', '2026-03-30'],
    ],
    [
      'monthly day-31 (Jan-31 -> Feb skip case): Feb/Apr/Jun all lack a 31st and are skipped',
      '2026-01-31',
      { freq: 'monthly', interval: 1, end: { count: 4 } },
      ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31'],
    ],
    [
      'monthly, until inclusive: end date that IS an occurrence is included',
      '2026-01-31',
      { freq: 'monthly', interval: 1, end: { untilISO: '2026-05-31' } },
      ['2026-01-31', '2026-03-31', '2026-05-31'],
    ],
  ];

  test.each(cases)('%s', (_name, startISO, rule, expected) => {
    expect(seriesDates(startISO, rule)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// The hand-verified biweekly, mid-week-start, calendar-week-anchored case
// called out explicitly in the spec.
// ---------------------------------------------------------------------------
describe('weekly byWeekday — calendar-week anchoring with a mid-week start', () => {
  test('every 2 weeks on Mon+Wed, starting from a Tuesday: Wed of the start week, then Mon+Wed two weeks later, repeating', () => {
    // 2026-06-16 is a Tuesday. The calendar week containing it (Sunday-based
    // startOfWeek) runs 2026-06-14 (Sun) .. 2026-06-20 (Sat). Monday of that
    // week (06-15) is BEFORE the start date, so it's never scanned; only
    // Wednesday (06-17), which falls on/after the start, appears from the
    // start week. The next matching week (2 calendar weeks later, per the
    // interval) is 2026-06-28 .. 2026-07-04, contributing both Mon (06-29)
    // and Wed (07-01); two weeks later again contributes Mon 07-13 and
    // Wed 07-15.
    const rule = { freq: 'weekly', interval: 2, byWeekday: [1, 3], end: { count: 5 } };
    expect(seriesDates('2026-06-16', rule)).toEqual([
      '2026-06-17',
      '2026-06-29',
      '2026-07-01',
      '2026-07-13',
      '2026-07-15',
    ]);
  });
});

// ---------------------------------------------------------------------------
// end: until-mode with zero matching occurrences returns [].
// ---------------------------------------------------------------------------
describe('end: until-mode with zero matches', () => {
  test('weekly byWeekday whose window never reaches a matching weekday returns []', () => {
    // Start is a Monday; window closes the Friday before the next Saturday,
    // so the only requested weekday (Saturday) never falls inside it.
    const rule = { freq: 'weekly', interval: 1, byWeekday: [6], end: { untilISO: '2026-01-09' } };
    expect(seriesDates('2026-01-05', rule)).toEqual([]);
    expect(countOccurrences('2026-01-05', rule)).toBe(0);
  });

  test('monthly window that closes before the next qualifying day-of-month contains only the start', () => {
    // Start is the 31st; Feb (28 days) doesn't qualify and the window closes
    // well before March 31st, the next month that does. The start date itself
    // is always a monthly occurrence (its own month necessarily has its
    // day-of-month), so a monthly until-window can never be empty — zero
    // occurrences is only reachable in weekly byWeekday mode.
    const rule = { freq: 'monthly', interval: 1, end: { untilISO: '2026-02-15' } };
    expect(seriesDates('2026-01-31', rule)).toEqual(['2026-01-31']);
    expect(countOccurrences('2026-01-31', rule)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// end: count-mode caps generation exactly.
// ---------------------------------------------------------------------------
describe('end: count-mode', () => {
  test('generates exactly N occurrences, no more no less', () => {
    const rule = { freq: 'weekly', interval: 1, end: { count: 5 } };
    expect(seriesDates('2026-01-05', rule)).toHaveLength(5);
  });

  test('count of 1 returns just the start date when it matches', () => {
    const rule = { freq: 'weekly', interval: 1, end: { count: 1 } };
    expect(seriesDates('2026-01-05', rule)).toEqual(['2026-01-05']);
  });
});

// ---------------------------------------------------------------------------
// The 52-occurrence cap, on both buildSeries and countOccurrences.
// ---------------------------------------------------------------------------
describe('MAX_OCCURRENCES cap', () => {
  test('MAX_OCCURRENCES is 52', () => {
    expect(MAX_OCCURRENCES).toBe(52);
  });

  test('buildSeries never exceeds 52 occurrences, even when the rule asks for far more', () => {
    const rule = { freq: 'weekly', interval: 1, end: { count: 1000 } };
    const drafts = buildSeries({ startISO: '2026-01-05', base: BASE, seriesId: 's', rule });
    expect(drafts).toHaveLength(52);
    expect(drafts[51].dueDate).toBe(seriesDates('2026-01-05', { freq: 'weekly', interval: 1, end: { count: 52 } })[51]);
  });

  test('buildSeries caps an open-ended (far-future untilISO) rule at 52 too', () => {
    const rule = { freq: 'weekly', interval: 1, end: { untilISO: '2099-01-01' } };
    expect(buildSeries({ startISO: '2026-01-05', base: BASE, seriesId: 's', rule })).toHaveLength(52);
  });

  test('countOccurrences returns exactly 52 when a rule asks for exactly the cap', () => {
    const rule = { freq: 'weekly', interval: 1, end: { count: 52 } };
    expect(countOccurrences('2026-01-05', rule)).toBe(52);
  });

  test('countOccurrences returns MAX_OCCURRENCES + 1 (53) when a rule overshoots the cap, regardless of by how much', () => {
    const rule = { freq: 'weekly', interval: 1, end: { count: 1000 } };
    expect(countOccurrences('2026-01-05', rule)).toBe(MAX_OCCURRENCES + 1);
    expect(countOccurrences('2026-01-05', rule)).toBe(53);
  });

  test('countOccurrences caps at 53 for an open-ended until far in the future', () => {
    const rule = { freq: 'weekly', interval: 1, end: { untilISO: '2099-01-01' } };
    expect(countOccurrences('2026-01-05', rule)).toBe(53);
  });
});

// ---------------------------------------------------------------------------
// Chronological ordering (also implicitly checked by every dueDate list
// above, but asserted directly here for both freqs).
// ---------------------------------------------------------------------------
describe('chronological order', () => {
  test('weekly with multiple weekdays interleaves in date order, not weekday-list order', () => {
    // byWeekday is [5, 1, 3] (unsorted input) — output must still be chronological.
    const rule = { freq: 'weekly', interval: 1, byWeekday: [5, 1, 3], end: { count: 4 } };
    const result = seriesDates('2026-06-01', rule); // Monday start
    expect(result).toEqual(['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-08']);
    const asDates = result.map(d => new Date(d));
    for (let i = 1; i < asDates.length; i++) {
      expect(asDates[i].getTime()).toBeGreaterThan(asDates[i - 1].getTime());
    }
  });

  test('monthly occurrences are strictly increasing across a skip', () => {
    const rule = { freq: 'monthly', interval: 1, end: { count: 3 } };
    const result = seriesDates('2026-01-31', rule);
    const asDates = result.map(d => new Date(d));
    for (let i = 1; i < asDates.length; i++) {
      expect(asDates[i].getTime()).toBeGreaterThan(asDates[i - 1].getTime());
    }
  });
});

// ---------------------------------------------------------------------------
// buildSeries draft shape: base fields + dueDate + seriesId + recurrenceRule.
// ---------------------------------------------------------------------------
describe('buildSeries — draft shape', () => {
  test('spreads base, and adds dueDate/seriesId/recurrenceRule to every draft', () => {
    const rule = { freq: 'weekly', interval: 1, end: { count: 2 } };
    const base = { title: 'Essay', course: 'ENGL', importance: 4, complexity: 'long', status: 'not_started' };
    const drafts = buildSeries({ startISO: '2026-01-05', base, seriesId: 'series-x', rule });

    expect(drafts).toHaveLength(2);
    expect(drafts.map(d => d.dueDate)).toEqual(['2026-01-05', '2026-01-12']);
    for (const d of drafts) {
      expect(d.title).toBe('Essay');
      expect(d.course).toBe('ENGL');
      expect(d.importance).toBe(4);
      expect(d.complexity).toBe('long');
      expect(d.seriesId).toBe('series-x');
      // The rule object itself is stored verbatim (same reference) on every row.
      expect(d.recurrenceRule).toBe(rule);
    }
  });

  test('propagates arbitrary base fields (regression: complexity must not be dropped)', () => {
    const rule = { freq: 'monthly', interval: 1, end: { count: 2 } };
    const drafts = buildSeries({
      startISO: '2026-01-15',
      base: { title: 'x', course: 'y', complexity: 'short', status: 'not_started' },
      seriesId: 's',
      rule,
    });
    expect(drafts).toHaveLength(2);
    for (const d of drafts) expect(d.complexity).toBe('short');
  });
});
