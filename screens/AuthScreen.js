import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signInWithApple, signInWithGoogle } from '../lib/socialAuth';
import { supabase } from '../lib/supabase';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
    }
  }, []);

  function clearMessages() {
    setError('');
    setInfo('');
  }

  function switchMode(next) {
    setMode(next);
    setEmail('');
    setPassword('');
    clearMessages();
  }

  async function handleForgotPassword() {
    clearMessages();
    if (!email.trim()) { setError('Enter your email address above first'); return; }
    setLoading(true);
    try {
      // Email links must be https:// so they work from any browser (especially desktop Gmail).
      // The hosted page reads Supabase's recovery token from the URL fragment and forwards
      // to assignmentplanner://reset-password#... which the app's deep-link handler picks up.
      const redirectTo = 'https://edunlevy.github.io/assignment-planner/reset-password.html';
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (err) {
        setError(err.message);
      } else {
        setInfo('Password reset email sent! Check your inbox.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    clearMessages();
    if (!email.trim()) { setError('Email is required'); return; }
    if (!password) { setError('Password is required'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err) setError(err.message);
      } else {
        // Email links must be https:// so they survive Mail/Gmail link rewriting.
        // The hosted page forwards into assignmentplanner:// for the installed app.
        const emailRedirectTo = 'https://edunlevy.github.io/assignment-planner/confirm-email.html';
        const { error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo },
        });
        if (err) {
          setError(err.message);
        } else {
          // Switch to login tab but keep the confirmation message visible
          setEmail('');
          setPassword('');
          setMode('login');
          setInfo('Account created! Check your email to confirm, then log in.');
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleAppleSignIn() {
    clearMessages();
    setLoading(true);
    try {
      await signInWithApple();
      // onAuthStateChange in App.js fires SIGNED_IN and unmounts this screen
    } catch (e) {
      if (e.code !== 'ERR_REQUEST_CANCELED') setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    clearMessages();
    setLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result === null) return; // user cancelled — stay silent
      // onAuthStateChange in App.js fires SIGNED_IN and unmounts this screen
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.appName}>Assignment Planner</Text>
        <Text style={styles.tagline}>Stay on top of your work</Text>
      </View>

      {/* Card */}
      <View style={styles.card}>
        {/* Mode tabs */}
        <View style={styles.tabs}>
          {['login', 'signup'].map(m => (
            <Pressable
              key={m}
              style={[styles.tab, mode === m && styles.tabActive]}
              onPress={() => switchMode(m)}
            >
              <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                {m === 'login' ? 'Log In' : 'Sign Up'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Fields */}
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          value={email}
          onChangeText={t => { setEmail(t); clearMessages(); }}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Min 8 characters"
          value={password}
          onChangeText={t => { setPassword(t); clearMessages(); }}
          secureTextEntry
        />

        {/* Forgot password — login mode only */}
        {mode === 'login' && (
          <Pressable onPress={handleForgotPassword} disabled={loading} style={styles.forgotButton}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>
        )}

        {/* Feedback */}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {info ? <Text style={styles.info}>{info}</Text> : null}

        {/* Submit */}
        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>
                {mode === 'login' ? 'Log In' : 'Create Account'}
              </Text>
          }
        </Pressable>

        {/* Social login — native only (Google SDK not implemented for web) */}
        {Platform.OS !== 'web' && (
          <>
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or continue with</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Sign in with Apple — iOS only, when available */}
            {appleAvailable && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={12}
                style={styles.appleButton}
                onPress={handleAppleSignIn}
              />
            )}

            {/* Continue with Google */}
            <Pressable
              style={[styles.googleButton, loading && styles.buttonDisabled]}
              onPress={handleGoogleSignIn}
              disabled={loading}
            >
              <Image
                source={{ uri: 'https://www.google.com/favicon.ico' }}
                style={styles.googleIcon}
              />
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F4FF',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  appName: {
    fontSize: 28,
    fontWeight: '800',
    color: '#3B5BDB',
  },
  tagline: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 4,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#F0F4FF',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#3B5BDB',
  },
  tabText: {
    fontWeight: '600',
    color: '#888',
    fontSize: 14,
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DDE2FF',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#1A1A2E',
    backgroundColor: '#F8F9FF',
  },
  forgotButton: {
    alignSelf: 'flex-end',
    marginTop: 8,
  },
  forgotText: {
    color: '#3B5BDB',
    fontSize: 13,
    fontWeight: '500',
  },
  error: {
    color: '#EF4444',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  info: {
    color: '#3B5BDB',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#3B5BDB',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E9FF',
  },
  dividerText: {
    marginHorizontal: 10,
    fontSize: 13,
    color: '#999',
  },
  appleButton: {
    width: '100%',
    height: 50,
    marginBottom: 10,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  googleIcon: {
    width: 18,
    height: 18,
    marginRight: 10,
  },
  googleButtonText: {
    color: '#3C4043',
    fontWeight: '600',
    fontSize: 15,
  },
});
