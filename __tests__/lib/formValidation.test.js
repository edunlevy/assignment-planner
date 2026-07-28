import {
  EMPTY_ERRORS,
  hasErrors,
  ruleFromForm,
  validateAssignmentForm,
} from '../../lib/formValidation';
import { MAX_OCCURRENCES } from '../../lib/recurring';

// Minimal valid form — all tests start from this and override only what they
// need to exercise. Mirrors EMPTY_FORM (title/course/... + the repeat-*
// fields) in hooks/useAssignmentForm.js.
const VALID_FORM = {
  title: 'Essay',
  course: 'ENGL 200',
  dueDate: '2026-09-01',
  importance: 3,
  status: 'not_started',
  complexity: 'medium',
  repeatEnabled: false,
  repeatFreq: 'weekly',
  repeatInterval: 1,
  repeatWeekdays: [],
  repeatEndMode: 'until',
  repeatUntil: '',
  repeatCount: 10,
};

// ---------------------------------------------------------------------------
// EMPTY_ERRORS shape
// ---------------------------------------------------------------------------
describe('EMPTY_ERRORS', () => {
  test('has exactly the expected keys, all empty strings', () => {
    expect(EMPTY_ERRORS).toEqual({
      title: '',
      course: '',
      dueDate: '',
      dueTime: '',
      repeatUntil: '',
      repeatCount: '',
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
    expect(hasErrors({ ...EMPTY_ERRORS, repeatCount: 'invalid' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ruleFromForm
// ---------------------------------------------------------------------------
describe('ruleFromForm', () => {
  test('weekly default: no weekdays selected, until-mode', () => {
    const form = { ...VALID_FORM, repeatUntil: '2026-10-01' };
    expect(ruleFromForm(form)).toEqual({
      freq: 'weekly',
      interval: 1,
      end: { untilISO: '2026-10-01' },
    });
  });

  test('byWeekday is sorted ascending regardless of selection order', () => {
    const form = { ...VALID_FORM, repeatWeekdays: [5, 1, 3], repeatUntil: '2026-10-01' };
    expect(ruleFromForm(form).byWeekday).toEqual([1, 3, 5]);
  });

  test('monthly ignores repeatWeekdays entirely (no byWeekday key at all)', () => {
    const form = {
      ...VALID_FORM,
      repeatFreq: 'monthly',
      repeatWeekdays: [1, 3],
      repeatUntil: '2026-10-01',
    };
    const rule = ruleFromForm(form);
    expect(rule.freq).toBe('monthly');
    expect(rule).not.toHaveProperty('byWeekday');
  });

  test('weekly with an empty repeatWeekdays array omits byWeekday (falls back to start weekday)', () => {
    const form = { ...VALID_FORM, repeatWeekdays: [], repeatUntil: '2026-10-01' };
    expect(ruleFromForm(form)).not.toHaveProperty('byWeekday');
  });

  test('count-mode end shape: { count }', () => {
    const form = { ...VALID_FORM, repeatEndMode: 'count', repeatCount: 8 };
    expect(ruleFromForm(form).end).toEqual({ count: 8 });
  });

  test('until-mode end shape: { untilISO }, trimmed', () => {
    const form = { ...VALID_FORM, repeatEndMode: 'until', repeatUntil: '  2026-10-01  ' };
    expect(ruleFromForm(form).end).toEqual({ untilISO: '2026-10-01' });
  });

  test('non-integer/zero repeatInterval falls back to 1', () => {
    expect(ruleFromForm({ ...VALID_FORM, repeatInterval: 0, repeatUntil: '2026-10-01' }).interval).toBe(1);
    expect(ruleFromForm({ ...VALID_FORM, repeatInterval: undefined, repeatUntil: '2026-10-01' }).interval).toBe(1);
    expect(ruleFromForm({ ...VALID_FORM, repeatInterval: 2.5, repeatUntil: '2026-10-01' }).interval).toBe(1);
  });

  test('a valid integer repeatInterval >= 1 is passed through unchanged', () => {
    expect(ruleFromForm({ ...VALID_FORM, repeatInterval: 3, repeatUntil: '2026-10-01' }).interval).toBe(3);
  });

  test('repeatInterval above MAX_INTERVAL is clamped — the persisted rule must be born valid', () => {
    expect(ruleFromForm({ ...VALID_FORM, repeatInterval: 99, repeatUntil: '2026-10-01' }).interval).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// validateAssignmentForm — dueTime (optional field)
// ---------------------------------------------------------------------------
describe('validateAssignmentForm — dueTime', () => {
  test('no error when dueTime is empty (field is optional)', () => {
    const { dueTime } = validateAssignmentForm({ ...VALID_FORM, dueTime: '' });
    expect(dueTime).toBe('');
  });

  test('no error when dueTime is absent', () => {
    const form = { ...VALID_FORM };
    delete form.dueTime;
    const { dueTime } = validateAssignmentForm(form);
    expect(dueTime).toBe('');
  });

  test('no error for a valid HH:MM time', () => {
    const { dueTime } = validateAssignmentForm({ ...VALID_FORM, dueTime: '17:00' });
    expect(dueTime).toBe('');
  });

  test('error for an invalid time string', () => {
    const { dueTime } = validateAssignmentForm({ ...VALID_FORM, dueTime: '25:00' });
    expect(dueTime).toMatch(/HH:MM/i);
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
  test('no errors for a valid edit form (status field present, repeat fields irrelevant)', () => {
    const errors = validateAssignmentForm(
      { ...VALID_FORM, status: 'in_progress' },
      { isEditing: true },
    );
    expect(errors).toEqual(EMPTY_ERRORS);
  });

  test('repeat validation is skipped entirely when isEditing=true', () => {
    // Even if the form state somehow has repeatEnabled=true + bad repeat*
    // fields, isEditing suppresses the check (the section isn't rendered).
    const errors = validateAssignmentForm(
      {
        ...VALID_FORM,
        repeatEnabled: true,
        repeatEndMode: 'until',
        repeatUntil: '',
        repeatCount: -5,
      },
      { isEditing: true },
    );
    expect(errors.repeatUntil).toBe('');
    expect(errors.repeatCount).toBe('');
  });
});

// ---------------------------------------------------------------------------
// validateAssignmentForm — repeat validation, until-mode
// ---------------------------------------------------------------------------
describe('validateAssignmentForm — repeat (until-mode)', () => {
  const REPEATING = { ...VALID_FORM, repeatEnabled: true, repeatEndMode: 'until' };

  test('no repeatUntil error when repeatEnabled is false', () => {
    const errors = validateAssignmentForm({ ...VALID_FORM, repeatEnabled: false, repeatUntil: '' });
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

  test('no error when repeatUntil is one day after dueDate (start day itself is an occurrence)', () => {
    const errors = validateAssignmentForm({
      ...REPEATING,
      dueDate: '2026-09-01',
      repeatUntil: '2026-09-02',
    });
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

  test('error: zero occurrences fall in the requested window (byWeekday never matches before until)', () => {
    // dueDate is a Monday; the window closes the Friday before the next
    // Saturday, and only Saturday is requested — no match ever falls inside.
    const { repeatUntil } = validateAssignmentForm({
      ...REPEATING,
      dueDate: '2026-01-05',
      repeatWeekdays: [6],
      repeatUntil: '2026-01-09',
    });
    expect(repeatUntil).toMatch(/no occurrences/i);
  });

  test('no error when exactly at the 52-occurrence cap boundary', () => {
    // Weekly, default weekday (Monday), 357 days later = exactly 52 Mondays.
    const errors = validateAssignmentForm({
      ...REPEATING,
      dueDate: '2026-01-05',
      repeatUntil: '2026-12-28',
    });
    expect(errors.repeatUntil).toBe('');
  });

  test('error when occurrences exceed the 52-occurrence cap — reported on repeatUntil', () => {
    // 364 days later = 53 Mondays: one past the cap.
    const { repeatUntil } = validateAssignmentForm({
      ...REPEATING,
      dueDate: '2026-01-05',
      repeatUntil: '2027-01-04',
    });
    expect(repeatUntil).toMatch(new RegExp(`${MAX_OCCURRENCES}`));
  });

  test('cap error message does not leak into repeatCount in until-mode', () => {
    const errors = validateAssignmentForm({
      ...REPEATING,
      dueDate: '2026-01-05',
      repeatUntil: '2027-01-04',
    });
    expect(errors.repeatCount).toBe('');
  });
});

// ---------------------------------------------------------------------------
// validateAssignmentForm — repeat validation, count-mode
// ---------------------------------------------------------------------------
describe('validateAssignmentForm — repeat (count-mode)', () => {
  const COUNTING = { ...VALID_FORM, repeatEnabled: true, repeatEndMode: 'count' };

  test('no error for a normal small count', () => {
    const errors = validateAssignmentForm({ ...COUNTING, repeatCount: 5 });
    expect(errors.repeatCount).toBe('');
  });

  test('repeatUntil is entirely ignored in count-mode', () => {
    const errors = validateAssignmentForm({ ...COUNTING, repeatCount: 5, repeatUntil: '' });
    expect(errors.repeatUntil).toBe('');
  });

  test('error when repeatCount is not an integer', () => {
    const { repeatCount } = validateAssignmentForm({ ...COUNTING, repeatCount: 2.5 });
    expect(repeatCount).toMatch(/how many times/i);
  });

  test('error when repeatCount is NaN', () => {
    const { repeatCount } = validateAssignmentForm({ ...COUNTING, repeatCount: NaN });
    expect(repeatCount).toMatch(/how many times/i);
  });

  test('error when repeatCount is less than 1', () => {
    const { repeatCount } = validateAssignmentForm({ ...COUNTING, repeatCount: 0 });
    expect(repeatCount).toMatch(/how many times/i);
  });

  test('error when repeatCount is negative', () => {
    const { repeatCount } = validateAssignmentForm({ ...COUNTING, repeatCount: -3 });
    expect(repeatCount).toMatch(/how many times/i);
  });

  test('no error when repeatCount is exactly the 52-occurrence cap', () => {
    const errors = validateAssignmentForm({ ...COUNTING, repeatCount: MAX_OCCURRENCES });
    expect(errors.repeatCount).toBe('');
  });

  test('error when repeatCount exceeds the 52-occurrence cap — reported on repeatCount', () => {
    const { repeatCount } = validateAssignmentForm({ ...COUNTING, repeatCount: MAX_OCCURRENCES + 1 });
    expect(repeatCount).toMatch(new RegExp(`${MAX_OCCURRENCES}`));
  });

  test('cap error message does not leak into repeatUntil in count-mode', () => {
    const errors = validateAssignmentForm({ ...COUNTING, repeatCount: MAX_OCCURRENCES + 1 });
    expect(errors.repeatUntil).toBe('');
  });
});
