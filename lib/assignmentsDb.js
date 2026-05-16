import { supabase } from './supabase';

// Single source of truth for the app-field ↔ DB-column mapping.
// Add a new field here and `fromDb` / `toDb` / `dbUpdate` all pick it up.
const FIELD_MAP = [
  { app: 'title',      db: 'title' },
  { app: 'course',     db: 'class_name' },
  { app: 'dueDate',    db: 'due_date' },
  { app: 'importance', db: 'importance' },
  { app: 'status',     db: 'status' },
  { app: 'seriesId',   db: 'series_id', nullable: true },
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
