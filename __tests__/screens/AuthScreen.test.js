// Tests run with Platform.OS = 'ios' (set in jest.setup.js).
import React from 'react';
import { act } from 'react-test-renderer';
import { render } from '../helpers/renderWithProviders';
import { supabase } from '../../lib/supabase';

vi.mock('../../lib/socialAuth', () => ({
  signInWithApple: vi.fn(async () => null),
  signInWithGoogle: vi.fn(async () => null),
}));

import { signInWithGoogle } from '../../lib/socialAuth';
import AuthScreen from '../../screens/AuthScreen';

beforeEach(() => {
  vi.clearAllMocks();
  supabase.auth.signInWithPassword.mockResolvedValue({ error: null });
  supabase.auth.signUp.mockResolvedValue({ error: null });
  supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
});

// Concatenate string/number leaves of a tree node (handles split JSX text).
function collectText(node) {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node || !node.children) return '';
  return node.children.map(collectText).join('');
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

// Press the Nth Pressable (0-based) whose text content includes `text`.
// AuthScreen reuses "Log In" for both the tab and the submit button, so
// callers disambiguate via index.
function pressByText(screen, text, index = 0) {
  const matches = screen.getAllByType('Pressable').filter(p => collectText(p).includes(text));
  const target = matches[index];
  if (!target) throw new Error(`Pressable[${index}] containing "${text}" not found`);
  act(() => { target.props.onPress && target.props.onPress(); });
}

describe('AuthScreen', () => {
  it('renders without crashing', () => {
    expect(() => render(React.createElement(AuthScreen))).not.toThrow();
  });

  it('shows Email and Password field labels', () => {
    const screen = render(React.createElement(AuthScreen));
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('Password')).toBeTruthy();
  });

  it('shows the "Forgot password?" link in login mode', () => {
    const screen = render(React.createElement(AuthScreen));
    expect(screen.getByText('Forgot password?')).toBeTruthy();
  });

  it('switching to the Sign Up tab hides the forgot-password link and shows Create Account', () => {
    const screen = render(React.createElement(AuthScreen));
    pressByText(screen, 'Sign Up');
    expect(screen.queryByText('Forgot password?')).toBeNull();
    expect(screen.getByText('Create Account')).toBeTruthy();
  });

  it('shows "Email is required" when submitting with an empty email', async () => {
    const screen = render(React.createElement(AuthScreen));
    pressByText(screen, 'Log In', 1);
    await screen.flush();
    expect(screen.getByText('Email is required')).toBeTruthy();
  });

  it('shows "Password is required" when submitting with an empty password', async () => {
    const screen = render(React.createElement(AuthScreen));
    fillInput(screen, 'you@example.com', 'user@test.com');
    pressByText(screen, 'Log In', 1);
    await screen.flush();
    expect(screen.getByText('Password is required')).toBeTruthy();
  });

  it('shows a min-length error when the password is under 8 characters', async () => {
    const screen = render(React.createElement(AuthScreen));
    fillInput(screen, 'you@example.com', 'user@test.com');
    fillInput(screen, 'Min 8 characters', 'short');
    pressByText(screen, 'Log In', 1);
    await screen.flush();
    expect(screen.getByText('Password must be at least 8 characters')).toBeTruthy();
  });

  it('calls signInWithPassword with trimmed email and password on valid login', async () => {
    const screen = render(React.createElement(AuthScreen));
    fillInput(screen, 'you@example.com', '  user@test.com  ');
    fillInput(screen, 'Min 8 characters', 'password123');
    pressByText(screen, 'Log In', 1);
    await screen.flush();
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@test.com',
      password: 'password123',
    });
  });

  it('shows the error message returned from signInWithPassword', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const screen = render(React.createElement(AuthScreen));
    fillInput(screen, 'you@example.com', 'user@test.com');
    fillInput(screen, 'Min 8 characters', 'password123');
    pressByText(screen, 'Log In', 1);
    await screen.flush();
    expect(screen.getByText('Invalid login credentials')).toBeTruthy();
  });

  it('successful sign-up switches back to login mode with a confirmation message', async () => {
    const screen = render(React.createElement(AuthScreen));
    pressByText(screen, 'Sign Up');
    fillInput(screen, 'you@example.com', 'new@test.com');
    fillInput(screen, 'Min 8 characters', 'password123');
    pressByText(screen, 'Create Account');
    await screen.flush();
    expect(supabase.auth.signUp).toHaveBeenCalled();
    expect(screen.getByText('Account created! Check your email to confirm, then log in.')).toBeTruthy();
    expect(screen.queryByText('Create Account')).toBeNull();
  });

  it('shows the ranking picker with all three factors in the Sign Up tab', () => {
    const screen = render(React.createElement(AuthScreen));
    pressByText(screen, 'Sign Up');
    expect(screen.getByText('Due date')).toBeTruthy();
    expect(screen.getByText('Importance')).toBeTruthy();
    expect(screen.getByText('Length / complexity')).toBeTruthy();
  });

  it('hides the ranking picker in Log In mode', () => {
    const screen = render(React.createElement(AuthScreen));
    expect(screen.queryByText('Due date')).toBeNull();
  });

  it('sign-up sends the default ranking order when the picker is untouched', async () => {
    const screen = render(React.createElement(AuthScreen));
    pressByText(screen, 'Sign Up');
    fillInput(screen, 'you@example.com', 'new@test.com');
    fillInput(screen, 'Min 8 characters', 'password123');
    pressByText(screen, 'Create Account');
    await screen.flush();
    expect(supabase.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        data: { rankingPreference: ['dueDate', 'importance', 'complexity'] },
      }),
    }));
  });

  it('moving a ranking factor up changes the order sent on sign-up', async () => {
    const screen = render(React.createElement(AuthScreen));
    pressByText(screen, 'Sign Up');
    fillInput(screen, 'you@example.com', 'new@test.com');
    fillInput(screen, 'Min 8 characters', 'password123');
    // Rows render in order [Due date, Importance, Length / complexity]; each
    // has its own "Move up" button, so index 1 is Importance's.
    pressByText(screen, 'Move up', 1);
    pressByText(screen, 'Create Account');
    await screen.flush();
    expect(supabase.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        data: { rankingPreference: ['importance', 'dueDate', 'complexity'] },
      }),
    }));
  });

  it('switching from Sign Up back to Log In and back to Sign Up resets the ranking to default', async () => {
    const screen = render(React.createElement(AuthScreen));
    pressByText(screen, 'Sign Up');
    pressByText(screen, 'Move up', 1); // Importance -> first
    pressByText(screen, 'Log In', 0);
    pressByText(screen, 'Sign Up');
    fillInput(screen, 'you@example.com', 'reset@test.com');
    fillInput(screen, 'Min 8 characters', 'password123');
    pressByText(screen, 'Create Account');
    await screen.flush();
    expect(supabase.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        data: { rankingPreference: ['dueDate', 'importance', 'complexity'] },
      }),
    }));
  });

  it('forgot password without an email shows an inline error', async () => {
    const screen = render(React.createElement(AuthScreen));
    pressByText(screen, 'Forgot password?');
    await screen.flush();
    expect(screen.getByText('Enter your email address above first')).toBeTruthy();
  });

  it('forgot password with an email sends a reset link', async () => {
    const screen = render(React.createElement(AuthScreen));
    fillInput(screen, 'you@example.com', 'user@test.com');
    pressByText(screen, 'Forgot password?');
    await screen.flush();
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'user@test.com',
      { redirectTo: 'https://ondeadline.app/reset-password.html' },
    );
    expect(screen.getByText('Password reset email sent! Check your inbox.')).toBeTruthy();
  });

  it('"Continue with Google" calls signInWithGoogle', async () => {
    const screen = render(React.createElement(AuthScreen));
    pressByText(screen, 'Continue with Google');
    await screen.flush();
    expect(signInWithGoogle).toHaveBeenCalled();
  });
});
