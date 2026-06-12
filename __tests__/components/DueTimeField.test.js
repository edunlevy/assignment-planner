// Tests run with Platform.OS = 'ios' (set in jest.setup.js).
import React from 'react';
import { act } from 'react-test-renderer';
import { render } from '../helpers/renderWithProviders';
import { resetAssignmentCounter } from '../helpers/mockAssignment';
import DueTimeField from '../../components/DueTimeField';

beforeEach(() => {
  resetAssignmentCounter();
});

const noop = () => {};

describe('DueTimeField (iOS)', () => {
  it('renders without crashing', () => {
    expect(() => render(React.createElement(DueTimeField, { value: '', onChange: noop, onClear: noop }))).not.toThrow();
  });

  it('shows placeholder text when no value is provided', () => {
    const screen = render(React.createElement(DueTimeField, { value: '', onChange: noop, onClear: noop }));
    expect(screen.getByText('Tap to choose a time')).toBeTruthy();
  });

  it('renders a formatted time when value is provided (24h → 12h)', () => {
    const screen = render(React.createElement(DueTimeField, {
      value: '14:30',
      onChange: noop,
      onClear: noop,
    }));
    expect(screen.getByText('2:30 PM')).toBeTruthy();
  });

  it('renders AM times correctly', () => {
    const screen = render(React.createElement(DueTimeField, {
      value: '09:05',
      onChange: noop,
      onClear: noop,
    }));
    expect(screen.getByText('9:05 AM')).toBeTruthy();
  });

  it('Clear button is not shown when value is empty', () => {
    const screen = render(React.createElement(DueTimeField, { value: '', onChange: noop, onClear: noop }));
    expect(screen.queryByText('Clear')).toBeNull();
  });

  it('Clear button is shown when value is set', () => {
    const screen = render(React.createElement(DueTimeField, {
      value: '10:00',
      onChange: noop,
      onClear: noop,
    }));
    expect(screen.getByText('Clear')).toBeTruthy();
  });

  it('pressing Clear calls onClear', () => {
    const onClear = vi.fn();
    const screen = render(React.createElement(DueTimeField, {
      value: '10:00',
      onChange: noop,
      onClear,
    }));
    screen.firePressOnText('Clear');
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('applies error border style when hasError is true', () => {
    const screen = render(React.createElement(DueTimeField, {
      value: '',
      onChange: noop,
      onClear: noop,
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

  it('time picker is not visible initially', () => {
    const screen = render(React.createElement(DueTimeField, { value: '', onChange: noop, onClear: noop }));
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('pressing the field opens the time picker on iOS', () => {
    const screen = render(React.createElement(DueTimeField, { value: '', onChange: noop, onClear: noop }));
    screen.firePressOnText('Tap to choose a time');
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('pressing Done closes the time picker', () => {
    const screen = render(React.createElement(DueTimeField, { value: '', onChange: noop, onClear: noop }));
    screen.firePressOnText('Tap to choose a time');
    screen.firePressOnText('Done');
    expect(screen.queryByText('Done')).toBeNull();
  });
});
