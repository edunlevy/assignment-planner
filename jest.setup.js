// Supabase env vars need to exist before lib/supabase.js is imported by any
// transitive test target. Tests mock the module itself, but the polyfill
// import chain still evaluates the guard at the top of lib/supabase.js.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://localhost.test';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// AsyncStorage: in-memory mock from the official package.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

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
}));

// expo-linking: only the helpers the app actually calls.
jest.mock('expo-linking', () => ({
  createURL: jest.fn(path => `assignmentplanner://${path}`),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  getInitialURL: jest.fn(async () => null),
  parse: jest.fn(() => ({})),
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
  return {
    supabase: {
      from: chain.from,
      auth: {
        signInWithPassword: jest.fn(),
        signUp: jest.fn(),
        signOut: jest.fn(),
        getSession: jest.fn(async () => ({ data: { session: null } })),
        onAuthStateChange: jest.fn(() => ({
          data: { subscription: { unsubscribe: jest.fn() } },
        })),
        startAutoRefresh: jest.fn(),
        stopAutoRefresh: jest.fn(),
        resetPasswordForEmail: jest.fn(),
        updateUser: jest.fn(),
        setSession: jest.fn(),
      },
    },
  };
});
