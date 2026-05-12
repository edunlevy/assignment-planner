import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
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
    status: 'not_started',
  },
  {
    id: '2',
    title: 'Lab Report — Titration',
    course: 'CHEM 110',
    dueDate: '2026-05-15',
    status: 'in_progress',
  },
  {
    id: '3',
    title: 'Essay Draft',
    course: 'ENG 102',
    dueDate: '2026-05-18',
    status: 'not_started',
  },
  {
    id: '4',
    title: 'Reading Response',
    course: 'HIST 220',
    dueDate: '2026-05-12',
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

function AssignmentRow({ item }) {
  const isCompleted = item.status === 'completed';
  return (
    <View style={[styles.card, isCompleted && styles.cardCompleted]}>
      <View style={styles.cardBody}>
        <Text style={[styles.cardTitle, isCompleted && styles.cardTitleCompleted]}>
          {item.title}
        </Text>
        <Text style={styles.cardCourse}>{item.course}</Text>
        <Text style={styles.cardDue}>Due {item.dueDate}</Text>
      </View>
      <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] }]}>
        <Text style={styles.badgeText}>{STATUS_LABELS[item.status]}</Text>
      </View>
    </View>
  );
}

export default function App() {
  const [assignments, setAssignments] = useState(SAMPLE_ASSIGNMENTS);
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState({ title: '', course: '', dueDate: '' });

  function handleAdd() {
    if (!form.title.trim() || !form.course.trim() || !form.dueDate.trim()) return;
    const newAssignment = {
      id: Date.now().toString(),
      title: form.title.trim(),
      course: form.course.trim(),
      dueDate: form.dueDate.trim(),
      status: 'not_started',
    };
    setAssignments(prev => [newAssignment, ...prev]);
    setForm({ title: '', course: '', dueDate: '' });
    setModalVisible(false);
  }

  const incomplete = assignments.filter(a => a.status !== 'completed');
  const completed = assignments.filter(a => a.status === 'completed');
  const sorted = [...incomplete, ...completed];

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Assignment Planner</Text>
        <Text style={styles.headerSub}>
          {incomplete.length} remaining
        </Text>
      </View>

      {/* List */}
      <FlatList
        data={sorted}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <AssignmentRow item={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>No assignments yet — tap + to add one.</Text>
        }
      />

      {/* Add button */}
      <Pressable style={styles.fab} onPress={() => setModalVisible(true)}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      {/* Add assignment modal */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>New Assignment</Text>

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
              style={styles.input}
              placeholder="YYYY-MM-DD"
              value={form.dueDate}
              onChangeText={t => setForm(f => ({ ...f, dueDate: t }))}
            />

            <Pressable style={styles.saveButton} onPress={handleAdd}>
              <Text style={styles.saveButtonText}>Save Assignment</Text>
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setModalVisible(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
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
