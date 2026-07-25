import React from 'react';
import { render } from '../helpers/renderWithProviders';
import { supabase } from '../../lib/supabase';
import * as Linking from 'expo-linking';

// Covers App.js's password-reset / signup-confirm deep-link handler — the
// auth-critical effect that turns an `assignmentplanner://…` redirect into a
// Supabase session exchange and, for recovery links only, opens the reset
// modal. parseAuthRedirect (lib/deepLink) runs for real here; only the
// Supabase auth methods and expo-linking are stubbed (jest.setup.js), so each
// case feeds a real URL and asserts the exact auth call + branch taken.

vi.mock('../../hooks/useAssignments', () => ({
  useAssignments: vi.fn(),
}));
import { useAssignments } from '../../hooks/useAssignments';

// AuthScreen / ProfileModal / heavy children stubbed to inert markers.
vi.mock('../../screens/AuthScreen', () => ({
  default: () => React.createElement('Text', null, 'AuthScreenStub'),
}));
vi.mock('../../screens/ProfileModal', () => ({
  default: () => React.createElement('Text', null, 'ProfileModalStub'),
}));
// ResetPasswordModal stub RESPECTS `visible` so the rendered marker is a
// direct proxy for App.js's recoveryMode state.
vi.mock('../../screens/ResetPasswordModal', () => ({
  default: ({ visible }) =>
    visible ? React.createElement('Text', null, 'ResetModalVisible') : null,
}));
vi.mock('../../components/AssignmentFormModal', () => ({
  default: () => React.createElement('Text', null, 'AssignmentFormModalStub'),
  STATUS_COLORS: { not_started: '#FF6B6B', in_progress: '#FFB347', completed: '#6BCB77' },
  STATUS_LABELS: { not_started: 'Not Started', in_progress: 'In Progress', completed: 'Completed' },
}));
vi.mock('../../components/CalendarView', () => ({
  default: () => React.createElement('Text', null, 'CalendarViewStub'),
}));

import App from '../../App';

const FIXED_NOW = new Date('2026-06-15T12:00:00');
const LOGGED_IN_SESSION = { user: { id: 'user-1', email: 'test@example.com' } };

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
    removeSeries: vi.fn(),
    ...overrides,
  };
}

// The url-event listener callback App.js registers via
// Linking.addEventListener('url', cb). Captured so tests can drive a link that
// arrives WHILE the app is already open (not just the initial URL).
let urlEventCb;
let urlListenerRemove;

beforeEach(() => {
  vi.useFakeTimers({ now: FIXED_NOW });
  vi.clearAllMocks();
  useAssignments.mockReturnValue(defaultAssignmentsHook());

  // Logged-in + loaded so App renders its main tree (where ResetPasswordModal
  // lives) — recovery links can legitimately arrive for an already-signed-in
  // account (stale/shared link), and the modal only mounts past the auth gate.
  supabase.auth.getSession.mockResolvedValue({ data: { session: LOGGED_IN_SESSION } });
  supabase.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  supabase.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  supabase.auth.setSession.mockResolvedValue({ error: null });

  urlEventCb = undefined;
  urlListenerRemove = vi.fn();
  Linking.getInitialURL.mockResolvedValue(null);
  Linking.addEventListener.mockImplementation((event, cb) => {
    if (event === 'url') urlEventCb = cb;
    return { remove: urlListenerRemove };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// Render App with `url` delivered as the INITIAL deep link, then flush.
async function renderWithInitialUrl(url) {
  Linking.getInitialURL.mockResolvedValue(url);
  const screen = render(React.createElement(App));
  await screen.flush();
  return screen;
}

describe('App deep-link auth handler', () => {
  describe('no / empty link', () => {
    it('exchanges nothing when there is no initial URL', async () => {
      const screen = await renderWithInitialUrl(null);
      expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
      expect(screen.queryByText('ResetModalVisible')).toBeNull();
    });

    it('ignores a URL with neither a code nor tokens', async () => {
      const screen = await renderWithInitialUrl('assignmentplanner://reset-password');
      expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
      expect(screen.queryByText('ResetModalVisible')).toBeNull();
    });

    it('does not set a session for a recovery link that carries no access_token', async () => {
      // type=recovery but the fragment has no access_token → the branch's
      // `&& params.access_token` guard must keep setSession from firing.
      const screen = await renderWithInitialUrl('assignmentplanner://reset-password#type=recovery');
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
      expect(screen.queryByText('ResetModalVisible')).toBeNull();
    });
  });

  describe('PKCE flow (?code=)', () => {
    it('exchanges the code and opens the reset modal for a reset link', async () => {
      const screen = await renderWithInitialUrl('assignmentplanner://reset-password?code=pkce-xyz');
      expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce-xyz');
      // Reset path + successful exchange → recoveryMode true → modal visible.
      expect(screen.getByText('ResetModalVisible')).toBeTruthy();
      // Code branch returns early: the token-based setSession is never reached.
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
    });

    it('does NOT open the reset modal when the code exchange fails', async () => {
      supabase.auth.exchangeCodeForSession.mockResolvedValue({ error: { message: 'bad code' } });
      const screen = await renderWithInitialUrl('assignmentplanner://reset-password?code=bad');
      expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('bad');
      expect(screen.queryByText('ResetModalVisible')).toBeNull();
    });

    it('exchanges the code but does NOT open the reset modal for a signup-confirm link', async () => {
      // confirm/login link: same PKCE exchange, but recoveryMode must stay off
      // (onAuthStateChange drives the signed-in UI instead).
      const screen = await renderWithInitialUrl('assignmentplanner://confirm?code=confirm-abc');
      expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('confirm-abc');
      expect(screen.queryByText('ResetModalVisible')).toBeNull();
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
    });
  });

  describe('implicit flow (#access_token=…&type=recovery)', () => {
    it('sets the session from fragment tokens and opens the reset modal', async () => {
      const screen = await renderWithInitialUrl(
        'assignmentplanner://reset-password#access_token=AT&refresh_token=RT&type=recovery',
      );
      expect(supabase.auth.setSession).toHaveBeenCalledWith({
        access_token: 'AT',
        refresh_token: 'RT',
      });
      expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(screen.getByText('ResetModalVisible')).toBeTruthy();
    });

    it('defaults refresh_token to an empty string when the fragment omits it', async () => {
      await renderWithInitialUrl(
        'assignmentplanner://reset-password#access_token=AT&type=recovery',
      );
      expect(supabase.auth.setSession).toHaveBeenCalledWith({
        access_token: 'AT',
        refresh_token: '',
      });
    });

    it('does NOT open the reset modal when setSession fails', async () => {
      supabase.auth.setSession.mockResolvedValue({ error: { message: 'expired' } });
      const screen = await renderWithInitialUrl(
        'assignmentplanner://reset-password#access_token=AT&refresh_token=RT&type=recovery',
      );
      expect(supabase.auth.setSession).toHaveBeenCalled();
      expect(screen.queryByText('ResetModalVisible')).toBeNull();
    });
  });

  describe('implicit signup confirmation (#type=signup on a confirm link)', () => {
    it('sets the session from fragment tokens without opening the reset modal', async () => {
      const screen = await renderWithInitialUrl(
        'assignmentplanner://confirm#access_token=AT&refresh_token=RT&type=signup',
      );
      expect(supabase.auth.setSession).toHaveBeenCalledWith({
        access_token: 'AT',
        refresh_token: 'RT',
      });
      expect(screen.queryByText('ResetModalVisible')).toBeNull();
    });

    it('ignores signup tokens that arrive on a non-confirm path', async () => {
      // isConfirmLink is false for a bare host, so the signup branch is skipped.
      await renderWithInitialUrl(
        'assignmentplanner://home#access_token=AT&refresh_token=RT&type=signup',
      );
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
      expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    });
  });

  describe('runtime url event + cleanup', () => {
    it('handles a reset link delivered via the url event after mount', async () => {
      const screen = render(React.createElement(App));
      await screen.flush();
      // No initial URL was exchanged.
      expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(typeof urlEventCb).toBe('function');

      // Deliver the link as a runtime `url` event; flush() wraps the resulting
      // async exchange + state updates in act().
      urlEventCb({ url: 'assignmentplanner://reset-password?code=late-code' });
      await screen.flush();

      expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('late-code');
      expect(screen.getByText('ResetModalVisible')).toBeTruthy();
    });

    it('removes the url event listener on unmount', async () => {
      const screen = render(React.createElement(App));
      await screen.flush();
      screen.unmount();
      expect(urlListenerRemove).toHaveBeenCalled();
    });
  });
});
