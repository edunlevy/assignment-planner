import { parseISO } from 'date-fns';
import { isValidDate, isValidTime } from './assignment';
import { countWeeklyOccurrences, MAX_WEEKLY_OCCURRENCES } from './recurring';

// Shape of the error object returned by validateAssignmentForm.
// Keys mirror the form fields that can have inline error messages.
export const EMPTY_ERRORS = {
  title: '',
  course: '',
  dueDate: '',
  dueTime: '',
  repeatUntil: '',
};

// Validate assignment form state and return an errors object.
// A field with a non-empty string value failed validation.
//
//   form      — the current form state (title, course, dueDate, repeatWeekly,
//               repeatUntil are read)
//   isEditing — true when editing an existing assignment; repeat-weekly
//               validation is skipped in that case (the field isn't shown)
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

  if (!isEditing && form.repeatWeekly) {
    if (!form.repeatUntil?.trim()) {
      errors.repeatUntil = 'End date is required when repeating';
    } else if (!isValidDate(form.repeatUntil.trim())) {
      errors.repeatUntil = 'Enter a valid date in YYYY-MM-DD format (e.g. 2026-08-01)';
    } else if (!errors.dueDate) {
      // Only check ordering / cap when dueDate itself is valid.
      const start = parseISO(form.dueDate.trim());
      const until = parseISO(form.repeatUntil.trim());
      if (!(until > start)) {
        errors.repeatUntil = 'End date must be after the first due date';
      } else {
        const intervalWeeks = form.repeatInterval === 2 ? 2 : 1;
        const occurrences = countWeeklyOccurrences(
          form.dueDate.trim(),
          form.repeatUntil.trim(),
          intervalWeeks,
        );
        if (occurrences > MAX_WEEKLY_OCCURRENCES) {
          errors.repeatUntil =
            `Cannot create more than ${MAX_WEEKLY_OCCURRENCES} occurrences`;
        }
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
