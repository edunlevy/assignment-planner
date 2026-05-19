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

// iOS allows at most 64 pending local notifications per app.
// We leave a small headroom so other app code (or future channels) can still schedule.
const IOS_PENDING_LIMIT = 64;
const IOS_PENDING_HEADROOM = 4;

async function pendingNotificationCount() {
  if (Platform.OS !== 'ios') return 0;
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    return Array.isArray(pending) ? pending.length : 0;
  } catch {
    return 0;
  }
}

// Compute the initial iOS slot budget by reading currently-pending notifications
// once. Callers scheduling many assignments at once should share a single budget
// object so concurrent schedules can't all see the same available count and
// collectively overrun the 64-notification cap.
async function makeSlotBudget() {
  if (Platform.OS !== 'ios') return { remaining: Infinity };
  const pending = await pendingNotificationCount();
  return { remaining: Math.max(0, IOS_PENDING_LIMIT - IOS_PENDING_HEADROOM - pending) };
}

// Schedule 24h and 1h reminders for an assignment, decrementing a shared
// `budget.remaining` counter. Used by both the single-shot `scheduleReminders`
// and the batch helper below.
async function scheduleRemindersForBudget(assignment, budget) {
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
    if (budget.remaining <= 0) break; // iOS pending-cap reached — stop scheduling

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
      budget.remaining--;
    } catch {
      // Ignore scheduling errors (e.g. no permission)
    }
  }

  return ids;
}

// Schedule 24h and 1h reminders for an assignment.
// Treats the due date as 11:59 PM local time.
// Skips any trigger that is already in the past.
// On iOS, also skips when the OS pending-notification limit (64) would be exceeded,
// rather than silently dropping the schedule.
// Returns an array of scheduled notification IDs (0–2 entries).
export async function scheduleReminders(assignment) {
  if (Platform.OS === 'web') return [];
  const budget = await makeSlotBudget();
  return scheduleRemindersForBudget(assignment, budget);
}

// Schedule reminders for many assignments sequentially against one shared
// iOS slot budget. Returns an array (matching input order) of reminder ID
// arrays. Use this in place of `Promise.all(items.map(scheduleReminders))`
// for bulk paths (recurring series creation, post-fetch rescheduling).
export async function scheduleRemindersBatch(assignments) {
  if (!Array.isArray(assignments)) return [];
  if (Platform.OS === 'web' || assignments.length === 0) {
    return assignments.map(() => []);
  }
  const budget = await makeSlotBudget();
  const out = [];
  for (const a of assignments) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await scheduleRemindersForBudget(a, budget));
  }
  return out;
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

// Persist the updated map. Awaits the write so callers that need
// ordering guarantees (e.g. cancel-then-clear on sign-out) can rely on it.
export async function saveReminderMap(userId, map) {
  try {
    await AsyncStorage.setItem(reminderMapKey(userId), JSON.stringify(map));
  } catch {
    // Storage write failed — non-fatal. Reminders still fire; we just
    // can't cancel them by ID until the next successful save.
  }
}

// Attach stored reminderIds to freshly fetched rows
export function mergeReminderIds(assignments, reminderMap) {
  return assignments.map(a => ({
    ...a,
    reminderIds: reminderMap[a.id] ?? [],
  }));
}

// Look up the canonical reminder IDs for one assignment from disk.
// Use this (instead of in-memory state) when cancelling, so a stale
// in-memory copy can't cause us to leak previously scheduled notifications.
export async function loadReminderIdsFor(userId, assignmentId) {
  const map = await loadReminderMap(userId);
  return map[assignmentId] ?? [];
}

// Deep-equal a reminder map by (id → sorted id list) so we avoid
// rewriting AsyncStorage when nothing actually changed.
export function reminderMapsEqual(a, b) {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const av = a[k];
    const bv = b[k];
    if (!Array.isArray(av) || !Array.isArray(bv)) return false;
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false;
    }
  }
  return true;
}
