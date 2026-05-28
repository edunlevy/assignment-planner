import {
  EMPTY_ERRORS,
  hasErrors,
  validateAssignmentForm,
} from '../../lib/formValidation';
import { MAX_WEEKLY_OCCURRENCES } from '../../lib/recurring';

// Minimal valid form — all tests start from this and override only what they
// need to exercise. Mirrors EMPTY_FORM in AssignmentFormModal.js.
const VALID_FORM = {
  title: 'Essay',
  course: 'ENGL 200',
  dueDate: '2026-09-01',
  importance: 3,
  status: 'not_started',
  complexity: 'medium',
  repeatWeekly: false,
  repeatUntil: '',
};

// ---------------------------------------------------------------------------
// EMPTY_ERRORS shape
// ---------------------------------------------------------------------------
describe('EMPTY_ERRORS', () => {
  test('has exactly the four expected keys, all empty strings', () => {
    expect(EMPTY_ERRORS).toEqual({
      title: '',
      course: '',
      dueDate: '',
      repeatUntil: '',
    });
  });
});

// ---------------------------------------------------------------------------
// hasErrors
// ---------------------------------------------------------------------------
describe('hasErrors', () => {
  test('returns false for EMPTY_ERRORS', () => {
    expect(hasErrors(EMPTY_ERRORS)).toBe(false);
  });

  test('returns true when any field has a message', () => {
    expect(hasErrors({ ...EMPTY_ERRORS, title: 'required' })).toBe(true);
    expect(hasErrors({ ...EMPTY_ERRORS, dueDate: 'invalid' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateAssignmentForm — required fields
// ---------------------------------------------------------------------------
describe('validateAssignmentForm — required fields', () => {
  test('returns no errors for a valid create form', () => {
    expect(validateAssignmentForm(VALID_FORM)).toEqual(EMPTY_ERRORS);
  });

  test('title: error when missing', () => {
    const { title } = validateAssignmentForm({ ...VALID_FORM, title: '' });
    expect(title).toMatch(/required/i);
  });

  test('title: error when only whitespace', () => {
    const { title } = validateAssignmentForm({ ...VALID_FORM, title: '   ' });
    expect(title).toMatch(/required/i);
  });

  test('course: error when missing', () => {
    const { course } = validateAssignmentForm({ ...VALID_FORM, course: '' });
    expect(course).toMatch(/required/i);
  });

  test('dueDate: error when missing', () => {
    const { dueDate } = validateAssignmentForm({ ...VALID_FORM, dueDate: '' });
    expect(dueDate).toMatch(/required/i);
  });

  test('dueDate: error when invalid format', () => {
    const { dueDate } = validateAssignmentForm({ ...VALID_FORM, dueDate: '01/15/2026' });
    expect(dueDate).toMatch(/YYYY-MM-DD/i);
  });

  test('dueDate: error on impossible calendar date', () => {
    const { dueDate } = validateAssignmentForm({ ...VALID_FORM, dueDate: '2026-02-30' });
    expect(dueDate).toMatch(/valid/i);
  });

  test('no cross-field contamination — title error does not set course error', () => {
    const errors = validateAssignmentForm({ ...VALID_FORM, title: '' });
    expect(errors.course).toBe('');
    expect(errors.dueDate).toBe('');
  });
});

// ---------------------------------------------------------------------------
// validateAssignmentForm — isEditing
// ---------------------------------------------------------------------------
describe('validateAssignmentForm — isEditing', () => {
  test('no errors for a valid edit form (status field present, repeatWeekly irrelevant)', () => {
    const errors = validateAssignmentForm(
      { ...VALID_FORM, status: 'in_progress' },
      { isEditing: true },
    );
    expect(errors).toEqual(EMPTY_ERRORS);
  });

  test('repeatWeekly is ignored when isEditing=true', () => {
    // Even if the form state somehow has repeatWeekly=true + bad repeatUntil,
    // isEditing suppresses the check (the field isn't rendered in edit mode).
    const errors = validateAssignmentForm(
      { ...VALID_FORM, repeatWeekly: true, repeatUntil: '' },
      { isEditing: true },
    );
    expect(errors.repeatUntil).toBe('');
  });
});

// ---------------------------------------------------------------------------
// validateAssignmentForm — repeat-weekly validation
// ---------------------------------------------------------------------------
describe('validateAssignmentForm — repeatWeekly', () => {
  const REPEATING = { ...VALID_FORM, repeatWeekly: true };

  test('no repeatUntil error when repeatWeekly is false', () => {
    const errors = validateAssignmentForm({ ...VALID_FORM, repeatWeekly: false, repeatUntil: '' });
    expect(errors.repeatUntil).toBe('');
  });

  test('error when repeatUntil is missing', () => {
    const { repeatUntil } = validateAssignmentForm({ ...REPEATING, repeatUntil: '' });
    expect(repeatUntil).toMatch(/required/i);
  });

  test('error when repeatUntil is an invalid date', () => {
    const { repeatUntil } = validateAssignmentForm({ ...REPEATING, repeatUntil: 'not-a-date' });
    expect(repeatUntil).toMatch(/YYYY-MM-DD/i);
  });

  test('error when repeatUntil is same day as dueDate', () => {
    const { repeatUntil } = validateAssignmentForm({
      ...REPEATING,
      dueDate: '2026-09-01',
      repeatUntil: '2026-09-01',
    });
    expect(repeatUntil).toMatch(/after/i);
  });

  test('error when repeatUntil is before dueDate', () => {
    const { repeatUntil } = validateAssignmentForm({
      ...REPEATING,
      dueDate: '2026-09-15',
      repeatUntil: '2026-09-01',
    });
    expect(repeatUntil).toMatch(/after/i);
  });

  test('no error when repeatUntil is one day after dueDate', () => {
    const errors = validateAssignmentForm({
      ...REPEATING,
      dueDate: '2026-09-01',
      repeatUntil: '2026-09-08', // 7 days later (1 occurrence after the first)
    });
    expect(errors.repeatUntil).toBe('');
  });

  test(`error when repeatUntil exceeds ${MAX_WEEKLY_OCCURRENCES}-week cap`, () => {
    // 53+ weeks past dueDate is always over the cap.
    const { repeatUntil } = validateAssignmentForm({
      ...REPEATING,
      dueDate: '2026-01-05',
      repeatUntil: '2027-04-05', // ~65 weeks
    });
    expect(repeatUntil).toMatch(new RegExp(`${MAX_WEEKLY_OCCURRENCES}`));
  });

  test('no error when repeatUntil is exactly at the week cap boundary', () => {
    // MAX_WEEKLY_OCCURRENCES = 52 weeks → 51 weeks past dueDate = 52 total.
    // That's within the cap.
    const dueDate = '2026-01-05';
    const repeatUntil = '2026-12-28'; // 51 weeks later = 52 occurrences total
    const errors = validateAssignmentForm({ ...REPEATING, dueDate, repeatUntil });
    expect(errors.repeatUntil).toBe('');
  });

  test('repeatUntil check is skipped when dueDate is invalid', () => {
    // With a broken dueDate we cannot compute ordering or occurrences, so
    // repeatUntil should not surface a secondary error on top of the dueDate error.
    const errors = validateAssignmentForm({
      ...REPEATING,
      dueDate: 'bad-date',
      repeatUntil: '2026-01-01',
    });
    expect(errors.dueDate).not.toBe('');
    expect(errors.repeatUntil).toBe('');
  });
});
