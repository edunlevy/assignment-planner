import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Calendar } from 'react-native-calendars';

import { STATUS_COLORS, STATUS_LABELS } from './AssignmentFormModal';
import { formatTime } from '../lib/displayHelpers';

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function currentMonthKey(isoDate) {
  return isoDate.slice(0, 7); // "YYYY-MM"
}

export default function CalendarView({ assignments, onSelectAssignment }) {
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [calendarMonth, setCalendarMonth] = useState(todayISO());
  // Incremented only when the user taps Today, forcing the Calendar to remount
  // at the current month. Normal arrow navigation does NOT increment this, so
  // the library keeps its own scroll state without flashing.
  const [jumpKey, setJumpKey] = useState(0);

  const isOnTodayMonth = currentMonthKey(calendarMonth) === currentMonthKey(todayISO());

  function jumpToToday() {
    const today = todayISO();
    setSelectedDate(today);
    setCalendarMonth(today);
    setJumpKey(k => k + 1);
  }

  const markedDates = useMemo(() => {
    const map = {};
    for (const a of assignments) {
      if (!a.dueDate) continue;
      const dots = map[a.dueDate]?.dots ?? [];
      // Cap dots per day to keep the marker readable.
      if (dots.length < 4) {
        dots.push({ key: a.id, color: STATUS_COLORS[a.status] ?? '#3B5BDB' });
      }
      map[a.dueDate] = { dots };
    }
    if (map[selectedDate]) {
      map[selectedDate] = { ...map[selectedDate], selected: true, selectedColor: '#3B5BDB' };
    } else {
      map[selectedDate] = { selected: true, selectedColor: '#3B5BDB' };
    }
    return map;
  }, [assignments, selectedDate]);

  const dayItems = useMemo(() => {
    const DAY_END = 23 * 60 + 59;
    function minsOf(dueTime) {
      if (!dueTime || !/^\d{2}:\d{2}$/.test(dueTime)) return DAY_END;
      const h = Number(dueTime.slice(0, 2));
      const m = Number(dueTime.slice(3));
      return (h > 23 || m > 59) ? DAY_END : h * 60 + m;
    }
    return assignments
      .filter(a => a.dueDate === selectedDate)
      .sort((a, b) => minsOf(a.dueTime) - minsOf(b.dueTime));
  }, [assignments, selectedDate]);

  return (
    <View style={styles.container}>
      <Calendar
        key={jumpKey}
        current={calendarMonth}
        markingType="multi-dot"
        markedDates={markedDates}
        onDayPress={day => setSelectedDate(day.dateString)}
        onMonthChange={month => setCalendarMonth(month.dateString)}
        theme={{
          todayTextColor: '#3B5BDB',
          arrowColor: '#3B5BDB',
          selectedDayBackgroundColor: '#3B5BDB',
        }}
      />

      {!isOnTodayMonth && (
        <Pressable style={styles.todayButton} onPress={jumpToToday}>
          <Text style={styles.todayButtonText}>Today</Text>
        </Pressable>
      )}

      <View style={styles.pill}>
        <Text style={styles.pillText}>
          {dayItems.length} {dayItems.length === 1 ? 'assignment' : 'assignments'} on {selectedDate}
        </Text>
      </View>

      <FlatList
        data={dayItems}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onSelectAssignment(item)}>
            <View style={styles.rowBody}>
              <Text
                style={[
                  styles.rowTitle,
                  item.status === 'completed' && styles.rowTitleCompleted,
                ]}
              >
                {item.title}
              </Text>
              <Text style={styles.rowCourse}>{item.course}</Text>
              {!!item.dueTime && (
                <Text style={styles.rowTime}>{formatTime(item.dueTime)}</Text>
              )}
            </View>
            <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] }]}>
              <Text style={styles.badgeText}>{STATUS_LABELS[item.status]}</Text>
            </View>
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>No assignments due this day.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  todayButton: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#3B5BDB',
  },
  todayButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pill: {
    alignSelf: 'center',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#E8ECFF',
  },
  pillText: {
    fontSize: 12,
    color: '#3B5BDB',
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 120,
  },
  row: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#1A1A2E' },
  rowTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#888',
  },
  rowCourse: { fontSize: 12, color: '#3B5BDB', marginTop: 2, fontWeight: '500' },
  rowTime: { fontSize: 11, color: '#888', marginTop: 2 },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 10,
  },
  badgeText: { fontSize: 11, color: '#FFFFFF', fontWeight: '600' },
  empty: {
    textAlign: 'center',
    color: '#888',
    fontSize: 13,
    marginTop: 20,
  },
});
