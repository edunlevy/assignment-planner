// Tests run with Platform.OS = 'ios' (set in jest.setup.js).
import React from 'react';
import { act } from 'react-test-renderer';
import { render } from '../helpers/renderWithProviders';
import { makeAssignment, resetAssignmentCounter } from '../helpers/mockAssignment';
import DueDateField from '../../components/DueDateField';

beforeEach(() => {
  resetAssignmentCounter();
});

const noop = () => {};

describe('DueDateField (iOS)', () => {
  it('renders without crashing', () => {
    expect(() => render(React.createElement(DueDateField, { value: '', onChange: noop }))).not.toThrow();
  });

  it('shows placeholder text when no value is provided', () => {
    const screen = render(React.createElement(DueDateField, { value: '', onChange: noop }));
    expect(screen.getByText('Tap to choose a date')).toBeTruthy();
  });

  it('shows a custom placeholder when the prop is set', () => {
    const screen = render(React.createElement(DueDateField, {
      value: '',
      onChange: noop,
      placeholder: 'Pick start date',
    }));
    expect(screen.getByText('Pick start date')).toBeTruthy();
  });

  it('renders a formatted date string when value is provided', () => {
    const screen = render(React.createElement(DueDateField, {
      value: '2026-06-15',
      onChange: noop,
    }));
    // date-fns format: 'EEE, MMM d, yyyy' → "Mon, Jun 15, 2026"
    expect(screen.getByText('Mon, Jun 15, 2026')).toBeTruthy();
  });

  it('no error styling when hasError is false', () => {
    const screen = render(React.createElement(DueDateField, {
      value: '',
      onChange: noop,
      hasError: false,
    }));
    const tree = screen.toJSON();
    function hasErrorBorder(node) {
      if (!node || typeof node !== 'object') return false;
      const s = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
      if (s.some(st => st && st.borderColor === '#FF6B6B')) return true;
      return (node.children || []).some(hasErrorBorder);
    }
    expect(hasErrorBorder(tree)).toBe(false);
  });

  it('applies error border style when hasError is true', () => {
    const screen = render(React.createElement(DueDateField, {
      value: '',
      onChange: noop,
      hasError: true,
    }));
    const tree = screen.toJSON();
    function hasErrorBorder(node) {
      if (!node || typeof node !== 'object') return false;
      const s = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
      if (s.some(st => st && st.borderColor === '#FF6B6B')) return true;
      return (node.children || []).some(hasErrorBorder);
    }
    expect(hasErrorBorder(tree)).toBe(true);
  });

  it('date picker is not visible initially', () => {
    const screen = render(React.createElement(DueDateField, { value: '', onChange: noop }));
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('pressing the field opens the date picker on iOS', () => {
    const screen = render(React.createElement(DueDateField, { value: '', onChange: noop }));
    screen.firePressOnText('Tap to choose a date');
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('pressing Done closes the date picker', () => {
    const screen = render(React.createElement(DueDateField, { value: '', onChange: noop }));
    screen.firePressOnText('Tap to choose a date');
    expect(screen.getByText('Done')).toBeTruthy();
    screen.firePressOnText('Done');
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('calls onChange when a date is selected via the picker', () => {
    const onChange = vi.fn();
    const screen = render(React.createElement(DueDateField, { value: '', onChange }));
    screen.firePressOnText('Tap to choose a date');
    // Find the DateTimePicker node and simulate an onChange call.
    const tree = screen.toJSON();
    function findPicker(node) {
      if (!node || typeof node !== 'object') return null;
      if (node.type === 'DateTimePicker') return node;
      for (const c of (node.children || [])) {
        const f = findPicker(c);
        if (f) return f;
      }
      return null;
    }
    const picker = findPicker(tree);
    expect(picker).not.toBeNull();
    act(() => {
      // Construct in local time (not UTC) so date-fns `format` doesn't shift
      // the day backward in timezones behind UTC.
      picker.props.onChange({}, new Date(2026, 8, 1));
    });
    expect(onChange).toHaveBeenCalledWith('2026-09-01');
  });
});
