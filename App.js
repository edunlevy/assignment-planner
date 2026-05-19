import { differenceInCalendarDays, parseISO } from 'date-fns';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import AssignmentFormModal, { STATUS_COLORS, STATUS_LABELS } from './components/AssignmentFormModal';
import CalendarView from './components/CalendarView';
import { useAssignments } from './hooks/useAssignments';
import { parseAuthRedirect } from './lib/deepLink';
import { buildWeeklySeries } from './lib/recurring';
import { supabase } from './lib/supabase';
import AuthScreen from './screens/AuthScreen';
import ProfileModal from './screens/ProfileModal';
import ResetPasswordModal from './screens/ResetPasswordModal';

// Importance bar: 5 filled segments, color shifts from light to deep blue
const IMPORTANCE_SEGMENT_COLORS = ['#BFC8FF', '#91A7FF', '#5C7CFA', '#3B5BDB', '#1E3A8A'];

function dueDateLabel(dueDateStr) {
  try {
    const days = differenceInCalendarDays(parseISO(dueDateStr), new Date());
    if (days < 0) return { text: 'Overdue', urgent: true };
    if (days === 0) return { text: 'Due today', urgent: true };
    if (days === 1) return { text: 'Due tomorrow', urgent: true };
    if (days <= 7) return { text: `Due in ${days} days`, urgent: false };
    return { text: `Due ${dueDateStr}`, urgent: false };
  } catch {
    return { text: `Due ${dueDateStr}`, urgent: false };
  }
}

function ImportanceBar({ value }) {
  return (
    <View className="flex-row gap-1 mt-1.5">
      {[1, 2, 3, 4, 5].map(n => (
        <View
          key={n}
          className="h-1.5 flex-1 rounded-full"
          style={{ backgroundColor: n <= value ? IMPORTANCE_SEGMENT_COLORS[n - 1] : '#E8ECFF' }}
        />
      ))}
    </View>
  );
}

function WorkOnNextCard({ assignment }) {
  const label = dueDateLabel(assignment.dueDate);
  return (
    <View className="mx-4 mb-3 rounded-2xl overflow-hidden" style={{ backgroundColor: '#1E3A8A' }}>
      <View className="px-4 pt-4 pb-1">
        <Text className="text-xs font-bold tracking-widest uppercase" style={{ color: '#93C5FD' }}>
          Work on next
        </Text>
      </View>
      <View className="px-4 pb-4">
        <Text className="text-lg font-bold text-white mt-0.5">{assignment.title}</Text>
        <Text className="text-sm mt-0.5" style={{ color: '#BFDBFE' }}>{assignment.course}</Text>
        <View className="flex-row items-center mt-2 gap-2">
          <View
            className="rounded-full px-2.5 py-0.5"
            style={{ backgroundColor: label.urgent ? '#EF4444' : 'rgba(255,255,255,0.15)' }}
          >
            <Text className="text-xs font-semibold text-white">{label.text}</Text>
          </View>
          <Text className="text-xs" style={{ color: '#BFDBFE' }}>
            Importance {assignment.importance}/5
          </Text>
        </View>
      </View>
    </View>
  );
}

function AssignmentRow({ item, onPress }) {
  const isCompleted = item.status === 'completed';
  const label = dueDateLabel(item.dueDate);
  return (
    <Pressable
      style={[styles.card, isCompleted && styles.cardCompleted]}
      onPress={onPress}
    >
      <View style={styles.cardBody}>
        <Text style={[styles.cardTitle, isCompleted && styles.cardTitleCompleted]}>
          {item.title}
        </Text>
        <Text style={styles.cardCourse}>{item.course}</Text>
        <Text style={[styles.cardDue, label.urgent && !isCompleted && styles.cardDueUrgent]}>
          {label.text}
        </Text>
        <ImportanceBar value={item.importance} />
      </View>
      <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] }]}>
        <Text style={styles.badgeText}>{STATUS_LABELS[item.status]}</Text>
      </View>
    </Pressable>
  );
}

function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center px-8 pt-16">
      <Text className="text-5xl mb-4">📋</Text>
      <Text className="text-lg font-bold text-center" style={{ color: '#1A1A2E' }}>
        All clear!
      </Text>
      <Text className="text-sm text-center mt-1" style={{ color: '#888' }}>
        No assignments yet. Tap the{' '}
        <Text className="font-bold" style={{ color: '#3B5BDB' }}>+</Text>
        {' '}button to add your first one.
      </Text>
    </View>
  );
}

// Top-level session bootstrap + assignment list view.
// All assignment lifecycle logic lives in useAssignments; the form lives in AssignmentFormModal.
function AppScreen() {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const userId = session?.user?.id ?? null;
  const {
    assignments,
    loaded,
    syncError,
    clearSyncError,
    reportSyncError,
    insert,
    insertMany,
    update,
    remove,
  } = useAssignments(userId);

  // Check for existing session and listen for auth changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setSessionLoaded(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) setRecoveryMode(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Handle password-reset deep links
  // (assignmentplanner://reset-password#access_token=...&type=recovery).
  // With detectSessionInUrl:false we parse the URL ourselves. setSession emits SIGNED_IN
  // (not PASSWORD_RECOVERY), so we set recoveryMode directly on success.
  useEffect(() => {
    async function handleDeepLink(url) {
      if (!url) return;
      const isResetLink = url.includes('reset-password');
      const params = parseAuthRedirect(url);

      // PKCE flow: Supabase sends ?code= instead of fragment tokens.
      // The URL path already scopes this to password resets, so a
      // successful exchange always means recovery.
      if (params.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);
        if (!error && isResetLink) setRecoveryMode(true);
        return;
      }

      // Implicit flow: fragment tokens
      if (params.type === 'recovery' && params.access_token) {
        const { error } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token ?? '',
        });
        if (!error) setRecoveryMode(true);
      }
    }
    Linking.getInitialURL().then(handleDeepLink);
    const sub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
    return () => sub.remove();
  }, []);


  function openAddModal() {
    setEditingId(null);
    setModalVisible(true);
  }

  function openEditModal(item) {
    setEditingId(item.id);
    setModalVisible(true);
  }

  function handleClose() {
    setEditingId(null);
    setModalVisible(false);
  }

  // Wrap a mutation with the saving spinner + uniform error banner handling.
  async function runMutation(fn) {
    setSaving(true);
    clearSyncError();
    try {
      await fn();
      handleClose();
    } catch {
      reportSyncError('Could not save. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleCreate(values) {
    return runMutation(() => insert(values));
  }

  function handleCreateRecurring(values) {
    return runMutation(() => {
      const drafts = buildWeeklySeries({
        startISO: values.dueDate,
        untilISO: values.repeatUntil,
        base: {
          title: values.title,
          course: values.course,
          importance: values.importance,
          status: 'not_started',
        },
        seriesId: Date.now().toString(),
      });
      return insertMany(drafts);
    });
  }

  function handleUpdate(id, changes) {
    return runMutation(() => update(id, changes));
  }

  function handleDelete(id) {
    setSaving(true);
    clearSyncError();
    remove(id)
      .then(() => handleClose())
      .catch(() => reportSyncError('Could not delete. Check your connection and try again.'))
      .finally(() => setSaving(false));
  }

  // Sorted/filtered views — memoized so they don't recompute on unrelated re-renders.
  const { sorted, workOnNext, incompleteCount } = useMemo(() => {
    const incomplete = assignments.filter(a => a.status !== 'completed');
    const completed = assignments.filter(a => a.status === 'completed');
    const sortedIncomplete = [...incomplete].sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return b.importance - a.importance;
    });
    const next = incomplete.length > 0
      ? [...incomplete].sort((a, b) => {
          if (b.importance !== a.importance) return b.importance - a.importance;
          return a.dueDate.localeCompare(b.dueDate);
        })[0]
      : null;
    return {
      sorted: [...sortedIncomplete, ...completed],
      workOnNext: next,
      incompleteCount: incomplete.length,
    };
  }, [assignments]);

  const editing = editingId ? assignments.find(a => a.id === editingId) ?? null : null;

  if (!sessionLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }
  if (!session) return <AuthScreen />;
  if (!loaded) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>Assignment Planner</Text>
            <Text style={styles.headerSub}>{incompleteCount} remaining</Text>
          </View>
          <Pressable
            style={styles.profileButton}
            onPress={() => setProfileVisible(true)}
          >
            <Text style={styles.profileButtonText}>Account</Text>
          </Pressable>
        </View>
        <View style={styles.segmented}>
          <Pressable
            style={[styles.segment, viewMode === 'list' && styles.segmentActive]}
            onPress={() => setViewMode('list')}
          >
            <Text style={[styles.segmentText, viewMode === 'list' && styles.segmentTextActive]}>
              List
            </Text>
          </Pressable>
          <Pressable
            style={[styles.segment, viewMode === 'calendar' && styles.segmentActive]}
            onPress={() => setViewMode('calendar')}
          >
            <Text style={[styles.segmentText, viewMode === 'calendar' && styles.segmentTextActive]}>
              Calendar
            </Text>
          </Pressable>
        </View>
      </View>

      {syncError ? (
        <Pressable style={styles.syncErrorBanner} onPress={clearSyncError}>
          <Text style={styles.syncErrorText}>{syncError}  ✕</Text>
        </Pressable>
      ) : null}

      {viewMode === 'list' ? (
        <FlatList
          data={sorted}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <AssignmentRow item={item} onPress={() => openEditModal(item)} />
          )}
          ListHeaderComponent={workOnNext ? <WorkOnNextCard assignment={workOnNext} /> : null}
          contentContainerStyle={[styles.list, sorted.length === 0 && styles.listEmpty]}
          ListEmptyComponent={<EmptyState />}
        />
      ) : (
        <CalendarView
          assignments={assignments}
          onSelectAssignment={openEditModal}
        />
      )}

      <Pressable style={[styles.fab, { bottom: insets.bottom + 16 }]} onPress={openAddModal}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <AssignmentFormModal
        visible={modalVisible}
        editing={editing}
        saving={saving}
        onClose={handleClose}
        onCreate={handleCreate}
        onCreateRecurring={handleCreateRecurring}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />

      <ProfileModal
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        email={session?.user?.email ?? ''}
        userId={session?.user?.id}
      />

      <ResetPasswordModal
        visible={recoveryMode}
        onDone={() => setRecoveryMode(false)}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppScreen />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F4FF',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F0F4FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#888',
    fontSize: 16,
  },

  header: {
    backgroundColor: '#3B5BDB',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  profileButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  profileButtonText: {
    color: '#BFC8FF',
    fontSize: 13,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSub: {
    fontSize: 14,
    color: '#BFC8FF',
    marginTop: 4,
  },
  segmented: {
    flexDirection: 'row',
    marginTop: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: '#FFFFFF',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#BFC8FF',
  },
  segmentTextActive: {
    color: '#3B5BDB',
  },

  list: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  listEmpty: {
    flex: 1,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  cardCompleted: {
    opacity: 0.5,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A2E',
  },
  cardTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#888',
  },
  cardCourse: {
    fontSize: 13,
    color: '#3B5BDB',
    marginTop: 2,
    fontWeight: '500',
  },
  cardDue: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  cardDueUrgent: {
    color: '#EF4444',
    fontWeight: '600',
  },

  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 10,
  },
  badgeText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
  },

  fab: {
    position: 'absolute',
    right: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#3B5BDB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3B5BDB',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    fontSize: 30,
    color: '#FFFFFF',
    lineHeight: 34,
  },

  syncErrorBanner: {
    backgroundColor: '#FEF2F2',
    borderBottomWidth: 1,
    borderBottomColor: '#FECACA',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  syncErrorText: {
    color: '#DC2626',
    fontSize: 13,
    textAlign: 'center',
  },
});
