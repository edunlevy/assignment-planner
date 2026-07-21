import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { cancelAllReminders, saveReminderMap } from '../lib/notifications';
import { supabase } from '../lib/supabase';

export default function ProfileModal({
  visible,
  onClose,
  email,
  userId,
  calendarSyncEnabled,
  calendarSyncLoaded,
  onEnableCalendarSync,
  onDisableCalendarSync,
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarError, setCalendarError] = useState('');

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
      // Order: reminders first (cancel OS notifications), then calendar
      // sync if it was ever enabled, then maps and assignment cache
      // (privacy + prevents stale data resurfacing).
      await cancelAllReminders();
      // calendarSyncEnabled is a prop snapshot that only becomes trustworthy
      // once calendarSyncLoaded flips true (see useCalendarOrchestration.js —
      // it starts false and is read from AsyncStorage asynchronously). The
      // Delete Account button below is disabled until calendarSyncLoaded, so
      // by the time handleDelete can run at all, this reflects the real
      // on-disk state rather than the pre-load default.
      if (calendarSyncEnabled) {
        // deleteEvents: true — the account and every assignment are gone,
        // so the synced calendar events must go too, matching the
        // "permanently erases... everything" promise in confirmDelete's
        // message above. Best-effort: account deletion already succeeded
        // server-side by this point, so a calendar API failure here must
        // not block the rest of local cleanup or leave the user stuck.
        await onDisableCalendarSync(true).catch(() => {});
      }
      if (userId) {
        await saveReminderMap(userId, {});
        // Remove every remaining per-user local-only cache so deleted data
        // can't resurface if session cleanup misbehaves after the account
        // is gone. The server-side preferences row is deleted by
        // delete_user() itself (see the migration); these are all local
        // AsyncStorage mirrors: assignments_/ranking_ (usePreferences.js),
        // and the calendar-sync flag/map + stored device TZ, which
        // onDisableCalendarSync above only clears/flips rather than
        // removing (it may also never have run at all, if sync was never
        // enabled for this account).
        await AsyncStorage.removeItem(`assignments_${userId}`);
        await AsyncStorage.removeItem(`ranking_${userId}`);
        await AsyncStorage.removeItem(`calendar_sync_enabled_${userId}`);
        await AsyncStorage.removeItem(`calendar_events_${userId}`);
        await AsyncStorage.removeItem(`device_tz_${userId}`);
      }
      // Best-effort Google SDK sign-out for the same reason as handleSignOut.
      await GoogleSignin.signOut().catch(() => {});

      await supabase.auth.signOut();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  async function handleEnableCalendarSync() {
    setCalendarError('');
    setCalendarBusy(true);
    try {
      const granted = await onEnableCalendarSync();
      if (!granted) {
        setCalendarError('Calendar permission denied. Enable it for this app in your device Settings to sync assignments.');
      }
    } catch {
      setCalendarError('Could not turn on calendar sync. Please try again.');
    } finally {
      setCalendarBusy(false);
    }
  }

  async function handleDisableCalendarSync(deleteEvents) {
    setCalendarError('');
    setCalendarBusy(true);
    try {
      await onDisableCalendarSync(deleteEvents);
    } catch (err) {
      // Sync itself did turn off either way (useCalendarOrchestration sets
      // syncEnabled=false before attempting the delete) — this specific
      // error means the "also delete the events" part couldn't be
      // confirmed, which deserves a more precise message than the generic
      // fallback so the user knows to go check their calendar app rather
      // than assume nothing happened at all.
      setCalendarError(
        err?.code === 'CALENDAR_DELETE_UNCONFIRMED'
          ? 'Sync is off, but some calendar events may not have been removed. Check your calendar app.'
          : 'Could not turn off calendar sync. Please try again.'
      );
    } finally {
      setCalendarBusy(false);
    }
  }

  // Turning sync off has three outcomes (cancel / keep events / delete
  // events) via a three-button Alert.alert. No web fallback needed here,
  // unlike confirmDelete above — the whole calendar-sync section below is
  // already hidden on web (no native calendar API to sync with), so this
  // is never reached with Platform.OS === 'web'.
  function confirmDisableCalendarSync() {
    Alert.alert(
      'Turn off calendar sync?',
      'You can keep the events this app already created on your calendar, or remove them.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Keep Events', onPress: () => handleDisableCalendarSync(false) },
        { text: 'Delete Events', style: 'destructive', onPress: () => handleDisableCalendarSync(true) },
      ],
    );
  }

  function handleCalendarSyncToggle() {
    if (calendarSyncEnabled) {
      confirmDisableCalendarSync();
    } else {
      handleEnableCalendarSync();
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

          {/* Calendar sync — native only; no device calendar API on web. */}
          {Platform.OS !== 'web' && (
            <View style={styles.calendarRow}>
              <View style={styles.calendarTextGroup}>
                <Text style={styles.calendarLabel}>Sync to Calendar</Text>
                <Text style={styles.calendarSub}>
                  Adds a dedicated "Assignment Planner" calendar with your due dates
                </Text>
              </View>
              <Pressable
                style={[styles.calendarToggle, calendarSyncEnabled && styles.calendarToggleOn]}
                onPress={handleCalendarSyncToggle}
                disabled={!calendarSyncLoaded || calendarBusy}
              >
                {calendarBusy
                  ? <ActivityIndicator size="small" color={calendarSyncEnabled ? '#FFFFFF' : '#3B5BDB'} />
                  : <Text style={[styles.calendarToggleText, calendarSyncEnabled && styles.calendarToggleTextOn]}>
                      {calendarSyncEnabled ? 'On' : 'Off'}
                    </Text>
                }
              </Pressable>
            </View>
          )}
          {calendarError ? <Text style={styles.error}>{calendarError}</Text> : null}

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
            style={[
              styles.deleteButton,
              (loading || deleting || calendarBusy || !calendarSyncLoaded) && styles.signOutButtonDisabled,
            ]}
            onPress={confirmDelete}
            disabled={loading || deleting || calendarBusy || !calendarSyncLoaded}
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
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0F4FF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  calendarTextGroup: {
    flex: 1,
    marginRight: 12,
  },
  calendarLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A2E',
  },
  calendarSub: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  calendarToggle: {
    minWidth: 56,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#3B5BDB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarToggleOn: {
    backgroundColor: '#3B5BDB',
  },
  calendarToggleText: {
    color: '#3B5BDB',
    fontWeight: '700',
    fontSize: 13,
  },
  calendarToggleTextOn: {
    color: '#FFFFFF',
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
