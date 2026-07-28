export const VALID_STATUSES = new Set(['not_started', 'in_progress', 'completed']);

// Complexity / length gauge — feeds the priority algorithm in lib/ordering.js
// (PR 4). 'medium' is the default for both new rows and pre-migration cached
// rows so the sanitizer never produces null/undefined here.
export const VALID_COMPLEXITIES = new Set(['short', 'medium', 'long']);
export const DEFAULT_COMPLEXITY = 'medium';

export function isValidTime(str) {
  if (typeof str !== 'string' || !/^\d{2}:\d{2}$/.test(str)) return false;
  const [h, m] = str.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function isValidDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function sanitizeAssignment(a) {
  if (!a || typeof a !== 'object') return null;
  if (!a.id || !a.title || !a.course || !a.dueDate) return null;
  if (!isValidDate(a.dueDate)) return null;
  return {
    ...a,
    importance: (Number.isInteger(a.importance) && a.importance >= 1 && a.importance <= 5)
      ? a.importance
      : 3,
    status: VALID_STATUSES.has(a.status) ? a.status : 'not_started',
    complexity: VALID_COMPLEXITIES.has(a.complexity) ? a.complexity : DEFAULT_COMPLEXITY,
    reminderIds: Array.isArray(a.reminderIds) ? a.reminderIds : [],
    dueTime: isValidTime(a.dueTime) ? a.dueTime : undefined,
  };
}

// Structural equality on the DB-mapped fields of two assignment objects.
// Used to detect whether a realtime UPDATE payload is the echo of our own
// write. reminderIds is excluded — it is device-local and not stored in DB.
//
// complexity is normalised to DEFAULT_COMPLEXITY on both sides so that a
// cached row from before the Phase E migration (no complexity field) is
// treated as equal to a freshly fetched row whose DB default is 'medium'.
// Without this normalisation, the realtime self-echo check could mis-fire
// on the first post-migration write and re-apply our own UPDATE.
// Order-blind canonical JSON for the (small) recurrence-rule object:
// Postgres jsonb does not preserve key order, so the same rule can round-trip
// back from the DB with its keys reordered — plain JSON.stringify comparison
// would call that a difference and defeat self-echo suppression.
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const body = Object.keys(value).sort()
      .map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function rowsMatch(a, b) {
  if (!a || !b) return false;
  return a.id === b.id
    && a.title === b.title
    && a.course === b.course
    && a.dueDate === b.dueDate
    && a.importance === b.importance
    && a.status === b.status
    && (a.complexity ?? DEFAULT_COMPLEXITY) === (b.complexity ?? DEFAULT_COMPLEXITY)
    && (a.seriesId ?? null) === (b.seriesId ?? null)
    && (a.dueTime ?? null) === (b.dueTime ?? null)
    // Structural, key-order-blind compare — see stableJson. Included so a
    // future rule edit (F3b) syncing from another device is never mistaken
    // for a self-echo and silently dropped.
    && stableJson(a.recurrenceRule ?? null) === stableJson(b.recurrenceRule ?? null);
}
