import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase config. Copy .env.example to .env and fill in ' +
    'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});

// Native only: pause token refresh when backgrounded, resume when foregrounded.
// processLock + AppState together follow the Supabase React Native auth quickstart.
//
// Exported as a function rather than run at module scope, so the caller
// (App.js's root component) owns the listener's lifecycle via a useEffect +
// cleanup instead of this module registering an unremovable listener every
// time it's evaluated — module-scope side effects like the old version run
// once in a normal production bundle, but Fast Refresh and repeated test
// imports can re-evaluate this file, accumulating listeners and duplicate
// startAutoRefresh/stopAutoRefresh calls with no way to remove the old ones.
// Returns the subscription (so the caller can remove it), or null on web,
// where there's nothing to listen for.
export function startAuthAutoRefresh() {
  if (Platform.OS === 'web') return null;
  return AppState.addEventListener('change', state => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
