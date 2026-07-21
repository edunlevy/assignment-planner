import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { isValidTime } from './assignment';
import { currentDeviceTimezone } from './notifications';

// One-way (app → device calendar) sync: this file only ever creates/reads/
// updates/deletes events INSIDE the dedicated "Assignment Planner" calendar
// it owns. It never reads or modifies the user's other calendars or events —
// deliberately least-privilege (write-only access on iOS 17+).
//
// Not supported on web (no native calendar API); every export short-circuits
// on Platform.OS === 'web', mirroring lib/notifications.js's pattern.

const CALENDAR_TITLE = 'Assignment Planner';
const CALENDAR_COLOR = '#3B5BDB';

// Ask for calendar permission once; resolves to true/false.
export async function requestCalendarPermission() {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Calendar.getCalendarPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
}

// Find-or-create the dedicated calendar this app writes to. Always verifies
// against the live calendar list rather than trusting a cached id blindly —
// the user can delete the calendar out from under us via OS settings, and a
// stale cached id would make every subsequent create/update silently fail.
// Callers that mutate many assignments in a row should call this ONCE and
// reuse the id, not call it per-event — this function itself always does a
// full list scan for correctness, not speed.
export async function ensureAssignmentCalendar() {
  if (Platform.OS === 'web') return null;

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const existing = calendars.find(c => c.title === CALENDAR_TITLE && c.allowsModifications);
  if (existing) return existing.id;

  if (Platform.OS === 'ios') {
    const defaultSource = await Calendar.getDefaultCalendarSourceAsync();
    return Calendar.createCalendarAsync({
      title: CALENDAR_TITLE,
      color: CALENDAR_COLOR,
      entityType: Calendar.EntityTypes.EVENT,
      sourceId: defaultSource.id,
      source: defaultSource,
      name: CALENDAR_TITLE,
      ownerAccount: defaultSource.name,
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });
  }

  // Android has no "default source" concept for a brand-new local calendar —
  // a local (non-account-backed) source is created inline instead.
  return Calendar.createCalendarAsync({
    title: CALENDAR_TITLE,
    color: CALENDAR_COLOR,
    entityType: Calendar.EntityTypes.EVENT,
    source: { isLocalAccount: true, name: CALENDAR_TITLE, type: Calendar.SourceType.LOCAL },
    name: CALENDAR_TITLE,
    ownerAccount: 'personal',
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
}

// Builds the { title, notes, startDate, endDate, allDay, timeZone } shape
// expo-calendar's create/update calls expect. Timed assignments (dueTime
// set) get a 30-minute event at that time; untimed ones get a full all-day
// event on the due date (expo-calendar's all-day convention: startDate at
// local midnight, endDate at the following midnight).
function buildEventDetails(assignment) {
  const [y, m, d] = assignment.dueDate.split('-').map(Number);
  const timeZone = currentDeviceTimezone() ?? undefined;

  if (assignment.dueTime && isValidTime(assignment.dueTime)) {
    const [h, min] = assignment.dueTime.split(':').map(Number);
    const startDate = new Date(y, m - 1, d, h, min, 0);
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);
    return {
      title: assignment.title,
      notes: assignment.course,
      startDate,
      endDate,
      allDay: false,
      timeZone,
    };
  }

  return {
    title: assignment.title,
    notes: assignment.course,
    startDate: new Date(y, m - 1, d, 0, 0, 0),
    endDate: new Date(y, m - 1, d + 1, 0, 0, 0),
    allDay: true,
    timeZone,
  };
}

// Create a calendar event for an assignment. Returns the new event id, or
// null on failure (e.g. permission revoked mid-session, calendar deleted).
export async function createEventFor(assignment, calendarId) {
  if (Platform.OS === 'web' || !calendarId) return null;
  try {
    return await Calendar.createEventAsync(calendarId, buildEventDetails(assignment));
  } catch {
    return null;
  }
}

// Update an existing event in place. Returns false on failure — including
// "event not found" (e.g. the user deleted it manually in their calendar
// app). Callers should treat false as "the event is gone, create a fresh
// one" rather than retrying the update.
export async function updateEventFor(eventId, assignment) {
  if (Platform.OS === 'web' || !eventId) return false;
  try {
    await Calendar.updateEventAsync(eventId, buildEventDetails(assignment));
    return true;
  } catch {
    return false;
  }
}

// Delete a single event. Never throws — deleting an already-gone event
// (manually removed by the user) is a no-op, not an error.
//
// Returns true only once removal is CONFIRMED (by re-fetching the event by
// id), not merely once the delete call didn't throw — same reasoning as
// deleteAssignmentCalendar: expo-calendar's errors don't reliably
// distinguish "already gone" from a genuine failure, so a bare try/catch
// can't tell the caller whether the event might still be on the device.
// Unlike deleteAssignmentCalendar's list-based check, a by-id lookup
// throwing IS the normal "not found" signal (there's no separate list to
// fall back on), so that case is treated as confirmed deletion; a lookup
// that resolves means the event is still there.
export async function deleteEventFor(eventId) {
  if (Platform.OS === 'web' || !eventId) return true;
  try {
    await Calendar.deleteEventAsync(eventId);
  } catch {
    // Fall through to verification below — could be "already gone" or a
    // real failure. Don't guess from the error alone.
  }
  try {
    await Calendar.getEventAsync(eventId);
    return false;
  } catch {
    return true;
  }
}

// Delete the whole dedicated calendar (and every event in it). Used when
// the user turns sync off and chooses to remove what was created.
//
// Returns true only once removal is CONFIRMED (by re-checking the live
// calendar list), not merely once the delete call didn't throw. expo-
// calendar's errors don't reliably distinguish "already gone" (harmless)
// from a genuine failure (permission revoked, OS error) — the same
// ambiguity already noted on updateEventFor — so callers that need to
// know whether events might still be on the device can't trust a bare
// try/catch here. Returns false if the calendar is still found afterward,
// or if existence can't even be verified (assume the worst rather than
// silently reporting success).
export async function deleteAssignmentCalendar(calendarId) {
  if (Platform.OS === 'web' || !calendarId) return true;
  try {
    await Calendar.deleteCalendarAsync(calendarId);
  } catch {
    // Fall through to verification below — could be "already gone" or a
    // real failure. Don't guess from the error alone.
  }
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return !calendars.some(c => c.id === calendarId);
  } catch {
    return false;
  }
}
