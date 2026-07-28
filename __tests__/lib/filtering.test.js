import {
  applyFilters,
  distinctCourses,
  emptyFilters,
  hasActiveFilters,
} from '../../lib/filtering';

// Fixed reference "now" for every test in this file: 2026-06-10, noon.
// Week window under this "now" is [2026-06-10, 2026-06-16] (diff 0..6).
const NOW = new Date('2026-06-10T12:00:00');

function make(overrides = {}) {
  return {
    id: 'a1',
    title: 'Test',
    course: 'CS101',
    dueDate: '2026-06-10',
    dueTime: undefined,
    importance: 3,
    complexity: 'medium',
    status: 'not_started',
    reminderIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// emptyFilters
// ---------------------------------------------------------------------------
describe('emptyFilters', () => {
  test('returns the default shape', () => {
    expect(emptyFilters()).toEqual({ courses: [], due: 'all', complexity: [] });
  });

  test('returns a fresh object each call (not a shared reference)', () => {
    const a = emptyFilters();
    const b = emptyFilters();
    expect(a).not.toBe(b);
    a.courses.push('CS101');
    expect(b.courses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hasActiveFilters
// ---------------------------------------------------------------------------
describe('hasActiveFilters', () => {
  test('false for emptyFilters()', () => {
    expect(hasActiveFilters(emptyFilters())).toBe(false);
  });

  test('true when courses is non-empty', () => {
    expect(hasActiveFilters({ courses: ['CS101'], due: 'all', complexity: [] })).toBe(true);
  });

  test('true when due is not "all"', () => {
    expect(hasActiveFilters({ courses: [], due: 'today', complexity: [] })).toBe(true);
  });

  test('true when complexity is non-empty', () => {
    expect(hasActiveFilters({ courses: [], due: 'all', complexity: ['long'] })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyFilters — due: 'overdue'
//
// Overdue = incomplete AND due strictly before `now`. Matches
// lib/ordering.js's rawDaysUntilDue exactly: untimed rows use an end-of-day
// (23:59) fallback, so an untimed assignment is only overdue once its due
// day has fully passed, never on the day itself.
// ---------------------------------------------------------------------------
describe('applyFilters — due: overdue', () => {
  const filters = { courses: [], due: 'overdue', complexity: [] };

  test('due yesterday, untimed — overdue', () => {
    const a = make({ dueDate: '2026-06-09' });
    expect(applyFilters([a], filters, NOW)).toEqual([a]);
  });

  test('due today, untimed — NOT overdue (day hasn\'t fully passed)', () => {
    const a = make({ dueDate: '2026-06-10' });
    expect(applyFilters([a], filters, NOW)).toEqual([]);
  });

  test('due today with a dueTime already past "now" — overdue', () => {
    // NOW is noon; 9 AM has already passed.
    const a = make({ dueDate: '2026-06-10', dueTime: '09:00' });
    expect(applyFilters([a], filters, NOW)).toEqual([a]);
  });

  test('due today with a dueTime still in the future — NOT overdue', () => {
    const a = make({ dueDate: '2026-06-10', dueTime: '18:00' });
    expect(applyFilters([a], filters, NOW)).toEqual([]);
  });

  test('completed assignment due in the past — NEVER counted as overdue', () => {
    const a = make({ dueDate: '2026-06-01', status: 'completed' });
    expect(applyFilters([a], filters, NOW)).toEqual([]);
  });

  test('due in the future — not overdue', () => {
    const a = make({ dueDate: '2026-06-20' });
    expect(applyFilters([a], filters, NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyFilters — due: 'today'
// ---------------------------------------------------------------------------
describe('applyFilters — due: today', () => {
  const filters = { courses: [], due: 'today', complexity: [] };

  test('dueDate equals today (local) — included', () => {
    const a = make({ dueDate: '2026-06-10' });
    expect(applyFilters([a], filters, NOW)).toEqual([a]);
  });

  test('dueDate is yesterday — excluded', () => {
    const a = make({ dueDate: '2026-06-09' });
    expect(applyFilters([a], filters, NOW)).toEqual([]);
  });

  test('dueDate is tomorrow — excluded', () => {
    const a = make({ dueDate: '2026-06-11' });
    expect(applyFilters([a], filters, NOW)).toEqual([]);
  });

  test('due today is included even once its dueTime has passed', () => {
    const a = make({ dueDate: '2026-06-10', dueTime: '09:00' });
    expect(applyFilters([a], filters, NOW)).toEqual([a]);
  });
});

// ---------------------------------------------------------------------------
// applyFilters — due: 'week'
// ---------------------------------------------------------------------------
describe('applyFilters — due: week', () => {
  const filters = { courses: [], due: 'week', complexity: [] };

  test('today (day 0) — included', () => {
    const a = make({ dueDate: '2026-06-10' });
    expect(applyFilters([a], filters, NOW)).toEqual([a]);
  });

  test('boundary day 6 (today + 6) — included', () => {
    const a = make({ dueDate: '2026-06-16' });
    expect(applyFilters([a], filters, NOW)).toEqual([a]);
  });

  test('day 7 (today + 7) — excluded', () => {
    const a = make({ dueDate: '2026-06-17' });
    expect(applyFilters([a], filters, NOW)).toEqual([]);
  });

  test('yesterday (day -1) — excluded, "week" does not include overdue', () => {
    const a = make({ dueDate: '2026-06-09' });
    expect(applyFilters([a], filters, NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyFilters — due: 'all'
// ---------------------------------------------------------------------------
describe('applyFilters — due: all', () => {
  test('no due-based filtering at all', () => {
    const list = [
      make({ id: 'past', dueDate: '2026-05-01' }),
      make({ id: 'today', dueDate: '2026-06-10' }),
      make({ id: 'future', dueDate: '2026-12-01' }),
    ];
    expect(applyFilters(list, emptyFilters(), NOW)).toEqual(list);
  });
});

// ---------------------------------------------------------------------------
// applyFilters — courses (multi-select)
// ---------------------------------------------------------------------------
describe('applyFilters — courses', () => {
  test('empty courses array applies no course filter', () => {
    const list = [make({ course: 'CS101' }), make({ course: 'MATH201' })];
    expect(applyFilters(list, { courses: [], due: 'all', complexity: [] }, NOW)).toEqual(list);
  });

  test('keeps only assignments whose course is in the selected set', () => {
    const cs = make({ id: 'cs', course: 'CS101' });
    const math = make({ id: 'math', course: 'MATH201' });
    const phys = make({ id: 'phys', course: 'PHYS100' });
    const filters = { courses: ['CS101', 'PHYS100'], due: 'all', complexity: [] };
    expect(applyFilters([cs, math, phys], filters, NOW)).toEqual([cs, phys]);
  });

  test('course matching is exact and case-sensitive', () => {
    const a = make({ course: 'cs101' });
    const filters = { courses: ['CS101'], due: 'all', complexity: [] };
    expect(applyFilters([a], filters, NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyFilters — complexity (multi-select)
// ---------------------------------------------------------------------------
describe('applyFilters — complexity', () => {
  test('empty complexity array applies no complexity filter', () => {
    const list = [make({ complexity: 'short' }), make({ complexity: 'long' })];
    expect(applyFilters(list, { courses: [], due: 'all', complexity: [] }, NOW)).toEqual(list);
  });

  test('keeps only assignments whose complexity is in the selected set', () => {
    const short = make({ id: 's', complexity: 'short' });
    const medium = make({ id: 'm', complexity: 'medium' });
    const long = make({ id: 'l', complexity: 'long' });
    const filters = { courses: [], due: 'all', complexity: ['short', 'long'] };
    expect(applyFilters([short, medium, long], filters, NOW)).toEqual([short, long]);
  });
});

// ---------------------------------------------------------------------------
// applyFilters — combined filters + order preservation
// ---------------------------------------------------------------------------
describe('applyFilters — combined', () => {
  test('course + due + complexity are AND-combined', () => {
    const match = make({ id: 'match', course: 'CS101', dueDate: '2026-06-10', complexity: 'long' });
    const wrongCourse = make({ id: 'wc', course: 'MATH201', dueDate: '2026-06-10', complexity: 'long' });
    const wrongDue = make({ id: 'wd', course: 'CS101', dueDate: '2026-06-20', complexity: 'long' });
    const wrongComplexity = make({ id: 'wx', course: 'CS101', dueDate: '2026-06-10', complexity: 'short' });
    const filters = { courses: ['CS101'], due: 'today', complexity: ['long'] };
    const list = [wrongCourse, match, wrongDue, wrongComplexity];
    expect(applyFilters(list, filters, NOW)).toEqual([match]);
  });

  test('preserves the original relative order of matching items', () => {
    const a = make({ id: 'a', course: 'CS101' });
    const b = make({ id: 'b', course: 'CS101' });
    const c = make({ id: 'c', course: 'MATH201' });
    const d = make({ id: 'd', course: 'CS101' });
    const filters = { courses: ['CS101'], due: 'all', complexity: [] };
    expect(applyFilters([a, b, c, d], filters, NOW).map(x => x.id)).toEqual(['a', 'b', 'd']);
  });
});

// ---------------------------------------------------------------------------
// distinctCourses
// ---------------------------------------------------------------------------
describe('distinctCourses', () => {
  test('dedupes repeated course values', () => {
    const list = [make({ course: 'CS101' }), make({ course: 'CS101' }), make({ course: 'MATH201' })];
    expect(distinctCourses(list)).toEqual(['CS101', 'MATH201']);
  });

  test('sorts alphabetically', () => {
    const list = [make({ course: 'PHYS100' }), make({ course: 'CS101' }), make({ course: 'MATH201' })];
    expect(distinctCourses(list)).toEqual(['CS101', 'MATH201', 'PHYS100']);
  });

  test('excludes empty and whitespace-only course values', () => {
    const list = [
      make({ course: 'CS101' }),
      make({ course: '' }),
      make({ course: '   ' }),
    ];
    expect(distinctCourses(list)).toEqual(['CS101']);
  });

  test('returns an empty array for an empty assignments list', () => {
    expect(distinctCourses([])).toEqual([]);
  });

  test('is case-sensitive (does not merge differently-cased duplicates)', () => {
    const list = [make({ course: 'CS101' }), make({ course: 'cs101' })];
    // localeCompare tie-breaks case AFTER base letters (lowercase first in
    // the default locale), unlike code-unit order which would put all
    // uppercase before all lowercase.
    expect(distinctCourses(list)).toEqual(['cs101', 'CS101']);
  });

  test('sorts alphabetically across mixed case (locale order, not code units)', () => {
    // Code-unit sort would yield ['Zoology', 'algebra'] — free-text course
    // names must sort the way a person reads them.
    const list = [make({ course: 'Zoology' }), make({ course: 'algebra' })];
    expect(distinctCourses(list)).toEqual(['algebra', 'Zoology']);
  });
});
