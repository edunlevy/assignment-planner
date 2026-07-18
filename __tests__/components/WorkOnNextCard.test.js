import React from 'react';
import { render } from '../helpers/renderWithProviders';
import { makeAssignment, resetAssignmentCounter } from '../helpers/mockAssignment';
import WorkOnNextCard from '../../components/WorkOnNextCard';

// Fix "today" so dueDateLabel output is deterministic.
const FIXED_TODAY = new Date('2026-05-29T12:00:00');

beforeEach(() => {
  resetAssignmentCounter();
  vi.useFakeTimers({ now: FIXED_TODAY });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WorkOnNextCard', () => {
  it('renders without crashing', () => {
    const a = makeAssignment({ dueDate: '2026-06-15' });
    expect(() => render(React.createElement(WorkOnNextCard, { assignment: a }))).not.toThrow();
  });

  it('renders the assignment title', () => {
    const a = makeAssignment({ title: 'Calculus Exam', dueDate: '2026-06-15' });
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    expect(screen.getByText('Calculus Exam')).toBeTruthy();
  });

  it('renders the assignment course', () => {
    const a = makeAssignment({ course: 'MATH201', dueDate: '2026-06-15' });
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    expect(screen.getByText('MATH201')).toBeTruthy();
  });

  it('renders the "Work on next" header label', () => {
    const a = makeAssignment({ dueDate: '2026-06-15' });
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    expect(screen.getByText('Work on next')).toBeTruthy();
  });

  it('subtitle reflects the default ranking\'s top factor (due date) when no ranking prop is passed', () => {
    const a = makeAssignment({ dueDate: '2026-06-15' });
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    // The factor phrase is its own JSX child (split from the surrounding
    // "Prioritised by your ranking — ... first" text), so it's matched exactly.
    expect(screen.getByText('due date')).toBeTruthy();
  });

  it('subtitle reflects a custom ranking\'s top factor', () => {
    const a = makeAssignment({ dueDate: '2026-06-15' });
    const ranking = ['complexity', 'importance', 'dueDate'];
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a, ranking }));
    expect(screen.getByText('length')).toBeTruthy();
  });

  it('renders the complexity label for short assignments', () => {
    const a = makeAssignment({ complexity: 'short', dueDate: '2026-06-15' });
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    expect(screen.getByText('Short')).toBeTruthy();
  });

  it('renders the complexity label for long assignments', () => {
    const a = makeAssignment({ complexity: 'long', dueDate: '2026-06-15' });
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    expect(screen.getByText('Long')).toBeTruthy();
  });

  it('renders the importance as "Importance N/5"', () => {
    const a = makeAssignment({ importance: 4, dueDate: '2026-06-15' });
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    expect(screen.getByText('Importance 4/5')).toBeTruthy();
  });

  it('shows "Overdue" label for past due dates', () => {
    const a = makeAssignment({ dueDate: '2026-05-20' }); // 9 days ago
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    expect(screen.getByText('Overdue')).toBeTruthy();
  });

  it('shows "Due today" for same-day assignments', () => {
    const a = makeAssignment({ dueDate: '2026-05-29' });
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    expect(screen.getByText('Due today')).toBeTruthy();
  });

  it('shows "Due in N days" label for assignments 2–7 days out', () => {
    // 5 days from fixed today. dueDateLabel uses "Due in N days" for 2–7
    // days and falls back to "Due YYYY-MM-DD" for anything further out.
    const a = makeAssignment({ dueDate: '2026-06-03' });
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    expect(screen.getByText('Due in 5 days')).toBeTruthy();
  });

  it('shows ISO date label for assignments more than 7 days out', () => {
    const a = makeAssignment({ dueDate: '2026-06-15' }); // 17 days out → "Due YYYY-MM-DD"
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    expect(screen.getByText('Due 2026-06-15')).toBeTruthy();
  });

  it('urgent badge is red (#EF4444) for overdue assignments', () => {
    const a = makeAssignment({ dueDate: '2026-05-20' });
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    const tree = screen.toJSON();
    // Walk the tree to find the View wrapping the "Overdue" badge text.
    function findBadgeView(node) {
      if (!node || typeof node !== 'object') return null;
      if (
        node.type === 'View' &&
        node.props.style &&
        node.props.style.backgroundColor === '#EF4444'
      ) return node;
      for (const child of (node.children || [])) {
        const found = findBadgeView(child);
        if (found) return found;
      }
      return null;
    }
    expect(findBadgeView(tree)).not.toBeNull();
  });

  it('urgent badge is not red for future assignments', () => {
    const a = makeAssignment({ dueDate: '2026-06-15' });
    const screen = render(React.createElement(WorkOnNextCard, { assignment: a }));
    const tree = screen.toJSON();
    function findRedView(node) {
      if (!node || typeof node !== 'object') return null;
      if (node.props.style && node.props.style.backgroundColor === '#EF4444') return node;
      for (const child of (node.children || [])) {
        const found = findRedView(child);
        if (found) return found;
      }
      return null;
    }
    expect(findRedView(tree)).toBeNull();
  });
});
