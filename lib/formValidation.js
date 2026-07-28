import { parseISO } from 'date-fns';
import { isValidDate, isValidTime } from './assignment';
import { countOccurrences, MAX_OCCURRENCES } from './recurring';

// Shape of the error object returned by validateAssignmentForm.
// Keys mirror the form fields that can have inline error messages.
export const EMPTY_ERRORS = {
  title: '',
  course: '',
  dueDate: '',
  dueTime: '',
  repeatUntil: '',
  repeatCount: '',
};

// Translate the form's flat repeat-* fields into a recurrence rule object
// (see lib/recurring.js for the rule shape). Shared by validation (to count
// occurrences) and useAssignmentForm's submit (to build the series), so the
// two can never disagree about what the form means.
export function ruleFromForm(form) {
  const freq = form.repeatFreq === 'monthly' ? 'monthly' : 'weekly';
  const interval =
    Number.isInteger(form.repeatInterval) && form.repeatInterval >= 1
      ? form.repeatInterval
      : 1;
  const rule = { freq, interval };
  if (freq === 'weekly' && Array.isArray(form.repeatWeekdays) && form.repeatWeekdays.length > 0) {
    rule.byWeekday = [...form.repeatWeekdays].sort((a, b) => a - b);
  }
  rule.end =
    form.repeatEndMode === 'count'
      ? { count: form.repeatCount }
      : { untilISO: form.repeatUntil.trim() };
  return rule;
}

// Validate assignment form state and return an errors object.
// A field with a non-empty string value failed validation.
//
//   form      — the current form state (title, course, dueDate, and the
//               repeat-* fields are read)
//   isEditing — true when editing an existing assignment; recurrence
//               validation is skipped in that case (the section isn't shown)
export function validateAssignmentForm(form, { isEditing = false } = {}) {
  const errors = { ...EMPTY_ERRORS };

  if (!form.title?.trim()) errors.title = 'Title is required';
  if (!form.course?.trim()) errors.course = 'Course is required';

  if (!form.dueDate?.trim()) {
    errors.dueDate = 'Due date is required';
  } else if (!isValidDate(form.dueDate.trim())) {
    errors.dueDate = 'Enter a valid date in YYYY-MM-DD format (e.g. 2026-06-01)';
  }

  if (form.dueTime?.trim() && !isValidTime(form.dueTime.trim())) {
    errors.dueTime = 'Enter a valid time in HH:MM format (e.g. 14:30)';
  }

  if (!isEditing && form.repeatEnabled) {
    if (form.repeatEndMode === 'count') {
      const n = form.repeatCount;
      if (!Number.isInteger(n) || n < 1) {
        errors.repeatCount = 'Choose how many times this repeats';
      } else if (n > MAX_OCCURRENCES) {
        errors.repeatCount = `Cannot create more than ${MAX_OCCURRENCES} occurrences`;
      }
    } else if (!form.repeatUntil?.trim()) {
      errors.repeatUntil = 'End date is required when repeating';
    } else if (!isValidDate(form.repeatUntil.trim())) {
      errors.repeatUntil = 'Enter a valid date in YYYY-MM-DD format (e.g. 2026-08-01)';
    } else if (!errors.dueDate) {
      // Only check ordering when dueDate itself is valid.
      const start = parseISO(form.dueDate.trim());
      const until = parseISO(form.repeatUntil.trim());
      if (!(until > start)) {
        errors.repeatUntil = 'End date must be after the first due date';
      }
    }

    // Occurrence-level checks need a valid start date and a structurally
    // valid end; skip them when either already failed above.
    if (!errors.dueDate && !errors.repeatUntil && !errors.repeatCount) {
      const occurrences = countOccurrences(form.dueDate.trim(), ruleFromForm(form));
      if (occurrences === 0) {
        // Only reachable in weekly byWeekday until-mode: a weekday selection
        // whose days all miss the start→until window. (Count-mode always
        // finds future matches, and a monthly window always contains at
        // least the start date itself.)
        errors.repeatUntil = 'No occurrences fall in this date range — check the repeat settings';
      } else if (occurrences > MAX_OCCURRENCES) {
        const key = form.repeatEndMode === 'count' ? 'repeatCount' : 'repeatUntil';
        errors[key] = `Cannot create more than ${MAX_OCCURRENCES} occurrences`;
      }
    }
  }

  return errors;
}

// Returns true when the errors object produced by validateAssignmentForm
// contains at least one non-empty message.
export function hasErrors(errors) {
  return Object.values(errors).some(msg => msg !== '');
}
