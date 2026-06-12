import { View } from 'react-native';
import { IMPORTANCE_COLORS, IMPORTANCE_INACTIVE_COLOR } from '../lib/constants';

// 5-segment horizontal bar that fills left-to-right based on importance (1–5).
export default function ImportanceBar({ value }) {
  return (
    <View className="flex-row gap-1 mt-1.5">
      {[1, 2, 3, 4, 5].map(n => (
        <View
          key={n}
          className="h-1.5 flex-1 rounded-full"
          style={{ backgroundColor: n <= value ? IMPORTANCE_COLORS[n - 1] : IMPORTANCE_INACTIVE_COLOR }}
        />
      ))}
    </View>
  );
}
