// Supabase env vars need to exist before lib/supabase.js is imported by any
// transitive test target. Tests mock the module itself, but the polyfill
// import chain still evaluates the guard at the top of lib/supabase.js.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://localhost.test';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// react-native: mocked wholesale so we never load or transform its
// Flow-typed source. This eliminates:
//   - ETIMEDOUT from @babel/plugin-transform-runtime corejs2 network calls
//   - __DEV__ ReferenceError from react-native/index.js
//
// The mock covers all primitives used by our lib files AND all UI components
// used by app screens/components so screen-level tests don't need extra setup.
// Components that are not meaningfully testable (e.g. View) are returned as
// plain string tags, matching the convention used by react-test-renderer.
jest.mock('react-native', () => ({
  // Platform — the only value lib/notifications.js uses directly.
  Platform: { OS: 'ios' },

  // UI primitives used by screens and components
  StyleSheet: { create: styles => styles, flatten: s => s, hairlineWidth: 1 },
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  FlatList: 'FlatList',
  Modal: 'Modal',
  Image: 'Image',
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  SafeAreaView: 'SafeAreaView',
  TouchableOpacity: 'TouchableOpacity',
  TouchableWithoutFeedback: 'TouchableWithoutFeedback',

  // Imperative APIs
  Alert: { alert: jest.fn() },
  Linking: {
    openURL: jest.fn(async () => {}),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    getInitialURL: jest.fn(async () => null),
  },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    currentState: 'active',
  },

  // Dimensions — used by SafeAreaContext internally
  Dimensions: { get: jest.fn(() => ({ width: 375, height: 812 })) },

  // useColorScheme — used by expo-status-bar's <StatusBar> (rendered by App.js).
  useColorScheme: jest.fn(() => 'light'),

  // StatusBar — expo-status-bar's NativeStatusBarWrapper renders <StatusBar>
  // from react-native directly when not running on web.
  StatusBar: 'StatusBar',
}));

// AsyncStorage: in-memory implementation that matches the official mock's
// API surface. Written inline rather than via require() so it works in both
// jest (CJS) and vitest (ESM) without a require-in-factory workaround.
jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    default: {
      setItem: jest.fn(async (key, value) => { store[key] = String(value); }),
      getItem: jest.fn(async key => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      removeItem: jest.fn(async key => { delete store[key]; }),
      clear: jest.fn(async () => { store = {}; }),
      getAllKeys: jest.fn(async () => Object.keys(store)),
      multiGet: jest.fn(async keys => keys.map(k => [k, store[k] ?? null])),
      multiSet: jest.fn(async pairs => { pairs.forEach(([k, v]) => { store[k] = String(v); }); }),
      multiRemove: jest.fn(async keys => { keys.forEach(k => { delete store[k]; }); }),
    },
  };
});

// expo-notifications: every export used by lib/notifications becomes a jest.fn
// so tests can spy/return-value per case without hitting the native module.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'notif-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  AndroidImportance: { HIGH: 4 },
  // Mirror the real enum used by SchedulableTriggerInput. lib/notifications.js
  // references CALENDAR; the rest are included so tests that need to
  // disambiguate trigger kinds (e.g. "this is NOT a DATE trigger") can.
  SchedulableTriggerInputTypes: {
    CALENDAR: 'calendar',
    DATE: 'date',
    TIME_INTERVAL: 'timeInterval',
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    YEARLY: 'yearly',
  },
}));

// expo-calendar: every export used by lib/calendarSync becomes a jest.fn so
// tests can spy/return-value per case without hitting the native module.
jest.mock('expo-calendar', () => ({
  getCalendarPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestCalendarPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCalendarsAsync: jest.fn(async () => []),
  createCalendarAsync: jest.fn(async () => 'calendar-id'),
  deleteCalendarAsync: jest.fn(async () => undefined),
  getDefaultCalendarSourceAsync: jest.fn(async () => ({ id: 'source-id', name: 'Default' })),
  createEventAsync: jest.fn(async () => 'event-id'),
  updateEventAsync: jest.fn(async () => undefined),
  deleteEventAsync: jest.fn(async () => undefined),
  EntityTypes: { EVENT: 'event' },
  SourceType: { LOCAL: 'local' },
  CalendarAccessLevel: { OWNER: 'owner' },
}));

// @react-native-community/datetimepicker: native module used by DueDateField
// and DueTimeField. Stub as a passthrough so components that import those
// fields don't crash in the node test environment.
jest.mock('@react-native-community/datetimepicker', () => ({
  default: 'DateTimePicker',
  __esModule: true,
}));

// react-native-safe-area-context: uses native modules; stub the values and
// provider so renderWithProviders doesn't crash in a node test environment.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
  useSafeAreaFrame: jest.fn(() => ({ x: 0, y: 0, width: 375, height: 812 })),
}));

// expo-linking: only the helpers the app actually calls.
jest.mock('expo-linking', () => ({
  createURL: jest.fn(path => `assignmentplanner://${path}`),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  getInitialURL: jest.fn(async () => null),
  parse: jest.fn(() => ({})),
}));

// expo-apple-authentication: imported by AuthScreen; stub so native module
// initialisation doesn't block the test runner.
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(async () => false),
  AppleAuthenticationButton: 'AppleAuthenticationButton',
  AppleAuthenticationButtonType: { SIGN_IN: 0 },
  AppleAuthenticationButtonStyle: { BLACK: 0 },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: jest.fn(),
}));

// Supabase client: replaced wholesale. Individual tests import this and
// override .from(...) return values as needed.
jest.mock('./lib/supabase', () => {
  const chain = {};
  const make = () => {
    const c = {
      select: jest.fn(() => c),
      insert: jest.fn(() => c),
      update: jest.fn(() => c),
      delete: jest.fn(() => c),
      eq: jest.fn(() => c),
      order: jest.fn(() => c),
      single: jest.fn(async () => ({ data: null, error: null })),
      then: undefined,
    };
    return c;
  };
  chain.from = jest.fn(() => make());

  // Minimal channel stub: supports the .on(...).subscribe() call pattern used
  // by useAssignments' realtime subscription. subscribe() returns the channel
  // so callers can pass it to removeChannel.
  const makeChannel = () => {
    const ch = {
      on: jest.fn(() => ch),
      subscribe: jest.fn(() => ch),
      unsubscribe: jest.fn(async () => {}),
    };
    return ch;
  };

  return {
    supabase: {
      from: chain.from,
      // channel/removeChannel — used by useAssignments realtime subscription.
      channel: jest.fn(() => makeChannel()),
      removeChannel: jest.fn(async () => {}),
      // rpc — used by ProfileModal's delete_user call.
      rpc: jest.fn(async () => ({ data: null, error: null })),
      auth: {
        signInWithPassword: jest.fn(),
        signUp: jest.fn(),
        signOut: jest.fn(async () => ({ error: null })),
        getSession: jest.fn(async () => ({ data: { session: null } })),
        onAuthStateChange: jest.fn(() => ({
          data: { subscription: { unsubscribe: jest.fn() } },
        })),
        startAutoRefresh: jest.fn(),
        stopAutoRefresh: jest.fn(),
        resetPasswordForEmail: jest.fn(async () => ({ error: null })),
        updateUser: jest.fn(async () => ({ data: null, error: null })),
        setSession: jest.fn(async () => ({ data: null, error: null })),
        // PKCE flow — used by App.js deep-link handler
        exchangeCodeForSession: jest.fn(async () => ({ data: null, error: null })),
        // Social auth — used by lib/socialAuth.js
        signInWithIdToken: jest.fn(async () => ({ data: null, error: null })),
      },
    },
  };
});

