import { View } from 'react-native';

// Color ramp: light lavender → deep navy, one segment per importance level.
const SEGMENT_COLORS = ['#BFC8FF', '#91A7FF', '#5C7CFA', '#3B5BDB', '#1E3A8A'];

// 5-segment horizontal bar that fills left-to-right based on importance (1–5).
export default function ImportanceBar({ value }) {
  return (
    <View className="flex-row gap-1 mt-1.5">
      {[1, 2, 3, 4, 5].map(n => (
        <View
          key={n}
          className="h-1.5 flex-1 rounded-full"
          style={{ backgroundColor: n <= value ? SEGMENT_COLORS[n - 1] : '#E8ECFF' }}
        />
      ))}
    </View>
  );
}
