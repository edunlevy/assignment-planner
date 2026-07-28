// PR 2.4 — useAssignmentForm tests
// Exercises the form state/validation/submit/delete logic extracted from
// AssignmentFormModal, in isolation (no component rendering).

import { Alert, Platform } from 'react-native';
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
    onUpdateSeries: vi.fn(async () => {}),
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

  it('EMPTY_FORM has the expected repeat-section defaults', () => {
    expect(EMPTY_FORM).toEqual(
      expect.objectContaining({
        repeatEnabled: false,
        repeatFreq: 'weekly',
        repeatInterval: 1,
        repeatWeekdays: [],
        repeatEndMode: 'until',
        repeatUntil: '',
        repeatCount: 10,
      })
    );
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
    expect(result.current.form.repeatEnabled).toBe(false);
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

  it('create (recurring, weekly/until-mode): calls onCreateRecurring with base + rule built by ruleFromForm', async () => {
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
      rule: {
        freq: 'weekly',
        interval: 2,
        end: { untilISO: '2026-08-01' },
      },
    });
  });

  it('create (recurring, monthly + weekdays + count-mode): the rule reflects every repeat-* field', async () => {
    const onCreateRecurring = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks({ onCreateRecurring }) })
    );
    await flushMicrotasks();

    act(() => {
      result.current.handleChange('title', 'Monthly Report');
      result.current.handleChange('course', 'BUS300');
      result.current.handleChange('dueDate', '2026-07-01');
      result.current.toggleRecurring();
    });
    act(() => {
      result.current.handleChange('repeatFreq', 'monthly');
      // Weekdays should be ignored by ruleFromForm because freq is monthly.
      result.current.toggleRepeatWeekday(1);
      result.current.handleChange('repeatEndMode', 'count');
      result.current.handleChange('repeatCount', 6);
    });

    await act(async () => { await result.current.handleSubmit(); });

    expect(onCreateRecurring).toHaveBeenCalledOnce();
    const [payload] = onCreateRecurring.mock.calls[0];
    expect(payload.rule).toEqual({
      freq: 'monthly',
      interval: 1,
      end: { count: 6 },
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

  // Regression test: handleSubmit's gate originally enumerated error keys
  // by hand and omitted repeatCount, so an invalid count slipped through and
  // onCreateRecurring fired with rule.end = { count: 0 } (buildSeries would
  // then silently produce zero drafts). The gate now uses hasErrors, which
  // can't drift when EMPTY_ERRORS gains a key. The UI stepper clamps at 1,
  // so this path is only reachable programmatically — defense in depth.
  it('invalid repeatCount (0) in count-mode blocks submit with a repeatCount error', async () => {
    const cbs = defaultCallbacks();
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...cbs })
    );
    await flushMicrotasks();

    act(() => {
      result.current.handleChange('title', 'Weekly Quiz');
      result.current.handleChange('course', 'CS101');
      result.current.handleChange('dueDate', '2026-07-01');
      result.current.toggleRecurring();
    });
    act(() => {
      result.current.handleChange('repeatEndMode', 'count');
      result.current.handleChange('repeatCount', 0); // invalid: must be >= 1
    });

    await act(async () => { await result.current.handleSubmit(); });

    // This is what the spec promises and what actually fails today:
    expect(cbs.onCreateRecurring).not.toHaveBeenCalled();
    expect(result.current.fieldErrors.repeatCount).toBeTruthy();
  });
});

// F3b — editing a row WITH a seriesId no longer calls onUpdate directly; it
// asks which occurrences the change applies to (chooseSeriesEditScope).
describe('useAssignmentForm — chooseSeriesEditScope (native, editing a series row)', () => {
  function seriesEditingSetup(overrides = {}) {
    const onUpdate = vi.fn(async () => {});
    const onUpdateSeries = vi.fn(async () => {});
    const editing = makeAssignment({
      title: 'Weekly Quiz',
      course: 'CS101',
      dueDate: '2026-06-15',
      dueTime: null,
      importance: 3,
      complexity: 'medium',
      status: 'in_progress',
      seriesId: 'series-1',
      ...overrides,
    });
    return { onUpdate, onUpdateSeries, editing };
  }

  it('handleSubmit shows a 3-button Alert with the expected title/message/buttons shape', async () => {
    const { onUpdate, onUpdateSeries, editing } = seriesEditingSetup();
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks({ onUpdate, onUpdateSeries }) })
    );
    await flushMicrotasks();

    act(() => { result.current.handleSubmit(); });

    expect(Alert.alert).toHaveBeenCalledOnce();
    const [title, message, buttons, options] = Alert.alert.mock.calls[0];
    expect(title).toBe('Apply changes to…');
    expect(message).toBe(
      'This assignment repeats. Apply your changes to just this occurrence, or to this and all future occurrences?'
    );
    expect(buttons.map(b => b.text)).toEqual(['Cancel', 'Just this one', 'This & future']);
    expect(buttons[0].style).toBe('cancel');
    expect(typeof options.onDismiss).toBe('function');
  });

  it('"Just this one" calls onUpdate(editing.id, {...base, status: form.status}) — status INCLUDED', async () => {
    const { onUpdate, onUpdateSeries, editing } = seriesEditingSetup();
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks({ onUpdate, onUpdateSeries }) })
    );
    await flushMicrotasks();

    act(() => { result.current.handleChange('status', 'completed'); });

    let submitPromise;
    act(() => { submitPromise = result.current.handleSubmit(); });

    const [, , buttons] = Alert.alert.mock.calls[0];
    const justThisOne = buttons.find(b => b.text === 'Just this one');
    await act(async () => { justThisOne.onPress(); await submitPromise; });

    expect(onUpdate).toHaveBeenCalledWith(editing.id, {
      title: 'Weekly Quiz',
      course: 'CS101',
      dueDate: '2026-06-15',
      dueTime: null,
      importance: 3,
      complexity: 'medium',
      status: 'completed',
    });
    expect(onUpdateSeries).not.toHaveBeenCalled();
  });

  it('"This & future" calls onUpdateSeries(editing.id, {...base, status}) — status INCLUDED, applied by the RPC to the target row only', async () => {
    // Regression (PR #42 review): the first version sent bare `base`, which
    // silently discarded a status change on the very row the user was
    // editing — the picker snapped back after save. The status now rides
    // along and update_series_from applies it to p_target_id alone; the
    // rest of the tail still keeps each occurrence's own status.
    const { onUpdate, onUpdateSeries, editing } = seriesEditingSetup();
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks({ onUpdate, onUpdateSeries }) })
    );
    await flushMicrotasks();

    act(() => { result.current.handleChange('status', 'completed'); });

    let submitPromise;
    act(() => { submitPromise = result.current.handleSubmit(); });

    const [, , buttons] = Alert.alert.mock.calls[0];
    const thisAndFuture = buttons.find(b => b.text === 'This & future');
    await act(async () => { thisAndFuture.onPress(); await submitPromise; });

    expect(onUpdateSeries).toHaveBeenCalledWith(editing.id, {
      title: 'Weekly Quiz',
      course: 'CS101',
      dueDate: '2026-06-15',
      dueTime: null,
      importance: 3,
      complexity: 'medium',
      status: 'completed',
    });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('Cancel resolves without calling onUpdate or onUpdateSeries', async () => {
    const { onUpdate, onUpdateSeries, editing } = seriesEditingSetup();
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks({ onUpdate, onUpdateSeries }) })
    );
    await flushMicrotasks();

    let submitPromise;
    act(() => { submitPromise = result.current.handleSubmit(); });

    const [, , buttons] = Alert.alert.mock.calls[0];
    const cancelButton = buttons.find(b => b.text === 'Cancel');
    await act(async () => { cancelButton.onPress(); await submitPromise; });

    expect(onUpdate).not.toHaveBeenCalled();
    expect(onUpdateSeries).not.toHaveBeenCalled();
  });

  it('onDismiss (Android back button / tap outside) resolves without calling either callback', async () => {
    const { onUpdate, onUpdateSeries, editing } = seriesEditingSetup();
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing, ...defaultCallbacks({ onUpdate, onUpdateSeries }) })
    );
    await flushMicrotasks();

    let submitPromise;
    act(() => { submitPromise = result.current.handleSubmit(); });

    const [, , , options] = Alert.alert.mock.calls[0];
    await act(async () => { options.onDismiss(); await submitPromise; });

    expect(onUpdate).not.toHaveBeenCalled();
    expect(onUpdateSeries).not.toHaveBeenCalled();
  });
});

describe('useAssignmentForm — chooseSeriesEditScope (web, editing a series row)', () => {
  function seriesEditingSetup(overrides = {}) {
    const onUpdate = vi.fn(async () => {});
    const onUpdateSeries = vi.fn(async () => {});
    const editing = makeAssignment({
      title: 'Weekly Quiz',
      course: 'CS101',
      dueDate: '2026-06-15',
      dueTime: null,
      importance: 3,
      complexity: 'medium',
      status: 'in_progress',
      seriesId: 'series-1',
      ...overrides,
    });
    return { onUpdate, onUpdateSeries, editing };
  }

  // Platform.OS / globalThis.window juggling copied from the
  // handleDelete web-confirm tests in ProfileModal.test.js.
  it('OK (confirm accepted) calls onUpdateSeries with {...base, status} — RPC applies status to the target row only', async () => {
    const originalOS = Platform.OS;
    const prevWindow = globalThis.window;
    const confirm = vi.fn(() => true);
    Platform.OS = 'web';
    globalThis.window = { confirm };
    try {
      const { onUpdate, onUpdateSeries, editing } = seriesEditingSetup();
      const { result } = renderHook(() =>
        useAssignmentForm({ visible: true, editing, ...defaultCallbacks({ onUpdate, onUpdateSeries }) })
      );
      await flushMicrotasks();

      await act(async () => { await result.current.handleSubmit(); });

      expect(confirm).toHaveBeenCalledOnce();
      expect(Alert.alert).not.toHaveBeenCalled();
      expect(onUpdateSeries).toHaveBeenCalledWith(editing.id, {
        title: 'Weekly Quiz',
        course: 'CS101',
        dueDate: '2026-06-15',
        dueTime: null,
        importance: 3,
        complexity: 'medium',
        status: 'in_progress',
      });
      expect(onUpdate).not.toHaveBeenCalled();
    } finally {
      Platform.OS = originalOS;
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
    }
  });

  it('Cancel (confirm dismissed) calls onUpdate with {...base, status} — single-row behavior', async () => {
    const originalOS = Platform.OS;
    const prevWindow = globalThis.window;
    const confirm = vi.fn(() => false);
    Platform.OS = 'web';
    globalThis.window = { confirm };
    try {
      const { onUpdate, onUpdateSeries, editing } = seriesEditingSetup();
      const { result } = renderHook(() =>
        useAssignmentForm({ visible: true, editing, ...defaultCallbacks({ onUpdate, onUpdateSeries }) })
      );
      await flushMicrotasks();

      await act(async () => { await result.current.handleSubmit(); });

      expect(confirm).toHaveBeenCalledOnce();
      expect(onUpdate).toHaveBeenCalledWith(editing.id, {
        title: 'Weekly Quiz',
        course: 'CS101',
        dueDate: '2026-06-15',
        dueTime: null,
        importance: 3,
        complexity: 'medium',
        status: 'in_progress',
      });
      expect(onUpdateSeries).not.toHaveBeenCalled();
    } finally {
      Platform.OS = originalOS;
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
    }
  });
});

describe('useAssignmentForm — toggleRecurring', () => {
  it('flips repeatEnabled and resets the whole repeat section back to defaults', async () => {
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks() })
    );
    await flushMicrotasks();

    act(() => {
      result.current.handleChange('repeatFreq', 'monthly');
      result.current.handleChange('repeatInterval', 3);
      result.current.toggleRepeatWeekday(2);
      result.current.handleChange('repeatEndMode', 'count');
      result.current.handleChange('repeatUntil', '2026-08-01');
      result.current.handleChange('repeatCount', 20);
    });
    act(() => { result.current.toggleRecurring(); });

    expect(result.current.form.repeatEnabled).toBe(true);
    expect(result.current.form.repeatFreq).toBe('weekly');
    expect(result.current.form.repeatInterval).toBe(1);
    expect(result.current.form.repeatWeekdays).toEqual([]);
    expect(result.current.form.repeatEndMode).toBe('until');
    expect(result.current.form.repeatUntil).toBe('');
    expect(result.current.form.repeatCount).toBe(10);

    act(() => { result.current.toggleRecurring(); });
    expect(result.current.form.repeatEnabled).toBe(false);
  });

  it('resets in-progress repeat edits even when toggling off then on again', async () => {
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks() })
    );
    await flushMicrotasks();

    act(() => { result.current.toggleRecurring(); }); // on
    act(() => { result.current.handleChange('repeatInterval', 5); });
    act(() => { result.current.toggleRecurring(); }); // off -> resets
    act(() => { result.current.toggleRecurring(); }); // on again

    expect(result.current.form.repeatInterval).toBe(1);
  });
});

describe('useAssignmentForm — toggleRepeatWeekday', () => {
  it('adds a weekday not yet selected', async () => {
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks() })
    );
    await flushMicrotasks();

    act(() => { result.current.toggleRepeatWeekday(1); });
    expect(result.current.form.repeatWeekdays).toEqual([1]);

    act(() => { result.current.toggleRepeatWeekday(3); });
    expect(result.current.form.repeatWeekdays).toEqual([1, 3]);
  });

  it('removes a weekday already selected', async () => {
    const { result } = renderHook(() =>
      useAssignmentForm({ visible: true, editing: null, ...defaultCallbacks() })
    );
    await flushMicrotasks();

    act(() => { result.current.toggleRepeatWeekday(1); });
    act(() => { result.current.toggleRepeatWeekday(3); });
    act(() => { result.current.toggleRepeatWeekday(1); });
    expect(result.current.form.repeatWeekdays).toEqual([3]);
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
