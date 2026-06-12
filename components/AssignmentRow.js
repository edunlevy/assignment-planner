import { Pressable, StyleSheet, Text, View } from 'react-native';
import { complexityLabel, dueDateLabel } from '../lib/displayHelpers';
import {
  STATUS_COLORS,
  STATUS_LABELS,
  WHITE,
  SHADOW,
  TEXT_PRIMARY,
  TEXT_MUTED,
  PRIMARY,
  URGENT,
  BADGE_BG,
  BORDER,
} from '../lib/constants';
import ImportanceBar from './ImportanceBar';

// A single row in the assignment list. Tapping it opens the edit modal.
export default function AssignmentRow({ item, onPress }) {
  const isCompleted = item.status === 'completed';
  const label = dueDateLabel(item.dueDate, new Date(), item.dueTime);
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
        <View style={styles.cardMetaRow}>
          <Text style={[styles.cardDue, label.urgent && !isCompleted && styles.cardDueUrgent]}>
            {label.text}
          </Text>
          <View style={styles.complexityChip}>
            <Text style={styles.complexityChipText}>
              {complexityLabel(item.complexity)}
            </Text>
          </View>
        </View>
        <ImportanceBar value={item.importance} />
      </View>
      <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] }]}>
        <Text style={styles.badgeText}>{STATUS_LABELS[item.status]}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: WHITE,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: SHADOW,
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
    color: TEXT_PRIMARY,
  },
  cardTitleCompleted: {
    textDecorationLine: 'line-through',
    color: TEXT_MUTED,
  },
  cardCourse: {
    fontSize: 13,
    color: PRIMARY,
    marginTop: 2,
    fontWeight: '500',
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
    flexWrap: 'wrap',
  },
  cardDue: {
    fontSize: 12,
    color: TEXT_MUTED,
  },
  cardDueUrgent: {
    color: URGENT,
    fontWeight: '600',
  },
  complexityChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: BADGE_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  complexityChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: PRIMARY,
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 10,
  },
  badgeText: {
    fontSize: 11,
    color: WHITE,
    fontWeight: '600',
  },
});
