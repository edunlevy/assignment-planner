import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DueDateField from './DueDateField';
import RecurringSeriesSection from './RecurringSeriesSection';
import { validateAssignmentForm, EMPTY_ERRORS } from '../lib/formValidation';

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

// Complexity / length gauge. Order matches the picker (Short → Medium → Long).
// Numeric weights live in lib/ordering.js — this file only owns labels + UI.
const COMPLEXITY_OPTIONS = [
  { key: 'short',  label: 'Short',  hint: '< 1 hour' },
  { key: 'medium', label: 'Medium', hint: '1–2 hours' },
  { key: 'long',   label: 'Long',   hint: '3+ hours' },
];

const EMPTY_FORM = {
  title: '', course: '', dueDate: '', importance: 3, status: 'not_started',
  complexity: 'medium',
  repeatWeekly: false, repeatUntil: '',
};

// EMPTY_ERRORS imported from lib/formValidation

function formFor(item) {
  if (!item) return EMPTY_FORM;
  return {
    title: item.title,
    course: item.course,
    dueDate: item.dueDate,
    importance: item.importance,
    status: item.status,
    complexity: item.complexity ?? 'medium',
    repeatWeekly: false,
    repeatUntil: '',
  };
}

// Modal form for creating or editing an assignment.
// Owns its own form state; mutation effects are delegated to the parent
// via onCreate / onCreateRecurring / onUpdate / onDelete callbacks.
export default function AssignmentFormModal({
  visible,
  editing,         // null = create, otherwise the assignment being edited
  saving,
  onClose,
  onCreate,
  onCreateRecurring,
  onUpdate,
  onDelete,
}) {
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState(EMPTY_ERRORS);

  // Reset form state when the modal opens or switches between create/edit.
  // Effect-based so we don't issue setState during render (which Strict Mode
  // and React 19 are stricter about). The `visible` gate ensures we only
  // re-seed on open transitions, never while the user is mid-edit.
  useEffect(() => {
    if (!visible) return;
    setForm(formFor(editing));
    setFieldErrors(EMPTY_ERRORS);
  }, [visible, editing?.id]);

  const isEditing = !!editing;

  async function handleSave() {
    const errors = validateAssignmentForm(form, { isEditing });
    if (errors.title || errors.course || errors.dueDate || errors.repeatUntil) {
      setFieldErrors(errors);
      return;
    }

    const base = {
      title: form.title.trim(),
      course: form.course.trim(),
      dueDate: form.dueDate.trim(),
      importance: form.importance,
      complexity: form.complexity,
    };

    if (isEditing) {
      await onUpdate(editing.id, { ...base, status: form.status });
    } else if (form.repeatWeekly) {
      await onCreateRecurring({
        ...base,
        repeatUntil: form.repeatUntil.trim(),
      });
    } else {
      await onCreate({ ...base, status: 'not_started' });
    }
  }

  function handleDelete() {
    const doDelete = () => onDelete(editing.id);
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm(`Delete "${form.title}"?`)) doDelete();
    } else {
      Alert.alert(
        'Delete Assignment',
        `Delete "${form.title}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>
              {isEditing ? 'Edit Assignment' : 'New Assignment'}
            </Text>

            <Text style={styles.label}>Title</Text>
            <TextInput
              style={[styles.input, fieldErrors.title ? styles.inputError : null]}
              placeholder="e.g. Problem Set 4"
              autoCapitalize="words"
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
              autoCapitalize="words"
              value={form.course}
              onChangeText={t => {
                setForm(f => ({ ...f, course: t }));
                if (fieldErrors.course) setFieldErrors(e => ({ ...e, course: '' }));
              }}
            />
            {fieldErrors.course ? <Text style={styles.errorText}>{fieldErrors.course}</Text> : null}

            <Text style={styles.label}>Due Date</Text>
            <DueDateField
              value={form.dueDate}
              hasError={!!fieldErrors.dueDate}
              onChange={iso => {
                setForm(f => ({ ...f, dueDate: iso }));
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

            <Text style={styles.label}>Complexity / length</Text>
            <View style={styles.statusRow}>
              {COMPLEXITY_OPTIONS.map(({ key, label }) => (
                <Pressable
                  key={key}
                  style={[
                    styles.statusButton,
                    form.complexity === key && {
                      backgroundColor: '#3B5BDB',
                      borderColor: '#3B5BDB',
                    },
                  ]}
                  onPress={() => setForm(f => ({ ...f, complexity: key }))}
                >
                  <Text
                    style={[
                      styles.statusButtonText,
                      form.complexity === key && styles.statusButtonTextSelected,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.importanceHint}>
              {COMPLEXITY_OPTIONS.find(o => o.key === form.complexity)?.hint}
            </Text>

            {!isEditing && (
              <RecurringSeriesSection
                repeatWeekly={form.repeatWeekly}
                repeatUntil={form.repeatUntil}
                dueDate={form.dueDate}
                repeatUntilError={fieldErrors.repeatUntil}
                onToggle={() => setForm(f => ({ ...f, repeatWeekly: !f.repeatWeekly, repeatUntil: '' }))}
                onRepeatUntilChange={iso => {
                  setForm(f => ({ ...f, repeatUntil: iso }));
                  if (fieldErrors.repeatUntil) setFieldErrors(e => ({ ...e, repeatUntil: '' }));
                }}
              />
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

            <Pressable
              style={[styles.saveButton, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.saveButtonText}>
                    {isEditing ? 'Save Changes' : 'Save Assignment'}
                  </Text>
              }
            </Pressable>

            {isEditing && (
              <Pressable
                style={[styles.deleteButton, saving && { opacity: 0.4 }]}
                onPress={handleDelete}
                disabled={saving}
              >
                <Text style={styles.deleteButtonText}>Delete Assignment</Text>
              </Pressable>
            )}

            <Pressable style={styles.cancelButton} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
    </Modal>
  );
}

export { STATUS_LABELS, STATUS_COLORS, COMPLEXITY_OPTIONS };

const styles = StyleSheet.create({
  modalSheet: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 24,
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
