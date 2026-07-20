import React from 'react';
import { Alert, Platform } from 'react-native';
import { act } from 'react-test-renderer';
import { render } from '../helpers/renderWithProviders';
import { supabase } from '../../lib/supabase';

vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { signOut: vi.fn(async () => {}) },
}));

vi.mock('../../lib/notifications', () => ({
  cancelAllReminders: vi.fn(async () => {}),
  saveReminderMap: vi.fn(async () => {}),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { cancelAllReminders, saveReminderMap } from '../../lib/notifications';
import ProfileModal from '../../screens/ProfileModal';

const baseProps = {
  visible: true,
  email: 'user@test.com',
  userId: 'user-123',
  calendarSyncEnabled: false,
  calendarSyncLoaded: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  supabase.auth.signOut.mockResolvedValue({ error: null });
  supabase.rpc.mockResolvedValue({ data: null, error: null });
});

function makeProps(overrides = {}) {
  return {
    ...baseProps,
    onClose: vi.fn(),
    onEnableCalendarSync: vi.fn(async () => true),
    onDisableCalendarSync: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('ProfileModal', () => {
  it('renders without crashing', () => {
    expect(() => render(React.createElement(ProfileModal, makeProps()))).not.toThrow();
  });

  it('shows the signed-in email', () => {
    const screen = render(React.createElement(ProfileModal, makeProps()));
    expect(screen.getByText('user@test.com')).toBeTruthy();
  });

  it('shows Sign Out, Delete Account, and Close buttons', () => {
    const screen = render(React.createElement(ProfileModal, makeProps()));
    expect(screen.getByText('Sign Out')).toBeTruthy();
    expect(screen.getByText('Delete Account')).toBeTruthy();
    expect(screen.getByText('Close')).toBeTruthy();
  });

  it('Sign Out success cancels reminders, signs out of Google, and closes', async () => {
    const onClose = vi.fn();
    const screen = render(React.createElement(ProfileModal, makeProps({ onClose })));
    screen.firePressOnText('Sign Out');
    await screen.flush();
    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
    expect(cancelAllReminders).toHaveBeenCalledOnce();
    expect(saveReminderMap).toHaveBeenCalledWith('user-123', {});
    expect(GoogleSignin.signOut).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Sign Out failure shows an error and does not close', async () => {
    supabase.auth.signOut.mockResolvedValue({ error: { message: 'network error' } });
    const onClose = vi.fn();
    const screen = render(React.createElement(ProfileModal, makeProps({ onClose })));
    screen.firePressOnText('Sign Out');
    await screen.flush();
    expect(screen.getByText('Could not sign out. Please try again.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('pressing Delete Account triggers a confirmation alert', () => {
    const screen = render(React.createElement(ProfileModal, makeProps()));
    screen.firePressOnText('Delete Account');
    expect(Alert.alert).toHaveBeenCalledOnce();
    const [title, , buttons] = Alert.alert.mock.calls[0];
    expect(title).toBe('Delete account?');
    expect(buttons.map(b => b.text)).toEqual(['Cancel', 'Delete']);
  });

  it('confirming delete wipes local data and signs out', async () => {
    const onClose = vi.fn();
    const onDisableCalendarSync = vi.fn(async () => {});
    const screen = render(React.createElement(ProfileModal, makeProps({ onClose, onDisableCalendarSync })));
    screen.firePressOnText('Delete Account');
    const [, , buttons] = Alert.alert.mock.calls[0];
    await act(async () => { await buttons[1].onPress(); });
    expect(supabase.rpc).toHaveBeenCalledWith('delete_user');
    expect(cancelAllReminders).toHaveBeenCalledOnce();
    expect(saveReminderMap).toHaveBeenCalledWith('user-123', {});
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('assignments_user-123');
    // The local ranking-preference cache (hooks/usePreferences.js) must be
    // wiped too — the server-side row is deleted by delete_user() itself,
    // but nothing else clears this AsyncStorage mirror.
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('ranking_user-123');
    expect(GoogleSignin.signOut).toHaveBeenCalledOnce();
    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    // calendarSyncEnabled defaults to false in these props — no reason to
    // touch calendar sync for an account that never turned it on.
    expect(onDisableCalendarSync).not.toHaveBeenCalled();
  });

  it('Delete Account is disabled until calendarSyncLoaded, so a fast tap cannot skip calendar cleanup with the pre-load default', () => {
    // Regression test: calendarSyncEnabled starts false and only becomes
    // trustworthy once calendarSyncLoaded flips true (see
    // hooks/useCalendarOrchestration.js). Without this guard, deleting the
    // account before that AsyncStorage read resolves would read the
    // default false snapshot and skip onDisableCalendarSync even if sync
    // was actually on.
    const screen = render(React.createElement(ProfileModal, makeProps({ calendarSyncLoaded: false })));
    function collectText(node) {
      if (typeof node === 'string') return node;
      if (typeof node === 'number') return String(node);
      if (!node || !node.children) return '';
      return node.children.map(collectText).join('');
    }
    const deleteButton = screen.getAllByType('Pressable').find(p => collectText(p).includes('Delete Account'));
    expect(deleteButton.props.disabled).toBe(true);
  });

  it('confirming delete also deletes synced calendar events when calendar sync was on', async () => {
    const onDisableCalendarSync = vi.fn(async () => {});
    const screen = render(React.createElement(ProfileModal, makeProps({
      calendarSyncEnabled: true,
      onDisableCalendarSync,
    })));
    screen.firePressOnText('Delete Account');
    const [, , buttons] = Alert.alert.mock.calls[0];
    await act(async () => { await buttons[1].onPress(); });
    expect(supabase.rpc).toHaveBeenCalledWith('delete_user');
    // true: the account and every assignment are gone, so the synced
    // calendar events must go too, not just be left behind detached.
    expect(onDisableCalendarSync).toHaveBeenCalledWith(true);
  });

  it('a calendar-sync cleanup failure during delete does not block the rest of local cleanup', async () => {
    const onClose = vi.fn();
    const onDisableCalendarSync = vi.fn(async () => { throw new Error('calendar API down'); });
    const screen = render(React.createElement(ProfileModal, makeProps({
      onClose,
      calendarSyncEnabled: true,
      onDisableCalendarSync,
    })));
    screen.firePressOnText('Delete Account');
    const [, , buttons] = Alert.alert.mock.calls[0];
    await act(async () => { await buttons[1].onPress(); });
    // Account deletion already succeeded server-side by this point — a
    // best-effort calendar failure must not strand the user mid-flow.
    expect(saveReminderMap).toHaveBeenCalledWith('user-123', {});
    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Delete Account is disabled while a calendar-sync toggle is in flight, closing a race with account deletion', async () => {
    // Regression test: calendarSyncEnabled is a snapshot passed down as a
    // prop. Without this guard, tapping Delete Account while an enable-sync
    // toggle is still in flight would read the pre-toggle (stale) false
    // value, skip the calendar cleanup in handleDelete, and could leave
    // events the in-flight toggle creates moments later permanently
    // orphaned (the account — and any record of them — is already gone).
    let resolveEnable;
    const onEnableCalendarSync = vi.fn(() => new Promise(resolve => { resolveEnable = () => resolve(true); }));
    const screen = render(React.createElement(ProfileModal, makeProps({ onEnableCalendarSync })));

    screen.firePressOnText('Off'); // starts the toggle; calendarBusy -> true
    await screen.flush();

    function collectText(node) {
      if (typeof node === 'string') return node;
      if (typeof node === 'number') return String(node);
      if (!node || !node.children) return '';
      return node.children.map(collectText).join('');
    }
    const deleteButton = screen.getAllByType('Pressable').find(p => collectText(p).includes('Delete Account'));
    expect(deleteButton.props.disabled).toBe(true);

    resolveEnable();
    await screen.flush();
  });

  // On web, Alert.alert renders no actionable buttons, so confirmDelete must
  // fall back to window.confirm (matching hooks/useAssignmentForm.js). The
  // test environment is `node`, so window is stubbed per-test.
  it('web: accepting window.confirm wipes local data and signs out', async () => {
    const originalOS = Platform.OS;
    const prevWindow = globalThis.window;
    const confirm = vi.fn(() => true);
    Platform.OS = 'web';
    globalThis.window = { confirm };
    try {
      const onClose = vi.fn();
      const screen = render(React.createElement(ProfileModal, makeProps({ onClose })));
      screen.firePressOnText('Delete Account');
      await screen.flush();
      expect(confirm).toHaveBeenCalledOnce();
      expect(Alert.alert).not.toHaveBeenCalled();
      expect(supabase.rpc).toHaveBeenCalledWith('delete_user');
      expect(cancelAllReminders).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      Platform.OS = originalOS;
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
    }
  });

  it('web: dismissing window.confirm does not delete', async () => {
    const originalOS = Platform.OS;
    const prevWindow = globalThis.window;
    const confirm = vi.fn(() => false);
    Platform.OS = 'web';
    globalThis.window = { confirm };
    try {
      const onClose = vi.fn();
      const screen = render(React.createElement(ProfileModal, makeProps({ onClose })));
      screen.firePressOnText('Delete Account');
      await screen.flush();
      expect(confirm).toHaveBeenCalledOnce();
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(cancelAllReminders).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      Platform.OS = originalOS;
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
    }
  });

  it('delete failure shows an error and does not wipe local data', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } });
    const onClose = vi.fn();
    const screen = render(React.createElement(ProfileModal, makeProps({ onClose })));
    screen.firePressOnText('Delete Account');
    const [, , buttons] = Alert.alert.mock.calls[0];
    await act(async () => { await buttons[1].onPress(); });
    expect(screen.getByText('Could not delete account. Please try again or contact support.')).toBeTruthy();
    expect(cancelAllReminders).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Close calls onClose', () => {
    const onClose = vi.fn();
    const screen = render(React.createElement(ProfileModal, makeProps({ onClose })));
    screen.firePressOnText('Close');
    expect(onClose).toHaveBeenCalledOnce();
  });

  describe('calendar sync toggle', () => {
    it('shows "Sync to Calendar" with an Off toggle when disabled', () => {
      const screen = render(React.createElement(ProfileModal, makeProps({ calendarSyncEnabled: false })));
      expect(screen.getByText('Sync to Calendar')).toBeTruthy();
      expect(screen.getByText('Off')).toBeTruthy();
    });

    it('shows an On toggle when enabled', () => {
      const screen = render(React.createElement(ProfileModal, makeProps({ calendarSyncEnabled: true })));
      expect(screen.getByText('On')).toBeTruthy();
    });

    it('is hidden entirely on web (no native calendar API)', () => {
      const originalOS = Platform.OS;
      Platform.OS = 'web';
      try {
        const screen = render(React.createElement(ProfileModal, makeProps()));
        expect(screen.queryByText('Sync to Calendar')).toBeNull();
      } finally {
        Platform.OS = originalOS;
      }
    });

    it('tapping Off calls onEnableCalendarSync', async () => {
      const onEnableCalendarSync = vi.fn(async () => true);
      const screen = render(React.createElement(ProfileModal, makeProps({ calendarSyncEnabled: false, onEnableCalendarSync })));
      screen.firePressOnText('Off');
      await screen.flush();
      expect(onEnableCalendarSync).toHaveBeenCalledOnce();
    });

    it('shows an error when calendar permission is denied', async () => {
      const onEnableCalendarSync = vi.fn(async () => false);
      const screen = render(React.createElement(ProfileModal, makeProps({ calendarSyncEnabled: false, onEnableCalendarSync })));
      screen.firePressOnText('Off');
      await screen.flush();
      expect(screen.getByText(
        'Calendar permission denied. Enable it for this app in your device Settings to sync assignments.'
      )).toBeTruthy();
    });

    it('tapping On shows a three-way confirmation (Cancel / Keep Events / Delete Events)', () => {
      const screen = render(React.createElement(ProfileModal, makeProps({ calendarSyncEnabled: true })));
      screen.firePressOnText('On');
      expect(Alert.alert).toHaveBeenCalledOnce();
      const [title, , buttons] = Alert.alert.mock.calls[0];
      expect(title).toBe('Turn off calendar sync?');
      expect(buttons.map(b => b.text)).toEqual(['Cancel', 'Keep Events', 'Delete Events']);
    });

    it('choosing Keep Events calls onDisableCalendarSync(false)', async () => {
      const onDisableCalendarSync = vi.fn(async () => {});
      const screen = render(React.createElement(ProfileModal, makeProps({ calendarSyncEnabled: true, onDisableCalendarSync })));
      screen.firePressOnText('On');
      const [, , buttons] = Alert.alert.mock.calls[0];
      await act(async () => { await buttons[1].onPress(); });
      expect(onDisableCalendarSync).toHaveBeenCalledWith(false);
    });

    it('choosing Delete Events calls onDisableCalendarSync(true)', async () => {
      const onDisableCalendarSync = vi.fn(async () => {});
      const screen = render(React.createElement(ProfileModal, makeProps({ calendarSyncEnabled: true, onDisableCalendarSync })));
      screen.firePressOnText('On');
      const [, , buttons] = Alert.alert.mock.calls[0];
      await act(async () => { await buttons[2].onPress(); });
      expect(onDisableCalendarSync).toHaveBeenCalledWith(true);
    });

    it('an unconfirmed calendar deletion shows a specific warning instead of the generic failure message', async () => {
      // Regression test: useCalendarOrchestration's disableSync throws a
      // distinguishable error (code: CALENDAR_DELETE_UNCONFIRMED) when
      // deleteEvents=true couldn't be confirmed, so the user isn't told
      // sync failed entirely when it actually turned off -- only the event
      // cleanup is in question.
      const err = new Error('Calendar deletion could not be confirmed');
      err.code = 'CALENDAR_DELETE_UNCONFIRMED';
      const onDisableCalendarSync = vi.fn(async () => { throw err; });
      const screen = render(React.createElement(ProfileModal, makeProps({ calendarSyncEnabled: true, onDisableCalendarSync })));
      screen.firePressOnText('On');
      const [, , buttons] = Alert.alert.mock.calls[0];
      await act(async () => { await buttons[2].onPress(); });
      expect(screen.getByText(
        'Sync is off, but some calendar events may not have been removed. Check your calendar app.'
      )).toBeTruthy();
    });
  });
});
