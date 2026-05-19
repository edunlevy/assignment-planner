import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
        onClose();
      }
    } finally {
      setLoading(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete account?',
      'This permanently erases your account and every assignment you have saved. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: handleDelete },
      ],
    );
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

      // Deletion succeeded — now safe to clean up local reminders.
      await cancelAllReminders();
      if (userId) await saveReminderMap(userId, {});

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
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
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
