// expo-calendar 57 (SDK 57) moved the classic function API to the
// "expo-calendar/legacy" entry point; the same names imported from plain
// "expo-calendar" are stubs that THROW at runtime. Importing from the main
// entry here is what broke calendar sync entirely in the first SDK 57
// device build ("Could not turn on calendar sync").
import * as Calendar from 'expo-calendar/legacy';
// New-API permission probe (main entry): unlike the legacy check, it can ask
// about write-only access specifically — see requestCalendarAccess below.
import { getCalendarPermissions } from 'expo-calendar';
import { Platform } from 'react-native';
import { isValidTime } from './assignment';
import { currentDeviceTimezone } from './notifications';

// One-way (app → device calendar) sync: this file only ever creates/reads/
// updates/deletes events INSIDE the dedicated "Assignment Planner" calendar
// it owns. It never reads or modifies the user's other calendars or events.
// NOTE: it still requires FULL calendar access on iOS 17+ — listing
// calendars and creating our own calendar are not permitted under
// "Add Events Only" (write-only) access, which only covers inserting events
// into existing calendars via the system UI.
//
// Not supported on web (no native calendar API); every export short-circuits
// on Platform.OS === 'web', mirroring lib/notifications.js's pattern.

const CALENDAR_TITLE = 'Assignment Planner';
const CALENDAR_COLOR = '#3B5BDB';

// Ask for calendar access once. Resolves to one of:
//   'granted'   — full access; sync can proceed
//   'writeOnly' — iOS 17+ "Add Events Only": technically granted, but not
//                 enough to list calendars / create our own (see header).
//                 Surfaced separately so the UI can say "switch to Full
//                 Access in Settings" instead of a misleading plain denial.
//   'denied'    — no usable access
export async function requestCalendarAccess() {
  if (Platform.OS === 'web') return 'denied';
  try {
    const { status: existing } = await Calendar.getCalendarPermissionsAsync();
    if (existing === 'granted') return 'granted';
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status === 'granted') return 'granted';
  } catch (e) {
    // Deliberately NOT a `return 'denied'`: fall through to the write-only
    // probe below. The full-access request can reject on a transient
    // EventKit error, and an "Add Events Only" user should still get the
    // actionable write-only message rather than a plain denial.
    console.warn('[calendarSync] permission request failed', e);
  }
  // Full access not granted. On iOS, distinguish "Add Events Only": the
  // legacy/full check above reports write-only as denied, while the new
  // API's write-only probe reports it as granted — full=denied +
  // writeOnly=granted can only mean the user picked Add Events Only.
  if (Platform.OS === 'ios') {
    try {
      const writeOnly = await getCalendarPermissions(true);
      if (writeOnly?.granted) return 'writeOnly';
    } catch (e) {
      console.warn('[calendarSync] write-only permission probe failed', e);
    }
  }
  return 'denied';
}

// Pick the iOS source (account) the dedicated calendar should live under.
// Prefer whichever source holds the user's default calendar — that's the
// account whose calendars they actually see. Fall back to scanning all
// sources (iCloud/CalDAV first — when iCloud Calendar is on, purely local
// calendars are hidden by iOS — then local, then anything) because
// getDefaultCalendarAsync can fail on devices with no default calendar
// configured. The pre-SDK-57 code called getDefaultCalendarSourceAsync(),
// which no longer exists in expo-calendar 57 (even in the legacy entry).
async function pickIosCalendarSource() {
  try {
    const defaultCalendar = await Calendar.getDefaultCalendarAsync();
    if (defaultCalendar?.source?.id) return defaultCalendar.source;
  } catch (e) {
    console.warn('[calendarSync] no default calendar; scanning sources', e);
  }
  const sources = await Calendar.getSourcesAsync();
  const byType = type => sources.find(s => s.type === type);
  const source =
    byType(Calendar.SourceType.CALDAV) ??
    byType(Calendar.SourceType.LOCAL) ??
    // Last resort: any source that can actually hold a created calendar —
    // subscribed and birthday sources are read-only and createCalendarAsync
    // under them fails.
    sources.find(
      s => s.type !== Calendar.SourceType.SUBSCRIBED && s.type !== Calendar.SourceType.BIRTHDAYS,
    );
  if (!source) throw new Error('No writable calendar source available on this device');
  return source;
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
    const source = await pickIosCalendarSource();
    return Calendar.createCalendarAsync({
      title: CALENDAR_TITLE,
      color: CALENDAR_COLOR,
      entityType: Calendar.EntityTypes.EVENT,
      sourceId: source.id,
      source,
      name: CALENDAR_TITLE,
      ownerAccount: source.name,
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
  } catch (e) {
    console.warn('[calendarSync] createEventAsync failed', e);
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
  } catch (e) {
    console.warn('[calendarSync] updateEventAsync failed', e);
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
