import { differenceInCalendarDays, parseISO } from 'date-fns';
import { DEFAULT_COMPLEXITY } from './assignment';

// ---------------------------------------------------------------------------
// Assignment priority / ordering
//
// Two consumers:
//   - sortForList     — full list display (chronological, predictable)
//   - pickWorkOnNext  — single "work on this next" card (urgency-adjusted)
//
// Both functions are pure: they take the full assignments array and an
// optional `today` reference date (defaults to new Date(); pass explicitly
// in tests to avoid clock-dependent failures).
// ---------------------------------------------------------------------------

// How many days of lead time each complexity level needs. A Long assignment
// due in 5 days competes with a Short due in 3 days because the Long one
// must be started sooner. Surfaces as adjustedDaysUntilDue below.
//
// These weights are intentionally small integers so the algorithm is easy
// to reason about without a spreadsheet. Adjust here if the recommendation
// feel needs tuning — no other file needs to change.
export const COMPLEXITY_BUFFER = {
  short:  0,  // fine to start the night before
  medium: 1,  // start a day early
  long:   2,  // start two days early
};

// Converts a valid "HH:MM" dueTime to minutes since midnight (0–1439).
// Returns null when dueTime is absent or invalid so callers can apply
// different fallbacks for display vs urgency contexts.
function dueMinutes(assignment) {
  const t = assignment.dueTime;
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return null;
  const h = Number(t.slice(0, 2));
  const m = Number(t.slice(3));
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

// Adjusted urgency: raw calendar days minus the complexity lead-time buffer,
// plus a sub-day fractional component for consistent time ordering.
// No-time rows fall back to 23:59 (same as sortForList) so a no-time
// same-day assignment never incorrectly surfaces ahead of an earlier explicit
// time in pickWorkOnNext. Can be negative (overdue rows).
export function adjustedDaysUntilDue(assignment, today = new Date()) {
  const raw = differenceInCalendarDays(parseISO(assignment.dueDate), today);
  const buffer = COMPLEXITY_BUFFER[assignment.complexity] ?? COMPLEXITY_BUFFER[DEFAULT_COMPLEXITY];
  const mins = dueMinutes(assignment) ?? (23 * 60 + 59); // 23:59 fallback
  return raw - buffer + mins / (24 * 60);
}

// ---------------------------------------------------------------------------
// sortForList
//
// Display order for the full assignment list.
//
//   Primary  : raw dueDate ASC (predictable chronological scroll)
//   Secondary: complexity DESC — long before short on the same day
//              (a Long assignment due today is more urgent than Short today)
//   Tertiary : importance DESC
//
// Completed assignments are always appended at the end regardless of date.
// ---------------------------------------------------------------------------
const COMPLEXITY_RANK = { long: 0, medium: 1, short: 2 };

export function sortForList(assignments) {
  const incomplete = assignments.filter(a => a.status !== 'completed');
  const completed  = assignments.filter(a => a.status === 'completed');

  const sortedIncomplete = incomplete.slice().sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    // Same day: sort by due time ascending; no-time rows treated as 23:59
    // so explicitly-timed assignments always appear before undated ones.
    const timeA = dueMinutes(a) ?? (23 * 60 + 59);
    const timeB = dueMinutes(b) ?? (23 * 60 + 59);
    if (timeA !== timeB) return timeA - timeB;
    const rankA = COMPLEXITY_RANK[a.complexity] ?? COMPLEXITY_RANK.medium;
    const rankB = COMPLEXITY_RANK[b.complexity] ?? COMPLEXITY_RANK.medium;
    if (rankA !== rankB) return rankA - rankB;       // lower rank = higher complexity
    return b.importance - a.importance;
  });

  return [...sortedIncomplete, ...completed];
}

// ---------------------------------------------------------------------------
// pickWorkOnNext
//
// Selects the single highest-priority incomplete assignment to feature in
// the "Work on next" card. Uses adjusted urgency so a longer assignment
// due a bit later can surface before a shorter one due sooner.
//
//   Primary  : adjustedDaysUntilDue ASC (lower = more urgent after lead-time)
//   Secondary: importance DESC
//   Tertiary : raw dueDate ASC (final tiebreaker when everything else ties)
//
// Returns null when there are no incomplete assignments.
// `today` can be injected for deterministic tests.
// ---------------------------------------------------------------------------
export function pickWorkOnNext(assignments, today = new Date()) {
  const incomplete = assignments.filter(a => a.status !== 'completed');
  if (incomplete.length === 0) return null;

  return incomplete.slice().sort((a, b) => {
    const adjA = adjustedDaysUntilDue(a, today);
    const adjB = adjustedDaysUntilDue(b, today);
    if (adjA !== adjB) return adjA - adjB;
    if (b.importance !== a.importance) return b.importance - a.importance;
    return a.dueDate.localeCompare(b.dueDate);
  })[0];
}
