import React from 'react';
import { render, act } from '../helpers/renderWithProviders';
import RecurringSeriesSection from '../../components/RecurringSeriesSection';
import { PRIMARY, DANGER } from '../../lib/constants';
import { MAX_OCCURRENCES } from '../../lib/recurring';

// RecurringSeriesSection is a pure presentational sub-form; all state lives in
// the parent. These tests exercise its own branches directly.
//
// The component renders a fragment when expanded, so its render root can be
// an array — the shared render helper's array-root walk handles that.
//
// IMPORTANT: the weekday-chip row renders duplicate single-letter labels
// ("S" for both Sunday and Saturday, "T" for both Tuesday and Thursday), so
// chips are selected by POSITION (index 0=Sun..6=Sat within the row), never
// by getByText('S') / getByText('T'), which would be ambiguous.

const REPEAT_UNTIL_PLACEHOLDER = 'Tap to choose an end date';

function baseProps(overrides = {}) {
  return {
    repeatEnabled: false,
    repeatFreq: 'weekly',
    repeatInterval: 1,
    repeatWeekdays: [],
    repeatEndMode: 'until',
    repeatUntil: '',
    repeatCount: 10,
    dueDate: '2026-06-01',
    repeatUntilError: '',
    repeatCountError: '',
    onToggle: vi.fn(),
    onFreqChange: vi.fn(),
    onIntervalChange: vi.fn(),
    onWeekdayToggle: vi.fn(),
    onEndModeChange: vi.fn(),
    onRepeatUntilChange: vi.fn(),
    onCountChange: vi.fn(),
    ...overrides,
  };
}

function renderSection(overrides = {}) {
  const props = baseProps(overrides);
  const screen = render(React.createElement(RecurringSeriesSection, props));
  return { screen, props };
}

// --- Local tree helpers (RTR JSON nodes) ------------------------------------
function collectText(node) {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node || !node.children) return '';
  return node.children.map(collectText).join('');
}

function styleHasBackground(node, color) {
  const style = node?.props?.style;
  const flat = Array.isArray(style) ? style : [style];
  return flat.some(s => s && s.backgroundColor === color);
}

// The weekday row is the View whose 7 direct Pressable children spell out
// "SMTWTFS" — locating it this way (rather than by any single chip's text)
// is what makes position-based selection below unambiguous.
function findWeekdayRow(root) {
  let found = null;
  (function walk(n) {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (
      n.type === 'View' &&
      Array.isArray(n.children) &&
      n.children.length === 7 &&
      n.children.every(c => c && c.type === 'Pressable')
    ) {
      if (n.children.map(collectText).join('') === 'SMTWTFS') found = n;
    }
    (n.children || []).forEach(walk);
  })(root);
  return found;
}

function pressWeekdayChip(root, index) {
  const row = findWeekdayRow(root);
  if (!row) throw new Error('Weekday row not found');
  act(() => { row.children[index].props.onPress(); });
}

// A Stepper renders <View style=stepperRow>[Pressable(-), Text(value), Pressable(+)]</View>.
// Find the row by the (unique) substring in its value Text, then press the
// minus/plus Pressable by position — avoids relying on the '−'/'+' glyphs,
// which are duplicated across the interval and count steppers.
function findStepperRow(root, valueSubstring) {
  let found = null;
  (function walk(n) {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'View' && Array.isArray(n.children) && n.children.length === 3) {
      const textChild = n.children.find(c => c && c.type === 'Text');
      const pressableCount = n.children.filter(c => c && c.type === 'Pressable').length;
      if (textChild && pressableCount === 2 && collectText(textChild).includes(valueSubstring)) {
        found = n;
      }
    }
    (n.children || []).forEach(walk);
  })(root);
  return found;
}

function stepperButtons(root, valueSubstring) {
  const row = findStepperRow(root, valueSubstring);
  if (!row) throw new Error(`Stepper row containing "${valueSubstring}" not found`);
  const pressables = row.children.filter(c => c && c.type === 'Pressable');
  return { minus: pressables[0], plus: pressables[1] };
}

function pressStepper(root, valueSubstring, which) {
  const { minus, plus } = stepperButtons(root, valueSubstring);
  const target = which === 'minus' ? minus : plus;
  act(() => { target.props.onPress(); });
}

describe('RecurringSeriesSection', () => {
  describe('collapsed (repeatEnabled = false)', () => {
    it('renders only the toggle row, no frequency/interval/end controls', () => {
      const { screen } = renderSection({ repeatEnabled: false });
      expect(screen.getByText('Repeats…')).toBeTruthy();
      expect(screen.queryByText('Frequency')).toBeNull();
      expect(screen.queryByText('Every')).toBeNull();
      expect(screen.queryByText('Ends')).toBeNull();
    });

    it('does not render the checkmark when unchecked', () => {
      const { screen } = renderSection({ repeatEnabled: false });
      expect(screen.queryByText('✓')).toBeNull();
    });

    it('calls onToggle when the toggle row is pressed', () => {
      const { screen, props } = renderSection({ repeatEnabled: false });
      screen.firePressOnText('Repeats…');
      expect(props.onToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe('expanded — frequency pills', () => {
    it('renders the checkmark and Frequency/Every/Ends sections', () => {
      const { screen } = renderSection({ repeatEnabled: true });
      expect(screen.getByText('✓')).toBeTruthy();
      expect(screen.getByText('Frequency')).toBeTruthy();
      expect(screen.getByText('Weekly')).toBeTruthy();
      expect(screen.getByText('Monthly')).toBeTruthy();
      expect(screen.getByText('Every')).toBeTruthy();
      expect(screen.getByText('Ends')).toBeTruthy();
    });

    it('calls onFreqChange("monthly") when the Monthly pill is pressed', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatFreq: 'weekly' });
      screen.firePressOnText('Monthly');
      expect(props.onFreqChange).toHaveBeenCalledWith('monthly');
    });

    it('calls onFreqChange("weekly") when the Weekly pill is pressed', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatFreq: 'monthly' });
      screen.firePressOnText('Weekly');
      expect(props.onFreqChange).toHaveBeenCalledWith('weekly');
    });

    it('highlights the selected frequency pill and not the other', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatFreq: 'weekly' });
      const tree = screen.toJSON();
      function findPressableByText(root, text) {
        let found = null;
        (function walk(n) {
          if (found || !n || typeof n !== 'object') return;
          if (Array.isArray(n)) { n.forEach(walk); return; }
          if (n.type === 'Pressable' && collectText(n).includes(text)) { found = n; return; }
          (n.children || []).forEach(walk);
        })(root);
        return found;
      }
      const weekly = findPressableByText(tree, 'Weekly');
      const monthly = findPressableByText(tree, 'Monthly');
      expect(styleHasBackground(weekly, PRIMARY)).toBe(true);
      expect(styleHasBackground(monthly, PRIMARY)).toBe(false);
    });
  });

  describe('expanded — interval stepper', () => {
    it('shows "1 week" for weekly at interval 1, and pluralizes at interval > 1', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatFreq: 'weekly', repeatInterval: 1 });
      expect(screen.getByText('1 week')).toBeTruthy();
    });

    it('shows "2 weeks" (plural) for weekly at interval 2', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatFreq: 'weekly', repeatInterval: 2 });
      expect(screen.getByText('2 weeks')).toBeTruthy();
    });

    it('shows "1 month" / "3 months" for monthly frequency', () => {
      const one = renderSection({ repeatEnabled: true, repeatFreq: 'monthly', repeatInterval: 1 });
      expect(one.screen.getByText('1 month')).toBeTruthy();
      const three = renderSection({ repeatEnabled: true, repeatFreq: 'monthly', repeatInterval: 3 });
      expect(three.screen.getByText('3 months')).toBeTruthy();
    });

    it('pressing + calls onIntervalChange with value + 1', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatInterval: 2 });
      pressStepper(screen.toJSON(), '2 weeks', 'plus');
      expect(props.onIntervalChange).toHaveBeenCalledWith(3);
    });

    it('pressing − calls onIntervalChange with value − 1', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatInterval: 2 });
      pressStepper(screen.toJSON(), '2 weeks', 'minus');
      expect(props.onIntervalChange).toHaveBeenCalledWith(1);
    });

    it('clamps at the minimum (1): pressing − at 1 still reports 1, and the button is disabled', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatInterval: 1 });
      const tree = screen.toJSON();
      const { minus } = stepperButtons(tree, '1 week');
      expect(minus.props.disabled).toBe(true);
      act(() => { minus.props.onPress(); });
      expect(props.onIntervalChange).toHaveBeenCalledWith(1);
    });

    it('clamps at the maximum (12): pressing + at 12 still reports 12, and the button is disabled', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatInterval: 12 });
      const tree = screen.toJSON();
      const { plus } = stepperButtons(tree, '12 weeks');
      expect(plus.props.disabled).toBe(true);
      act(() => { plus.props.onPress(); });
      expect(props.onIntervalChange).toHaveBeenCalledWith(12);
    });
  });

  describe('expanded — weekday chips (weekly only)', () => {
    it('renders the weekday row when frequency is weekly', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatFreq: 'weekly' });
      expect(screen.getByText('On days')).toBeTruthy();
      expect(findWeekdayRow(screen.toJSON())).not.toBeNull();
    });

    it('does not render the weekday row (or its label) when frequency is monthly', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatFreq: 'monthly' });
      expect(screen.queryByText('On days')).toBeNull();
      expect(findWeekdayRow(screen.toJSON())).toBeNull();
    });

    it('calls onWeekdayToggle(1) when the Monday chip (index 1) is pressed', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatFreq: 'weekly', repeatWeekdays: [] });
      pressWeekdayChip(screen.toJSON(), 1);
      expect(props.onWeekdayToggle).toHaveBeenCalledWith(1);
    });

    it('calls onWeekdayToggle(0) for the first "S" chip (Sunday) and onWeekdayToggle(6) for the last "S" chip (Saturday) — distinguished purely by position', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatFreq: 'weekly' });
      const tree = screen.toJSON();
      pressWeekdayChip(tree, 0);
      expect(props.onWeekdayToggle).toHaveBeenLastCalledWith(0);
      pressWeekdayChip(tree, 6);
      expect(props.onWeekdayToggle).toHaveBeenLastCalledWith(6);
    });

    it('highlights selected chips and not unselected ones', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatFreq: 'weekly', repeatWeekdays: [1, 3] });
      const row = findWeekdayRow(screen.toJSON());
      // index 0=Sun, 1=Mon, 2=Tue, 3=Wed
      expect(styleHasBackground(row.children[1], PRIMARY)).toBe(true); // Mon selected
      expect(styleHasBackground(row.children[3], PRIMARY)).toBe(true); // Wed selected
      expect(styleHasBackground(row.children[0], PRIMARY)).toBe(false); // Sun not selected
      expect(styleHasBackground(row.children[2], PRIMARY)).toBe(false); // Tue not selected
    });

    it('shows the hint when no weekdays are selected', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatFreq: 'weekly', repeatWeekdays: [] });
      expect(screen.getByText("No days selected — repeats on the due date's weekday")).toBeTruthy();
    });

    it('hides the hint once a weekday is selected', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatFreq: 'weekly', repeatWeekdays: [2] });
      expect(screen.queryByText("No days selected — repeats on the due date's weekday")).toBeNull();
    });
  });

  describe('expanded — end mode pills', () => {
    it('renders both end-mode pill labels', () => {
      const { screen } = renderSection({ repeatEnabled: true });
      expect(screen.getByText('On a date')).toBeTruthy();
      expect(screen.getByText('After N times')).toBeTruthy();
    });

    it('calls onEndModeChange("count") when "After N times" is pressed', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatEndMode: 'until' });
      screen.firePressOnText('After N times');
      expect(props.onEndModeChange).toHaveBeenCalledWith('count');
    });

    it('calls onEndModeChange("until") when "On a date" is pressed', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatEndMode: 'count' });
      screen.firePressOnText('On a date');
      expect(props.onEndModeChange).toHaveBeenCalledWith('until');
    });

    it('shows the DueDateField (not the count stepper) in until-mode', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatEndMode: 'until' });
      expect(screen.queryByText(REPEAT_UNTIL_PLACEHOLDER)).toBeTruthy();
      expect(screen.queryByText('10 times')).toBeNull();
    });

    it('shows the count stepper (not the DueDateField) in count-mode', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatEndMode: 'count', repeatCount: 10 });
      expect(screen.getByText('10 times')).toBeTruthy();
      expect(screen.queryByText(REPEAT_UNTIL_PLACEHOLDER)).toBeNull();
    });
  });

  describe('expanded — count stepper (count-mode)', () => {
    it('shows "1 time" (singular) at count 1', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatEndMode: 'count', repeatCount: 1 });
      expect(screen.getByText('1 time')).toBeTruthy();
    });

    it('pressing + calls onCountChange with count + 1', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatEndMode: 'count', repeatCount: 10 });
      pressStepper(screen.toJSON(), '10 times', 'plus');
      expect(props.onCountChange).toHaveBeenCalledWith(11);
    });

    it('pressing − calls onCountChange with count − 1', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatEndMode: 'count', repeatCount: 10 });
      pressStepper(screen.toJSON(), '10 times', 'minus');
      expect(props.onCountChange).toHaveBeenCalledWith(9);
    });

    it('clamps at minimum 1', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatEndMode: 'count', repeatCount: 1 });
      const tree = screen.toJSON();
      const { minus } = stepperButtons(tree, '1 time');
      expect(minus.props.disabled).toBe(true);
      act(() => { minus.props.onPress(); });
      expect(props.onCountChange).toHaveBeenCalledWith(1);
    });

    it(`clamps at maximum ${MAX_OCCURRENCES}`, () => {
      const { screen, props } = renderSection({
        repeatEnabled: true,
        repeatEndMode: 'count',
        repeatCount: MAX_OCCURRENCES,
      });
      const tree = screen.toJSON();
      const { plus } = stepperButtons(tree, `${MAX_OCCURRENCES} times`);
      expect(plus.props.disabled).toBe(true);
      act(() => { plus.props.onPress(); });
      expect(props.onCountChange).toHaveBeenCalledWith(MAX_OCCURRENCES);
    });

    it('shows the repeatCountError text when set', () => {
      const { screen } = renderSection({
        repeatEnabled: true,
        repeatEndMode: 'count',
        repeatCountError: 'Choose how many times this repeats',
      });
      expect(screen.getByText('Choose how many times this repeats')).toBeTruthy();
    });

    it('does not render an error node when repeatCountError is empty', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatEndMode: 'count', repeatCountError: '' });
      const tree = screen.toJSON();
      function hasDangerText(node) {
        if (Array.isArray(node)) return node.some(hasDangerText);
        if (!node || typeof node !== 'object') return false;
        const style = node.props?.style;
        const flat = Array.isArray(style) ? style : [style];
        if (flat.some(s => s && s.color === DANGER)) return true;
        return (node.children || []).some(hasDangerText);
      }
      expect(hasDangerText(tree)).toBe(false);
    });
  });

  describe('expanded — end-date field wiring (until-mode)', () => {
    it('shows the repeatUntilError text when set', () => {
      const { screen } = renderSection({
        repeatEnabled: true,
        repeatEndMode: 'until',
        repeatUntilError: 'End date must be after the first due date',
      });
      expect(screen.getByText('End date must be after the first due date')).toBeTruthy();
    });

    it('does not render an error node when repeatUntilError is empty', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatEndMode: 'until', repeatUntilError: '' });
      const tree = screen.toJSON();
      function hasDangerText(node) {
        if (Array.isArray(node)) return node.some(hasDangerText);
        if (!node || typeof node !== 'object') return false;
        const style = node.props?.style;
        const flat = Array.isArray(style) ? style : [style];
        if (flat.some(s => s && s.color === DANGER)) return true;
        return (node.children || []).some(hasDangerText);
      }
      expect(hasDangerText(tree)).toBe(false);
    });

    it('passes a minimumDate derived from a valid dueDate to the picker', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatEndMode: 'until', dueDate: '2026-06-01' });
      screen.firePressOnText(REPEAT_UNTIL_PLACEHOLDER);
      const picker = screen.getAllByType('DateTimePicker')[0];
      expect(picker.props.minimumDate).toBeInstanceOf(Date);
      expect(picker.props.minimumDate.getFullYear()).toBe(2026);
    });

    it('passes undefined minimumDate when dueDate is not a valid date', () => {
      const { screen } = renderSection({ repeatEnabled: true, repeatEndMode: 'until', dueDate: '' });
      screen.firePressOnText(REPEAT_UNTIL_PLACEHOLDER);
      const picker = screen.getAllByType('DateTimePicker')[0];
      expect(picker.props.minimumDate).toBeUndefined();
    });

    it('forwards the picked date through onRepeatUntilChange', () => {
      const { screen, props } = renderSection({ repeatEnabled: true, repeatEndMode: 'until', dueDate: '2026-06-01' });
      screen.firePressOnText(REPEAT_UNTIL_PLACEHOLDER);
      const picker = screen.getAllByType('DateTimePicker')[0];
      act(() => { picker.props.onChange({ type: 'set' }, new Date(2026, 6, 15)); });
      expect(props.onRepeatUntilChange).toHaveBeenCalledWith('2026-07-15');
    });
  });
});
