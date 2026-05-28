import { Text, View } from 'react-native';

// Shown in the list when there are no assignments yet.
export default function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center px-8 pt-16">
      <Text className="text-5xl mb-4">📋</Text>
      <Text className="text-lg font-bold text-center" style={{ color: '#1A1A2E' }}>
        All clear!
      </Text>
      <Text className="text-sm text-center mt-1" style={{ color: '#888' }}>
        No assignments yet. Tap the{' '}
        <Text className="font-bold" style={{ color: '#3B5BDB' }}>+</Text>
        {' '}button to add your first one.
      </Text>
    </View>
  );
}
