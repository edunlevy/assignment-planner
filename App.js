import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import AssignmentFormModal from './components/AssignmentFormModal';
import AssignmentRow from './components/AssignmentRow';
import CalendarView from './components/CalendarView';
import EmptyState from './components/EmptyState';
import FilterBar from './components/FilterBar';
import WorkOnNextCard from './components/WorkOnNextCard';
import { applyFilters, distinctCourses, emptyFilters } from './lib/filtering';
import { pickWorkOnNext, sortForList } from './lib/ordering';
import { useAssignments } from './hooks/useAssignments';
import { useAuthSession } from './hooks/useAuthSession';
import { useDeepLinkAuth } from './hooks/useDeepLinkAuth';
import { usePreferences } from './hooks/usePreferences';
import { buildSeries } from './lib/recurring';
import { uuidv4 } from './lib/uuid';
import AuthScreen from './screens/AuthScreen';
import ProfileModal from './screens/ProfileModal';
import ResetPasswordModal from './screens/ResetPasswordModal';

// User-facing copy for the sync-error banner, one per mutation kind. Centralised
// so the shared "Check your connection and try again." wording stays consistent.
const SYNC_ERROR = {
  save: 'Could not save. Check your connection and try again.',
  delete: 'Could not delete. Check your connection and try again.',
  deleteSeries: 'Could not delete series. Check your connection and try again.',
};

// Top-level session bootstrap + assignment list view.
// All assignment lifecycle logic lives in useAssignments; the form lives in AssignmentFormModal.
function AppScreen() {
  const insets = useSafeAreaInsets();
  // Session lifecycle (getSession + onAuthStateChange + auto-refresh + the
  // recovery flag) and the auth deep-link handler live in dedicated hooks.
  const { session, sessionLoaded, recoveryMode, setRecoveryMode } = useAuthSession();
  useDeepLinkAuth(setRecoveryMode);
  const [profileVisible, setProfileVisible] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  // Session-only: no persistence across app restarts.
  const [filters, setFilters] = useState(emptyFilters());

  // Monotonic counter that increments every 60 s and on every app-foreground
  // event. Including it in the useMemo dependency array below ensures that
  // time-sensitive labels ("Due today", "Overdue") and the Work-on-next
  // recommendation stay accurate even when the app is left open across a
  // due time or midnight without any assignment data changing.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setClockTick(t => t + 1), 60_000);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') setClockTick(t => t + 1);
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  const userId = session?.user?.id ?? null;

  // Filters are per-account view state, but AppScreen stays mounted across
  // sign-out (the !session branch below is an early return, not an unmount),
  // so without this reset user B would inherit user A's filters — and a
  // course filter that matches nothing of B's silently hides their whole
  // list behind "No matches".
  useEffect(() => {
    setFilters(emptyFilters());
  }, [userId]);

  const {
    assignments,
    loaded,
    syncError,
    clearSyncError,
    reportSyncError,
    insert,
    insertMany,
    update,
    updateSeriesFrom,
    remove,
    removeSeries,
    calendarSyncEnabled,
    calendarSyncLoaded,
    enableCalendarSync,
    disableCalendarSync,
  } = useAssignments(userId);

  // Ranking preference for "Work on next" (see hooks/usePreferences.js for
  // the full reconciliation: existing DB row > sign-up metadata > default).
  // rankingPreference in user_metadata only exists for users who signed up
  // through the email/password form; social sign-ins fall back to default.
  const { ranking } = usePreferences(userId, session?.user?.user_metadata?.rankingPreference);

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
      reportSyncError(SYNC_ERROR.save);
    } finally {
      setSaving(false);
    }
  }

  function handleCreate(values) {
    return runMutation(() => insert(values));
  }

  function handleCreateRecurring(values) {
    return runMutation(() => {
      const drafts = buildSeries({
        startISO: values.dueDate,
        rule: values.rule,
        base: {
          title: values.title,
          course: values.course,
          importance: values.importance,
          complexity: values.complexity,
          ...(values.dueTime ? { dueTime: values.dueTime } : {}),
          status: 'not_started',
        },
        seriesId: uuidv4(),
      });
      return insertMany(drafts);
    });
  }

  function handleUpdate(id, changes) {
    return runMutation(() => update(id, changes));
  }

  function handleUpdateSeries(id, changes) {
    return runMutation(() => updateSeriesFrom(id, changes));
  }

  function handleDelete(id) {
    setSaving(true);
    clearSyncError();
    remove(id)
      .then(() => handleClose())
      .catch(() => reportSyncError(SYNC_ERROR.delete))
      .finally(() => setSaving(false));
  }

  function handleDeleteSeries(seriesId) {
    setSaving(true);
    clearSyncError();
    removeSeries(seriesId)
      .then(() => handleClose())
      .catch(() => reportSyncError(SYNC_ERROR.deleteSeries))
      .finally(() => setSaving(false));
  }

  // Sorted/filtered views — memoized so they don't recompute on unrelated re-renders.
  // clockTick is included so the Work-on-next recommendation and row labels
  // refresh when the clock crosses a due time, even without data changes.
  // Ordering logic lives in lib/ordering.js so it can be unit-tested in isolation.
  const { sorted, workOnNext, incompleteCount } = useMemo(() => {
    const now = new Date();
    const incompleteCount = assignments.filter(a => a.status !== 'completed').length;
    return {
      // Filtering narrows what's displayed only — workOnNext/incompleteCount
      // stay derived from the unfiltered list so the recommendation and
      // header count never change just because the view is filtered.
      sorted: sortForList(applyFilters(assignments, filters, now)),
      workOnNext: pickWorkOnNext(assignments, now, ranking),
      incompleteCount,
    };
  }, [assignments, clockTick, ranking, filters]);

  // Course chip options for the filter bar, derived from the full
  // (unfiltered) assignment set so a selected course chip doesn't disappear
  // once it narrows the list.
  const courseOptions = useMemo(() => distinctCourses(assignments), [assignments]);

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
        <>
          {assignments.length > 0 && (
            <FilterBar filters={filters} courses={courseOptions} onChange={setFilters} />
          )}
          <FlatList
            data={sorted}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <AssignmentRow item={item} onPress={() => openEditModal(item)} />
            )}
            // workOnNext is deliberately unfiltered, but recommending an
            // assignment directly above "No matches" reads as a
            // self-contradiction — suppress the card when filters (or an
            // empty account) leave nothing visible below it.
            ListHeaderComponent={workOnNext && sorted.length > 0 ? <WorkOnNextCard assignment={workOnNext} ranking={ranking} /> : null}
            contentContainerStyle={[styles.list, sorted.length === 0 && styles.listEmpty]}
            ListEmptyComponent={
              assignments.length > 0 && sorted.length === 0
                ? <EmptyState variant="noMatches" onClear={() => setFilters(emptyFilters())} />
                : <EmptyState />
            }
          />
        </>
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
        onUpdateSeries={handleUpdateSeries}
        onDelete={handleDelete}
        onDeleteSeries={handleDeleteSeries}
      />

      <ProfileModal
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        email={session?.user?.email ?? ''}
        userId={session?.user?.id}
        calendarSyncEnabled={calendarSyncEnabled}
        calendarSyncLoaded={calendarSyncLoaded}
        onEnableCalendarSync={enableCalendarSync}
        onDisableCalendarSync={disableCalendarSync}
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
