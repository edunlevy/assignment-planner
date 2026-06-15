import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { supabase } from './supabase';

// Replace this with the iOS client ID from Google Cloud Console (step B.5 of the setup plan).
const GOOGLE_IOS_CLIENT_ID = '603041259915-podoirniape9mshtee0jnvtmelkq9p4k.apps.googleusercontent.com';

// Helper: wrap a raw caught value in a normalised Error with a .code property.
// Callers always see { code: string, message: string } — no provider-specific
// error shapes leak into the UI layer.
function normaliseError(e, code) {
  const msg = e?.message ?? String(e) ?? 'An unknown error occurred';
  const err = new Error(msg);
  err.code = code;
  return err;
}

// Returns null when the user cancels; throws a normalised Error on failure.
export async function signInWithApple() {
  // No nonce. Supabase's native Sign in with Apple flow (signInWithIdToken)
  // already validates the id_token's signature, audience, and expiry. Passing
  // a nonce here caused GoTrue to reject the token on device with "passed
  // nonce and nonce in id_token should either both exist or not" — expo-apple-
  // authentication's returned identityToken did not carry the nonce claim, so
  // the two sides disagreed on its existence. This matches Supabase's official
  // Expo example, which omits the nonce on both signInAsync and
  // signInWithIdToken.
  let credential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    // ERR_REQUEST_CANCELED: user tapped Cancel — treat as null (no error shown).
    if (e?.code === 'ERR_REQUEST_CANCELED') return null;
    throw normaliseError(e, 'APPLE_SIGN_IN_ERROR');
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });

  if (error) throw normaliseError(error, 'APPLE_AUTH_ERROR');
}

export async function signInWithGoogle() {
  GoogleSignin.configure({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    webClientId: '603041259915-v7fi5i6p2h277j9sqcmo9g4e7mvbor7h.apps.googleusercontent.com',
  });

  // showPlayServicesUpdateDialog is required in non-production Android builds;
  // omitting it causes hasPlayServices() to throw. Passing true here also
  // ensures users on outdated Play Services see the system update prompt.
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const signInResult = await GoogleSignin.signIn();

  // v16 returns { type: 'cancelled' } when the user dismisses the picker
  if (signInResult.type === 'cancelled') return null;

  const idToken = signInResult.data?.idToken ?? signInResult.idToken;
  if (!idToken) throw normaliseError(
    { message: 'Google sign-in did not return an ID token' },
    'MISSING_ID_TOKEN',
  );

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) throw normaliseError(error, 'GOOGLE_AUTH_ERROR');
}
