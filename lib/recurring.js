import { addWeeks, format, isAfter, parseISO } from 'date-fns';

// Hard cap on occurrences from a single recurring series entry.
// Applies regardless of interval (weekly or biweekly). Surfaced to the UI
// so we can warn instead of silently truncating.
export const MAX_WEEKLY_OCCURRENCES = 52;

// Count how many occurrences a (startISO, untilISO) window would produce at
// the given interval, without applying the cap. Used by form validation.
// intervalWeeks defaults to 1 (weekly) for backward compatibility.
export function countWeeklyOccurrences(startISO, untilISO, intervalWeeks = 1) {
  const start = parseISO(startISO);
  const until = parseISO(untilISO);
  let count = 0;
  let current = start;
  while (!isAfter(current, until)) {
    count++;
    current = addWeeks(current, intervalWeeks);
    if (count > MAX_WEEKLY_OCCURRENCES + 1) break; // safety
  }
  return count;
}

// Produce the per-occurrence draft list for a recurring series.
// Returns at most MAX_WEEKLY_OCCURRENCES entries.
// intervalWeeks defaults to 1 (weekly) for backward compatibility.
export function buildWeeklySeries({ startISO, untilISO, base, seriesId, intervalWeeks = 1 }) {
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
    current = addWeeks(current, intervalWeeks);
  }
  return drafts;
}
