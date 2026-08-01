import { useEffect, useRef, useState } from 'react';
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
  onUpdateSeries,
  onDelete,
  onDeleteSeries,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState(EMPTY_ERRORS);
  // Web-only in-modal replacement for the native series-edit-scope Alert
  // (see chooseSeriesEditScope). Visibility drives the overlay in
  // AssignmentFormModal; the pending promise's resolver and payload live in
  // the ref so a re-render can't lose them.
  const [scopePromptVisible, setScopePromptVisible] = useState(false);
  const scopePromptRef = useRef(null); // { resolve, withStatus } while visible

  // Reset form state when the modal opens or switches between create/edit.
  // Effect-based so we don't issue setState during render (which Strict Mode
  // and React 19 are stricter about). The `visible` gate ensures we only
  // re-seed on open transitions, never while the user is mid-edit.
  useEffect(() => {
    // Runs on BOTH open and close (before the visible gate below): a scope
    // prompt can't meaningfully survive the modal closing or re-seeding
    // under it, and its promise must settle either way or handleSubmit
    // dangles forever. Resolving with nothing = cancel, no write.
    scopePromptRef.current?.resolve();
    scopePromptRef.current = null;
    setScopePromptVisible(false);
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
      if (editing.seriesId) {
        await chooseSeriesEditScope(base);
      } else {
        await onUpdate(editing.id, { ...base, status: form.status });
      }
    } else if (form.repeatEnabled) {
      // The rule is derived through the same ruleFromForm the validator
      // used, so what gets built can't diverge from what was validated.
      await onCreateRecurring({ ...base, rule: ruleFromForm(form) });
    } else {
      await onCreate({ ...base, status: 'not_started' });
    }
  }

  // Saving an edit to a series row asks which occurrences it applies to.
  // Both scopes include the status field: for "this and future" the status
  // applies ONLY to the edited row (the user was looking at its status
  // picker when they saved; discarding it would silently revert a visible
  // edit) while the rest of the tail keeps each occurrence's own completion
  // state — that split lives in the update_series_from RPC. On web,
  // Alert.alert renders no actionable buttons, so the choice renders as an
  // in-modal overlay (AssignmentFormModal) with the same three options the
  // native Alert offers — the earlier window.confirm fallback collapsed
  // Cancel into "just this one", the opposite of what Cancel means in every
  // other confirm in this file.
  function chooseSeriesEditScope(base) {
    const withStatus = { ...base, status: form.status };
    if (Platform.OS === 'web') {
      return new Promise(resolve => {
        scopePromptRef.current = { resolve, withStatus };
        setScopePromptVisible(true);
      });
    }
    return new Promise(resolve => {
      Alert.alert(
        'Apply changes to…',
        'This assignment repeats. Apply your changes to just this occurrence, or to this and all future occurrences?',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
          {
            text: 'Just this one',
            onPress: () => resolve(onUpdate(editing.id, withStatus)),
          },
          {
            text: 'This & future',
            onPress: () => resolve(onUpdateSeries(editing.id, withStatus)),
          },
        ],
        // Android can dismiss without a button tap (back button / tap
        // outside); resolve so the save spinner never hangs.
        { onDismiss: () => resolve() },
      );
    });
  }

  // Settle the web scope prompt. choice: 'one' | 'future' | 'cancel'.
  // Cancel resolves without saving — the modal stays open with edits intact,
  // matching the native Alert's Cancel and this file's other confirms.
  function resolveScopePrompt(choice) {
    const pending = scopePromptRef.current;
    scopePromptRef.current = null;
    setScopePromptVisible(false);
    if (!pending) return;
    if (choice === 'one') {
      pending.resolve(onUpdate(editing.id, pending.withStatus));
    } else if (choice === 'future') {
      pending.resolve(onUpdateSeries(editing.id, pending.withStatus));
    } else {
      pending.resolve();
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
    scopePromptVisible,
    resolveScopePrompt,
    importanceHint: IMPORTANCE_HINTS[form.importance],
  };
}
