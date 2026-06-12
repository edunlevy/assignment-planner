import React from 'react';
import { act } from 'react-test-renderer';
import { render } from '../helpers/renderWithProviders';
import { makeAssignment, resetAssignmentCounter } from '../helpers/mockAssignment';
import { supabase } from '../../lib/supabase';

// --- Mock useAssignments so App.js's branching logic is isolated from the
// hook's internals (covered separately in hooks/useAssignments tests). ---
vi.mock('../../hooks/useAssignments', () => ({
  useAssignments: vi.fn(),
}));
import { useAssignments } from '../../hooks/useAssignments';

// --- Stub out heavy child components/screens with lightweight markers. ---
vi.mock('../../screens/AuthScreen', () => ({
  default: () => React.createElement('Text', null, 'AuthScreenStub'),
}));
vi.mock('../../screens/ProfileModal', () => ({
  default: () => React.createElement('Text', null, 'ProfileModalStub'),
}));
vi.mock('../../screens/ResetPasswordModal', () => ({
  default: () => React.createElement('Text', null, 'ResetPasswordModalStub'),
}));
vi.mock('../../components/AssignmentFormModal', () => ({
  default: () => React.createElement('Text', null, 'AssignmentFormModalStub'),
  STATUS_COLORS: {
    not_started: '#FF6B6B',
    in_progress: '#FFB347',
    completed: '#6BCB77',
  },
  STATUS_LABELS: {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    completed: 'Completed',
  },
}));
vi.mock('../../components/CalendarView', () => ({
  default: () => React.createElement('Text', null, 'CalendarViewStub'),
}));

import App from '../../App';
import AssignmentRow from '../../components/AssignmentRow';

// FlatList is mocked as the bare string 'FlatList', so renderItem is never
// invoked automatically. Find the (first) FlatList and pull its `data`/render.
function getFlatList(screen) {
  return screen.getAllByType('FlatList')[0];
}

const FIXED_NOW = new Date('2026-06-15T12:00:00');

function defaultAssignmentsHook(overrides = {}) {
  return {
    assignments: [],
    loaded: true,
    syncError: '',
    clearSyncError: vi.fn(),
    reportSyncError: vi.fn(),
    insert: vi.fn(),
    insertMany: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

const LOGGED_IN_SESSION = {
  user: { id: 'user-1', email: 'test@example.com' },
};

beforeEach(() => {
  resetAssignmentCounter();
  vi.useFakeTimers({ now: FIXED_NOW });
  vi.clearAllMocks();
  useAssignments.mockReturnValue(defaultAssignmentsHook());
  supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  supabase.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('App', () => {
  it('shows "Loading…" before the session resolves', () => {
    // getSession's promise never resolves within this test, so sessionLoaded stays false.
    supabase.auth.getSession.mockReturnValue(new Promise(() => {}));
    const screen = render(React.createElement(App));
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('renders AuthScreen when session resolves to null', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    const screen = render(React.createElement(App));
    await screen.flush();
    expect(screen.getByText('AuthScreenStub')).toBeTruthy();
  });

  it('shows "Loading…" when logged in but assignments not yet loaded', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: LOGGED_IN_SESSION } });
    useAssignments.mockReturnValue(defaultAssignmentsHook({ loaded: false }));
    const screen = render(React.createElement(App));
    await screen.flush();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  describe('logged in + loaded', () => {
    async function renderLoggedIn(hookOverrides = {}) {
      supabase.auth.getSession.mockResolvedValue({ data: { session: LOGGED_IN_SESSION } });
      useAssignments.mockReturnValue(defaultAssignmentsHook(hookOverrides));
      const screen = render(React.createElement(App));
      await screen.flush();
      return screen;
    }

    it('renders the assignment list with assignments from useAssignments', async () => {
      const item = makeAssignment({ title: 'Read Chapter 5', dueDate: '2026-06-20' });
      const screen = await renderLoggedIn({ assignments: [item] });

      const flatList = getFlatList(screen);
      expect(flatList.props.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: 'Read Chapter 5' }),
      ]));

      // The FlatList's renderItem wraps each item in an AssignmentRow.
      const rendered = flatList.props.renderItem({ item });
      expect(rendered.type).toBe(AssignmentRow);
      expect(rendered.props.item).toEqual(item);
    });

    it('shows the FAB ("+") button', async () => {
      const screen = await renderLoggedIn();
      expect(screen.getByText('+')).toBeTruthy();
    });

    it('switches to CalendarView when the "Calendar" segment is tapped', async () => {
      const item = makeAssignment({ title: 'List Item', dueDate: '2026-06-20' });
      const screen = await renderLoggedIn({ assignments: [item] });

      expect(screen.queryByText('CalendarViewStub')).toBeNull();

      screen.firePressOnText('Calendar');

      expect(screen.getByText('CalendarViewStub')).toBeTruthy();
      expect(screen.queryByText('List Item')).toBeNull();
    });

    it('switches back to the list when the "List" segment is tapped', async () => {
      const item = makeAssignment({ title: 'List Item', dueDate: '2026-06-20' });
      const screen = await renderLoggedIn({ assignments: [item] });

      screen.firePressOnText('Calendar');
      expect(screen.getByText('CalendarViewStub')).toBeTruthy();

      screen.firePressOnText('List');
      expect(screen.queryByText('CalendarViewStub')).toBeNull();
      const flatList = getFlatList(screen);
      expect(flatList.props.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: 'List Item' }),
      ]));
    });

    it('shows the syncError banner and clears it on tap', async () => {
      const clearSyncError = vi.fn();
      const screen = await renderLoggedIn({ syncError: 'Something went wrong', clearSyncError });

      expect(screen.getByText('Something went wrong  ✕')).toBeTruthy();

      screen.firePressOnText('Something went wrong');
      expect(clearSyncError).toHaveBeenCalledOnce();
    });

    it('does not show the syncError banner when syncError is empty', async () => {
      const screen = await renderLoggedIn({ syncError: '' });
      const root = screen.toJSON();
      function findBanner(node) {
        if (!node || typeof node !== 'object') return null;
        if (Array.isArray(node.children)) {
          for (const child of node.children) {
            if (typeof child === 'string' && child.includes('✕')) return node;
            const found = findBanner(child);
            if (found) return found;
          }
        }
        return null;
      }
      expect(findBanner(root)).toBeNull();
    });
  });
});
