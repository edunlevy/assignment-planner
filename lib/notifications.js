import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { isValidTime } from './assignment';

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
  // Use the assignment's specific due time when set and valid; fall back to
  // 11:59 PM so reminders still fire for assignments without a specific time.
  // Validate before splitting so a malformed value from an old/partial DB row
  // can't produce NaN hours and silently break Date construction.
  const [dueH, dueMin] = (assignment.dueTime && isValidTime(assignment.dueTime))
    ? assignment.dueTime.split(':').map(Number)
    : [23, 59];
  const dueAt = new Date(y, m - 1, d, dueH, dueMin, 0);
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

    // Platform-specific trigger:
    //
    //   iOS   — CALENDAR trigger (UNCalendarNotificationTrigger). Fires when
    //           the local clock reaches the specified date/time components, so
    //           a later device-TZ change adjusts the fire time automatically.
    //           NB: month is 1-indexed in CALENDAR triggers.
    //
    //   Android — DATE trigger (absolute timestamp). expo-notifications 0.32.x
    //           rejects CALENDAR triggers on Android and the error is silently
    //           swallowed here, causing Android users to receive no reminders.
    //           Android TZ changes are caught by the AppState reschedule path
    //           in useAssignments.js, which cancels and re-schedules all
    //           incomplete reminders using a fresh absolute timestamp.
    const triggerDate = new Date(triggerMs);
    const trigger = Platform.OS === 'ios'
      ? {
          type:   Notifications.SchedulableTriggerInputTypes.CALENDAR,
          year:   triggerDate.getFullYear(),
          month:  triggerDate.getMonth() + 1,   // 1-indexed
          day:    triggerDate.getDate(),
          hour:   triggerDate.getHours(),
          minute: triggerDate.getMinutes(),
          second: 0,
          channelId: 'reminders',
        }
      : {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(triggerMs),
          channelId: 'reminders',
        };

    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: { assignmentId: assignment.id },
        },
        trigger,
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
// Uses assignment.dueTime (HH:MM) when present; falls back to 11:59 PM local time.
// Skips any trigger that is already in the past.
// On iOS, also skips when the OS pending-notification limit (64) would be exceeded,
// rather than silently dropping the schedule.
//
// `reservedSlots` lets a caller who is about to free up N of its OWN
// currently-pending slots count those N as already available, rather than
// have them count against the very scheduling attempt that's replacing
// them. Used by useReminderOrchestration's scheduleFor, which now schedules
// new reminders BEFORE cancelling the old ones (so a transient failure
// never loses working reminders) — without this adjustment, a user near
// the iOS cap editing an assignment could see its own still-scheduled old
// reminders count against the new schedule attempt and fail to get
// replacements, even though cancelling the old ones nets zero new load.
// Defaults to 0 for every other caller (fresh inserts, batch scheduling),
// where there's nothing of the row's own already occupying a slot.
// Returns an array of scheduled notification IDs (0–2 entries).
export async function scheduleReminders(assignment, reservedSlots = 0) {
  if (Platform.OS === 'web') return [];
  const budget = await makeSlotBudget();
  budget.remaining += reservedSlots;
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

// Identifiers of every notification currently scheduled with the OS,
// regardless of whether our on-disk reminder map accounts for it. Used by
// reconcileOnLoad to find orphaned notifications — ones scheduled by a
// previous install/session whose tracking was lost (e.g. AsyncStorage
// cleared while OS-level schedules persisted) — which would otherwise fire
// forever with stale content.
export async function getAllScheduledNotificationIds() {
  if (Platform.OS === 'web') return [];
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    return Array.isArray(pending) ? pending.map(n => n.identifier).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// --- Reminder map entry format -------------------------------------------
//
// Old format (pre-signature): { [assignmentId]: string[] }
//   The value is a plain array of OS notification IDs.
//
// New format (post-signature): { [assignmentId]: { ids: string[], sig: string } }
//   `ids` is the OS notification ID array; `sig` encodes the scheduling-relevant
//   fields (dueDate, dueTime, title, course) at the time the notifications were
//   scheduled. On fresh fetch the sig is compared to the current row; a mismatch
//   means a remote edit happened while offline, so the old notifications are
//   cancelled and rescheduled.
//
// Both formats co-exist in the wild. All accessors below handle both.

// Build a stable signature string for the four fields that affect reminder
// content or fire-time. A sig change → reminders must be rescheduled.
export function reminderSig(assignment) {
  return `${assignment.dueDate}|${assignment.dueTime ?? ''}|${assignment.title}|${assignment.course}`;
}

// Extract the raw notification IDs from either a legacy string[] or a new
// { ids, sig } map entry. Returns [] for any unrecognised shape.
export function reminderEntryIds(entry) {
  if (Array.isArray(entry)) return entry;
  if (entry && Array.isArray(entry.ids)) return entry.ids;
  return [];
}

// Extract the stored sig from a new-format entry. Returns null for legacy
// entries (no sig was stored) so callers can treat the absence of a sig as
// "always reschedule on next fetch".
export function reminderEntrySig(entry) {
  if (entry && !Array.isArray(entry) && typeof entry.sig === 'string') return entry.sig;
  return null;
}

// Create a new-format map entry pairing notification IDs with their sig.
export function makeReminderEntry(ids, sig) {
  return { ids, sig };
}

// --- Reminder ID persistence (survives Supabase fetch replacing all rows) ---

function reminderMapKey(userId) {
  return `reminder_ids_${userId}`;
}

// Load the { [assignmentId]: string[] } map from AsyncStorage.
// Drops any entry whose value is not an array of strings — otherwise a
// corrupted map could cause mergeReminderIds to attach the wrong shape,
// which then silently bypasses cancellation (cancelReminders requires an
// array) and leaks OS-scheduled notifications.
export async function loadReminderMap(userId) {
  try {
    const json = await AsyncStorage.getItem(reminderMapKey(userId));
    if (!json) return {};
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean = {};
    for (const [k, v] of Object.entries(parsed)) {
      // Legacy format: plain string array of notification IDs.
      if (Array.isArray(v) && v.every(id => typeof id === 'string')) {
        clean[k] = v;
        continue;
      }
      // New format: { ids: string[], sig: string }
      if (
        v && typeof v === 'object' && !Array.isArray(v) &&
        Array.isArray(v.ids) && v.ids.every(id => typeof id === 'string') &&
        typeof v.sig === 'string'
      ) {
        clean[k] = v;
      }
    }
    return clean;
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

// Attach stored reminderIds to freshly fetched rows.
// Extracts only the raw notification ID array from each map entry so
// in-memory assignment objects always carry a plain string[].
export function mergeReminderIds(assignments, reminderMap) {
  return assignments.map(a => ({
    ...a,
    reminderIds: reminderEntryIds(reminderMap[a.id] ?? []),
  }));
}

// Look up the canonical reminder IDs for one assignment from disk.
// Use this (instead of in-memory state) when cancelling, so a stale
// in-memory copy can't cause us to leak previously scheduled notifications.
export async function loadReminderIdsFor(userId, assignmentId) {
  const map = await loadReminderMap(userId);
  return reminderEntryIds(map[assignmentId] ?? []);
}

// --- Device time-zone tracking ----------------------------------------------
//
// CALENDAR triggers fire at local date components, so they self-adjust when
// the device TZ changes WHILE THE OS REMAINS RESPONSIBLE FOR FIRING (iOS is
// reliable here; Android via AlarmManager is more variable). These helpers
// let the hook layer reschedule all reminders on TZ change as a
// belt-and-suspenders second layer.
//
// The stored value is the IANA TZ name returned by
// Intl.DateTimeFormat().resolvedOptions().timeZone (e.g. "America/New_York").
// On the first run for a given user there is no baseline yet; in that case
// detectTimezoneChanged returns false so we don't reschedule unnecessarily —
// callers should `storeDeviceTimezone` once the initial reminder set is in
// place.

function timezoneKey(userId) {
  return `device_tz_${userId}`;
}

// Returns the device's current IANA TZ name, or null if unavailable.
// Wrapped in try/catch because very old JS engines or non-standard runtimes
// may not implement Intl.DateTimeFormat.resolvedOptions().
export function currentDeviceTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.length > 0 ? tz : null;
  } catch {
    return null;
  }
}

// Read the previously-stored TZ for this user, or null if none persisted.
export async function loadStoredTimezone(userId) {
  try {
    return await AsyncStorage.getItem(timezoneKey(userId));
  } catch {
    return null;
  }
}

// Persist the current device TZ for this user. Returns the stored string
// (or null if Intl is unavailable). Failures are swallowed — non-fatal.
export async function storeDeviceTimezone(userId) {
  const tz = currentDeviceTimezone();
  if (!tz) return null;
  try {
    await AsyncStorage.setItem(timezoneKey(userId), tz);
  } catch {
    // Storage write failed; the AppState path will detect-and-retry next time.
  }
  return tz;
}

// True iff a previous TZ was stored AND it differs from the current TZ.
// First-run case (no stored value) returns false on purpose — there is no
// baseline to detect change against.
export async function detectTimezoneChanged(userId) {
  const current = currentDeviceTimezone();
  if (!current) return false;
  const stored = await loadStoredTimezone(userId);
  if (stored === null) return false;
  return stored !== current;
}

function reminderEntryEqual(a, b) {
  const aIds = reminderEntryIds(a ?? []);
  const bIds = reminderEntryIds(b ?? []);
  if (aIds.length !== bIds.length) return false;
  for (let i = 0; i < aIds.length; i++) {
    if (aIds[i] !== bIds[i]) return false;
  }
  return reminderEntrySig(a) === reminderEntrySig(b);
}

// Deep-equal a reminder map by (id → {ids, sig}) so we avoid
// rewriting AsyncStorage when nothing actually changed. Handles both
// legacy string[] entries and new {ids, sig} entries.
export function reminderMapsEqual(a, b) {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!reminderEntryEqual(a[k], b[k])) return false;
  }
  return true;
}
