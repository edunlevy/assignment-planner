import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatTime } from '../lib/displayHelpers';

// Parses a stored "HH:MM" string into a Date object for the native picker.
function parseStoredTime(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

// Formats a Date object from the picker back to "HH:MM".
function toHHMM(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// Optional time picker. value is "HH:MM" (24-hour) or ''.
// onChange(hhmm) — called with the new "HH:MM" string.
// onClear() — called when the user removes the time.
export default function DueTimeField({ value, onChange, onClear, hasError }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.webRow}>
        <TextInput
          style={[styles.webInput, hasError ? styles.fieldError : null]}
          placeholder="HH:MM (e.g. 14:30)"
          value={value}
          onChangeText={onChange}
        />
        {!!value && (
          <Pressable style={styles.clearButton} onPress={onClear}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const parsedValue = parseStoredTime(value);
  const displayText = parsedValue ? formatTime(value) : 'Tap to choose a time';

  function handleChange(event, selectedDate) {
    if (Platform.OS === 'android') {
      setPickerOpen(false);
      if (event.type === 'dismissed') return;
    }
    if (selectedDate) onChange(toHHMM(selectedDate));
  }

  const pickerValue = parsedValue ?? new Date();

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          style={[styles.field, hasError ? styles.fieldError : null, { flex: 1 }]}
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={parsedValue ? `Time: ${displayText}. Tap to change.` : 'Tap to choose a time'}
        >
          <Text style={parsedValue ? styles.valueText : styles.placeholderText}>
            {displayText}
          </Text>
        </Pressable>
        {!!value && (
          <Pressable style={styles.clearButton} onPress={onClear}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        )}
      </View>

      {pickerOpen && Platform.OS === 'ios' && (
        <View style={styles.iosPickerWrap}>
          <DateTimePicker
            value={pickerValue}
            mode="time"
            display="spinner"
            onChange={handleChange}
          />
          <Pressable style={styles.doneButton} onPress={() => setPickerOpen(false)}>
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        </View>
      )}

      {pickerOpen && Platform.OS === 'android' && (
        <DateTimePicker
          value={pickerValue}
          mode="time"
          display="default"
          onChange={handleChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  webRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  webInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#DDE2FF',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#1A1A2E',
    backgroundColor: '#F8F9FF',
  },
  field: {
    borderWidth: 1,
    borderColor: '#DDE2FF',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#F8F9FF',
  },
  fieldError: {
    borderColor: '#FF6B6B',
    backgroundColor: '#FFF5F5',
  },
  valueText: {
    fontSize: 15,
    color: '#1A1A2E',
  },
  placeholderText: {
    fontSize: 15,
    color: '#9AA0B4',
  },
  clearButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  clearText: {
    color: '#3B5BDB',
    fontWeight: '600',
    fontSize: 14,
  },
  iosPickerWrap: {
    marginTop: 8,
    backgroundColor: '#F8F9FF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDE2FF',
    overflow: 'hidden',
  },
  doneButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  doneButtonText: {
    color: '#3B5BDB',
    fontWeight: '600',
    fontSize: 15,
  },
});
