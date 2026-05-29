import {
  DEFAULT_COMPLEXITY,
  isValidDate,
  isValidTime,
  rowsMatch,
  sanitizeAssignment,
  VALID_COMPLEXITIES,
  VALID_STATUSES,
} from '../../lib/assignment';

const BASE = {
  id: 'a1',
  title: 'Essay',
  course: 'ENGL 200',
  dueDate: '2026-09-01',
  importance: 4,
  status: 'in_progress',
  complexity: 'long',
  seriesId: 'series-1',
};

describe('VALID_STATUSES', () => {
  test('contains exactly the three expected statuses', () => {
    expect([...VALID_STATUSES].sort()).toEqual(['completed', 'in_progress', 'not_started']);
  });
});

describe('isValidDate — re-exported from lib/assignment', () => {
  test('accepts a well-formed YYYY-MM-DD', () => {
    expect(isValidDate('2026-05-15')).toBe(true);
  });

  test('rejects a leap day on a non-leap year', () => {
    expect(isValidDate('2027-02-29')).toBe(false);
  });

  test('rejects non-string', () => {
    expect(isValidDate(null)).toBe(false);
    expect(isValidDate(20260515)).toBe(false);
  });
});

describe('sanitizeAssignment — re-exported from lib/assignment', () => {
  test('fills defaults and validates shape', () => {
    const out = sanitizeAssignment({ id: 'x', title: 't', course: 'c', dueDate: '2026-06-01' });
    expect(out).toMatchObject({
      importance: 3,
      status: 'not_started',
      complexity: 'medium',
      reminderIds: [],
    });
  });

  test('rejects missing required fields', () => {
    expect(sanitizeAssignment(null)).toBeNull();
    expect(sanitizeAssignment({ id: 'x', title: '', course: 'c', dueDate: '2026-06-01' })).toBeNull();
  });
});

describe('VALID_COMPLEXITIES', () => {
  test('contains exactly short / medium / long', () => {
    expect([...VALID_COMPLEXITIES].sort()).toEqual(['long', 'medium', 'short']);
  });

  test('DEFAULT_COMPLEXITY is medium', () => {
    expect(DEFAULT_COMPLEXITY).toBe('medium');
  });
});

describe('sanitizeAssignment — complexity handling', () => {
  const base = { id: 'x', title: 't', course: 'c', dueDate: '2026-06-01' };

  test('passes through a valid complexity unchanged', () => {
    for (const c of ['short', 'medium', 'long']) {
      expect(sanitizeAssignment({ ...base, complexity: c }).complexity).toBe(c);
    }
  });

  test('normalises missing complexity to medium (pre-migration cache compat)', () => {
    expect(sanitizeAssignment(base).complexity).toBe('medium');
  });

  test('normalises invalid complexity values to medium', () => {
    expect(sanitizeAssignment({ ...base, complexity: 'huge' }).complexity).toBe('medium');
    expect(sanitizeAssignment({ ...base, complexity: null }).complexity).toBe('medium');
    expect(sanitizeAssignment({ ...base, complexity: 42 }).complexity).toBe('medium');
    expect(sanitizeAssignment({ ...base, complexity: '' }).complexity).toBe('medium');
  });
});

describe('isValidTime', () => {
  test('accepts valid HH:MM strings', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('17:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('09:30')).toBe(true);
  });

  test('rejects out-of-range values', () => {
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('17:60')).toBe(false);
    expect(isValidTime('25:00')).toBe(false);
  });

  test('rejects wrong format', () => {
    expect(isValidTime('5:00')).toBe(false);
    expect(isValidTime('5pm')).toBe(false);
    expect(isValidTime('17:00:00')).toBe(false);
    expect(isValidTime('')).toBe(false);
    expect(isValidTime(null)).toBe(false);
  });
});

describe('sanitizeAssignment — dueTime handling', () => {
  const base = { id: 'x', title: 't', course: 'c', dueDate: '2026-06-01' };

  test('preserves a valid dueTime', () => {
    expect(sanitizeAssignment({ ...base, dueTime: '17:00' }).dueTime).toBe('17:00');
  });

  test('omits dueTime when invalid', () => {
    const out = sanitizeAssignment({ ...base, dueTime: '25:00' });
    expect(out.dueTime).toBeUndefined();
  });

  test('omits dueTime when absent', () => {
    const out = sanitizeAssignment(base);
    expect(out.dueTime).toBeUndefined();
  });
});

describe('rowsMatch — dueTime inclusion', () => {
  test('returns false when dueTime differs', () => {
    expect(rowsMatch({ ...BASE, dueTime: '09:00' }, { ...BASE, dueTime: '17:00' })).toBe(false);
  });

  test('treats undefined and null dueTime as the same', () => {
    const noDueTime = { ...BASE };
    delete noDueTime.dueTime;
    expect(rowsMatch({ ...BASE, dueTime: null }, noDueTime)).toBe(true);
    expect(rowsMatch({ ...BASE, dueTime: undefined }, noDueTime)).toBe(true);
  });

  test('returns true when both have the same dueTime', () => {
    expect(rowsMatch({ ...BASE, dueTime: '14:30' }, { ...BASE, dueTime: '14:30' })).toBe(true);
  });
});

describe('rowsMatch — complexity inclusion', () => {
  test('returns false when complexity differs between known values', () => {
    expect(rowsMatch(
      { ...BASE, complexity: 'short' },
      { ...BASE, complexity: 'long' },
    )).toBe(false);
  });

  test('treats undefined and "medium" as the same value (pre-migration row vs default)', () => {
    const withoutComplexity = { ...BASE };
    delete withoutComplexity.complexity;
    expect(rowsMatch(withoutComplexity, { ...BASE, complexity: 'medium' })).toBe(true);
  });

  test('treats null and "medium" as the same value', () => {
    expect(rowsMatch({ ...BASE, complexity: null }, { ...BASE, complexity: 'medium' })).toBe(true);
  });
});

describe('rowsMatch', () => {
  test('returns true for identical objects', () => {
    expect(rowsMatch(BASE, { ...BASE })).toBe(true);
  });

  test('ignores reminderIds — device-local field excluded from DB comparison', () => {
    expect(rowsMatch(
      { ...BASE, reminderIds: ['old-id'] },
      { ...BASE, reminderIds: ['new-id'] }
    )).toBe(true);
  });

  test('returns false when any mapped field differs', () => {
    expect(rowsMatch(BASE, { ...BASE, title: 'Other' })).toBe(false);
    expect(rowsMatch(BASE, { ...BASE, course: 'MATH' })).toBe(false);
    expect(rowsMatch(BASE, { ...BASE, dueDate: '2026-10-01' })).toBe(false);
    expect(rowsMatch(BASE, { ...BASE, importance: 1 })).toBe(false);
    expect(rowsMatch(BASE, { ...BASE, status: 'completed' })).toBe(false);
    expect(rowsMatch(BASE, { ...BASE, seriesId: 'other-series' })).toBe(false);
  });

  test('treats undefined and null seriesId as the same (both map to null)', () => {
    const noSeries = { ...BASE };
    delete noSeries.seriesId;
    expect(rowsMatch({ ...BASE, seriesId: null }, noSeries)).toBe(true);
    expect(rowsMatch({ ...BASE, seriesId: undefined }, noSeries)).toBe(true);
  });

  test('returns false when either argument is null/undefined', () => {
    expect(rowsMatch(null, BASE)).toBe(false);
    expect(rowsMatch(BASE, null)).toBe(false);
    expect(rowsMatch(null, null)).toBe(false);
  });
});
