import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { parseAuthRedirect } from '../lib/deepLink';
import { supabase } from '../lib/supabase';

// Handle password-reset deep links
// (assignmentplanner://reset-password#access_token=...&type=recovery).
// With detectSessionInUrl:false we parse the URL ourselves. setSession emits
// SIGNED_IN (not PASSWORD_RECOVERY), so we set recoveryMode directly on success.
//
// `setRecoveryMode` comes from useAuthSession — this hook only ever sets it to
// true (on a successful recovery exchange); useAuthSession clears it on sign-out.
export function useDeepLinkAuth(setRecoveryMode) {
  useEffect(() => {
    async function handleDeepLink(url) {
      if (!url) return;
      // Match on path segment, not substring — keeps confirm/reset branches exclusive.
      const isResetLink = /(^|\/)reset-password(\b|\/|\?|#)/.test(url);
      const isConfirmLink = /(^|\/)(confirm|login)(\b|\/|\?|#)/.test(url);
      const params = parseAuthRedirect(url);

      // PKCE flow: Supabase sends ?code= instead of fragment tokens.
      // Recovery and signup confirmation share the same exchange call; the
      // URL path tells us which UI to surface afterward.
      if (params.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);
        if (!error && isResetLink) setRecoveryMode(true);
        // Signup-confirm: onAuthStateChange will fire SIGNED_IN; nothing else to do.
        return;
      }

      // Implicit flow: fragment tokens
      if (params.type === 'recovery' && params.access_token) {
        const { error } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token ?? '',
        });
        if (!error) setRecoveryMode(true);
        return;
      }

      // Implicit-flow signup confirmation: tokens in the fragment, type=signup.
      if (isConfirmLink && params.type === 'signup' && params.access_token) {
        await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token ?? '',
        });
      }
    }
    Linking.getInitialURL().then(handleDeepLink);
    const sub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
    return () => sub.remove();
  }, [setRecoveryMode]);
}
