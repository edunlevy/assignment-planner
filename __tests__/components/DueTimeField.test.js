// Tests run with Platform.OS = 'ios' (set in jest.setup.js).
import React from 'react';
import { Platform } from 'react-native';
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

  it('seeds the picker with the parsed stored time', () => {
    const screen = render(React.createElement(DueTimeField, { value: '14:30', onChange: noop, onClear: noop }));
    screen.firePressOnText('2:30 PM'); // open the picker
    const picker = screen.getAllByType('DateTimePicker')[0];
    expect(picker.props.value.getHours()).toBe(14);
    expect(picker.props.value.getMinutes()).toBe(30);
  });

  it('selecting a time from the picker calls onChange with HH:MM', () => {
    const onChange = vi.fn();
    const screen = render(React.createElement(DueTimeField, { value: '14:30', onChange, onClear: noop }));
    screen.firePressOnText('2:30 PM');
    const picker = screen.getAllByType('DateTimePicker')[0];
    act(() => { picker.props.onChange({ type: 'set' }, new Date(2026, 0, 1, 9, 5)); });
    expect(onChange).toHaveBeenCalledWith('09:05');
  });
});

// The app also runs on web and Android; those render branches are never hit
// under the default iOS platform, so exercise them by overriding Platform.OS.
describe('DueTimeField (web)', () => {
  beforeEach(() => { Platform.OS = 'web'; });
  afterEach(() => { Platform.OS = 'ios'; });

  it('renders a text input and forwards typing to onChange', () => {
    const onChange = vi.fn();
    const screen = render(React.createElement(DueTimeField, { value: '', onChange, onClear: noop }));
    const input = screen.getAllByType('TextInput')[0];
    expect(input.props.placeholder).toBe('HH:MM (e.g. 14:30)');
    act(() => { input.props.onChangeText('14:30'); });
    expect(onChange).toHaveBeenCalledWith('14:30');
  });

  it('shows Clear (wired to onClear) only when a value is set', () => {
    const onClear = vi.fn();
    const empty = render(React.createElement(DueTimeField, { value: '', onChange: noop, onClear }));
    expect(empty.queryByText('Clear')).toBeNull();

    const filled = render(React.createElement(DueTimeField, { value: '10:00', onChange: noop, onClear }));
    filled.firePressOnText('Clear');
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe('DueTimeField (android)', () => {
  beforeEach(() => { Platform.OS = 'android'; });
  afterEach(() => { Platform.OS = 'ios'; });

  it('selecting a time calls onChange and closes the picker', () => {
    const onChange = vi.fn();
    const screen = render(React.createElement(DueTimeField, { value: '', onChange, onClear: noop }));
    screen.firePressOnText('Tap to choose a time'); // android renders the picker inline
    const picker = screen.getAllByType('DateTimePicker')[0];
    act(() => { picker.props.onChange({ type: 'set' }, new Date(2026, 0, 1, 8, 15)); });
    expect(onChange).toHaveBeenCalledWith('08:15');
  });

  it('dismissing the picker does not call onChange even if a date is present', () => {
    // Pass a truthy date with type:'dismissed' so the assertion gates the
    // android dismissed guard specifically — if that early return were removed,
    // execution would fall through to `if (selectedDate)` and call onChange.
    const onChange = vi.fn();
    const screen = render(React.createElement(DueTimeField, { value: '', onChange, onClear: noop }));
    screen.firePressOnText('Tap to choose a time');
    const picker = screen.getAllByType('DateTimePicker')[0];
    act(() => { picker.props.onChange({ type: 'dismissed' }, new Date(2026, 0, 1, 8, 15)); });
    expect(onChange).not.toHaveBeenCalled();
  });
});
