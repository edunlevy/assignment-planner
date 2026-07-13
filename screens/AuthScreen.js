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
import { DEFAULT_RANKING } from '../lib/ordering';
import { signInWithApple, signInWithGoogle } from '../lib/socialAuth';
import { supabase } from '../lib/supabase';

// Display labels for the "Work on next" ranking factors, shown on the Sign
// Up tab. Keys must match lib/ordering.js's RANKING_FACTORS.
const FACTOR_LABELS = {
  dueDate: 'Due date',
  importance: 'Importance',
  complexity: 'Length / complexity',
};

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ranking, setRanking] = useState(DEFAULT_RANKING);
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
    setRanking(DEFAULT_RANKING);
    clearMessages();
  }

  // Swap the ranking entries at `index` and `index + direction` (direction
  // is -1 for "move up" / +1 for "move down"). No-op at the array edges.
  function moveRankingFactor(index, direction) {
    setRanking(prev => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleForgotPassword() {
    clearMessages();
    if (!email.trim()) { setError('Enter your email address above first'); return; }
    setLoading(true);
    try {
      // Email links must be https:// so they work from any browser (especially desktop Gmail).
      // The hosted page reads Supabase's recovery token from the URL fragment and forwards
      // to assignmentplanner://reset-password#... which the app's deep-link handler picks up.
      const redirectTo = 'https://ondeadline.app/reset-password.html';
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
        const emailRedirectTo = 'https://ondeadline.app/confirm-email.html';
        // rankingPreference rides in user_metadata so it survives the gap
        // between signUp() and email confirmation (no session exists yet to
        // write it straight to user_preferences). usePreferences reads it
        // off session.user.user_metadata on first authenticated load and
        // adopts it as the stored preference — see hooks/usePreferences.js.
        const { error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo, data: { rankingPreference: ranking } },
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
      const result = await signInWithApple();
      if (result === null) return; // user cancelled — stay silent
      // onAuthStateChange in App.js fires SIGNED_IN and unmounts this screen
    } catch (e) {
      setError(e.message);
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

        {/* Priority ranking — signup mode only. Order of `ranking` (top =
            index 0) is what gets sent as rankingPreference on submit. */}
        {mode === 'signup' && (
          <View style={styles.rankingSection}>
            <Text style={styles.label}>
              Rank what matters most for "Work on next"
            </Text>
            {ranking.map((factor, index) => (
              <View key={factor} style={styles.rankingRow}>
                <Text style={styles.rankingIndex}>{index + 1}</Text>
                <Text style={styles.rankingText}>{FACTOR_LABELS[factor]}</Text>
                <Pressable
                  onPress={() => moveRankingFactor(index, -1)}
                  disabled={index === 0}
                  style={styles.rankingButton}
                >
                  <Text style={[styles.rankingButtonText, index === 0 && styles.rankingButtonDisabled]}>
                    Move up
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => moveRankingFactor(index, 1)}
                  disabled={index === ranking.length - 1}
                  style={styles.rankingButton}
                >
                  <Text style={[styles.rankingButtonText, index === ranking.length - 1 && styles.rankingButtonDisabled]}>
                    Move down
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

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
  rankingSection: {
    marginTop: 4,
  },
  rankingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FF',
    borderWidth: 1,
    borderColor: '#DDE2FF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 6,
  },
  rankingIndex: {
    width: 20,
    fontWeight: '700',
    color: '#3B5BDB',
    fontSize: 14,
  },
  rankingText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A2E',
  },
  rankingButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  rankingButtonText: {
    color: '#3B5BDB',
    fontSize: 12,
    fontWeight: '600',
  },
  rankingButtonDisabled: {
    color: '#C3C9EE',
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
