import React from 'react';
import { Alert } from 'react-native';
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

const baseProps = { visible: true, email: 'user@test.com', userId: 'user-123' };

beforeEach(() => {
  vi.clearAllMocks();
  supabase.auth.signOut.mockResolvedValue({ error: null });
  supabase.rpc.mockResolvedValue({ data: null, error: null });
});

function makeProps(overrides = {}) {
  return { ...baseProps, onClose: vi.fn(), ...overrides };
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
    const screen = render(React.createElement(ProfileModal, makeProps({ onClose })));
    screen.firePressOnText('Delete Account');
    const [, , buttons] = Alert.alert.mock.calls[0];
    await act(async () => { await buttons[1].onPress(); });
    expect(supabase.rpc).toHaveBeenCalledWith('delete_user');
    expect(cancelAllReminders).toHaveBeenCalledOnce();
    expect(saveReminderMap).toHaveBeenCalledWith('user-123', {});
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('assignments_user-123');
    expect(GoogleSignin.signOut).toHaveBeenCalledOnce();
    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
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
});
