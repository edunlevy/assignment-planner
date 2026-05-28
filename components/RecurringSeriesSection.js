import { parseISO } from 'date-fns';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DueDateField from './DueDateField';
import { isValidDate } from '../lib/assignment';

// Recurring-series sub-form rendered inside AssignmentFormModal (create mode only).
// Owns its own display logic; all state lives in the parent and is passed down.
//
// Props:
//   repeatWeekly        boolean — whether the repeat toggle is on
//   repeatUntil         string  — ISO end date, or '' when not set
//   dueDate             string  — first due date (used to compute minimumDate)
//   repeatUntilError    string  — validation error message, or ''
//   onToggle            fn      — toggle repeatWeekly on/off (also clears repeatUntil)
//   onRepeatUntilChange fn(iso) — called when the end-date picker changes
export default function RecurringSeriesSection({
  repeatWeekly,
  repeatUntil,
  dueDate,
  repeatUntilError,
  onToggle,
  onRepeatUntilChange,
}) {
  return (
    <>
      <Pressable style={styles.repeatToggleRow} onPress={onToggle}>
        <View style={[styles.checkbox, repeatWeekly && styles.checkboxChecked]}>
          {repeatWeekly && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.repeatToggleLabel}>Repeat weekly until…</Text>
      </Pressable>

      {repeatWeekly && (
        <>
          <Text style={styles.label}>Repeat until</Text>
          <DueDateField
            value={repeatUntil}
            hasError={!!repeatUntilError}
            placeholder="Tap to choose an end date"
            minimumDate={isValidDate(dueDate) ? parseISO(dueDate) : undefined}
            onChange={onRepeatUntilChange}
          />
          {repeatUntilError
            ? <Text style={styles.errorText}>{repeatUntilError}</Text>
            : null}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
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
  // Mirrors AssignmentFormModal's label + errorText styles so this component
  // is visually consistent without needing the parent to pass styles down.
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginBottom: 6,
    marginTop: 12,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 12,
    marginTop: 4,
  },
});
