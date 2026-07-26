import { useEffect, useState } from 'react';
import { startAuthAutoRefresh, supabase } from '../lib/supabase';

// Owns the app-root Supabase session lifecycle: the initial getSession, the
// onAuthStateChange subscription, the loading gate (+ its 8 s safety timeout),
// the AppState token auto-refresh listener, and the password-recovery flag.
//
// recoveryMode is exposed here (not in useDeepLinkAuth) because it must be
// cleared on sign-out — done in the onAuthStateChange handler below — and the
// deep-link handler only ever SETS it. See App.js for how the two compose:
// `const { setRecoveryMode } = useAuthSession(); useDeepLinkAuth(setRecoveryMode);`.
export function useAuthSession() {
  const [session, setSession] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);

  // Own the Supabase auth auto-refresh AppState listener's lifecycle here
  // (mount once, remove on unmount) instead of lib/supabase.js registering an
  // unremovable listener at module-evaluation time — see startAuthAutoRefresh's
  // comment for why that leaked across Fast Refresh.
  useEffect(() => {
    const sub = startAuthAutoRefresh();
    return () => sub?.remove();
  }, []);

  // Check for an existing session and listen for auth changes.
  //
  // Hardened against an unreachable/slow backend so the app can't hang on the
  // loading screen forever (e.g. a paused Supabase project): getSession
  // rejections are caught, and an 8 s safety timeout flips the loading gate no
  // matter what. `markLoaded` only clears the gate once; session updates still
  // apply whenever they arrive (a late getSession resolve or onAuthStateChange),
  // so a brief outage degrades to the auth screen instead of an infinite
  // spinner, and recovers automatically once the backend responds.
  useEffect(() => {
    let settled = false;
    const markLoaded = () => {
      if (!settled) {
        settled = true;
        setSessionLoaded(true);
      }
    };
    supabase.auth.getSession()
      .then(({ data: { session: s } }) => { setSession(s); markLoaded(); })
      .catch(() => markLoaded());
    const timer = setTimeout(markLoaded, 8000);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      markLoaded();
      if (!s) setRecoveryMode(false);
    });
    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  return { session, sessionLoaded, recoveryMode, setRecoveryMode };
}
