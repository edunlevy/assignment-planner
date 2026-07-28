import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  getDay,
  getDaysInMonth,
  isAfter,
  isBefore,
  parseISO,
  setDate,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

// Hard cap on occurrences from a single recurring series entry, regardless
// of frequency/interval. Surfaced to the UI so we can warn instead of
// silently truncating.
export const MAX_OCCURRENCES = 52;

// Hard cap on the every-N interval (weeks or months). The UI stepper clamps
// to this, but the generator must clamp too: a stored rule is arbitrary
// jsonb read back from the DB (F3b), and an unbounded interval makes the
// weekly day-scan effectively (or with Infinity, literally) endless and
// overflows Date in the monthly branch. Every scan bound below is only an
// absolute bound BECAUSE interval is capped first.
export const MAX_INTERVAL = 12;

// Normalize an untrusted rule.interval to an integer in [1, MAX_INTERVAL].
function clampInterval(raw) {
  if (!Number.isFinite(raw)) return 1;
  return Math.min(MAX_INTERVAL, Math.max(1, Math.floor(raw)));
}

// A recurrence rule describes how a series repeats:
//
//   {
//     freq: 'weekly' | 'monthly',
//     interval: N >= 1,                 // every N weeks / months
//     byWeekday?: [0..6, ...],          // weekly only; 0=Sun..6=Sat (getDay
//                                       // convention). Absent/empty = the
//                                       // start date's own weekday.
//     end: { untilISO: 'YYYY-MM-DD' }   // inclusive end date
//        | { count: N >= 1 },           // total number of occurrences
//   }
//
// The same rule object is stored verbatim on every row of the series
// (assignments.recurrence_rule) so future features — editing a series'
// recurrence, regenerating the tail — can recover how it was built.
//
// Semantics:
// - Occurrences are the pattern's matching dates ON OR AFTER the start date;
//   the start date itself is included only when it matches (e.g. a Tuesday
//   start with byWeekday [Mon, Fri] begins on the following Friday).
// - Weekly weeks are anchored to the calendar week containing the start date
//   (date-fns startOfWeek, Sunday-based): "every 2 weeks on Mon+Wed" means
//   Mon+Wed of the start week, then Mon+Wed two calendar weeks later, even
//   when the start date falls mid-week.
// - Monthly repeats on the start date's day-of-month; months that lack that
//   day (29/30/31) are skipped entirely rather than clamped — the simplest
//   rule to explain, matching most planners.

// The scans below walk day-by-day (weekly) or month-by-month (monthly), so
// bound the horizon defensively: enough to hold MAX_OCCURRENCES at the given
// (already-clamped) interval plus slack. With interval capped at
// MAX_INTERVAL these are absolute bounds (~4.5k days / ~1.3k months), so a
// malformed rule that slips past validation — byWeekday values that can
// never match, a bogus end — terminates instead of hanging.
function weeklyScanLimitDays(interval) {
  return (MAX_OCCURRENCES + 2) * interval * 7 + 14;
}

// Worst monthly skip rate is day-31 (7 qualifying months in 12), so double
// the occurrence budget in months comfortably covers every day-of-month.
function monthlyScanLimitMonths(interval) {
  return (MAX_OCCURRENCES + 2) * 2 * interval;
}

// All occurrence dates (ISO strings, chronological) for a rule, capped at
// `limit`. countOccurrences passes limit = MAX_OCCURRENCES + 1 so callers
// can distinguish "at the cap" from "over the cap"; buildSeries uses the
// cap itself.
function occurrenceDates(startISO, rule, limit) {
  const start = parseISO(startISO);
  const until = rule.end.untilISO !== undefined ? parseISO(rule.end.untilISO) : null;
  const target = rule.end.count !== undefined ? Math.min(rule.end.count, limit) : limit;
  const interval = clampInterval(rule.interval);
  const dates = [];

  if (rule.freq === 'monthly') {
    const dayOfMonth = start.getDate();
    const anchorMonth = startOfMonth(start);
    const scanLimit = monthlyScanLimitMonths(interval);
    for (let k = 0; dates.length < target && k < scanLimit; k++) {
      const month = addMonths(anchorMonth, k * interval);
      if (until && isAfter(month, until)) break;
      if (getDaysInMonth(month) < dayOfMonth) continue;
      const d = setDate(month, dayOfMonth);
      if (isBefore(d, start)) continue;
      if (until && isAfter(d, until)) break;
      dates.push(format(d, 'yyyy-MM-dd'));
    }
    return dates;
  }

  const weekdays = rule.byWeekday?.length
    ? new Set(rule.byWeekday)
    : new Set([getDay(start)]);
  const anchor = startOfWeek(start);
  const scanLimit = weeklyScanLimitDays(interval);
  let d = start;
  for (let scanned = 0; dates.length < target && scanned < scanLimit; scanned++) {
    if (until && isAfter(d, until)) break;
    const weekIndex = Math.floor(differenceInCalendarDays(startOfWeek(d), anchor) / 7);
    if (weekIndex % interval === 0 && weekdays.has(getDay(d))) {
      dates.push(format(d, 'yyyy-MM-dd'));
    }
    d = addDays(d, 1);
  }
  return dates;
}

// Count a rule's occurrences for form validation, without applying the cap.
// Bounded at MAX_OCCURRENCES + 1: any return value above MAX_OCCURRENCES
// means "over the cap" — the exact overshoot is irrelevant to the error
// message and unbounded counting would defeat the scan limits.
export function countOccurrences(startISO, rule) {
  return occurrenceDates(startISO, rule, MAX_OCCURRENCES + 1).length;
}

// Produce the per-occurrence draft list for a recurring series. Each draft
// carries the shared seriesId and the rule itself (stored per-row as
// recurrence_rule). Returns at most MAX_OCCURRENCES entries.
export function buildSeries({ startISO, base, seriesId, rule }) {
  return occurrenceDates(startISO, rule, MAX_OCCURRENCES).map(dueDate => ({
    ...base,
    dueDate,
    seriesId,
    recurrenceRule: rule,
  }));
}
