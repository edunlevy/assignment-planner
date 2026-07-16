import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import {
  createEventFor,
  deleteAssignmentCalendar,
  deleteEventFor,
  ensureAssignmentCalendar,
  requestCalendarPermission,
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
  Calendar.getDefaultCalendarSourceAsync.mockReset();
  Calendar.createEventAsync.mockReset();
  Calendar.updateEventAsync.mockReset();
  Calendar.deleteEventAsync.mockReset();

  Calendar.getCalendarPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Calendar.requestCalendarPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Calendar.getCalendarsAsync.mockResolvedValue([]);
  Calendar.createCalendarAsync.mockResolvedValue('new-calendar-id');
  Calendar.getDefaultCalendarSourceAsync.mockResolvedValue({ id: 'source-1', name: 'iCloud' });
  Calendar.createEventAsync.mockResolvedValue('new-event-id');
});

describe('requestCalendarPermission', () => {
  test('returns true when already granted (no re-prompt)', async () => {
    expect(await requestCalendarPermission()).toBe(true);
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
  });

  test('asks the OS when not yet granted', async () => {
    Calendar.getCalendarPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    expect(await requestCalendarPermission()).toBe(true);
    expect(Calendar.requestCalendarPermissionsAsync).toHaveBeenCalled();
  });

  test('returns false when denied', async () => {
    Calendar.getCalendarPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    Calendar.requestCalendarPermissionsAsync.mockResolvedValue({ status: 'denied' });
    expect(await requestCalendarPermission()).toBe(false);
  });

  test('returns false on web without touching native APIs', async () => {
    Platform.OS = 'web';
    expect(await requestCalendarPermission()).toBe(false);
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

  test('creates via the default source on iOS when none exists', async () => {
    Platform.OS = 'ios';
    const id = await ensureAssignmentCalendar();
    expect(Calendar.getDefaultCalendarSourceAsync).toHaveBeenCalled();
    expect(Calendar.createCalendarAsync).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Assignment Planner', sourceId: 'source-1' })
    );
    expect(id).toBe('new-calendar-id');
  });

  test('creates via a local source on Android when none exists', async () => {
    Platform.OS = 'android';
    await ensureAssignmentCalendar();
    expect(Calendar.getDefaultCalendarSourceAsync).not.toHaveBeenCalled();
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
  test('deletes the event', async () => {
    await deleteEventFor('event-1');
    expect(Calendar.deleteEventAsync).toHaveBeenCalledWith('event-1');
  });

  test('never throws when the event is already gone', async () => {
    Calendar.deleteEventAsync.mockRejectedValue(new Error('not found'));
    await expect(deleteEventFor('gone')).resolves.toBeUndefined();
  });

  test('no-ops without an eventId', async () => {
    await deleteEventFor(null);
    expect(Calendar.deleteEventAsync).not.toHaveBeenCalled();
  });

  test('no-ops on web', async () => {
    Platform.OS = 'web';
    await deleteEventFor('event-1');
    expect(Calendar.deleteEventAsync).not.toHaveBeenCalled();
  });
});

describe('deleteAssignmentCalendar', () => {
  test('deletes the calendar', async () => {
    await deleteAssignmentCalendar('cal-1');
    expect(Calendar.deleteCalendarAsync).toHaveBeenCalledWith('cal-1');
  });

  test('never throws when the calendar is already gone', async () => {
    Calendar.deleteCalendarAsync.mockRejectedValue(new Error('not found'));
    await expect(deleteAssignmentCalendar('gone')).resolves.toBeUndefined();
  });

  test('no-ops without a calendarId', async () => {
    await deleteAssignmentCalendar(null);
    expect(Calendar.deleteCalendarAsync).not.toHaveBeenCalled();
  });
});
