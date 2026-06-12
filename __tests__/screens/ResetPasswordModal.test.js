import React from 'react';
import { act } from 'react-test-renderer';
import { render } from '../helpers/renderWithProviders';
import { supabase } from '../../lib/supabase';
import ResetPasswordModal from '../../screens/ResetPasswordModal';

beforeEach(() => {
  vi.clearAllMocks();
  supabase.auth.updateUser.mockResolvedValue({ data: null, error: null });
  supabase.auth.signOut.mockResolvedValue({ error: null });
});

function makeProps(overrides = {}) {
  return { visible: true, onDone: vi.fn(), ...overrides };
}

// Find a TextInput by placeholder and set its value.
function fillInput(screen, placeholder, value) {
  function find(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'TextInput' && node.props.placeholder === placeholder) return node;
    for (const c of (node.children || [])) {
      const f = find(c);
      if (f) return f;
    }
    return null;
  }
  const input = find(screen.toJSON());
  if (!input) throw new Error(`TextInput with placeholder "${placeholder}" not found`);
  act(() => { input.props.onChangeText(value); });
}

describe('ResetPasswordModal', () => {
  it('renders without crashing', () => {
    expect(() => render(React.createElement(ResetPasswordModal, makeProps()))).not.toThrow();
  });

  it('shows the title and field labels', () => {
    const screen = render(React.createElement(ResetPasswordModal, makeProps()));
    expect(screen.getByText('Set New Password')).toBeTruthy();
    expect(screen.getByText('New password')).toBeTruthy();
    expect(screen.getByText('Confirm password')).toBeTruthy();
  });

  it('shows Save Password and Cancel buttons', () => {
    const screen = render(React.createElement(ResetPasswordModal, makeProps()));
    expect(screen.getByText('Save Password')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('shows a min-length error for short passwords', async () => {
    const screen = render(React.createElement(ResetPasswordModal, makeProps()));
    fillInput(screen, 'Min 8 characters', 'short');
    fillInput(screen, 'Repeat new password', 'short');
    screen.firePressOnText('Save Password');
    await screen.flush();
    expect(screen.getByText('Password must be at least 8 characters')).toBeTruthy();
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it('shows a mismatch error when passwords differ', async () => {
    const screen = render(React.createElement(ResetPasswordModal, makeProps()));
    fillInput(screen, 'Min 8 characters', 'password123');
    fillInput(screen, 'Repeat new password', 'password456');
    screen.firePressOnText('Save Password');
    await screen.flush();
    expect(screen.getByText('Passwords do not match')).toBeTruthy();
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it('calls updateUser and onDone when the form is valid', async () => {
    const onDone = vi.fn();
    const screen = render(React.createElement(ResetPasswordModal, makeProps({ onDone })));
    fillInput(screen, 'Min 8 characters', 'password123');
    fillInput(screen, 'Repeat new password', 'password123');
    screen.firePressOnText('Save Password');
    await screen.flush();
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'password123' });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('shows the error message returned from updateUser and does not call onDone', async () => {
    supabase.auth.updateUser.mockResolvedValue({ data: null, error: { message: 'Update failed' } });
    const onDone = vi.fn();
    const screen = render(React.createElement(ResetPasswordModal, makeProps({ onDone })));
    fillInput(screen, 'Min 8 characters', 'password123');
    fillInput(screen, 'Repeat new password', 'password123');
    screen.firePressOnText('Save Password');
    await screen.flush();
    expect(screen.getByText('Update failed')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('Cancel signs out and calls onDone', async () => {
    const onDone = vi.fn();
    const screen = render(React.createElement(ResetPasswordModal, makeProps({ onDone })));
    screen.firePressOnText('Cancel');
    await screen.flush();
    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });
});
