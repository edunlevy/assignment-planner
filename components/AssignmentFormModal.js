import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DueDateField from './DueDateField';
import DueTimeField from './DueTimeField';
import RecurringSeriesSection from './RecurringSeriesSection';
import { STATUS_LABELS, STATUS_COLORS, COMPLEXITY_OPTIONS, PRIMARY, WHITE } from '../lib/constants';
import { useAssignmentForm } from '../hooks/useAssignmentForm';
import { styles } from './AssignmentFormModal.styles';

// Modal form for creating or editing an assignment.
// Form state/validation/submit logic lives in useAssignmentForm; this
// component is responsible for rendering only.
export default function AssignmentFormModal({
  visible,
  editing,         // null = create, otherwise the assignment being edited
  saving,
  onClose,
  onCreate,
  onCreateRecurring,
  onUpdate,
  onDelete,
  onDeleteSeries,
}) {
  const insets = useSafeAreaInsets();
  const f = useAssignmentForm({ visible, editing, onCreate, onCreateRecurring, onUpdate, onDelete, onDeleteSeries });
  const { form, fieldErrors, isEditing } = f;

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
              onChangeText={t => f.handleChange('title', t)}
            />
            {fieldErrors.title ? <Text style={styles.errorText}>{fieldErrors.title}</Text> : null}

            <Text style={styles.label}>Course</Text>
            <TextInput
              style={[styles.input, fieldErrors.course ? styles.inputError : null]}
              placeholder="e.g. MATH 201"
              autoCapitalize="words"
              value={form.course}
              onChangeText={t => f.handleChange('course', t)}
            />
            {fieldErrors.course ? <Text style={styles.errorText}>{fieldErrors.course}</Text> : null}

            <Text style={styles.label}>Due Date</Text>
            <DueDateField
              value={form.dueDate}
              hasError={!!fieldErrors.dueDate}
              onChange={iso => f.handleChange('dueDate', iso)}
            />
            {fieldErrors.dueDate ? <Text style={styles.errorText}>{fieldErrors.dueDate}</Text> : null}

            <Text style={styles.label}>Due Time (optional)</Text>
            <DueTimeField
              value={form.dueTime}
              hasError={!!fieldErrors.dueTime}
              onChange={t => f.handleChange('dueTime', t)}
              onClear={f.clearDueTime}
            />
            {fieldErrors.dueTime ? <Text style={styles.errorText}>{fieldErrors.dueTime}</Text> : null}

            <Text style={styles.label}>Importance</Text>
            <View style={styles.importanceRow}>
              {[1, 2, 3, 4, 5].map(n => (
                <Pressable
                  key={n}
                  style={[
                    styles.importanceButton,
                    form.importance === n && styles.importanceButtonSelected,
                  ]}
                  onPress={() => f.handleChange('importance', n)}
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
            <Text style={styles.importanceHint}>{f.importanceHint}</Text>

            <Text style={styles.label}>Complexity / length</Text>
            <View style={styles.statusRow}>
              {COMPLEXITY_OPTIONS.map(({ key, label }) => (
                <Pressable
                  key={key}
                  style={[
                    styles.statusButton,
                    form.complexity === key && {
                      backgroundColor: PRIMARY,
                      borderColor: PRIMARY,
                    },
                  ]}
                  onPress={() => f.handleChange('complexity', key)}
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
                repeatInterval={form.repeatInterval}
                repeatUntil={form.repeatUntil}
                dueDate={form.dueDate}
                repeatUntilError={fieldErrors.repeatUntil}
                onToggle={f.toggleRecurring}
                onIntervalChange={n => f.handleChange('repeatInterval', n)}
                onRepeatUntilChange={iso => f.handleChange('repeatUntil', iso)}
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
                      onPress={() => f.handleChange('status', key)}
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
              onPress={f.handleSubmit}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color={WHITE} />
                : <Text style={styles.saveButtonText}>
                    {isEditing ? 'Save Changes' : 'Save Assignment'}
                  </Text>
              }
            </Pressable>

            {isEditing && (
              <Pressable
                style={[styles.deleteButton, saving && { opacity: 0.4 }]}
                onPress={f.handleDelete}
                disabled={saving}
              >
                <Text style={styles.deleteButtonText}>Delete Assignment</Text>
              </Pressable>
            )}

            {f.hasSeries && isEditing && (
              <Pressable
                style={[styles.deleteButton, saving && { opacity: 0.4 }]}
                onPress={f.handleDeleteSeries}
                disabled={saving}
              >
                <Text style={styles.deleteButtonText}>Delete Entire Series</Text>
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
