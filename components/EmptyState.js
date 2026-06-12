import { Text, View } from 'react-native';
import { TEXT_PRIMARY, TEXT_MUTED, PRIMARY } from '../lib/constants';

// Shown in the list when there are no assignments yet.
export default function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center px-8 pt-16">
      <Text className="text-5xl mb-4">📋</Text>
      <Text className="text-lg font-bold text-center" style={{ color: TEXT_PRIMARY }}>
        All clear!
      </Text>
      <Text className="text-sm text-center mt-1" style={{ color: TEXT_MUTED }}>
        No assignments yet. Tap the{' '}
        <Text className="font-bold" style={{ color: PRIMARY }}>+</Text>
        {' '}button to add your first one.
      </Text>
    </View>
  );
}
