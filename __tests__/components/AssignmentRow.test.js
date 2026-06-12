import React from 'react';
import { render } from '../helpers/renderWithProviders';
import { makeAssignment, resetAssignmentCounter } from '../helpers/mockAssignment';
import AssignmentRow from '../../components/AssignmentRow';
import { act } from 'react-test-renderer';

// AssignmentRow uses STATUS_COLORS / STATUS_LABELS from AssignmentFormModal.
const STATUS_COLORS = {
  not_started: '#FF6B6B',
  in_progress: '#FFB347',
  completed: '#6BCB77',
};
const STATUS_LABELS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const FIXED_TODAY = new Date('2026-05-29T12:00:00');

beforeEach(() => {
  resetAssignmentCounter();
  vi.useFakeTimers({ now: FIXED_TODAY });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AssignmentRow', () => {
  it('renders without crashing', () => {
    const item = makeAssignment({ dueDate: '2026-06-15' });
    expect(() => render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }))).not.toThrow();
  });

  it('renders the assignment title', () => {
    const item = makeAssignment({ title: 'Essay Draft', dueDate: '2026-06-15' });
    const screen = render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }));
    expect(screen.getByText('Essay Draft')).toBeTruthy();
  });

  it('renders the course name', () => {
    const item = makeAssignment({ course: 'ENG201', dueDate: '2026-06-15' });
    const screen = render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }));
    expect(screen.getByText('ENG201')).toBeTruthy();
  });

  it('renders the due date label for far-future assignments', () => {
    // 17 days out → dueDateLabel returns "Due YYYY-MM-DD" (> 7 days threshold)
    const item = makeAssignment({ dueDate: '2026-06-15' });
    const screen = render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }));
    expect(screen.getByText('Due 2026-06-15')).toBeTruthy();
  });

  it('renders "Overdue" for past due dates', () => {
    const item = makeAssignment({ dueDate: '2026-05-01' });
    const screen = render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }));
    expect(screen.getByText('Overdue')).toBeTruthy();
  });

  it('renders the complexity chip', () => {
    const item = makeAssignment({ complexity: 'long', dueDate: '2026-06-15' });
    const screen = render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }));
    expect(screen.getByText('Long')).toBeTruthy();
  });

  it('includes an ImportanceBar (5 child segments exist)', () => {
    const item = makeAssignment({ importance: 3, dueDate: '2026-06-15' });
    const screen = render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }));
    // ImportanceBar renders a View with 5 child Views; walk the tree to confirm.
    const tree = screen.toJSON();
    function findFiveSegmentRow(node) {
      if (!node || typeof node !== 'object') return null;
      if (node.type === 'View' && Array.isArray(node.children) && node.children.length === 5) {
        return node;
      }
      for (const child of (node.children || [])) {
        const found = findFiveSegmentRow(child);
        if (found) return found;
      }
      return null;
    }
    expect(findFiveSegmentRow(tree)).not.toBeNull();
  });

  describe('status badge', () => {
    it('shows "Not Started" badge for not_started status', () => {
      const item = makeAssignment({ status: 'not_started', dueDate: '2026-06-15' });
      const screen = render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }));
      expect(screen.getByText(STATUS_LABELS.not_started)).toBeTruthy();
    });

    it('shows "In Progress" badge for in_progress status', () => {
      const item = makeAssignment({ status: 'in_progress', dueDate: '2026-06-15' });
      const screen = render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }));
      expect(screen.getByText(STATUS_LABELS.in_progress)).toBeTruthy();
    });

    it('shows "Completed" badge for completed status', () => {
      const item = makeAssignment({ status: 'completed', dueDate: '2026-06-15' });
      const screen = render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }));
      expect(screen.getByText(STATUS_LABELS.completed)).toBeTruthy();
    });

    it('badge has the correct background color per status', () => {
      // Style may be a flat object OR an array (StyleSheet.create + inline merge).
      function getBgColor(style) {
        if (!style) return undefined;
        if (Array.isArray(style)) {
          for (const s of style) {
            const c = getBgColor(s);
            if (c !== undefined) return c;
          }
          return undefined;
        }
        return style.backgroundColor;
      }

      function findBadge(node, expectedColor) {
        if (!node || typeof node !== 'object') return null;
        if (getBgColor(node.props && node.props.style) === expectedColor) return node;
        for (const child of (node.children || [])) {
          const found = findBadge(child, expectedColor);
          if (found) return found;
        }
        return null;
      }

      Object.entries(STATUS_COLORS).forEach(([status, expectedColor]) => {
        const item = makeAssignment({ status, dueDate: '2026-06-15' });
        const screen = render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }));
        expect(findBadge(screen.toJSON(), expectedColor)).not.toBeNull();
      });
    });
  });

  describe('completed styling', () => {
    it('completed row has reduced opacity', () => {
      const item = makeAssignment({ status: 'completed', dueDate: '2026-06-15' });
      const screen = render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }));
      const root = screen.toJSON();
      // The root Pressable should merge cardCompleted style (opacity: 0.5).
      const styles = Array.isArray(root.props.style) ? root.props.style : [root.props.style];
      const opacityStyle = styles.find(s => s && s.opacity === 0.5);
      expect(opacityStyle).toBeTruthy();
    });

    it('not_started row does not have reduced opacity', () => {
      const item = makeAssignment({ status: 'not_started', dueDate: '2026-06-15' });
      const screen = render(React.createElement(AssignmentRow, { item, onPress: vi.fn() }));
      const root = screen.toJSON();
      const styles = Array.isArray(root.props.style) ? root.props.style : [root.props.style];
      const opacityStyle = styles.find(s => s && s.opacity === 0.5);
      expect(opacityStyle).toBeFalsy();
    });
  });

  it('calls onPress when tapped', () => {
    const onPress = vi.fn();
    const item = makeAssignment({ dueDate: '2026-06-15' });
    const screen = render(React.createElement(AssignmentRow, { item, onPress }));
    const root = screen.toJSON();
    act(() => { root.props.onPress && root.props.onPress(); });
    expect(onPress).toHaveBeenCalledOnce();
  });
});
