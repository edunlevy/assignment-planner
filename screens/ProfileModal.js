import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { cancelAllReminders, saveReminderMap } from '../lib/notifications';
import { supabase } from '../lib/supabase';

export default function ProfileModal({ visible, onClose, email, userId }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function handleSignOut() {
    setLoading(true);
    setError('');
    try {
      const { error: err } = await supabase.auth.signOut();
      if (err) {
        setError('Could not sign out. Please try again.');
      } else {
        // Sign-out succeeded — now safe to cancel reminders and wipe
        // the local reminder map so the next sign-in reschedules fresh.
        // Await the map write so onClose can't race ahead of the disk flush.
        await cancelAllReminders();
        if (userId) await saveReminderMap(userId, {});
        // Best-effort Google SDK sign-out so the account picker is shown
        // fresh next time rather than silently reusing the cached session.
        await GoogleSignin.signOut().catch(() => {});
        onClose();
      }
    } finally {
      setLoading(false);
    }
  }

  function confirmDelete() {
    const message =
      'This permanently erases your account and every assignment you have saved. This cannot be undone.';
    // React Native Web's Alert.alert renders no actionable buttons, so the
    // destructive onPress would never fire — "Delete Account" would silently
    // do nothing. Use window.confirm on web, mirroring the assignment delete
    // flow in hooks/useAssignmentForm.js.
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm(`Delete account?\n\n${message}`)) handleDelete();
    } else {
      Alert.alert(
        'Delete account?',
        message,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: handleDelete },
        ],
      );
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError('');
    try {
      const { error: rpcErr } = await supabase.rpc('delete_user');
      if (rpcErr) {
        setError('Could not delete account. Please try again or contact support.');
        return;
      }

      // Deletion succeeded — wipe all local data for this user.
      // Order: reminders first (cancel OS notifications), then maps and
      // assignment cache (privacy + prevents stale data resurfacing).
      await cancelAllReminders();
      if (userId) {
        await saveReminderMap(userId, {});
        // Remove the assignment cache so deleted data can't resurface
        // if session cleanup misbehaves after the account is gone.
        await AsyncStorage.removeItem(`assignments_${userId}`);
      }
      // Best-effort Google SDK sign-out for the same reason as handleSignOut.
      await GoogleSignin.signOut().catch(() => {});

      await supabase.auth.signOut();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>

          <View style={styles.handle} />

          <Text style={styles.title}>Profile</Text>

          <View style={styles.emailRow}>
            <Text style={styles.emailLabel}>Signed in as</Text>
            <Text style={styles.emailValue} numberOfLines={1}>{email}</Text>
          </View>

          <Pressable
            style={[styles.signOutButton, (loading || deleting) && styles.signOutButtonDisabled]}
            onPress={handleSignOut}
            disabled={loading || deleting}
          >
            {loading
              ? <ActivityIndicator color="#DC2626" />
              : <Text style={styles.signOutText}>Sign Out</Text>
            }
          </Pressable>

          <Pressable
            style={[styles.deleteButton, (loading || deleting) && styles.signOutButtonDisabled]}
            onPress={confirmDelete}
            disabled={loading || deleting}
          >
            {deleting
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.deleteText}>Delete Account</Text>
            }
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={styles.closeButton} onPress={onClose} disabled={loading || deleting}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>

        </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 24,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDE2FF',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 24,
  },
  emailRow: {
    backgroundColor: '#F0F4FF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  emailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A2E',
  },
  signOutButton: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  signOutButtonDisabled: {
    opacity: 0.6,
  },
  signOutText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 15,
  },
  deleteButton: {
    backgroundColor: '#DC2626',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  deleteText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  error: {
    color: '#DC2626',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  closeButton: {
    alignItems: 'center',
    padding: 8,
  },
  closeText: {
    color: '#888',
    fontSize: 15,
  },
});
