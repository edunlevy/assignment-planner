import React from 'react';
import { render, act } from '../helpers/renderWithProviders';
import RecurringSeriesSection from '../../components/RecurringSeriesSection';
import { PRIMARY, DANGER } from '../../lib/constants';

// RecurringSeriesSection is a pure presentational sub-form; all state lives in
// the parent. These tests exercise its own branches directly (previously it was
// only covered incidentally through AssignmentFormModal).
//
// The component returns a fragment, so when expanded its render root is an
// array — rendered directly here to exercise the render helper's array-root
// walk (a <View> wrapper was previously needed before that walk was fixed).

const REPEAT_UNTIL_PLACEHOLDER = 'Tap to choose an end date';

function renderSection(overrides = {}) {
  const props = {
    repeatWeekly: false,
    repeatInterval: 1,
    repeatUntil: '',
    dueDate: '2026-06-01',
    repeatUntilError: '',
    onToggle: vi.fn(),
    onIntervalChange: vi.fn(),
    onRepeatUntilChange: vi.fn(),
    ...overrides,
  };
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

// Find the first Pressable whose concatenated text contains `text`.
// Handles an array root (the component renders a fragment when expanded).
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

describe('RecurringSeriesSection', () => {
  describe('collapsed (repeatWeekly = false)', () => {
    it('renders only the toggle row, no interval/end-date controls', () => {
      const { screen } = renderSection({ repeatWeekly: false });
      expect(screen.getByText('Repeat until…')).toBeTruthy();
      expect(screen.queryByText('Repeat interval')).toBeNull();
      expect(screen.queryByText('Weekly')).toBeNull();
    });

    it('does not render the checkmark when unchecked', () => {
      const { screen } = renderSection({ repeatWeekly: false });
      expect(screen.queryByText('✓')).toBeNull();
    });

    it('calls onToggle when the toggle row is pressed', () => {
      const { screen, props } = renderSection({ repeatWeekly: false });
      screen.firePressOnText('Repeat until…');
      expect(props.onToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe('expanded (repeatWeekly = true)', () => {
    it('renders the checkmark, interval options, and end-date field', () => {
      const { screen } = renderSection({ repeatWeekly: true });
      expect(screen.getByText('✓')).toBeTruthy();
      expect(screen.getByText('Repeat interval')).toBeTruthy();
      expect(screen.getByText('Weekly')).toBeTruthy();
      expect(screen.getByText('Every 2 weeks')).toBeTruthy();
      expect(screen.getByText(REPEAT_UNTIL_PLACEHOLDER)).toBeTruthy();
    });

    it('calls onIntervalChange(1) when Weekly is pressed', () => {
      const { screen, props } = renderSection({ repeatWeekly: true, repeatInterval: 2 });
      screen.firePressOnText('Weekly');
      expect(props.onIntervalChange).toHaveBeenCalledWith(1);
    });

    it('calls onIntervalChange(2) when "Every 2 weeks" is pressed', () => {
      const { screen, props } = renderSection({ repeatWeekly: true, repeatInterval: 1 });
      screen.firePressOnText('Every 2 weeks');
      expect(props.onIntervalChange).toHaveBeenCalledWith(2);
    });

    it('highlights the selected interval and not the unselected one', () => {
      const { screen } = renderSection({ repeatWeekly: true, repeatInterval: 1 });
      const tree = screen.toJSON();
      const weekly = findPressableByText(tree, 'Weekly');
      const biweekly = findPressableByText(tree, 'Every 2 weeks');
      expect(styleHasBackground(weekly, PRIMARY)).toBe(true);
      expect(styleHasBackground(biweekly, PRIMARY)).toBe(false);
    });

    it('shows the validation error when repeatUntilError is set', () => {
      const { screen } = renderSection({ repeatWeekly: true, repeatUntilError: 'End date must be after the due date' });
      expect(screen.getByText('End date must be after the due date')).toBeTruthy();
    });

    it('does not render an error node when repeatUntilError is empty', () => {
      const { screen } = renderSection({ repeatWeekly: true, repeatUntilError: '' });
      // The only DANGER-coloured text would be the error message.
      const tree = screen.toJSON();
      function hasDangerText(node) {
        if (Array.isArray(node)) return node.some(hasDangerText); // fragment root
        if (!node || typeof node !== 'object') return false;
        const style = node.props?.style;
        const flat = Array.isArray(style) ? style : [style];
        if (flat.some(s => s && s.color === DANGER)) return true;
        return (node.children || []).some(hasDangerText);
      }
      expect(hasDangerText(tree)).toBe(false);
    });
  });

  describe('end-date field wiring', () => {
    it('passes a minimumDate derived from a valid dueDate to the picker', () => {
      const { screen } = renderSection({ repeatWeekly: true, dueDate: '2026-06-01' });
      // Open the iOS picker so the DateTimePicker (and its minimumDate) mounts.
      screen.firePressOnText(REPEAT_UNTIL_PLACEHOLDER);
      const picker = screen.getAllByType('DateTimePicker')[0];
      expect(picker.props.minimumDate).toBeInstanceOf(Date);
      expect(picker.props.minimumDate.getFullYear()).toBe(2026);
    });

    it('passes undefined minimumDate when dueDate is not a valid date', () => {
      const { screen } = renderSection({ repeatWeekly: true, dueDate: '' });
      screen.firePressOnText(REPEAT_UNTIL_PLACEHOLDER);
      const picker = screen.getAllByType('DateTimePicker')[0];
      expect(picker.props.minimumDate).toBeUndefined();
    });

    it('forwards the picked date through onRepeatUntilChange', () => {
      const { screen, props } = renderSection({ repeatWeekly: true, dueDate: '2026-06-01' });
      screen.firePressOnText(REPEAT_UNTIL_PLACEHOLDER);
      const picker = screen.getAllByType('DateTimePicker')[0];
      act(() => { picker.props.onChange({ type: 'set' }, new Date(2026, 6, 15)); });
      expect(props.onRepeatUntilChange).toHaveBeenCalledWith('2026-07-15');
    });
  });
});
