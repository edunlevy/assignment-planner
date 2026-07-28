import { parseISO } from 'date-fns';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DueDateField from './DueDateField';
import { isValidDate } from '../lib/assignment';
import { MAX_INTERVAL, MAX_OCCURRENCES } from '../lib/recurring';
import {
  PRIMARY,
  WHITE,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  BORDER,
  SURFACE_TINT,
  DANGER,
} from '../lib/constants';

const FREQ_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const END_MODE_OPTIONS = [
  { value: 'until', label: 'On a date' },
  { value: 'count', label: 'After N times' },
];

// Single-letter weekday chips, Sunday-first to match the 0=Sun..6=Sat
// convention the rule model uses (date-fns getDay).
const WEEKDAYS = [
  { value: 0, label: 'S' },
  { value: 1, label: 'M' },
  { value: 2, label: 'T' },
  { value: 3, label: 'W' },
  { value: 4, label: 'T' },
  { value: 5, label: 'F' },
  { value: 6, label: 'S' },
];

// The interval stepper's bound is the generator's own MAX_INTERVAL (12 —
// covers "once a quarter" in weeks and a full year in months), imported so
// the UI clamp and the generator clamp can't drift apart.

// A [-] value [+] stepper. Clamped; the buttons visually disable at the
// bounds so the clamp is discoverable.
function Stepper({ value, min, max, suffix, onChange }) {
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <View style={styles.stepperRow}>
      <Pressable
        style={[styles.stepperButton, atMin && styles.stepperButtonDisabled]}
        disabled={atMin}
        onPress={() => onChange(Math.max(min, value - 1))}
      >
        <Text style={styles.stepperButtonText}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue}>{`${value}${suffix}`}</Text>
      <Pressable
        style={[styles.stepperButton, atMax && styles.stepperButtonDisabled]}
        disabled={atMax}
        onPress={() => onChange(Math.min(max, value + 1))}
      >
        <Text style={styles.stepperButtonText}>+</Text>
      </Pressable>
    </View>
  );
}

// Selected/unselected pill row shared by the frequency and end-mode pickers.
function PillRow({ options, selected, onSelect }) {
  return (
    <View style={styles.pillRow}>
      {options.map(({ value, label }) => (
        <Pressable
          key={value}
          style={[styles.pill, selected === value && styles.pillSelected]}
          onPress={() => onSelect(value)}
        >
          <Text style={[styles.pillText, selected === value && styles.pillTextSelected]}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// Recurring-series sub-form rendered inside AssignmentFormModal (create mode
// only). Owns its own display logic; all state lives in the parent and is
// passed down. See lib/recurring.js for the rule model this maps onto.
export default function RecurringSeriesSection({
  repeatEnabled,
  repeatFreq,
  repeatInterval,
  repeatWeekdays,
  repeatEndMode,
  repeatUntil,
  repeatCount,
  dueDate,
  repeatUntilError,
  repeatCountError,
  onToggle,
  onFreqChange,
  onIntervalChange,
  onWeekdayToggle,
  onEndModeChange,
  onRepeatUntilChange,
  onCountChange,
}) {
  const intervalSuffix =
    repeatFreq === 'monthly'
      ? repeatInterval === 1 ? ' month' : ' months'
      : repeatInterval === 1 ? ' week' : ' weeks';

  return (
    <>
      <Pressable style={styles.repeatToggleRow} onPress={onToggle}>
        <View style={[styles.checkbox, repeatEnabled && styles.checkboxChecked]}>
          {repeatEnabled && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.repeatToggleLabel}>Repeats…</Text>
      </Pressable>

      {repeatEnabled && (
        <>
          <Text style={styles.label}>Frequency</Text>
          <PillRow options={FREQ_OPTIONS} selected={repeatFreq} onSelect={onFreqChange} />

          <Text style={styles.label}>Every</Text>
          <Stepper
            value={repeatInterval}
            min={1}
            max={MAX_INTERVAL}
            suffix={intervalSuffix}
            onChange={onIntervalChange}
          />

          {repeatFreq === 'weekly' && (
            <>
              <Text style={styles.label}>On days</Text>
              <View style={styles.weekdayRow}>
                {WEEKDAYS.map(({ value, label }) => (
                  <Pressable
                    key={value}
                    style={[
                      styles.weekdayChip,
                      repeatWeekdays.includes(value) && styles.weekdayChipSelected,
                    ]}
                    onPress={() => onWeekdayToggle(value)}
                  >
                    <Text
                      style={[
                        styles.weekdayChipText,
                        repeatWeekdays.includes(value) && styles.weekdayChipTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {repeatWeekdays.length === 0 && (
                <Text style={styles.hint}>No days selected — repeats on the due date's weekday</Text>
              )}
            </>
          )}

          <Text style={styles.label}>Ends</Text>
          <PillRow options={END_MODE_OPTIONS} selected={repeatEndMode} onSelect={onEndModeChange} />

          {repeatEndMode === 'count' ? (
            <>
              <Stepper
                value={repeatCount}
                min={1}
                max={MAX_OCCURRENCES}
                suffix={repeatCount === 1 ? ' time' : ' times'}
                onChange={onCountChange}
              />
              {repeatCountError
                ? <Text style={styles.errorText}>{repeatCountError}</Text>
                : null}
            </>
          ) : (
            <>
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
    borderColor: BORDER,
    backgroundColor: SURFACE_TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  checkmark: {
    color: WHITE,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  repeatToggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  pill: {
    borderRadius: 20,
    borderWidth: 2,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: SURFACE_TINT,
  },
  pillSelected: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_SECONDARY,
  },
  pillTextSelected: {
    color: WHITE,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  stepperButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: BORDER,
    backgroundColor: SURFACE_TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonDisabled: {
    opacity: 0.4,
  },
  stepperButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    lineHeight: 20,
  },
  stepperValue: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    minWidth: 90,
    textAlign: 'center',
  },
  weekdayRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  weekdayChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: BORDER,
    backgroundColor: SURFACE_TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayChipSelected: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  weekdayChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_SECONDARY,
  },
  weekdayChipTextSelected: {
    color: WHITE,
  },
  // Mirrors AssignmentFormModal's label + errorText styles so this component
  // is visually consistent without needing the parent to pass styles down.
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_SECONDARY,
    marginBottom: 6,
    marginTop: 12,
  },
  hint: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    marginTop: 6,
  },
  errorText: {
    color: DANGER,
    fontSize: 12,
    marginTop: 4,
  },
});
