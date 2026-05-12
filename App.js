import AsyncStorage from '@react-native-async-storage/async-storage';
import { addWeeks, differenceInCalendarDays, isAfter, parseISO } from 'date-fns';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

const SAMPLE_ASSIGNMENTS = [
  {
    id: '1',
    title: 'Problem Set 3',
    course: 'MATH 201',
    dueDate: '2026-05-14',
    importance: 4,
    status: 'not_started',
  },
  {
    id: '2',
    title: 'Lab Report — Titration',
    course: 'CHEM 110',
    dueDate: '2026-05-15',
    importance: 5,
    status: 'in_progress',
  },
  {
    id: '3',
    title: 'Essay Draft',
    course: 'ENG 102',
    dueDate: '2026-05-18',
    importance: 3,
    status: 'not_started',
  },
  {
    id: '4',
    title: 'Reading Response',
    course: 'HIST 220',
    dueDate: '2026-05-12',
    importance: 2,
    status: 'completed',
  },
];

const STATUS_LABELS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const STATUS_COLORS = {
  not_started: '#FF6B6B',
  in_progress: '#FFB347',
  completed: '#6BCB77',
};

const IMPORTANCE_HINTS = {
  1: 'Low priority',
  2: 'Minor',
  3: 'Normal',
  4: 'Important',
  5: 'Critical — do this first!',
};

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

const EMPTY_FORM = {
  title: '', course: '', dueDate: '', importance: 3, status: 'not_started',
  repeatWeekly: false, repeatUntil: '',
};

function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

const VALID_STATUSES = new Set(['not_started', 'in_progress', 'completed']);

function sanitizeAssignment(a) {
  if (!a || typeof a !== 'object') return null;
  if (!a.id || !a.title || !a.course || !a.dueDate) return null;
  return {
    ...a,
    importance: (Number.isInteger(a.importance) && a.importance >= 1 && a.importance <= 5)
      ? a.importance
      : 3,
    status: VALID_STATUSES.has(a.status) ? a.status : 'not_started',
  };
}

const STORAGE_KEY = 'assignments';

function AppScreen() {
  const insets = useSafeAreaInsets();
  const [assignments, setAssignments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({ title: '', course: '', dueDate: '', repeatUntil: '' });

  useEffect(() => {
    (async () => {
      try {
        const json = await AsyncStorage.getItem(STORAGE_KEY);
        if (json) {
          const parsed = JSON.parse(json);
          if (Array.isArray(parsed)) {
            const clean = parsed.map(sanitizeAssignment).filter(Boolean);
            setAssignments(clean);
          } else {
            setAssignments([]);
          }
        } else {
          setAssignments([]);
        }
      } catch {
        setAssignments([]);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(assignments)).catch(e =>
      console.warn('Failed to save assignments:', e)
    );
  }, [assignments, loaded]);

  const EMPTY_ERRORS = { title: '', course: '', dueDate: '', repeatUntil: '' };

  function openAddModal() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFieldErrors(EMPTY_ERRORS);
    setModalVisible(true);
  }

  function openEditModal(item) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      course: item.course,
      dueDate: item.dueDate,
      importance: item.importance,
      status: item.status,
    });
    setFieldErrors(EMPTY_ERRORS);
    setModalVisible(true);
  }

  function handleClose() {
    setForm(EMPTY_FORM);
    setFieldErrors(EMPTY_ERRORS);
    setEditingId(null);
    setModalVisible(false);
  }

  function handleSave() {
    const errors = { title: '', course: '', dueDate: '', repeatUntil: '' };
    if (!form.title.trim()) errors.title = 'Title is required';
    if (!form.course.trim()) errors.course = 'Course is required';
    if (!form.dueDate.trim()) {
      errors.dueDate = 'Due date is required';
    } else if (!isValidDate(form.dueDate.trim())) {
      errors.dueDate = 'Enter a valid date in YYYY-MM-DD format (e.g. 2026-06-01)';
    }
    if (!editingId && form.repeatWeekly) {
      if (!form.repeatUntil.trim()) {
        errors.repeatUntil = 'End date is required when repeating';
      } else if (!isValidDate(form.repeatUntil.trim())) {
        errors.repeatUntil = 'Enter a valid date in YYYY-MM-DD format (e.g. 2026-08-01)';
      } else if (!errors.dueDate && !isAfter(parseISO(form.repeatUntil.trim()), parseISO(form.dueDate.trim()))) {
        errors.repeatUntil = 'End date must be after the first due date';
      }
    }
    if (errors.title || errors.course || errors.dueDate || errors.repeatUntil) {
      setFieldErrors(errors);
      return;
    }

    if (editingId) {
      setAssignments(prev =>
        prev.map(a =>
          a.id === editingId
            ? {
                ...a,
                title: form.title.trim(),
                course: form.course.trim(),
                dueDate: form.dueDate.trim(),
                importance: form.importance,
                status: form.status,
              }
            : a
        )
      );
    } else if (form.repeatWeekly) {
      // Generate all weekly occurrences up front, capped at 52 (1 year)
      const seriesId = Date.now().toString();
      const until = parseISO(form.repeatUntil.trim());
      const occurrences = [];
      let current = parseISO(form.dueDate.trim());
      let week = 0;
      while (!isAfter(current, until) && week < 52) {
        const dueDateStr = current.toISOString().slice(0, 10);
        occurrences.push({
          id: `${seriesId}-${week}`,
          title: form.title.trim(),
          course: form.course.trim(),
          dueDate: dueDateStr,
          importance: form.importance,
          status: 'not_started',
          seriesId,
        });
        current = addWeeks(current, 1);
        week++;
      }
      setAssignments(prev => [...occurrences, ...prev]);
    } else {
      setAssignments(prev => [
        {
          id: Date.now().toString(),
          title: form.title.trim(),
          course: form.course.trim(),
          dueDate: form.dueDate.trim(),
          importance: form.importance,
          status: 'not_started',
        },
        ...prev,
      ]);
    }
    handleClose();
  }

  function handleDelete() {
    Alert.alert(
      'Delete Assignment',
      `Delete "${form.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setAssignments(prev => prev.filter(a => a.id !== editingId));
            handleClose();
          },
        },
      ]
    );
  }

  const incomplete = assignments.filter(a => a.status !== 'completed');
  const completed = assignments.filter(a => a.status === 'completed');
  const sortedIncomplete = [...incomplete].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return b.importance - a.importance;
  });
  const sorted = [...sortedIncomplete, ...completed];

  // Highest-priority incomplete assignment: importance desc, then due date asc
  const workOnNext = incomplete.length > 0
    ? [...incomplete].sort((a, b) => {
        if (b.importance !== a.importance) return b.importance - a.importance;
        return a.dueDate.localeCompare(b.dueDate);
      })[0]
    : null;

  if (!loaded) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  const isEditing = editingId !== null;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.headerTitle}>Assignment Planner</Text>
        <Text style={styles.headerSub}>{incomplete.length} remaining</Text>
      </View>

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

      <Pressable style={[styles.fab, { bottom: insets.bottom + 16 }]} onPress={openAddModal}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={handleClose}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>
                {isEditing ? 'Edit Assignment' : 'New Assignment'}
              </Text>

              <Text style={styles.label}>Title</Text>
              <TextInput
                style={[styles.input, fieldErrors.title ? styles.inputError : null]}
                placeholder="e.g. Problem Set 4"
                value={form.title}
                onChangeText={t => {
                  setForm(f => ({ ...f, title: t }));
                  if (fieldErrors.title) setFieldErrors(e => ({ ...e, title: '' }));
                }}
              />
              {fieldErrors.title ? <Text style={styles.errorText}>{fieldErrors.title}</Text> : null}

              <Text style={styles.label}>Course</Text>
              <TextInput
                style={[styles.input, fieldErrors.course ? styles.inputError : null]}
                placeholder="e.g. MATH 201"
                value={form.course}
                onChangeText={t => {
                  setForm(f => ({ ...f, course: t }));
                  if (fieldErrors.course) setFieldErrors(e => ({ ...e, course: '' }));
                }}
              />
              {fieldErrors.course ? <Text style={styles.errorText}>{fieldErrors.course}</Text> : null}

              <Text style={styles.label}>Due Date</Text>
              <TextInput
                style={[styles.input, fieldErrors.dueDate ? styles.inputError : null]}
                placeholder="YYYY-MM-DD"
                value={form.dueDate}
                onChangeText={t => {
                  setForm(f => ({ ...f, dueDate: t }));
                  if (fieldErrors.dueDate) setFieldErrors(e => ({ ...e, dueDate: '' }));
                }}
              />
              {fieldErrors.dueDate ? <Text style={styles.errorText}>{fieldErrors.dueDate}</Text> : null}

              <Text style={styles.label}>Importance</Text>
              <View style={styles.importanceRow}>
                {[1, 2, 3, 4, 5].map(n => (
                  <Pressable
                    key={n}
                    style={[
                      styles.importanceButton,
                      form.importance === n && styles.importanceButtonSelected,
                    ]}
                    onPress={() => setForm(f => ({ ...f, importance: n }))}
                  >
                    <Text
                      style={[
                        styles.importanceButtonText,
                        form.importance === n && styles.importanceButtonTextSelected,
                      ]}
                    >
                      {n}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.importanceHint}>{IMPORTANCE_HINTS[form.importance]}</Text>

              {/* Repeat weekly — only shown when adding, not editing */}
              {!isEditing && (
                <>
                  <Pressable
                    style={styles.repeatToggleRow}
                    onPress={() => setForm(f => ({ ...f, repeatWeekly: !f.repeatWeekly, repeatUntil: '' }))}
                  >
                    <View style={[styles.checkbox, form.repeatWeekly && styles.checkboxChecked]}>
                      {form.repeatWeekly && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={styles.repeatToggleLabel}>Repeat weekly until…</Text>
                  </Pressable>

                  {form.repeatWeekly && (
                    <>
                      <TextInput
                        style={[styles.input, fieldErrors.repeatUntil ? styles.inputError : null]}
                        placeholder="End date YYYY-MM-DD"
                        value={form.repeatUntil}
                        onChangeText={t => {
                          setForm(f => ({ ...f, repeatUntil: t }));
                          if (fieldErrors.repeatUntil) setFieldErrors(e => ({ ...e, repeatUntil: '' }));
                        }}
                      />
                      {fieldErrors.repeatUntil
                        ? <Text style={styles.errorText}>{fieldErrors.repeatUntil}</Text>
                        : null}
                    </>
                  )}
                </>
              )}

              {isEditing && (
                <>
                  <Text style={styles.label}>Status</Text>
                  <View style={styles.statusRow}>
                    {Object.entries(STATUS_LABELS).map(([key, label]) => (
                      <Pressable
                        key={key}
                        style={[
                          styles.statusButton,
                          form.status === key && {
                            backgroundColor: STATUS_COLORS[key],
                            borderColor: STATUS_COLORS[key],
                          },
                        ]}
                        onPress={() => setForm(f => ({ ...f, status: key }))}
                      >
                        <Text
                          style={[
                            styles.statusButtonText,
                            form.status === key && styles.statusButtonTextSelected,
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Pressable style={styles.saveButton} onPress={handleSave}>
                <Text style={styles.saveButtonText}>
                  {isEditing ? 'Save Changes' : 'Save Assignment'}
                </Text>
              </Pressable>

              {isEditing && (
                <Pressable style={styles.deleteButton} onPress={handleDelete}>
                  <Text style={styles.deleteButtonText}>Delete Assignment</Text>
                </Pressable>
              )}

              <Pressable style={styles.cancelButton} onPress={handleClose}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 20,
    paddingHorizontal: 20,
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

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: '90%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 20,
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
  inputError: {
    borderColor: '#FF6B6B',
    backgroundColor: '#FFF5F5',
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 12,
    marginTop: 4,
  },

  importanceRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  importanceButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#DDE2FF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F9FF',
  },
  importanceButtonSelected: {
    backgroundColor: '#3B5BDB',
    borderColor: '#3B5BDB',
  },
  importanceButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#3B5BDB',
  },
  importanceButtonTextSelected: {
    color: '#FFFFFF',
  },
  importanceHint: {
    fontSize: 12,
    color: '#888',
    marginTop: 6,
  },

  // Repeat toggle
  repeatToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#DDE2FF',
    backgroundColor: '#F8F9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#3B5BDB',
    borderColor: '#3B5BDB',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  repeatToggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A2E',
  },

  statusRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  statusButton: {
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#DDE2FF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#F8F9FF',
  },
  statusButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
  },
  statusButtonTextSelected: {
    color: '#FFFFFF',
  },

  saveButton: {
    backgroundColor: '#3B5BDB',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  deleteButton: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FF6B6B',
    padding: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  deleteButtonText: {
    color: '#FF6B6B',
    fontWeight: '700',
    fontSize: 15,
  },
  cancelButton: {
    alignItems: 'center',
    marginTop: 12,
    padding: 8,
  },
  cancelButtonText: {
    color: '#888',
    fontSize: 15,
  },
});
