import React from 'react';
import { act } from 'react-test-renderer';
import { render } from '../helpers/renderWithProviders';
import { makeAssignment, resetAssignmentCounter } from '../helpers/mockAssignment';
import { startAuthAutoRefresh, supabase } from '../../lib/supabase';

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
// Captures the props App.js passes to AssignmentFormModal on the most recent
// render, so tests can assert on prop WIRING (e.g. onUpdateSeries) without
// rendering the real modal (covered separately in
// __tests__/components/AssignmentFormModal.test.js).
let lastFormModalProps = null;
vi.mock('../../components/AssignmentFormModal', () => ({
  default: props => {
    lastFormModalProps = props;
    return React.createElement('Text', null, 'AssignmentFormModalStub');
  },
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
    updateSeriesFrom: vi.fn(),
    remove: vi.fn(),
    removeSeries: vi.fn(),
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

  it('starts the Supabase auth auto-refresh listener on mount and removes it on unmount', async () => {
    // Regression test: the listener used to be registered at lib/supabase.js
    // module-evaluation time with no way to remove it. It's now owned by an
    // App.js mount-effect with a cleanup, so this is where its lifecycle is
    // actually observable/testable.
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    const screen = render(React.createElement(App));
    await screen.flush();
    expect(startAuthAutoRefresh).toHaveBeenCalledOnce();
    const sub = startAuthAutoRefresh.mock.results[0].value;
    screen.unmount();
    expect(sub.remove).toHaveBeenCalledOnce();
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

    // F3b wiring: App's handleUpdateSeries must forward to updateSeriesFrom,
    // wrapped in the same runMutation (saving spinner + sync-error banner)
    // flow as every other mutation — not call it bare.
    it('wires onUpdateSeries through to updateSeriesFrom via runMutation', async () => {
      const updateSeriesFrom = vi.fn(async () => 2);
      await renderLoggedIn({ updateSeriesFrom });

      expect(typeof lastFormModalProps.onUpdateSeries).toBe('function');

      await act(async () => {
        await lastFormModalProps.onUpdateSeries('row-1', { title: 'Updated' });
      });

      expect(updateSeriesFrom).toHaveBeenCalledWith('row-1', { title: 'Updated' });
    });

    it('a failed onUpdateSeries reports the save error via reportSyncError (runMutation error handling)', async () => {
      const updateSeriesFrom = vi.fn(async () => { throw new Error('boom'); });
      const reportSyncError = vi.fn();
      const clearSyncError = vi.fn();
      await renderLoggedIn({ updateSeriesFrom, reportSyncError, clearSyncError });

      await act(async () => {
        await lastFormModalProps.onUpdateSeries('row-1', { title: 'Updated' });
      });

      expect(clearSyncError).toHaveBeenCalled();
      expect(reportSyncError).toHaveBeenCalledWith('Could not save. Check your connection and try again.');
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

    describe('filtering', () => {
      it('narrows the visible list without changing the Work-on-next card or header count', async () => {
        // Due today and high-importance: pickWorkOnNext picks this one under
        // the default ranking regardless of which course filter is later applied.
        const workOnNextItem = makeAssignment({
          id: 'w', title: 'Urgent Essay', course: 'CS101', dueDate: '2026-06-15', importance: 5,
        });
        const other = makeAssignment({
          id: 'o', title: 'Other Course Reading', course: 'MATH201', dueDate: '2026-07-01',
        });
        const screen = await renderLoggedIn({ assignments: [workOnNextItem, other] });

        // Sanity check before any filter is applied: both rows are in the
        // FlatList's data, the header count reflects both, and the
        // Work-on-next card (FlatList's ListHeaderComponent) shows the urgent one.
        let flatList = getFlatList(screen);
        expect(flatList.props.data).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: 'w' }),
          expect.objectContaining({ id: 'o' }),
        ]));
        expect(screen.getByText('2 remaining')).toBeTruthy();
        expect(flatList.props.ListHeaderComponent.props.assignment.id).toBe('w');

        // Select the CS101 course chip (rendered by FilterBar, a real part of
        // the tree — unlike FlatList's data/props, chip taps actually re-render).
        screen.firePressOnText('CS101');

        flatList = getFlatList(screen);
        expect(flatList.props.data).toEqual([expect.objectContaining({ id: 'w' })]);
        // workOnNext and the header count are derived from the UNFILTERED
        // assignments list, so neither should change.
        expect(screen.getByText('2 remaining')).toBeTruthy();
        expect(flatList.props.ListHeaderComponent.props.assignment.id).toBe('w');
      });

      it("resets filters when the signed-in user changes, so user B never inherits user A's filters", async () => {
        // AppScreen stays mounted across sign-out/sign-in (the !session
        // branch is an early return, not an unmount), so filter state would
        // survive an account switch without the userId-keyed reset effect —
        // and a course filter matching nothing of B's would hide their whole
        // list behind "No matches".
        let authCallback;
        supabase.auth.onAuthStateChange.mockImplementation(cb => {
          authCallback = cb;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        });
        const a = makeAssignment({ id: 'a', title: 'A Task', course: 'CS101', dueDate: '2026-06-20' });
        const b = makeAssignment({ id: 'b', title: 'B Task', course: 'BIO150', dueDate: '2026-06-20' });
        const screen = await renderLoggedIn({ assignments: [a, b] });

        screen.firePressOnText('CS101');
        let flatList = getFlatList(screen);
        expect(flatList.props.data).toEqual([expect.objectContaining({ id: 'a' })]);

        // Simulate the account switch through the real auth plumbing: the
        // subscription handler useAuthSession registered receives a session
        // for a different user id.
        await act(async () => {
          authCallback('SIGNED_IN', { user: { id: 'user-2', email: 'b@example.com' } });
        });

        flatList = getFlatList(screen);
        expect(flatList.props.data).toHaveLength(2);
        expect(flatList.props.data).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: 'a' }),
          expect.objectContaining({ id: 'b' }),
        ]));
      });

      it('keeps filters across a token refresh for the SAME user (reset keys on userId, not session identity)', async () => {
        // Supabase fires onAuthStateChange with a FRESH session object on
        // TOKEN_REFRESHED and on app foreground, and useAuthSession calls
        // setSession every time. Keying the reset effect on `session` instead
        // of `userId` would therefore wipe the user's filters mid-use on a
        // timer — this pins the dep-array choice the account-switch test
        // above can't distinguish.
        let authCallback;
        supabase.auth.onAuthStateChange.mockImplementation(cb => {
          authCallback = cb;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        });
        const a = makeAssignment({ id: 'a', title: 'A Task', course: 'CS101', dueDate: '2026-06-20' });
        const b = makeAssignment({ id: 'b', title: 'B Task', course: 'BIO150', dueDate: '2026-06-20' });
        const screen = await renderLoggedIn({ assignments: [a, b] });

        screen.firePressOnText('CS101');
        let flatList = getFlatList(screen);
        expect(flatList.props.data).toEqual([expect.objectContaining({ id: 'a' })]);

        // Same user id, new session object identity.
        await act(async () => {
          authCallback('TOKEN_REFRESHED', { user: { id: 'user-1', email: 'test@example.com' } });
        });

        flatList = getFlatList(screen);
        expect(flatList.props.data).toEqual([expect.objectContaining({ id: 'a' })]);
      });

      it('shows the no-matches state when filters exclude every assignment, and clearing restores the list', async () => {
        const item = makeAssignment({ title: 'Only Item', course: 'CS101', dueDate: '2026-06-20' });
        const screen = await renderLoggedIn({ assignments: [item] });

        // "Today" excludes this item: it's due 2026-06-20, five days after
        // FIXED_NOW (2026-06-15), so the due-range filter alone empties the list.
        screen.firePressOnText('Today');

        let flatList = getFlatList(screen);
        expect(flatList.props.data).toEqual([]);
        // FlatList's ListEmptyComponent prop is never auto-rendered by the
        // mocked FlatList host tag, so assert on the element itself.
        expect(flatList.props.ListEmptyComponent.props.variant).toBe('noMatches');
        // The Work-on-next card is suppressed alongside "No matches" — a
        // recommendation directly above "nothing matches" reads as a
        // self-contradiction (workOnNext itself is unfiltered by design).
        expect(flatList.props.ListHeaderComponent).toBeNull();

        // Firing the noMatches variant's onClear (as App.js wires it) should
        // reset filters and bring the item back into view.
        await act(async () => {
          flatList.props.ListEmptyComponent.props.onClear();
        });

        flatList = getFlatList(screen);
        expect(flatList.props.data).toEqual([expect.objectContaining({ title: 'Only Item' })]);
        expect(flatList.props.ListEmptyComponent.props.variant).toBeUndefined();
      });
    });
  });
});
