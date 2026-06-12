// PR 2.4 — useAssignmentForm tests
// Exercises the form state/validation/submit/delete logic extracted from
// AssignmentFormModal, in isolation (no component rendering).

import { Alert } from 'react-native';
import { act } from 'react-test-renderer';
import { renderHook, flushMicrotasks } from '../helpers/renderHook';
import { useAssignmentForm, EMPTY_FORM } from '../../hooks/useAssignmentForm';
import { makeAssignment, resetAssignmentCounter } from '../helpers/mockAssignment';

beforeEach(() => {
  resetAssignmentCounter();
  vi.clearAllMocks();
});

function defaultCallbacks(overrides = {}) {
  return {
    onCreate: vi.fn(async () => {}),
    onCreateRecurring: vi.fn(async () => {}),
    onUpdate: vi.fn(async () => {}),
    onDelete: vi.fn(),
    onDeleteSeries: vi.fn(),
    ...overrides,
  };
}

describe('useAssignmentForm — initial state', () => {
  it('create mode: form is EMPTY_FORM after the reset effect', async () => {
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks() })
    );
    await flushMicrotasks();
    expect(result.current.form).toEqual(EMPTY_FORM);
    expect(result.current.isEditing).toBe(false);
  });

  it('edit mode: form is pre-filled from the editing item', async () => {
    const editing = makeAssignment({
      title: 'Lab Report',
      course: 'BIO101',
      dueDate: '2026-06-10',
      dueTime: '14:00',
      importance: 4,
      complexity: 'long',
      status: 'in_progress',
    });
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks() })
    );
    await flushMicrotasks();
    expect(result.current.form.title).toBe('Lab Report');
    expect(result.current.form.course).toBe('BIO101');
    expect(result.current.form.dueDate).toBe('2026-06-10');
    expect(result.current.form.dueTime).toBe('14:00');
    expect(result.current.form.importance).toBe(4);
    expect(result.current.form.complexity).toBe('long');
    expect(result.current.form.status).toBe('in_progress');
    expect(result.current.form.repeatWeekly).toBe(false);
    expect(result.current.isEditing).toBe(true);
  });
});

describe('useAssignmentForm — handleChange', () => {
  it('updates a field value', async () => {
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks() })
    );
    await flushMicrotasks();
    act(() => { result.current.handleChange('title', 'New Title'); });
    expect(result.current.form.title).toBe('New Title');
  });

  it('clears the matching field error when present', async () => {
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks() })
    );
    await flushMicrotasks();
    // Trigger validation errors via an empty-form submit.
    await act(async () => { await result.current.handleSubmit(); });
    expect(result.current.fieldErrors.title).toBeTruthy();

    act(() => { result.current.handleChange('title', 'Filled'); });
    expect(result.current.fieldErrors.title).toBe('');
  });

  it('importance/complexity/status changes update the form (no error entries to clear)', async () => {
    const editing = makeAssignment({ status: 'not_started' });
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks() })
    );
    await flushMicrotasks();

    act(() => { result.current.handleChange('importance', 5); });
    expect(result.current.form.importance).toBe(5);

    act(() => { result.current.handleChange('complexity', 'short'); });
    expect(result.current.form.complexity).toBe('short');

    act(() => { result.current.handleChange('status', 'completed'); });
    expect(result.current.form.status).toBe('completed');
  });
});

describe('useAssignmentForm — reset on open', () => {
  it('re-seeds form from editing when visible flips false -> true', async () => {
    const editing = makeAssignment({ title: 'Essay' });
    let visible = true;
    const { result, rerender } = renderHook(() =>
      useAssignmentForm({ visible, editing, ...defaultCallbacks() })
    );
    await flushMicrotasks();
    expect(result.current.form.title).toBe('Essay');

    act(() => { result.current.handleChange('title', 'Edited locally'); });
    expect(result.current.form.title).toBe('Edited locally');

    // visible: false -> should not re-seed (edit stays)
    visible = false;
    rerender();
    await flushMicrotasks();
    expect(result.current.form.title).toBe('Edited locally');

    // visible: true again -> re-seeds from editing
    visible = true;
    rerender();
    await flushMicrotasks();
    expect(result.current.form.title).toBe('Essay');
  });

  it('re-seeds form when editing.id changes', async () => {
    const editingA = makeAssignment({ title: 'Essay A' });
    const editingB = makeAssignment({ title: 'Essay B' });
    let editing = editingA;
    const cbs = defaultCallbacks();

    const { result, rerender } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...cbs })
    );
    await flushMicrotasks();
    expect(result.current.form.title).toBe('Essay A');

    editing = editingB;
    rerender();
    await flushMicrotasks();
    expect(result.current.form.title).toBe('Essay B');
  });
});

describe('useAssignmentForm — handleSubmit', () => {
  it('create (non-recurring): calls onCreate with trimmed base + status not_started', async () => {
    const onCreate = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks({ onCreate }) })
    );
    await flushMicrotasks();

    act(() => {
      result.current.handleChange('title', '  Calculus Midterm  ');
      result.current.handleChange('course', '  MATH 201  ');
      result.current.handleChange('dueDate', '2026-07-01');
    });

    await act(async () => { await result.current.handleSubmit(); });

    expect(onCreate).toHaveBeenCalledOnce();
    const [payload] = onCreate.mock.calls[0];
    expect(payload).toEqual({
      title: 'Calculus Midterm',
      course: 'MATH 201',
      dueDate: '2026-07-01',
      dueTime: null,
      importance: 3,
      complexity: 'medium',
      status: 'not_started',
    });
  });

  it('create (recurring): calls onCreateRecurring with base + repeatInterval/repeatUntil', async () => {
    const onCreateRecurring = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks({ onCreateRecurring }) })
    );
    await flushMicrotasks();

    act(() => {
      result.current.handleChange('title', 'Weekly Quiz');
      result.current.handleChange('course', 'CS101');
      result.current.handleChange('dueDate', '2026-07-01');
      result.current.toggleRecurring();
    });
    act(() => {
      result.current.handleChange('repeatInterval', 2);
      result.current.handleChange('repeatUntil', '2026-08-01');
    });

    await act(async () => { await result.current.handleSubmit(); });

    expect(onCreateRecurring).toHaveBeenCalledOnce();
    const [payload] = onCreateRecurring.mock.calls[0];
    expect(payload).toEqual({
      title: 'Weekly Quiz',
      course: 'CS101',
      dueDate: '2026-07-01',
      dueTime: null,
      importance: 3,
      complexity: 'medium',
      repeatInterval: 2,
      repeatUntil: '2026-08-01',
    });
  });

  it('edit: calls onUpdate(editing.id, {...base, status})', async () => {
    const onUpdate = vi.fn(async () => {});
    const editing = makeAssignment({
      title: 'Lab Report',
      course: 'BIO101',
      dueDate: '2026-06-10',
      dueTime: '14:00',
      importance: 4,
      complexity: 'long',
      status: 'in_progress',
    });
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks({ onUpdate }) })
    );
    await flushMicrotasks();

    act(() => { result.current.handleChange('status', 'completed'); });

    await act(async () => { await result.current.handleSubmit(); });

    expect(onUpdate).toHaveBeenCalledOnce();
    const [id, payload] = onUpdate.mock.calls[0];
    expect(id).toBe(editing.id);
    expect(payload).toEqual({
      title: 'Lab Report',
      course: 'BIO101',
      dueDate: '2026-06-10',
      dueTime: '14:00',
      importance: 4,
      complexity: 'long',
      status: 'completed',
    });
  });

  it('invalid form (empty title) sets fieldErrors and calls no callback', async () => {
    const cbs = defaultCallbacks();
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...cbs })
    );
    await flushMicrotasks();

    await act(async () => { await result.current.handleSubmit(); });

    expect(result.current.fieldErrors.title).toBeTruthy();
    expect(cbs.onCreate).not.toHaveBeenCalled();
    expect(cbs.onCreateRecurring).not.toHaveBeenCalled();
    expect(cbs.onUpdate).not.toHaveBeenCalled();
  });
});

describe('useAssignmentForm — toggleRecurring', () => {
  it('flips repeatWeekly and resets repeatInterval/repeatUntil', async () => {
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks() })
    );
    await flushMicrotasks();

    act(() => {
      result.current.handleChange('repeatInterval', 2);
      result.current.handleChange('repeatUntil', '2026-08-01');
    });
    act(() => { result.current.toggleRecurring(); });

    expect(result.current.form.repeatWeekly).toBe(true);
    expect(result.current.form.repeatInterval).toBe(1);
    expect(result.current.form.repeatUntil).toBe('');

    act(() => { result.current.toggleRecurring(); });
    expect(result.current.form.repeatWeekly).toBe(false);
  });
});

describe('useAssignmentForm — clearDueTime', () => {
  it('sets dueTime to empty string', async () => {
    const editing = makeAssignment({ dueTime: '14:00' });
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks() })
    );
    await flushMicrotasks();
    expect(result.current.form.dueTime).toBe('14:00');

    act(() => { result.current.clearDueTime(); });
    expect(result.current.form.dueTime).toBe('');
  });
});

describe('useAssignmentForm — handleDelete (native)', () => {
  it('Alert.alert fires; confirming calls onDelete(editing.id)', async () => {
    const onDelete = vi.fn();
    const editing = makeAssignment({ title: 'Lab Report' });
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks({ onDelete }) })
    );
    await flushMicrotasks();

    act(() => { result.current.handleDelete(); });

    expect(Alert.alert).toHaveBeenCalledOnce();
    const [title, message, buttons] = Alert.alert.mock.calls[0];
    expect(title).toBe('Delete Assignment');
    expect(message).toBe('Delete "Lab Report"?');

    const deleteButton = buttons.find(b => b.text === 'Delete');
    act(() => { deleteButton.onPress(); });

    expect(onDelete).toHaveBeenCalledWith(editing.id);
  });
});

describe('useAssignmentForm — hasSeries', () => {
  it('is false when editing is null', async () => {
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks() })
    );
    await flushMicrotasks();
    expect(result.current.hasSeries).toBe(false);
  });

  it('is false when editing.seriesId is null', async () => {
    const editing = makeAssignment({ title: 'Lab Report', seriesId: null });
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks() })
    );
    await flushMicrotasks();
    expect(result.current.hasSeries).toBe(false);
  });

  it('is true when editing.seriesId is set', async () => {
    const editing = makeAssignment({ title: 'Lab Report', seriesId: 'series-1' });
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks() })
    );
    await flushMicrotasks();
    expect(result.current.hasSeries).toBe(true);
  });
});

describe('useAssignmentForm — handleDeleteSeries (native)', () => {
  it('Alert.alert fires with "Delete Entire Series"; confirming calls onDeleteSeries(editing.seriesId)', async () => {
    const onDeleteSeries = vi.fn();
    const editing = makeAssignment({ title: 'Lab Report', seriesId: 'series-1' });
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks({ onDeleteSeries }) })
    );
    await flushMicrotasks();

    act(() => { result.current.handleDeleteSeries(); });

    expect(Alert.alert).toHaveBeenCalledOnce();
    const [title, message, buttons] = Alert.alert.mock.calls[0];
    expect(title).toBe('Delete Entire Series');
    expect(message).toBe('Delete all occurrences of "Lab Report"? This cannot be undone.');

    const deleteAllButton = buttons.find(b => b.text === 'Delete All');
    act(() => { deleteAllButton.onPress(); });

    expect(onDeleteSeries).toHaveBeenCalledWith(editing.seriesId);
  });
});

describe('useAssignmentForm — importanceHint', () => {
  it('reflects the current importance level', async () => {
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks() })
    );
    await flushMicrotasks();
    expect(result.current.importanceHint).toBe('Normal');

    act(() => { result.current.handleChange('importance', 5); });
    expect(result.current.importanceHint).toBe('Critical — do this first!');
  });
});
