import DateTimePicker from '@react-native-community/datetimepicker';
import { format, parseISO } from 'date-fns';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

function parseStoredDate(value) {
  if (!value) return null;
  try {
    const parsed = parseISO(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function DueDateField({
  value,
  onChange,
  hasError,
  placeholder = 'Tap to choose a date',
  minimumDate,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (Platform.OS === 'web') {
    return (
      <TextInput
        style={[styles.webInput, hasError ? styles.fieldError : null]}
        placeholder="YYYY-MM-DD"
        value={value}
        onChangeText={onChange}
      />
    );
  }

  const parsedValue = parseStoredDate(value);
  const displayText = parsedValue
    ? format(parsedValue, 'EEE, MMM d, yyyy')
    : placeholder;

  function handleChange(event, selectedDate) {
    if (Platform.OS === 'android') {
      setPickerOpen(false);
      if (event.type === 'dismissed') return;
    }
    if (selectedDate) {
      onChange(format(selectedDate, 'yyyy-MM-dd'));
    }
  }

  const pickerValue = parsedValue ?? minimumDate ?? new Date();

  return (
    <View>
      <Pressable
        style={[
          styles.field,
          hasError ? styles.fieldError : null,
        ]}
        onPress={() => setPickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={parsedValue ? `Date: ${displayText}. Tap to change.` : 'Tap to choose a date'}
      >
        <Text style={parsedValue ? styles.valueText : styles.placeholderText}>
          {displayText}
        </Text>
      </Pressable>

      {pickerOpen && Platform.OS === 'ios' && (
        <View style={styles.iosPickerWrap}>
          <DateTimePicker
            value={pickerValue}
            mode="date"
            display="spinner"
            minimumDate={minimumDate}
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
          mode="date"
          display="default"
          minimumDate={minimumDate}
          onChange={handleChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  webInput: {
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
