import * as Calendar from 'expo-calendar/legacy';
import { getCalendarPermissions } from 'expo-calendar';
import { Platform } from 'react-native';
import {
  createEventFor,
  deleteAssignmentCalendar,
  deleteEventFor,
  ensureAssignmentCalendar,
  requestCalendarAccess,
  updateEventFor,
} from '../../lib/calendarSync';

function makeAssignment(overrides = {}) {
  return {
    id: 'a1',
    title: 'Essay',
    course: 'ENGL 200',
    dueDate: '2026-06-15',
    importance: 3,
    complexity: 'medium',
    status: 'not_started',
    ...overrides,
  };
}

beforeEach(() => {
  Platform.OS = 'ios';
  Calendar.getCalendarPermissionsAsync.mockReset();
  Calendar.requestCalendarPermissionsAsync.mockReset();
  Calendar.getCalendarsAsync.mockReset();
  Calendar.createCalendarAsync.mockReset();
  Calendar.deleteCalendarAsync.mockReset();
  Calendar.getDefaultCalendarAsync.mockReset();
  Calendar.getSourcesAsync.mockReset();
  Calendar.createEventAsync.mockReset();
  Calendar.updateEventAsync.mockReset();
  Calendar.deleteEventAsync.mockReset();
  Calendar.getEventAsync.mockReset();
  getCalendarPermissions.mockReset();

  Calendar.getCalendarPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Calendar.requestCalendarPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Calendar.getCalendarsAsync.mockResolvedValue([]);
  Calendar.createCalendarAsync.mockResolvedValue('new-calendar-id');
  Calendar.getDefaultCalendarAsync.mockResolvedValue({
    id: 'default-cal',
    source: { id: 'source-1', name: 'iCloud', type: 'caldav' },
  });
  Calendar.getSourcesAsync.mockResolvedValue([{ id: 'source-1', name: 'iCloud', type: 'caldav' }]);
  getCalendarPermissions.mockResolvedValue({ status: 'denied', granted: false });
  Calendar.createEventAsync.mockResolvedValue('new-event-id');
  // Default: the event is confirmed gone after a delete (a by-id lookup
  // throwing is the normal "not found" signal) — matches most tests'
  // assumption that deletion succeeds.
  Calendar.getEventAsync.mockRejectedValue(new Error('not found'));
});

describe('requestCalendarAccess', () => {
  test("returns 'granted' when already granted (no re-prompt)", async () => {
    expect(await requestCalendarAccess()).toBe('granted');
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
  });

  test('asks the OS when not yet granted', async () => {
    Calendar.getCalendarPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    expect(await requestCalendarAccess()).toBe('granted');
    expect(Calendar.requestCalendarPermissionsAsync).toHaveBeenCalled();
  });

  test("returns 'denied' when denied outright", async () => {
    Calendar.getCalendarPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    Calendar.requestCalendarPermissionsAsync.mockResolvedValue({ status: 'denied' });
    expect(await requestCalendarAccess()).toBe('denied');
  });

  test("returns 'writeOnly' on iOS when full access is denied but the write-only probe is granted (Add Events Only)", async () => {
    Calendar.getCalendarPermissionsAsync.mockResolvedValue({ status: 'denied' });
    Calendar.requestCalendarPermissionsAsync.mockResolvedValue({ status: 'denied' });
    getCalendarPermissions.mockResolvedValue({ status: 'granted', granted: true });
    expect(await requestCalendarAccess()).toBe('writeOnly');
    expect(getCalendarPermissions).toHaveBeenCalledWith(true);
  });

  test('never probes write-only on Android — a denial is just a denial', async () => {
    Platform.OS = 'android';
    Calendar.getCalendarPermissionsAsync.mockResolvedValue({ status: 'denied' });
    Calendar.requestCalendarPermissionsAsync.mockResolvedValue({ status: 'denied' });
    expect(await requestCalendarAccess()).toBe('denied');
    expect(getCalendarPermissions).not.toHaveBeenCalled();
  });

  test("returns 'denied' when the permission calls themselves throw, after still attempting the write-only probe", async () => {
    Calendar.getCalendarPermissionsAsync.mockRejectedValue(new Error('native error'));
    expect(await requestCalendarAccess()).toBe('denied');
    expect(getCalendarPermissions).toHaveBeenCalledWith(true);
  });

  test("still detects write-only when the full-access request throws (transient EventKit error must not mask 'Add Events Only')", async () => {
    Calendar.getCalendarPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    Calendar.requestCalendarPermissionsAsync.mockRejectedValue(new Error('E_CALENDAR_ERROR_UNKNOWN'));
    getCalendarPermissions.mockResolvedValue({ status: 'granted', granted: true });
    expect(await requestCalendarAccess()).toBe('writeOnly');
  });

  test("returns 'denied' when the write-only probe throws", async () => {
    Calendar.getCalendarPermissionsAsync.mockResolvedValue({ status: 'denied' });
    Calendar.requestCalendarPermissionsAsync.mockResolvedValue({ status: 'denied' });
    getCalendarPermissions.mockRejectedValue(new Error('native error'));
    expect(await requestCalendarAccess()).toBe('denied');
  });

  test("returns 'denied' on web without touching native APIs", async () => {
    Platform.OS = 'web';
    expect(await requestCalendarAccess()).toBe('denied');
    expect(Calendar.getCalendarPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('ensureAssignmentCalendar', () => {
  test('returns the existing calendar id when one is already found', async () => {
    Calendar.getCalendarsAsync.mockResolvedValue([
      { id: 'existing-id', title: 'Assignment Planner', allowsModifications: true },
    ]);
    const id = await ensureAssignmentCalendar();
    expect(id).toBe('existing-id');
    expect(Calendar.createCalendarAsync).not.toHaveBeenCalled();
  });

  test('ignores a same-titled calendar that disallows modifications', async () => {
    Calendar.getCalendarsAsync.mockResolvedValue([
      { id: 'readonly-id', title: 'Assignment Planner', allowsModifications: false },
    ]);
    await ensureAssignmentCalendar();
    expect(Calendar.createCalendarAsync).toHaveBeenCalled();
  });

  test("creates under the default calendar's source on iOS when none exists", async () => {
    Platform.OS = 'ios';
    const id = await ensureAssignmentCalendar();
    expect(Calendar.getDefaultCalendarAsync).toHaveBeenCalled();
    expect(Calendar.getSourcesAsync).not.toHaveBeenCalled();
    expect(Calendar.createCalendarAsync).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Assignment Planner', sourceId: 'source-1' })
    );
    expect(id).toBe('new-calendar-id');
  });

  test('falls back to scanning sources when getDefaultCalendarAsync fails, preferring CalDAV', async () => {
    Platform.OS = 'ios';
    Calendar.getDefaultCalendarAsync.mockRejectedValue(new Error('no default calendar'));
    Calendar.getSourcesAsync.mockResolvedValue([
      { id: 'local-1', name: 'On My iPhone', type: 'local' },
      { id: 'icloud-1', name: 'iCloud', type: 'caldav' },
    ]);
    await ensureAssignmentCalendar();
    expect(Calendar.createCalendarAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'icloud-1' })
    );
  });

  test('falls back to a local source when no CalDAV source exists', async () => {
    Platform.OS = 'ios';
    Calendar.getDefaultCalendarAsync.mockResolvedValue({ id: 'cal', source: undefined });
    Calendar.getSourcesAsync.mockResolvedValue([
      { id: 'exchange-1', name: 'Work', type: 'exchange' },
      { id: 'local-1', name: 'On My iPhone', type: 'local' },
    ]);
    await ensureAssignmentCalendar();
    expect(Calendar.createCalendarAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'local-1' })
    );
  });

  test('throws when the device has no calendar sources at all', async () => {
    Platform.OS = 'ios';
    Calendar.getDefaultCalendarAsync.mockRejectedValue(new Error('no default calendar'));
    Calendar.getSourcesAsync.mockResolvedValue([]);
    await expect(ensureAssignmentCalendar()).rejects.toThrow('No writable calendar source');
    expect(Calendar.createCalendarAsync).not.toHaveBeenCalled();
  });

  test('last-resort fallback skips read-only subscribed/birthday sources', async () => {
    Platform.OS = 'ios';
    Calendar.getDefaultCalendarAsync.mockRejectedValue(new Error('no default calendar'));
    Calendar.getSourcesAsync.mockResolvedValue([
      { id: 'subs-1', name: 'Holidays', type: 'subscribed' },
      { id: 'bday-1', name: 'Birthdays', type: 'birthdays' },
      { id: 'exchange-1', name: 'Work', type: 'exchange' },
    ]);
    await ensureAssignmentCalendar();
    expect(Calendar.createCalendarAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'exchange-1' })
    );
  });

  test('throws when only read-only sources exist rather than trying to create under one', async () => {
    Platform.OS = 'ios';
    Calendar.getDefaultCalendarAsync.mockRejectedValue(new Error('no default calendar'));
    Calendar.getSourcesAsync.mockResolvedValue([
      { id: 'subs-1', name: 'Holidays', type: 'subscribed' },
    ]);
    await expect(ensureAssignmentCalendar()).rejects.toThrow('No writable calendar source');
    expect(Calendar.createCalendarAsync).not.toHaveBeenCalled();
  });

  test('creates via a local source on Android when none exists', async () => {
    Platform.OS = 'android';
    await ensureAssignmentCalendar();
    expect(Calendar.getDefaultCalendarAsync).not.toHaveBeenCalled();
    expect(Calendar.createCalendarAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Assignment Planner',
        source: expect.objectContaining({ isLocalAccount: true }),
      })
    );
  });

  test('returns null on web without touching native APIs', async () => {
    Platform.OS = 'web';
    expect(await ensureAssignmentCalendar()).toBeNull();
    expect(Calendar.getCalendarsAsync).not.toHaveBeenCalled();
  });
});

describe('createEventFor', () => {
  test('builds an all-day event when dueTime is absent', async () => {
    await createEventFor(makeAssignment(), 'cal-1');
    const [calendarId, details] = Calendar.createEventAsync.mock.calls[0];
    expect(calendarId).toBe('cal-1');
    expect(details.allDay).toBe(true);
    expect(details.startDate.getHours()).toBe(0);
  });

  test('builds a 30-minute timed event when dueTime is set', async () => {
    await createEventFor(makeAssignment({ dueTime: '14:30' }), 'cal-1');
    const [, details] = Calendar.createEventAsync.mock.calls[0];
    expect(details.allDay).toBe(false);
    expect(details.startDate.getHours()).toBe(14);
    expect(details.startDate.getMinutes()).toBe(30);
    expect(details.endDate.getTime() - details.startDate.getTime()).toBe(30 * 60 * 1000);
  });

  test('returns null on web without touching native APIs', async () => {
    Platform.OS = 'web';
    expect(await createEventFor(makeAssignment(), 'cal-1')).toBeNull();
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
  });

  test('returns null without a calendarId', async () => {
    expect(await createEventFor(makeAssignment(), null)).toBeNull();
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
  });

  test('returns null when the native call throws', async () => {
    Calendar.createEventAsync.mockRejectedValue(new Error('boom'));
    expect(await createEventFor(makeAssignment(), 'cal-1')).toBeNull();
  });
});

describe('updateEventFor', () => {
  test('returns true on success', async () => {
    expect(await updateEventFor('event-1', makeAssignment())).toBe(true);
    expect(Calendar.updateEventAsync).toHaveBeenCalledWith('event-1', expect.any(Object));
  });

  test('returns false when the event no longer exists', async () => {
    Calendar.updateEventAsync.mockRejectedValue(new Error('not found'));
    expect(await updateEventFor('gone', makeAssignment())).toBe(false);
  });

  test('returns false without an eventId', async () => {
    expect(await updateEventFor(null, makeAssignment())).toBe(false);
    expect(Calendar.updateEventAsync).not.toHaveBeenCalled();
  });

  test('returns false on web', async () => {
    Platform.OS = 'web';
    expect(await updateEventFor('event-1', makeAssignment())).toBe(false);
  });
});

describe('deleteEventFor', () => {
  test('deletes the event and confirms it via the by-id lookup throwing (not found)', async () => {
    const confirmed = await deleteEventFor('event-1');
    expect(Calendar.deleteEventAsync).toHaveBeenCalledWith('event-1');
    expect(confirmed).toBe(true);
  });

  test('confirms deletion even if deleteEventAsync itself threw, as long as the follow-up lookup says gone', async () => {
    // expo-calendar's errors don't reliably distinguish "already gone" from
    // a real failure — the follow-up lookup is the source of truth.
    Calendar.deleteEventAsync.mockRejectedValue(new Error('not found'));
    await expect(deleteEventFor('gone')).resolves.toBe(true);
  });

  test('reports unconfirmed when the event is still found afterward', async () => {
    Calendar.getEventAsync.mockResolvedValue({ id: 'event-1', title: 'Essay' });
    const confirmed = await deleteEventFor('event-1');
    expect(confirmed).toBe(false);
  });

  test('no-ops (and reports confirmed) without an eventId', async () => {
    const confirmed = await deleteEventFor(null);
    expect(Calendar.deleteEventAsync).not.toHaveBeenCalled();
    expect(confirmed).toBe(true);
  });

  test('no-ops (and reports confirmed) on web', async () => {
    Platform.OS = 'web';
    const confirmed = await deleteEventFor('event-1');
    expect(Calendar.deleteEventAsync).not.toHaveBeenCalled();
    expect(confirmed).toBe(true);
  });
});

describe('deleteAssignmentCalendar', () => {
  test('deletes the calendar and confirms it via the live list', async () => {
    Calendar.getCalendarsAsync.mockResolvedValue([]); // no longer present
    const confirmed = await deleteAssignmentCalendar('cal-1');
    expect(Calendar.deleteCalendarAsync).toHaveBeenCalledWith('cal-1');
    expect(confirmed).toBe(true);
  });

  test('confirms deletion even if deleteCalendarAsync itself threw, as long as the calendar is verified gone', async () => {
    // expo-calendar's errors don't reliably distinguish "already gone" from
    // a real failure — the follow-up existence check is the source of truth.
    Calendar.deleteCalendarAsync.mockRejectedValue(new Error('not found'));
    Calendar.getCalendarsAsync.mockResolvedValue([]);
    await expect(deleteAssignmentCalendar('gone')).resolves.toBe(true);
  });

  test('reports NOT confirmed when the calendar is still found afterward', async () => {
    Calendar.getCalendarsAsync.mockResolvedValue([{ id: 'cal-1', title: 'Assignment Planner' }]);
    const confirmed = await deleteAssignmentCalendar('cal-1');
    expect(confirmed).toBe(false);
  });

  test('reports NOT confirmed when existence cannot even be verified', async () => {
    Calendar.getCalendarsAsync.mockRejectedValue(new Error('permission revoked'));
    const confirmed = await deleteAssignmentCalendar('cal-1');
    expect(confirmed).toBe(false);
  });

  test('no-ops (nothing to confirm) without a calendarId', async () => {
    const confirmed = await deleteAssignmentCalendar(null);
    expect(Calendar.deleteCalendarAsync).not.toHaveBeenCalled();
    expect(confirmed).toBe(true);
  });

  test('no-ops (nothing to confirm) on web', async () => {
    Platform.OS = 'web';
    const confirmed = await deleteAssignmentCalendar('cal-1');
    expect(Calendar.deleteCalendarAsync).not.toHaveBeenCalled();
    expect(confirmed).toBe(true);
  });
});
