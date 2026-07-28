import { differenceInCalendarDays, parseISO } from 'date-fns';

// ---------------------------------------------------------------------------
// Assignment list filtering (course / due-range / complexity)
//
// Pure, no React/RN imports — applyFilters is called from App.js's list memo
// before sortForList runs. Filtering never touches workOnNext/incompleteCount,
// which stay computed from the unfiltered assignments list (see App.js).
// ---------------------------------------------------------------------------

export function emptyFilters() {
  return { courses: [], due: 'all', complexity: [] };
}

export function hasActiveFilters(filters) {
  return filters.courses.length > 0 || filters.due !== 'all' || filters.complexity.length > 0;
}

// Converts a valid "HH:MM" dueTime to minutes since midnight (0-1439).
// Returns null when dueTime is absent or invalid.
//
// Mirrors lib/ordering.js's private dueMinutes exactly — that file's
// rawDaysUntilDue is the source of truth for "overdue" in this app, but it
// isn't exported (and ordering.js is out of scope for this feature), so the
// small amount of day/time math is duplicated here rather than reimplemented
// differently.
function dueMinutes(assignment) {
  const t = assignment.dueTime;
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return null;
  const h = Number(t.slice(0, 2));
  const m = Number(t.slice(3));
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

// Signed "days until due" with no complexity buffer — negative once the
// assignment's due moment (dueTime, or end-of-day 23:59 when untimed) has
// passed. This is lib/ordering.js's rawDaysUntilDue, reproduced exactly so
// "overdue" here matches what the list's own ordering considers overdue.
function rawDaysUntilDue(assignment, now) {
  const raw = differenceInCalendarDays(parseISO(assignment.dueDate), now);
  const mins = dueMinutes(assignment) ?? (23 * 60 + 59);

  if (raw === 0) {
    const nowMins = now.getHours() * 60 + now.getMinutes();
    return (mins - nowMins) / (24 * 60);
  }

  return raw + mins / (24 * 60);
}

// Overdue = incomplete AND due strictly before `now`. Completed assignments
// are never overdue, regardless of date.
function isOverdue(assignment, now) {
  return assignment.status !== 'completed' && rawDaysUntilDue(assignment, now) < 0;
}

function isDueToday(assignment, now) {
  return differenceInCalendarDays(parseISO(assignment.dueDate), now) === 0;
}

// Within [today, today+6 days] inclusive (7-day window), local calendar days.
function isDueThisWeek(assignment, now) {
  const diff = differenceInCalendarDays(parseISO(assignment.dueDate), now);
  return diff >= 0 && diff <= 6;
}

const DUE_PREDICATES = {
  overdue: isOverdue,
  today: isDueToday,
  week: isDueThisWeek,
};

// Order-preserving filter over `assignments`. Each filter dimension is
// independent (AND'd together); an empty courses/complexity array or
// due: 'all' means "no constraint from that dimension".
export function applyFilters(assignments, filters, now = new Date()) {
  const { courses = [], due = 'all', complexity = [] } = filters;
  const duePredicate = DUE_PREDICATES[due];

  return assignments.filter(a => {
    if (courses.length > 0 && !courses.includes(a.course)) return false;
    if (complexity.length > 0 && !complexity.includes(a.complexity)) return false;
    if (duePredicate && !duePredicate(a, now)) return false;
    return true;
  });
}

// Unique, alphabetically sorted course names for the filter bar's course
// chips. Case-sensitive (matches applyFilters' exact-match course comparison)
// and excludes empty/whitespace-only course values.
export function distinctCourses(assignments) {
  const set = new Set();
  for (const a of assignments) {
    if (typeof a.course === 'string' && a.course.trim() !== '') set.add(a.course);
  }
  return [...set].sort();
}
