import { addWeeks, format, isAfter, parseISO } from 'date-fns';

// Hard cap on weekly recurrences from a single "repeat until" entry.
// Surfaced to the UI so we can warn instead of silently truncating.
export const MAX_WEEKLY_OCCURRENCES = 52;

// Count how many weekly occurrences a (startISO, untilISO) window would
// produce without applying the cap. Used by form validation.
export function countWeeklyOccurrences(startISO, untilISO) {
  const start = parseISO(startISO);
  const until = parseISO(untilISO);
  let count = 0;
  let current = start;
  while (!isAfter(current, until)) {
    count++;
    current = addWeeks(current, 1);
    if (count > MAX_WEEKLY_OCCURRENCES + 1) break; // safety
  }
  return count;
}

// Produce the per-occurrence draft list for a recurring series.
// Returns at most MAX_WEEKLY_OCCURRENCES entries.
export function buildWeeklySeries({ startISO, untilISO, base, seriesId }) {
  const start = parseISO(startISO);
  const until = parseISO(untilISO);
  const drafts = [];
  let current = start;
  while (!isAfter(current, until) && drafts.length < MAX_WEEKLY_OCCURRENCES) {
    drafts.push({
      ...base,
      dueDate: format(current, 'yyyy-MM-dd'),
      seriesId,
    });
    current = addWeeks(current, 1);
  }
  return drafts;
}
