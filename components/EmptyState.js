import { Pressable, Text, View } from 'react-native';
import { TEXT_PRIMARY, TEXT_MUTED, PRIMARY } from '../lib/constants';

// Shown in the list when there are no assignments at all (default) or when
// filters have narrowed the list down to zero matches (variant="noMatches").
// Default export's no-props behavior is unchanged so existing callers/tests
// that render <EmptyState /> keep seeing the original copy.
export default function EmptyState({ variant, onClear }) {
  if (variant === 'noMatches') {
    return (
      <View className="flex-1 items-center justify-center px-8 pt-16">
        <Text className="text-5xl mb-4">🔍</Text>
        <Text className="text-lg font-bold text-center" style={{ color: TEXT_PRIMARY }}>
          No matches
        </Text>
        <Text className="text-sm text-center mt-1" style={{ color: TEXT_MUTED }}>
          No assignments match the current filters.
        </Text>
        <Pressable className="mt-4 rounded-full px-4 py-2" onPress={onClear}>
          <Text className="text-sm font-bold" style={{ color: PRIMARY }}>
            Clear filters
          </Text>
        </Pressable>
      </View>
    );
  }

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
