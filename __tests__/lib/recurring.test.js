import {
  MAX_WEEKLY_OCCURRENCES,
  buildWeeklySeries,
  countWeeklyOccurrences,
} from '../../lib/recurring';

describe('countWeeklyOccurrences', () => {
  test('counts 1 when start === until', () => {
    expect(countWeeklyOccurrences('2026-01-05', '2026-01-05')).toBe(1);
  });

  test('counts 1 when until is before start', () => {
    expect(countWeeklyOccurrences('2026-01-12', '2026-01-05')).toBe(0);
  });

  test('counts a typical 4-week stretch', () => {
    // Jan 5 + (0,7,14,21) days = 4 weekly occurrences through Jan 26
    expect(countWeeklyOccurrences('2026-01-05', '2026-01-26')).toBe(4);
  });

  test('caps near MAX_WEEKLY_OCCURRENCES + safety margin', () => {
    // 5 years of weekly recurrences — should bail out at safety bound.
    const n = countWeeklyOccurrences('2026-01-01', '2031-01-01');
    expect(n).toBeLessThanOrEqual(MAX_WEEKLY_OCCURRENCES + 2);
  });
});

describe('buildWeeklySeries', () => {
  test('produces weekly drafts inheriting base fields', () => {
    const drafts = buildWeeklySeries({
      startISO: '2026-01-05',
      untilISO: '2026-01-26',
      base: { title: 'Reading', course: 'HIST', importance: 2, status: 'not_started' },
      seriesId: 'series-1',
    });
    expect(drafts).toHaveLength(4);
    expect(drafts.map(d => d.dueDate)).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
    ]);
    for (const d of drafts) {
      expect(d.title).toBe('Reading');
      expect(d.course).toBe('HIST');
      expect(d.seriesId).toBe('series-1');
    }
  });

  test('returns a single occurrence when start === until', () => {
    const drafts = buildWeeklySeries({
      startISO: '2026-03-01',
      untilISO: '2026-03-01',
      base: { title: 'x', course: 'y' },
      seriesId: 's',
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].dueDate).toBe('2026-03-01');
  });

  test('returns [] when until is before start', () => {
    const drafts = buildWeeklySeries({
      startISO: '2026-03-08',
      untilISO: '2026-03-01',
      base: { title: 'x', course: 'y' },
      seriesId: 's',
    });
    expect(drafts).toEqual([]);
  });

  test('truncates at MAX_WEEKLY_OCCURRENCES', () => {
    const drafts = buildWeeklySeries({
      startISO: '2026-01-01',
      untilISO: '2031-01-01',
      base: { title: 'x', course: 'y' },
      seriesId: 's',
    });
    expect(drafts.length).toBe(MAX_WEEKLY_OCCURRENCES);
  });

  test('crosses a DST boundary without doubling/skipping a week', () => {
    // US DST 2026 begins March 8. Start in late Feb, end in mid-March.
    const drafts = buildWeeklySeries({
      startISO: '2026-02-22',
      untilISO: '2026-03-15',
      base: { title: 'x', course: 'y' },
      seriesId: 's',
    });
    expect(drafts.map(d => d.dueDate)).toEqual([
      '2026-02-22',
      '2026-03-01',
      '2026-03-08',
      '2026-03-15',
    ]);
  });
});
