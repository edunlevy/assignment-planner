import { isValidDate, sanitizeAssignment } from '../../lib/assignment';

describe('isValidDate', () => {
  test('accepts a well-formed YYYY-MM-DD', () => {
    expect(isValidDate('2026-05-15')).toBe(true);
  });

  test('accepts a leap day on a leap year', () => {
    expect(isValidDate('2028-02-29')).toBe(true);
  });

  test('rejects a leap day on a non-leap year', () => {
    expect(isValidDate('2027-02-29')).toBe(false);
  });

  test('rejects out-of-range months and days', () => {
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-00-10')).toBe(false);
    expect(isValidDate('2026-04-31')).toBe(false);
    expect(isValidDate('2026-12-32')).toBe(false);
  });

  test('rejects wrong shape / empty / non-string', () => {
    expect(isValidDate('')).toBe(false);
    expect(isValidDate('2026/05/15')).toBe(false);
    expect(isValidDate('20260515')).toBe(false);
    expect(isValidDate(null)).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
    expect(isValidDate(20260515)).toBe(false);
  });
});

describe('sanitizeAssignment', () => {
  const base = {
    id: 'a1',
    title: 'Read chapter 3',
    course: 'HIST 101',
    dueDate: '2026-06-01',
  };

  test('keeps a valid assignment and fills defaults', () => {
    const out = sanitizeAssignment({ ...base });
    expect(out).toMatchObject({
      id: 'a1',
      title: 'Read chapter 3',
      course: 'HIST 101',
      dueDate: '2026-06-01',
      importance: 3,
      status: 'not_started',
      complexity: 'medium',
      reminderIds: [],
    });
  });

  test('clamps invalid importance to default 3', () => {
    expect(sanitizeAssignment({ ...base, importance: 0 }).importance).toBe(3);
    expect(sanitizeAssignment({ ...base, importance: 6 }).importance).toBe(3);
    expect(sanitizeAssignment({ ...base, importance: 'high' }).importance).toBe(3);
    expect(sanitizeAssignment({ ...base, importance: 2.5 }).importance).toBe(3);
  });

  test('keeps importance within 1..5 inclusive', () => {
    expect(sanitizeAssignment({ ...base, importance: 1 }).importance).toBe(1);
    expect(sanitizeAssignment({ ...base, importance: 5 }).importance).toBe(5);
  });

  test('falls back to not_started for unknown status', () => {
    expect(sanitizeAssignment({ ...base, status: 'bogus' }).status).toBe('not_started');
  });

  test('keeps the known statuses', () => {
    for (const s of ['not_started', 'in_progress', 'completed']) {
      expect(sanitizeAssignment({ ...base, status: s }).status).toBe(s);
    }
  });

  test('keeps an array of reminderIds, drops anything else', () => {
    expect(sanitizeAssignment({ ...base, reminderIds: ['n1', 'n2'] }).reminderIds)
      .toEqual(['n1', 'n2']);
    expect(sanitizeAssignment({ ...base, reminderIds: 'oops' }).reminderIds).toEqual([]);
  });

  test('rejects rows missing required fields or with a bad date', () => {
    expect(sanitizeAssignment(null)).toBeNull();
    expect(sanitizeAssignment({})).toBeNull();
    expect(sanitizeAssignment({ ...base, id: undefined })).toBeNull();
    expect(sanitizeAssignment({ ...base, title: '' })).toBeNull();
    expect(sanitizeAssignment({ ...base, course: '' })).toBeNull();
    expect(sanitizeAssignment({ ...base, dueDate: '2026-13-99' })).toBeNull();
  });
});
