// Factory for valid Assignment test fixtures.
// All fields have sensible defaults; pass overrides to vary what you need.
//
// Usage:
//   import { makeAssignment } from '../helpers/mockAssignment';
//   const a = makeAssignment({ title: 'Essay', importance: 5 });

let _counter = 0;

export function makeAssignment(overrides = {}) {
  _counter += 1;
  return {
    id: `test-id-${_counter}`,
    title: `Test Assignment ${_counter}`,
    course: 'CS101',
    dueDate: '2026-06-15',
    dueTime: null,
    importance: 3,
    complexity: 'medium',
    status: 'not_started',
    seriesId: null,
    reminderIds: [],
    ...overrides,
  };
}

// Reset the counter between tests so IDs are predictable.
export function resetAssignmentCounter() {
  _counter = 0;
}
