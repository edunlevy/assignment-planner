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

// Shared day/time math behind adjustedDaysUntilDue and rawDaysUntilDue:
// raw calendar days minus a caller-supplied lead-time buffer, plus a sub-day
// fractional component for consistent time ordering. No-time rows fall back
// to 23:59 (same as sortForList).
//
// For same-day assignments the fractional component is computed relative to
// the current time of day, so an assignment due at 9 AM produces a negative
// score at 5 PM (matching the "Overdue" display in dueDateLabel) and an
// already-past-due assignment correctly surfaces ahead of future ones.
function daysUntilDueWithBuffer(assignment, today, buffer) {
  const raw = differenceInCalendarDays(parseISO(assignment.dueDate), today);
  const mins = dueMinutes(assignment) ?? (23 * 60 + 59);

  if (raw === 0) {
    // Same calendar day: compare against the actual current minute so that
    // an assignment whose time has passed gets a negative fractional score.
    const todayMins = today.getHours() * 60 + today.getMinutes();
    return (mins - todayMins) / (24 * 60) - buffer;
  }

  return raw - buffer + mins / (24 * 60);
}

// Adjusted urgency: days-until-due with the complexity lead-time buffer
// baked in, so a Long assignment "counts" as due sooner than its raw date.
export function adjustedDaysUntilDue(assignment, today = new Date()) {
  const buffer = COMPLEXITY_BUFFER[assignment.complexity] ?? COMPLEXITY_BUFFER[DEFAULT_COMPLEXITY];
  return daysUntilDueWithBuffer(assignment, today, buffer);
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

// The three factors a user can rank, in priority order, for pickWorkOnNext.
// Keep in sync with lib/preferencesDb.js's DB-side validation.
export const RANKING_FACTORS = ['dueDate', 'importance', 'complexity'];

// Default order when a user hasn't set a preference: reproduces the
// pre-ranking behavior exactly (see the dueDate comparator below).
export const DEFAULT_RANKING = ['dueDate', 'importance', 'complexity'];

function isValidRankingShape(ranking) {
  return Array.isArray(ranking)
    && ranking.length === RANKING_FACTORS.length
    && RANKING_FACTORS.every(f => ranking.includes(f));
}

// Each comparator returns <0 when `a` should sort before `b` for that factor
// alone; 0 means "tied on this factor, fall through to the next one".
//
// dueDate always uses the buffered (adjusted) score, even when complexity is
// ranked above due date. This isn't double-counting in practice: the buffer
// is a function of complexity alone, so for two assignments of the SAME
// complexity it cancels out of the comparison entirely (adjA - adjB reduces
// to rawA - rawB once the equal buffer subtracts out of both sides), and for
// assignments of DIFFERENT complexity the complexity factor already decides
// the order before dueDate is ever consulted whenever complexity outranks
// it. So a single buffered score works for every ranking, not just the
// default one.
const FACTOR_COMPARATORS = {
  dueDate: (a, b, today) => adjustedDaysUntilDue(a, today) - adjustedDaysUntilDue(b, today),
  importance: (a, b) => b.importance - a.importance,
  complexity: (a, b) => {
    const rankA = COMPLEXITY_RANK[a.complexity] ?? COMPLEXITY_RANK[DEFAULT_COMPLEXITY];
    const rankB = COMPLEXITY_RANK[b.complexity] ?? COMPLEXITY_RANK[DEFAULT_COMPLEXITY];
    return rankA - rankB; // lower rank = higher complexity (long) sorts first
  },
};

// ---------------------------------------------------------------------------
// pickWorkOnNext
//
// Selects the single highest-priority incomplete assignment to feature in
// the "Work on next" card, using the three factors in `ranking` order as
// successive tiebreakers (first factor decides unless tied, then the next,
// and so on). Falls back to raw dueDate ASC as a final tiebreaker when every
// ranked factor ties.
//
// Returns null when there are no incomplete assignments.
// `today` can be injected for deterministic tests. `ranking` defaults to
// DEFAULT_RANKING and falls back to it if malformed (wrong length/keys).
// ---------------------------------------------------------------------------
export function pickWorkOnNext(assignments, today = new Date(), ranking = DEFAULT_RANKING) {
  const incomplete = assignments.filter(a => a.status !== 'completed');
  if (incomplete.length === 0) return null;

  const factors = isValidRankingShape(ranking) ? ranking : DEFAULT_RANKING;

  return incomplete.slice().sort((a, b) => {
    for (const factor of factors) {
      const cmp = FACTOR_COMPARATORS[factor](a, b, today);
      if (cmp !== 0) return cmp;
    }
    return a.dueDate.localeCompare(b.dueDate);
  })[0];
}
