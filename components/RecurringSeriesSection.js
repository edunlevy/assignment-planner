import { parseISO } from 'date-fns';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DueDateField from './DueDateField';
import { isValidDate } from '../lib/assignment';

const INTERVAL_OPTIONS = [
  { value: 1, label: 'Weekly' },
  { value: 2, label: 'Every 2 weeks' },
];

// Recurring-series sub-form rendered inside AssignmentFormModal (create mode only).
// Owns its own display logic; all state lives in the parent and is passed down.
//
// Props:
//   repeatWeekly        boolean — whether the repeat toggle is on
//   repeatInterval      number  — 1 (weekly) or 2 (biweekly)
//   repeatUntil         string  — ISO end date, or '' when not set
//   dueDate             string  — first due date (used to compute minimumDate)
//   repeatUntilError    string  — validation error message, or ''
//   onToggle            fn      — toggle repeatWeekly on/off (also clears repeatUntil)
//   onIntervalChange    fn(n)   — called when interval changes (1 or 2)
//   onRepeatUntilChange fn(iso) — called when the end-date picker changes
export default function RecurringSeriesSection({
  repeatWeekly,
  repeatInterval,
  repeatUntil,
  dueDate,
  repeatUntilError,
  onToggle,
  onIntervalChange,
  onRepeatUntilChange,
}) {
  return (
    <>
      <Pressable style={styles.repeatToggleRow} onPress={onToggle}>
        <View style={[styles.checkbox, repeatWeekly && styles.checkboxChecked]}>
          {repeatWeekly && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.repeatToggleLabel}>Repeat until…</Text>
      </Pressable>

      {repeatWeekly && (
        <>
          <Text style={styles.label}>Repeat interval</Text>
          <View style={styles.intervalRow}>
            {INTERVAL_OPTIONS.map(({ value, label }) => (
              <Pressable
                key={value}
                style={[
                  styles.intervalButton,
                  repeatInterval === value && styles.intervalButtonSelected,
                ]}
                onPress={() => onIntervalChange(value)}
              >
                <Text style={[
                  styles.intervalButtonText,
                  repeatInterval === value && styles.intervalButtonTextSelected,
                ]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

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
  intervalRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  intervalButton: {
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#DDE2FF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#F8F9FF',
  },
  intervalButtonSelected: {
    backgroundColor: '#3B5BDB',
    borderColor: '#3B5BDB',
  },
  intervalButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
  },
  intervalButtonTextSelected: {
    color: '#FFFFFF',
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
