import { complexityLabel, dueDateLabel } from '../../lib/displayHelpers';

// Fixed reference date — all tests pass this as `today` so results never
// depend on the real clock.
const TODAY = new Date('2026-06-01T12:00:00');

// ---------------------------------------------------------------------------
// complexityLabel
// ---------------------------------------------------------------------------
describe('complexityLabel', () => {
  test.each([
    ['short',  'Short'],
    ['medium', 'Medium'],
    ['long',   'Long'],
  ])('key "%s" returns "%s"', (key, expected) => {
    expect(complexityLabel(key)).toBe(expected);
  });

  test('unknown key falls back to "Medium" (pre-migration compat)', () => {
    expect(complexityLabel(undefined)).toBe('Medium');
    expect(complexityLabel(null)).toBe('Medium');
    expect(complexityLabel('')).toBe('Medium');
    expect(complexityLabel('huge')).toBe('Medium');
  });
});

// ---------------------------------------------------------------------------
// dueDateLabel
// ---------------------------------------------------------------------------
describe('dueDateLabel', () => {
  test('overdue: negative days → urgent red label', () => {
    expect(dueDateLabel('2026-05-28', TODAY)).toEqual({ text: 'Overdue', urgent: true });
  });

  test('due today: 0 days → urgent', () => {
    expect(dueDateLabel('2026-06-01', TODAY)).toEqual({ text: 'Due today', urgent: true });
  });

  test('due tomorrow: 1 day → urgent', () => {
    expect(dueDateLabel('2026-06-02', TODAY)).toEqual({ text: 'Due tomorrow', urgent: true });
  });

  test('due in 2–7 days → "Due in N days", not urgent', () => {
    expect(dueDateLabel('2026-06-03', TODAY)).toEqual({ text: 'Due in 2 days', urgent: false });
    expect(dueDateLabel('2026-06-08', TODAY)).toEqual({ text: 'Due in 7 days', urgent: false });
  });

  test('due in 8+ days → shows the ISO date, not urgent', () => {
    expect(dueDateLabel('2026-06-09', TODAY)).toEqual({ text: 'Due 2026-06-09', urgent: false });
    expect(dueDateLabel('2026-12-31', TODAY)).toEqual({ text: 'Due 2026-12-31', urgent: false });
  });

  test('invalid date string: falls back gracefully, not urgent', () => {
    expect(dueDateLabel('not-a-date', TODAY)).toEqual({ text: 'Due not-a-date', urgent: false });
    expect(dueDateLabel('', TODAY)).toEqual({ text: 'Due ', urgent: false });
  });

  test('defaults today to new Date() when omitted (smoke test — just checks shape)', () => {
    const result = dueDateLabel('2099-01-01');
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('urgent');
    expect(typeof result.text).toBe('string');
    expect(typeof result.urgent).toBe('boolean');
  });
});
