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

// Days-until-due with NO complexity buffer applied. Used as the "due date"
// ranking factor for any NON-default ranking — see FACTOR_COMPARATORS.dueDate
// below for why.
function rawDaysUntilDue(assignment, today = new Date()) {
  return daysUntilDueWithBuffer(assignment, today, 0);
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

// Default order when a user hasn't set a preference. Its dueDate factor
// specifically reuses the pre-ranking buffered due-date score (see
// FACTOR_COMPARATORS.dueDate's useBuffered below) — the pre-ranking
// pickWorkOnNext itself never had a complexity tiebreaker at all, so this
// isn't a full bit-for-bit reproduction; see the note on pickWorkOnNext.
export const DEFAULT_RANKING = ['dueDate', 'importance', 'complexity'];

function isValidRankingShape(ranking) {
  return Array.isArray(ranking)
    && ranking.length === RANKING_FACTORS.length
    && RANKING_FACTORS.every(f => ranking.includes(f));
}

function rankingsEqual(a, b) {
  return a.length === b.length && a.every((factor, i) => factor === b[i]);
}

// Each comparator returns <0 when `a` should sort before `b` for that factor
// alone; 0 means "tied on this factor, fall through to the next one".
//
// dueDate's `useBuffered` flag: true only for DEFAULT_RANKING itself, so the
// out-of-the-box due-date score matches the pre-ranking adjustedDaysUntilDue
// exactly (complexity's lead-time buffer folded in). This is the only piece
// of pre-ranking behavior preserved on purpose — pickWorkOnNext itself never
// had a complexity tiebreaker at all before this feature, so DEFAULT_RANKING
// is not a full bit-for-bit reproduction (see the note on pickWorkOnNext).
// Any ranking a user actually customizes gets the raw (unbuffered) due date
// instead — otherwise complexity would silently influence the dueDate
// comparison a second time whenever dueDate outranks complexity in a custom
// order, on top of complexity's own factor further down the list,
// contradicting the "independent successive tiebreakers" model documented
// on pickWorkOnNext below.
const FACTOR_COMPARATORS = {
  dueDate: (a, b, today, useBuffered) => {
    const scoreFn = useBuffered ? adjustedDaysUntilDue : rawDaysUntilDue;
    return scoreFn(a, today) - scoreFn(b, today);
  },
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
// successive, independent tiebreakers (first factor decides unless tied,
// then the next, and so on). Falls back to raw dueDate ASC as a final
// tiebreaker when every ranked factor ties.
//
// One exception: for DEFAULT_RANKING specifically, the dueDate factor reuses
// the pre-ranking buffered due-date score (see FACTOR_COMPARATORS.dueDate's
// useBuffered) rather than being fully independent of complexity. This is
// NOT a claim that DEFAULT_RANKING reproduces the old pickWorkOnNext
// bit-for-bit — the old function never had a complexity tiebreaker at all,
// so DEFAULT_RANKING (complexity ranked last) now breaks urgency+importance
// ties by complexity where the old code fell straight to raw due date; see
// the "complexity ranked third by default" test in ordering.test.js. Any
// non-default ranking gets fully independent factors throughout.
//
// Returns null when there are no incomplete assignments.
// `today` can be injected for deterministic tests. `ranking` defaults to
// DEFAULT_RANKING and falls back to it if malformed (wrong length/keys).
// ---------------------------------------------------------------------------
export function pickWorkOnNext(assignments, today = new Date(), ranking = DEFAULT_RANKING) {
  const incomplete = assignments.filter(a => a.status !== 'completed');
  if (incomplete.length === 0) return null;

  const factors = isValidRankingShape(ranking) ? ranking : DEFAULT_RANKING;
  const useBuffered = rankingsEqual(factors, DEFAULT_RANKING);

  return incomplete.slice().sort((a, b) => {
    for (const factor of factors) {
      const cmp = factor === 'dueDate'
        ? FACTOR_COMPARATORS.dueDate(a, b, today, useBuffered)
        : FACTOR_COMPARATORS[factor](a, b, today);
      if (cmp !== 0) return cmp;
    }
    return a.dueDate.localeCompare(b.dueDate);
  })[0];
}
