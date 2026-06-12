import React from 'react';
import { act } from 'react-test-renderer';
import { render } from '../helpers/renderWithProviders';
import { makeAssignment, resetAssignmentCounter } from '../helpers/mockAssignment';

// react-native-calendars pulls in native/Flow internals; stub the Calendar
// component as a simple passthrough that renders its props so tests can
// inspect markedDates / fire onDayPress / onMonthChange.
vi.mock('react-native-calendars', () => ({
  Calendar: 'Calendar',
}));

import CalendarView from '../../components/CalendarView';

const STATUS_COLORS = {
  not_started: '#FF6B6B',
  in_progress: '#FFB347',
  completed: '#6BCB77',
};

const FIXED_TODAY = new Date('2026-06-15T12:00:00');
const TODAY_ISO = '2026-06-15';

beforeEach(() => {
  resetAssignmentCounter();
  vi.useFakeTimers({ now: FIXED_TODAY });
});

afterEach(() => {
  vi.useRealTimers();
});

function getCalendar(screen) {
  return screen.getAllByType('Calendar')[0];
}

function getFlatList(screen) {
  return screen.getAllByType('FlatList')[0];
}

// Concatenate string/number leaves of a React element tree (createElement
// output, as returned by renderItem/ListEmptyComponent — NOT the
// react-test-renderer JSON tree, which uses `.children` instead of `.props.children`).
function collectElementText(node) {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  const children = node.props && node.props.children;
  if (children == null) return '';
  if (Array.isArray(children)) return children.map(collectElementText).join('');
  return collectElementText(children);
}

// FlatList is mocked as the bare string 'FlatList', so renderItem/
// ListEmptyComponent are never invoked automatically. Render them manually
// from the FlatList's props to inspect the day-item rows.
function renderDayItems(screen) {
  const flatList = getFlatList(screen);
  const { data, renderItem, ListEmptyComponent } = flatList.props;
  if (!data || data.length === 0) {
    return [collectElementText(ListEmptyComponent)];
  }
  return data.map(item => collectElementText(renderItem({ item })));
}

// Find the rendered element for a given dayItem and fire its onPress.
function pressDayItem(screen, item) {
  const flatList = getFlatList(screen);
  const { renderItem } = flatList.props;
  const element = renderItem({ item });
  act(() => { element.props.onPress(); });
}

describe('CalendarView', () => {
  it('renders without crashing given an assignments array', () => {
    const assignments = [makeAssignment({ dueDate: TODAY_ISO })];
    expect(() =>
      render(React.createElement(CalendarView, { assignments, onSelectAssignment: vi.fn() }))
    ).not.toThrow();
  });

  it('markedDates contains dot markers for dates with assignments', () => {
    const assignments = [
      makeAssignment({ dueDate: '2026-06-20', status: 'not_started' }),
      makeAssignment({ dueDate: '2026-06-21', status: 'in_progress' }),
    ];
    const screen = render(React.createElement(CalendarView, { assignments, onSelectAssignment: vi.fn() }));
    const calendar = getCalendar(screen);
    const markedDates = calendar.props.markedDates;

    expect(markedDates['2026-06-20'].dots).toEqual([
      { key: assignments[0].id, color: STATUS_COLORS.not_started },
    ]);
    expect(markedDates['2026-06-21'].dots).toEqual([
      { key: assignments[1].id, color: STATUS_COLORS.in_progress },
    ]);
  });

  it('caps dots at 4 for a day with more than 4 assignments', () => {
    const assignments = Array.from({ length: 6 }, () =>
      makeAssignment({ dueDate: '2026-06-20', status: 'not_started' })
    );
    const screen = render(React.createElement(CalendarView, { assignments, onSelectAssignment: vi.fn() }));
    const calendar = getCalendar(screen);
    const markedDates = calendar.props.markedDates;

    expect(markedDates['2026-06-20'].dots).toHaveLength(4);
  });

  it('tapping a date updates selectedDate and the pill/dayItems shown', () => {
    const assignments = [
      makeAssignment({ title: 'Today Task', dueDate: TODAY_ISO }),
      makeAssignment({ title: 'Future Task', dueDate: '2026-06-20' }),
    ];
    const screen = render(React.createElement(CalendarView, { assignments, onSelectAssignment: vi.fn() }));

    // Initially selected = today, so today's task shows.
    expect(renderDayItems(screen).join(' ')).toContain('Today Task');
    expect(renderDayItems(screen).join(' ')).not.toContain('Future Task');

    // Simulate tapping 2026-06-20.
    const calendar = getCalendar(screen);
    act(() => { calendar.props.onDayPress({ dateString: '2026-06-20' }); });

    expect(renderDayItems(screen).join(' ')).toContain('Future Task');
    expect(renderDayItems(screen).join(' ')).not.toContain('Today Task');
    expect(screen.getByText('1 assignment on 2026-06-20')).toBeTruthy();
  });

  it('pill shows correct count and pluralization', () => {
    const assignments = [
      makeAssignment({ dueDate: TODAY_ISO }),
      makeAssignment({ dueDate: TODAY_ISO }),
    ];
    const screen = render(React.createElement(CalendarView, { assignments, onSelectAssignment: vi.fn() }));
    expect(screen.getByText(`2 assignments on ${TODAY_ISO}`)).toBeTruthy();
  });

  it('pill shows singular "assignment" for exactly one item', () => {
    const assignments = [makeAssignment({ dueDate: TODAY_ISO })];
    const screen = render(React.createElement(CalendarView, { assignments, onSelectAssignment: vi.fn() }));
    expect(screen.getByText(`1 assignment on ${TODAY_ISO}`)).toBeTruthy();
  });

  it('tapping a row in the day list calls onSelectAssignment with that item', () => {
    const item = makeAssignment({ title: 'Tap Me', dueDate: TODAY_ISO });
    const onSelectAssignment = vi.fn();
    const screen = render(React.createElement(CalendarView, { assignments: [item], onSelectAssignment }));

    expect(renderDayItems(screen).join(' ')).toContain('Tap Me');
    pressDayItem(screen, item);
    expect(onSelectAssignment).toHaveBeenCalledWith(item);
  });

  it('shows "No assignments due this day." for an empty day', () => {
    const screen = render(React.createElement(CalendarView, { assignments: [], onSelectAssignment: vi.fn() }));
    expect(renderDayItems(screen)).toEqual(['No assignments due this day.']);
  });

  describe('Today button', () => {
    it('is not shown when calendarMonth is the current month', () => {
      const screen = render(React.createElement(CalendarView, { assignments: [], onSelectAssignment: vi.fn() }));
      expect(screen.queryByText('Today')).toBeNull();
    });

    it('is shown after navigating to a different month, and tapping it jumps back to today', () => {
      const assignments = [
        makeAssignment({ title: 'Today Task', dueDate: TODAY_ISO }),
        makeAssignment({ title: 'July Task', dueDate: '2026-07-05' }),
      ];
      const screen = render(React.createElement(CalendarView, { assignments, onSelectAssignment: vi.fn() }));

      let calendar = getCalendar(screen);
      const initialCurrent = calendar.props.current;

      // Navigate to a different month and select a day in it.
      act(() => { calendar.props.onMonthChange({ dateString: '2026-07-01' }); });
      act(() => { calendar.props.onDayPress({ dateString: '2026-07-05' }); });

      expect(screen.getByText('Today')).toBeTruthy();
      expect(renderDayItems(screen).join(' ')).toContain('July Task');

      // Tap "Today".
      screen.firePressOnText('Today');

      // The "Today" button disappears again, since calendarMonth resets.
      expect(screen.queryByText('Today')).toBeNull();
      // selectedDate resets to today, reflected in the pill and day list.
      expect(screen.getByText(`1 assignment on ${TODAY_ISO}`)).toBeTruthy();
      const items = renderDayItems(screen).join(' ');
      expect(items).toContain('Today Task');
      expect(items).not.toContain('July Task');

      // Calendar's `current` prop resets to today's month (remounted via jumpKey).
      calendar = getCalendar(screen);
      expect(calendar.props.current).toBe(TODAY_ISO);
      expect(calendar.props.current).not.toBe('2026-07-01');
      expect(initialCurrent).toBe(TODAY_ISO);
    });
  });
});
