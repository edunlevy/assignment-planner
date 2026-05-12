import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Show notifications even when the app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Create Android notification channel (required on Android 8+)
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('reminders', {
    name: 'Assignment Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    sound: true,
  });
}

// Ask for permission once; resolves to true/false
export async function requestNotificationPermission() {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// Schedule 24h and 1h reminders for an assignment.
// Treats the due date as 11:59 PM local time.
// Skips any trigger that is already in the past.
// Returns an array of scheduled notification IDs (0–2 entries).
export async function scheduleReminders(assignment) {
  if (Platform.OS === 'web') return [];

  const [y, m, d] = assignment.dueDate.split('-').map(Number);
  const dueAt = new Date(y, m - 1, d, 23, 59, 0); // 11:59 PM on due date (local)
  const now = Date.now();

  const reminders = [
    {
      offsetMs: 24 * 60 * 60 * 1000,
      title: 'Due tomorrow',
      body: `${assignment.title} — ${assignment.course}`,
    },
    {
      offsetMs: 60 * 60 * 1000,
      title: 'Due in 1 hour',
      body: `${assignment.title} — ${assignment.course}`,
    },
  ];

  const ids = [];
  for (const { offsetMs, title, body } of reminders) {
    const triggerMs = dueAt.getTime() - offsetMs;
    if (triggerMs <= now) continue; // already passed — skip

    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: { assignmentId: assignment.id },
        },
        trigger: { type: 'date', date: new Date(triggerMs), channelId: 'reminders' },
      });
      ids.push(id);
    } catch {
      // Ignore scheduling errors (e.g. no permission)
    }
  }

  return ids;
}

// Cancel every scheduled notification on this device (call on sign-out)
export async function cancelAllReminders() {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
}

// Cancel a list of previously scheduled notification IDs
export async function cancelReminders(reminderIds) {
  if (!Array.isArray(reminderIds) || reminderIds.length === 0) return;
  for (const id of reminderIds) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }
}

// --- Reminder ID persistence (survives Supabase fetch replacing all rows) ---

function reminderMapKey(userId) {
  return `reminder_ids_${userId}`;
}

// Load the { [assignmentId]: string[] } map from AsyncStorage
export async function loadReminderMap(userId) {
  try {
    const json = await AsyncStorage.getItem(reminderMapKey(userId));
    if (!json) return {};
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Persist the updated map
export async function saveReminderMap(userId, map) {
  AsyncStorage.setItem(reminderMapKey(userId), JSON.stringify(map)).catch(() => {});
}

// Attach stored reminderIds to freshly fetched rows
export function mergeReminderIds(assignments, reminderMap) {
  return assignments.map(a => ({
    ...a,
    reminderIds: reminderMap[a.id] ?? [],
  }));
}
