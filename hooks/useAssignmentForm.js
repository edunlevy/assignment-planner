import { useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { validateAssignmentForm, ruleFromForm, hasErrors, EMPTY_ERRORS } from '../lib/formValidation';

export const IMPORTANCE_HINTS = {
  1: 'Low priority',
  2: 'Minor',
  3: 'Normal',
  4: 'Important',
  5: 'Critical — do this first!',
};

// Repeat-section defaults, reset together whenever the toggle flips or the
// modal is re-seeded. repeatCount's default of 10 is a starting point for
// the count stepper, not a magic value.
const EMPTY_REPEAT = {
  repeatEnabled: false,
  repeatFreq: 'weekly',       // 'weekly' | 'monthly'
  repeatInterval: 1,          // every N weeks / months
  repeatWeekdays: [],         // 0=Sun..6=Sat; empty = the start date's weekday
  repeatEndMode: 'until',     // 'until' | 'count'
  repeatUntil: '',
  repeatCount: 10,
};

export const EMPTY_FORM = {
  title: '', course: '', dueDate: '', dueTime: '', importance: 3, status: 'not_started',
  complexity: 'medium',
  ...EMPTY_REPEAT,
};

export function formFor(item) {
  if (!item) return EMPTY_FORM;
  return {
    title: item.title,
    course: item.course,
    dueDate: item.dueDate,
    dueTime: item.dueTime ?? '',
    importance: item.importance,
    status: item.status,
    complexity: item.complexity ?? 'medium',
    ...EMPTY_REPEAT,
  };
}

// Owns the form state, validation, and submit/delete logic for
// AssignmentFormModal. Mutation effects are delegated to the caller via
// onCreate / onCreateRecurring / onUpdate / onDelete callbacks.
export function useAssignmentForm({
  visible,
  editing,        // null = create, otherwise the assignment being edited
  onCreate,
  onCreateRecurring,
  onUpdate,
  onDelete,
  onDeleteSeries,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState(EMPTY_ERRORS);

  // Reset form state when the modal opens or switches between create/edit.
  // Effect-based so we don't issue setState during render (which Strict Mode
  // and React 19 are stricter about). The `visible` gate ensures we only
  // re-seed on open transitions, never while the user is mid-edit.
  useEffect(() => {
    if (!visible) return;
    setForm(formFor(editing));
    setFieldErrors(EMPTY_ERRORS);
  }, [visible, editing?.id]);

  const isEditing = !!editing;

  function handleChange(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    if (fieldErrors[field]) setFieldErrors(e => ({ ...e, [field]: '' }));
  }

  function clearDueTime() {
    setForm(f => ({ ...f, dueTime: '' }));
  }

  function toggleRecurring() {
    setForm(f => ({ ...f, ...EMPTY_REPEAT, repeatEnabled: !f.repeatEnabled }));
  }

  // Toggle one weekday (0=Sun..6=Sat) in the weekly-repeat weekday picker.
  function toggleRepeatWeekday(day) {
    setForm(f => ({
      ...f,
      repeatWeekdays: f.repeatWeekdays.includes(day)
        ? f.repeatWeekdays.filter(d => d !== day)
        : [...f.repeatWeekdays, day],
    }));
  }

  async function handleSubmit() {
    const errors = validateAssignmentForm(form, { isEditing });
    // hasErrors, not an enumerated key list: a hand-maintained list silently
    // stops blocking submit the moment EMPTY_ERRORS gains a key it doesn't
    // name (exactly what happened when repeatCount was added).
    if (hasErrors(errors)) {
      setFieldErrors(errors);
      return;
    }

    const trimmedTime = form.dueTime.trim();
    const base = {
      title: form.title.trim(),
      course: form.course.trim(),
      dueDate: form.dueDate.trim(),
      dueTime: trimmedTime || null,
      importance: form.importance,
      complexity: form.complexity,
    };

    if (isEditing) {
      await onUpdate(editing.id, { ...base, status: form.status });
    } else if (form.repeatEnabled) {
      // The rule is derived through the same ruleFromForm the validator
      // used, so what gets built can't diverge from what was validated.
      await onCreateRecurring({ ...base, rule: ruleFromForm(form) });
    } else {
      await onCreate({ ...base, status: 'not_started' });
    }
  }

  function handleDelete() {
    const doDelete = () => onDelete(editing.id);
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm(`Delete "${form.title}"?`)) doDelete();
    } else {
      Alert.alert(
        'Delete Assignment',
        `Delete "${form.title}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  }

  function handleDeleteSeries() {
    const doDelete = () => onDeleteSeries(editing.seriesId);
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm(`Delete the entire series for "${form.title}"? This removes all occurrences and cannot be undone.`)) doDelete();
    } else {
      Alert.alert(
        'Delete Entire Series',
        `Delete all occurrences of "${form.title}"? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete All', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  }

  return {
    form,
    fieldErrors,
    isEditing,
    hasSeries: !!editing?.seriesId,
    handleChange,
    clearDueTime,
    toggleRecurring,
    toggleRepeatWeekday,
    handleSubmit,
    handleDelete,
    handleDeleteSeries,
    importanceHint: IMPORTANCE_HINTS[form.importance],
  };
}
