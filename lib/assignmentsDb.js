import { supabase } from './supabase';

// Single source of truth for the app-field ↔ DB-column mapping.
// Add a new field here and `fromDb` / `toDb` / `dbUpdate` all pick it up.
const FIELD_MAP = [
  { app: 'title',      db: 'title' },
  { app: 'course',     db: 'class_name' },
  { app: 'dueDate',    db: 'due_date' },
  { app: 'importance', db: 'importance' },
  { app: 'status',     db: 'status' },
  { app: 'complexity', db: 'complexity' },
  { app: 'seriesId',   db: 'series_id', nullable: true },
  { app: 'dueTime',    db: 'due_time',  nullable: true },
  // The recurrence rule that generated a series row (jsonb; see
  // lib/recurring.js for the shape). Stored verbatim on every row of the
  // series; null on standalone assignments and on rows created before the
  // 2026-07-28 migration.
  { app: 'recurrenceRule', db: 'recurrence_rule', nullable: true },
];

export function fromDb(row) {
  const out = { id: row.id };
  for (const { app, db, nullable } of FIELD_MAP) {
    const value = row[db];
    if (nullable && (value === null || value === undefined)) continue;
    out[app] = value;
  }
  return out;
}

function toDb(a, userId) {
  const out = { user_id: userId };
  // Client-generated UUIDs (see lib/uuid.js) are passed through when the
  // caller supplies one. The DB column still defaults via gen_random_uuid()
  // when `id` is omitted, so legacy callers keep working.
  if (a.id !== undefined) out.id = a.id;
  for (const { app, db, nullable } of FIELD_MAP) {
    const value = a[app];
    if (value === undefined) {
      if (nullable) out[db] = null;
      continue;
    }
    out[db] = value;
  }
  return out;
}

function changesToDb(changes) {
  const payload = {};
  for (const { app, db } of FIELD_MAP) {
    if (changes[app] !== undefined) payload[db] = changes[app];
  }
  return payload;
}

// Fetch all assignments for the logged-in user, ordered by due date
export async function dbFetch(userId) {
  const { data, error } = await supabase
    .from('assignments')
    .select('*')
    .eq('user_id', userId)
    .order('due_date', { ascending: true });
  if (error) throw error;
  return data.map(fromDb);
}

// Insert a single assignment; returns the saved row with its DB-generated UUID
export async function dbInsert(assignment, userId) {
  const { data, error } = await supabase
    .from('assignments')
    .insert(toDb(assignment, userId))
    .select()
    .single();
  if (error) throw error;
  return fromDb(data);
}

// Insert multiple assignments at once (for recurring series)
export async function dbInsertMany(assignments, userId) {
  const { data, error } = await supabase
    .from('assignments')
    .insert(assignments.map(a => toDb(a, userId)))
    .select();
  if (error) throw error;
  return data.map(fromDb);
}

// Update any subset of mapped fields by id
export async function dbUpdate(id, userId, changes) {
  const { data, error } = await supabase
    .from('assignments')
    .update(changesToDb(changes))
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return fromDb(data);
}

// Delete a single assignment by id
export async function dbDelete(id, userId) {
  const { error } = await supabase
    .from('assignments')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

// Delete every assignment belonging to a recurring series
export async function dbDeleteSeries(seriesId, userId) {
  const { error } = await supabase
    .from('assignments')
    .delete()
    .eq('series_id', seriesId)
    .eq('user_id', userId);
  if (error) throw error;
}

// "Edit this and all future occurrences": one atomic server-side UPDATE over
// the tail of a series (due_date >= fromDateISO), applying the uniform base
// fields and shifting each row's due_date by dayDelta days. Runs through the
// update_series_from RPC (db/migrations/2026-07-28_update_series_from.sql)
// because PostgREST can't express per-row date arithmetic and 52 individual
// updates would be slow and non-atomic. No userId parameter here: the RPC
// is SECURITY INVOKER (RLS scopes it to the caller's rows) and its WHERE
// additionally pins user_id = auth.uid() server-side — the client has
// nothing to contribute to that filter.
// `status` is applied only to the edited row (targetId) — the tail keeps
// each occurrence's own completion state.
// Returns the updated rows (full server rows, mapped through fromDb).
export async function dbUpdateSeriesFrom(seriesId, fromDateISO, dayDelta, targetId, base) {
  const { data, error } = await supabase.rpc('update_series_from', {
    p_series_id: seriesId,
    p_from_date: fromDateISO,
    p_day_delta: dayDelta,
    p_title: base.title,
    p_class_name: base.course,
    p_importance: base.importance,
    p_complexity: base.complexity,
    p_due_time: base.dueTime ?? null,
    p_target_id: targetId,
    p_status: base.status,
  });
  if (error) throw error;
  return (data ?? []).map(fromDb);
}
