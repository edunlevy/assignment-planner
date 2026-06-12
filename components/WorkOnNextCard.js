import { Text, View } from 'react-native';
import { complexityLabel, dueDateLabel } from '../lib/displayHelpers';
import { WORK_CARD_BG, WORK_CARD_LABEL, WORK_CARD_TEXT, URGENT } from '../lib/constants';

// Prominent card shown at the top of the list for the highest-priority
// incomplete assignment (as selected by lib/ordering.pickWorkOnNext).
export default function WorkOnNextCard({ assignment }) {
  const label = dueDateLabel(assignment.dueDate, new Date(), assignment.dueTime);
  return (
    <View className="mx-4 mb-3 rounded-2xl overflow-hidden" style={{ backgroundColor: WORK_CARD_BG }}>
      <View className="px-4 pt-4 pb-1">
        <Text className="text-xs font-bold tracking-widest uppercase" style={{ color: WORK_CARD_LABEL }}>
          Work on next
        </Text>
        <Text className="text-xs" style={{ color: 'rgba(147,197,253,0.7)' }}>
          Prioritised by urgency &amp; complexity
        </Text>
      </View>
      <View className="px-4 pb-4">
        <Text className="text-lg font-bold text-white mt-0.5">{assignment.title}</Text>
        <Text className="text-sm mt-0.5" style={{ color: WORK_CARD_TEXT }}>{assignment.course}</Text>
        <View className="flex-row items-center mt-2 gap-2 flex-wrap">
          <View
            className="rounded-full px-2.5 py-0.5"
            style={{ backgroundColor: label.urgent ? URGENT : 'rgba(255,255,255,0.15)' }}
          >
            <Text className="text-xs font-semibold text-white">{label.text}</Text>
          </View>
          <View
            className="rounded-full px-2.5 py-0.5"
            style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
          >
            <Text className="text-xs font-semibold text-white">
              {complexityLabel(assignment.complexity)}
            </Text>
          </View>
          <Text className="text-xs" style={{ color: WORK_CARD_TEXT }}>
            Importance {assignment.importance}/5
          </Text>
        </View>
      </View>
    </View>
  );
}
