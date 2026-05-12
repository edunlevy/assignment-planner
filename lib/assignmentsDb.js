import { supabase } from './supabase';

// Convert a Supabase row → app assignment object
function fromDb(row) {
  return {
    id: row.id,
    title: row.title,
    course: row.class_name,
    dueDate: row.due_date,
    importance: row.importance,
    status: row.status,
    ...(row.series_id ? { seriesId: row.series_id } : {}),
  };
}

// Convert an app assignment → Supabase insert/update payload
function toDb(a, userId) {
  return {
    user_id: userId,
    class_name: a.course,
    title: a.title,
    due_date: a.dueDate,
    importance: a.importance,
    status: a.status,
    series_id: a.seriesId ?? null,
  };
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

// Update title, course, dueDate, importance, or status by id
export async function dbUpdate(id, userId, changes) {
  const payload = {};
  if (changes.title !== undefined)      payload.title      = changes.title;
  if (changes.course !== undefined)     payload.class_name = changes.course;
  if (changes.dueDate !== undefined)    payload.due_date   = changes.dueDate;
  if (changes.importance !== undefined) payload.importance = changes.importance;
  if (changes.status !== undefined)     payload.status     = changes.status;

  const { data, error } = await supabase
    .from('assignments')
    .update(payload)
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
