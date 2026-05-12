import AsyncStorage from '@react-native-async-storage/async-storage';
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

function ImportanceDots({ value }) {
  return (
    <View style={styles.dotsRow}>
      {[1, 2, 3, 4, 5].map(n => (
        <View
          key={n}
          style={[styles.dot, n <= value ? styles.dotFilled : styles.dotEmpty]}
        />
      ))}
    </View>
  );
}

function AssignmentRow({ item, onPress }) {
  const isCompleted = item.status === 'completed';
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
        <Text style={styles.cardDue}>Due {item.dueDate}</Text>
        <ImportanceDots value={item.importance} />
      </View>
      <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] }]}>
        <Text style={styles.badgeText}>{STATUS_LABELS[item.status]}</Text>
      </View>
    </Pressable>
  );
}

const EMPTY_FORM = { title: '', course: '', dueDate: '', importance: 3, status: 'not_started' };

function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

const STORAGE_KEY = 'assignments';

export default function App() {
  const [assignments, setAssignments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = add mode, id string = edit mode
  const [form, setForm] = useState(EMPTY_FORM);
  const [dueDateError, setDueDateError] = useState('');

  // Load saved assignments on first launch; fall back to sample data for new installs
  useEffect(() => {
    (async () => {
      try {
        const json = await AsyncStorage.getItem(STORAGE_KEY);
        if (json) {
          const parsed = JSON.parse(json);
          setAssignments(Array.isArray(parsed) ? parsed : SAMPLE_ASSIGNMENTS);
        } else {
          setAssignments(SAMPLE_ASSIGNMENTS);
        }
      } catch {
        setAssignments(SAMPLE_ASSIGNMENTS);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Persist whenever the list changes (skip the initial empty state before loading)
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(assignments)).catch(e =>
      console.warn('Failed to save assignments:', e)
    );
  }, [assignments, loaded]);

  function openAddModal() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDueDateError('');
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
    setDueDateError('');
    setModalVisible(true);
  }

  function handleClose() {
    setForm(EMPTY_FORM);
    setDueDateError('');
    setEditingId(null);
    setModalVisible(false);
  }

  function handleSave() {
    if (!form.title.trim() || !form.course.trim() || !form.dueDate.trim()) return;
    if (!isValidDate(form.dueDate.trim())) {
      setDueDateError('Enter a valid date in YYYY-MM-DD format (e.g. 2026-06-01)');
      return;
    }

    if (editingId) {
      // Update existing assignment
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
    } else {
      // Add new assignment
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

  // Smart sort: incomplete sorted by due date asc, then importance desc; completed at bottom
  const incomplete = assignments.filter(a => a.status !== 'completed');
  const completed = assignments.filter(a => a.status === 'completed');
  const sortedIncomplete = [...incomplete].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return b.importance - a.importance;
  });
  const sorted = [...sortedIncomplete, ...completed];

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

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Assignment Planner</Text>
        <Text style={styles.headerSub}>{incomplete.length} remaining</Text>
      </View>

      {/* List */}
      <FlatList
        data={sorted}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <AssignmentRow item={item} onPress={() => openEditModal(item)} />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>No assignments yet — tap + to add one.</Text>
        }
      />

      {/* Add button */}
      <Pressable style={styles.fab} onPress={openAddModal}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      {/* Add / Edit modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={handleClose}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>
                {isEditing ? 'Edit Assignment' : 'New Assignment'}
              </Text>

              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Problem Set 4"
                value={form.title}
                onChangeText={t => setForm(f => ({ ...f, title: t }))}
              />

              <Text style={styles.label}>Course</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. MATH 201"
                value={form.course}
                onChangeText={t => setForm(f => ({ ...f, course: t }))}
              />

              <Text style={styles.label}>Due Date</Text>
              <TextInput
                style={[styles.input, dueDateError ? styles.inputError : null]}
                placeholder="YYYY-MM-DD"
                value={form.dueDate}
                onChangeText={t => {
                  setForm(f => ({ ...f, dueDate: t }));
                  if (dueDateError) setDueDateError('');
                }}
              />
              {dueDateError ? (
                <Text style={styles.errorText}>{dueDateError}</Text>
              ) : null}

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

              {/* Status picker — only shown when editing */}
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

  // Header
  header: {
    backgroundColor: '#3B5BDB',
    paddingTop: 60,
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

  // List
  list: {
    padding: 16,
    paddingBottom: 100,
  },
  empty: {
    textAlign: 'center',
    color: '#888',
    marginTop: 60,
    fontSize: 15,
  },

  // Card
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

  // Importance dots (on card)
  dotsRow: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotFilled: {
    backgroundColor: '#3B5BDB',
  },
  dotEmpty: {
    backgroundColor: '#DDE2FF',
  },

  // Status badge
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

  // FAB
  fab: {
    position: 'absolute',
    bottom: 32,
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

  // Modal
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
    paddingBottom: 40,
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

  // Importance picker
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

  // Status picker
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

  // Action buttons
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
