import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { supabase } from './supabase';

// Replace this with the iOS client ID from Google Cloud Console (step B.5 of the setup plan).
const GOOGLE_IOS_CLIENT_ID = '603041259915-podoirniape9mshtee0jnvtmelkq9p4k.apps.googleusercontent.com';

export async function signInWithApple() {
  // Generate a cryptographically secure nonce. Math.random() is not suitable
  // for replay-protection because it is predictable; getRandomBytesAsync uses
  // the platform CSPRNG (SecRandomCopyBytes on iOS, /dev/urandom on Android).
  // We encode the raw bytes as hex so the string is valid UTF-8 for SHA-256.
  const randomBytes = await Crypto.getRandomBytesAsync(32);
  const rawNonce = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce
  );

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });

  if (error) throw error;
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
  if (!idToken) throw new Error('Google sign-in did not return an ID token');

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) throw error;
}
