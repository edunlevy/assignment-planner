import React from 'react';
import { Alert } from 'react-native';
import { act } from 'react-test-renderer';
import { render } from '../helpers/renderWithProviders';
import { makeAssignment, resetAssignmentCounter } from '../helpers/mockAssignment';
import AssignmentFormModal from '../../components/AssignmentFormModal';

beforeEach(() => {
  resetAssignmentCounter();
  vi.clearAllMocks();
});

// Default no-op callbacks.
const defaults = {
  visible: true,
  editing: null,
  saving: false,
  onClose: vi.fn(),
  onCreate: vi.fn(async () => {}),
  onCreateRecurring: vi.fn(async () => {}),
  onUpdate: vi.fn(async () => {}),
  onDelete: vi.fn(),
  onDeleteSeries: vi.fn(),
};

function makeProps(overrides = {}) {
  return { ...defaults, ...overrides };
}

// Fill a TextInput found by its placeholder text with a new value.
function fillInput(tree, placeholder, value) {
  function findInput(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'TextInput' && node.props.placeholder === placeholder) return node;
    for (const c of (node.children || [])) {
      const f = findInput(c);
      if (f) return f;
    }
    return null;
  }
  const input = findInput(tree);
  if (!input) throw new Error(`TextInput with placeholder "${placeholder}" not found`);
  act(() => { input.props.onChangeText(value); });
}

// --- Stepper helper (RecurringSeriesSection's Every-N and count steppers) --
// A Stepper renders <View>[Pressable(-), Text(value), Pressable(+)]</View>.
// Locate the row by a substring of its value text (e.g. "1 week") and press
// the minus/plus Pressable by position — the glyphs themselves ('−'/'+')
// are shared by both steppers when both are on screen, so text-matching on
// the glyph would be ambiguous.
function collectText(node) {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node || !node.children) return '';
  return node.children.map(collectText).join('');
}

function pressStepperButton(root, valueSubstring, which) {
  let target = null;
  (function walk(n) {
    if (target || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'View' && Array.isArray(n.children) && n.children.length === 3) {
      const textChild = n.children.find(c => c && c.type === 'Text');
      const pressables = n.children.filter(c => c && c.type === 'Pressable');
      if (textChild && pressables.length === 2 && collectText(textChild).includes(valueSubstring)) {
        target = pressables[which === 'minus' ? 0 : 1];
      }
    }
    (n.children || []).forEach(walk);
  })(root);
  if (!target) throw new Error(`Stepper button ("${which}") not found for value containing "${valueSubstring}"`);
  act(() => { target.props.onPress(); });
}

describe('AssignmentFormModal — create mode', () => {
  it('renders without crashing', () => {
    expect(() => render(React.createElement(AssignmentFormModal, makeProps()))).not.toThrow();
  });

  it('shows "New Assignment" title', () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps()));
    expect(screen.getByText('New Assignment')).toBeTruthy();
  });

  it('shows Title and Course field labels', () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps()));
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('Course')).toBeTruthy();
  });

  it('shows Due Date and Due Time field labels', () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps()));
    expect(screen.getByText('Due Date')).toBeTruthy();
    expect(screen.getByText('Due Time (optional)')).toBeTruthy();
  });

  it('shows "Save Assignment" button', () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps()));
    expect(screen.getByText('Save Assignment')).toBeTruthy();
  });

  it('shows "Cancel" button', () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps()));
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('does not show "Delete Assignment" in create mode', () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps()));
    expect(screen.queryByText('Delete Assignment')).toBeNull();
  });

  it('does not show Status section in create mode', () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps()));
    expect(screen.queryByText('Status')).toBeNull();
  });

  it('shows validation errors for empty title and course on save', async () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps()));
    await screen.flush();
    screen.firePressOnText('Save Assignment');
    await screen.flush();
    // formValidation sets error messages for empty title and course
    expect(screen.queryByText("Title is required")).not.toBeNull();
  });

  it('calls onCreate with correct base fields when form is valid', async () => {
    const onCreate = vi.fn(async () => {});
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ onCreate })));
    await screen.flush();
    const tree = screen.toJSON();
    fillInput(tree, 'e.g. Problem Set 4', 'Calculus Midterm');
    fillInput(tree, 'e.g. MATH 201', 'MATH 201');
    // Set due date by finding DueDateField's Pressable and simulating onChange.
    // DueDateField renders a Pressable → but its onChange is called internally.
    // We simulate by finding the DueDateField's onPress on the Pressable inside it
    // and triggering the picker onChange instead.
    act(() => {
      // Find DateTimePicker or simulate onChange on the DueDateField directly via
      // the form's internal state pathway: locate and call the DueDateField onChange.
      // The DueDateField is rendered as a View > Pressable in iOS mode.
      // We press it to open the picker, then call onChange on the DateTimePicker.
      screen.firePressOnText('Tap to choose a date');
    });
    const updatedTree = screen.toJSON();
    function findPicker(node) {
      if (!node || typeof node !== 'object') return null;
      if (node.type === 'DateTimePicker') return node;
      for (const c of (node.children || [])) {
        const f = findPicker(c);
        if (f) return f;
      }
      return null;
    }
    const picker = findPicker(updatedTree);
    // Construct in local time (not UTC) so date-fns `format` doesn't shift
    // the day backward in timezones behind UTC.
    act(() => { picker.props.onChange({}, new Date(2026, 6, 1)); });
    screen.firePressOnText('Done');
    screen.firePressOnText('Save Assignment');
    await screen.flush();
    expect(onCreate).toHaveBeenCalledOnce();
    const [args] = onCreate.mock.calls[0];
    expect(args.title).toBe('Calculus Midterm');
    expect(args.course).toBe('MATH 201');
    expect(args.dueDate).toBe('2026-07-01');
    expect(args.status).toBe('not_started');
  });

  it('calls onClose when Cancel is pressed', () => {
    const onClose = vi.fn();
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ onClose })));
    screen.firePressOnText('Cancel');
    expect(onClose).toHaveBeenCalledOnce();
  });

  // Fill the two required text fields and pick a due date so the form validates.
  function fillRequired(screen, { title = 'Essay', course = 'ENGL 200' } = {}) {
    fillInput(screen.toJSON(), 'e.g. Problem Set 4', title);
    fillInput(screen.toJSON(), 'e.g. MATH 201', course);
    screen.firePressOnText('Tap to choose a date');
    act(() => { screen.getAllByType('DateTimePicker')[0].props.onChange({}, new Date(2026, 6, 1)); });
    screen.firePressOnText('Done');
  }

  it('forwards the selected importance and complexity to onCreate', async () => {
    const onCreate = vi.fn(async () => {});
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ onCreate })));
    await screen.flush();
    fillRequired(screen);
    screen.firePressOnText('5');    // importance button
    screen.firePressOnText('Long'); // complexity button
    screen.firePressOnText('Save Assignment');
    await screen.flush();
    expect(onCreate).toHaveBeenCalledOnce();
    const [args] = onCreate.mock.calls[0];
    expect(args.importance).toBe(5);
    expect(args.complexity).toBe('long');
  });

  it('forwards a chosen due time to onCreate', async () => {
    const onCreate = vi.fn(async () => {});
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ onCreate })));
    await screen.flush();
    fillRequired(screen);
    screen.firePressOnText('Tap to choose a time');
    act(() => { screen.getAllByType('DateTimePicker')[0].props.onChange({ type: 'set' }, new Date(2026, 0, 1, 14, 30)); });
    screen.firePressOnText('Save Assignment');
    await screen.flush();
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate.mock.calls[0][0].dueTime).toBe('14:30');
  });

  it('creates a recurring series with the chosen frequency/interval and end date (until-mode)', async () => {
    const onCreate = vi.fn(async () => {});
    const onCreateRecurring = vi.fn(async () => {});
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ onCreate, onCreateRecurring })));
    await screen.flush();
    fillRequired(screen, { title: 'Weekly Quiz', course: 'CHEM 101' });

    // Turn on recurring (defaults: weekly, interval 1, until-mode) and bump
    // the interval stepper from 1 week to 2 weeks.
    screen.firePressOnText('Repeats…');
    pressStepperButton(screen.toJSON(), '1 week', 'plus');

    screen.firePressOnText('Tap to choose an end date');
    act(() => { screen.getAllByType('DateTimePicker')[0].props.onChange({}, new Date(2026, 7, 1)); });
    screen.firePressOnText('Done');
    screen.firePressOnText('Save Assignment');
    await screen.flush();
    expect(onCreateRecurring).toHaveBeenCalledOnce();
    // Recurring branch is exclusive — the one-off create path must not fire.
    expect(onCreate).not.toHaveBeenCalled();
    const [args] = onCreateRecurring.mock.calls[0];
    expect(args.rule).toEqual({
      freq: 'weekly',
      interval: 2,
      end: { untilISO: '2026-08-01' },
    });
  });

  it('creates a recurring series in count-mode with a monthly frequency and selected count', async () => {
    const onCreateRecurring = vi.fn(async () => {});
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ onCreateRecurring })));
    await screen.flush();
    fillRequired(screen, { title: 'Monthly Report', course: 'BUS300' });

    screen.firePressOnText('Repeats…');
    screen.firePressOnText('Monthly');
    screen.firePressOnText('After N times');
    pressStepperButton(screen.toJSON(), '10 times', 'plus'); // 10 -> 11

    screen.firePressOnText('Save Assignment');
    await screen.flush();

    expect(onCreateRecurring).toHaveBeenCalledOnce();
    const [args] = onCreateRecurring.mock.calls[0];
    expect(args.rule).toEqual({
      freq: 'monthly',
      interval: 1,
      end: { count: 11 },
    });
  });
});

describe('AssignmentFormModal — edit mode', () => {
  function editingAssignment(overrides = {}) {
    return makeAssignment({
      title: 'Lab Report',
      course: 'BIO101',
      dueDate: '2026-06-10',
      dueTime: '14:00',
      importance: 4,
      complexity: 'long',
      status: 'in_progress',
      ...overrides,
    });
  }

  it('shows "Edit Assignment" title', () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ editing: editingAssignment() })));
    expect(screen.getByText('Edit Assignment')).toBeTruthy();
  });

  it('pre-fills the title input with the editing assignment title', async () => {
    const editing = editingAssignment();
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ editing })));
    await screen.flush();
    const tree = screen.toJSON();
    function findTitleInput(node) {
      if (!node || typeof node !== 'object') return null;
      if (node.type === 'TextInput' && node.props.value === 'Lab Report') return node;
      for (const c of (node.children || [])) {
        const f = findTitleInput(c);
        if (f) return f;
      }
      return null;
    }
    expect(findTitleInput(tree)).not.toBeNull();
  });

  it('shows Status section in edit mode', async () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ editing: editingAssignment() })));
    await screen.flush();
    expect(screen.getByText('Status')).toBeTruthy();
  });

  it('shows all three status options', async () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ editing: editingAssignment() })));
    await screen.flush();
    expect(screen.getByText('Not Started')).toBeTruthy();
    expect(screen.getByText('In Progress')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('shows "Delete Assignment" button in edit mode', async () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ editing: editingAssignment() })));
    await screen.flush();
    expect(screen.getByText('Delete Assignment')).toBeTruthy();
  });

  it('shows "Save Changes" button in edit mode', async () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ editing: editingAssignment() })));
    await screen.flush();
    expect(screen.getByText('Save Changes')).toBeTruthy();
  });

  it('does not show RecurringSeriesSection in edit mode', async () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ editing: editingAssignment() })));
    await screen.flush();
    // Recurring toggle only shows in create mode
    expect(screen.queryByText('Repeats…')).toBeNull();
  });

  it('pressing Delete triggers Alert.alert', async () => {
    const editing = editingAssignment();
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ editing })));
    await screen.flush();
    screen.firePressOnText('Delete Assignment');
    expect(Alert.alert).toHaveBeenCalledOnce();
    const [title] = Alert.alert.mock.calls[0];
    expect(title).toBe('Delete Assignment');
  });

  it('does not show "Delete Entire Series" when seriesId is null', async () => {
    const editing = editingAssignment(); // seriesId: null by default
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ editing })));
    await screen.flush();
    expect(screen.queryByText('Delete Entire Series')).toBeNull();
  });

  it('shows "Delete Entire Series" when seriesId is set, and confirming calls onDeleteSeries', async () => {
    const onDeleteSeries = vi.fn();
    const editing = editingAssignment({ seriesId: 'series-1' });
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ editing, onDeleteSeries })));
    await screen.flush();

    expect(screen.getByText('Delete Entire Series')).toBeTruthy();

    screen.firePressOnText('Delete Entire Series');
    expect(Alert.alert).toHaveBeenCalledOnce();
    const [title, , buttons] = Alert.alert.mock.calls[0];
    expect(title).toBe('Delete Entire Series');

    const deleteAllButton = buttons.find(b => b.text === 'Delete All');
    act(() => { deleteAllButton.onPress(); });

    expect(onDeleteSeries).toHaveBeenCalledWith('series-1');
  });

  it('calls onUpdate with changed fields when saving in edit mode', async () => {
    const onUpdate = vi.fn(async () => {});
    const editing = editingAssignment();
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ editing, onUpdate })));
    await screen.flush();
    screen.firePressOnText('Save Changes');
    await screen.flush();
    expect(onUpdate).toHaveBeenCalledOnce();
    const [id, changes] = onUpdate.mock.calls[0];
    expect(id).toBe(editing.id);
    expect(changes.title).toBe('Lab Report');
    expect(changes.course).toBe('BIO101');
  });

  it('forwards a status change to onUpdate', async () => {
    const onUpdate = vi.fn(async () => {});
    const editing = editingAssignment(); // starts as in_progress
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ editing, onUpdate })));
    await screen.flush();
    screen.firePressOnText('Completed'); // status button
    screen.firePressOnText('Save Changes');
    await screen.flush();
    expect(onUpdate).toHaveBeenCalledOnce();
    const [, changes] = onUpdate.mock.calls[0];
    expect(changes.status).toBe('completed');
  });
});

describe('AssignmentFormModal — saving state', () => {
  it('Save button is disabled when saving=true', () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ saving: true })));
    const tree = screen.toJSON();
    function findSaveButton(node) {
      if (!node || typeof node !== 'object') return null;
      if (node.type === 'Pressable' && node.props.disabled === true) {
        // Look for ActivityIndicator as a child
        function hasIndicator(n) {
          if (!n || typeof n !== 'object') return false;
          if (n.type === 'ActivityIndicator') return true;
          return (n.children || []).some(hasIndicator);
        }
        if (hasIndicator(node)) return node;
      }
      for (const c of (node.children || [])) {
        const f = findSaveButton(c);
        if (f) return f;
      }
      return null;
    }
    expect(findSaveButton(tree)).not.toBeNull();
  });

  it('shows ActivityIndicator instead of button text when saving=true', () => {
    const screen = render(React.createElement(AssignmentFormModal, makeProps({ saving: true })));
    expect(screen.queryByText('Save Assignment')).toBeNull();
    // ActivityIndicator is rendered — confirm it appears in the tree
    const tree = screen.toJSON();
    function hasActivityIndicator(node) {
      if (!node || typeof node !== 'object') return false;
      if (node.type === 'ActivityIndicator') return true;
      return (node.children || []).some(hasActivityIndicator);
    }
    expect(hasActivityIndicator(tree)).toBe(true);
  });
});
