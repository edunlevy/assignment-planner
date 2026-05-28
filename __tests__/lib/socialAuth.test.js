// expo-crypto is not mocked globally — mock it here so no native module loads.
vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: vi.fn(),
  digestStringAsync: vi.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

// @react-native-google-signin/google-signin is not mocked globally.
vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: vi.fn(),
    hasPlayServices: vi.fn(),
    signIn: vi.fn(),
  },
}));

import * as Crypto from 'expo-crypto';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { supabase } from '../../lib/supabase';
import { signInWithApple, signInWithGoogle } from '../../lib/socialAuth';

// Fake byte array that maps to a known raw nonce hex string.
const FAKE_BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef, ...new Array(28).fill(0x00)]);
const FAKE_RAW_NONCE = 'deadbeef' + '00'.repeat(28);
const FAKE_HASHED_NONCE = 'hashed-nonce-abc123';

beforeEach(() => {
  Crypto.getRandomBytesAsync.mockReset();
  Crypto.digestStringAsync.mockReset();
  AppleAuthentication.signInAsync.mockReset();
  GoogleSignin.configure.mockReset();
  GoogleSignin.hasPlayServices.mockReset();
  GoogleSignin.signIn.mockReset();
  supabase.auth.signInWithIdToken.mockReset();
  supabase.auth.signInWithIdToken.mockResolvedValue({ data: null, error: null });
});

// ---------------------------------------------------------------------------
// signInWithApple
// ---------------------------------------------------------------------------
describe('signInWithApple', () => {
  function setupAppleSuccess({ identityToken = 'apple-id-token' } = {}) {
    Crypto.getRandomBytesAsync.mockResolvedValue(FAKE_BYTES);
    Crypto.digestStringAsync.mockResolvedValue(FAKE_HASHED_NONCE);
    AppleAuthentication.signInAsync.mockResolvedValue({ identityToken });
  }

  test('passes the HASHED nonce to Apple and the RAW nonce to Supabase', async () => {
    setupAppleSuccess();
    await signInWithApple();

    // Apple receives the SHA-256 hash (replay protection)
    expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: FAKE_HASHED_NONCE })
    );

    // Supabase receives the raw nonce so it can verify the hash
    expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple-id-token',
      nonce: FAKE_RAW_NONCE,
    });
  });

  test('passes Apple identity token to supabase.auth.signInWithIdToken', async () => {
    setupAppleSuccess({ identityToken: 'my-apple-token' });
    await signInWithApple();
    expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'my-apple-token' })
    );
  });

  test('calls getRandomBytesAsync with 32 bytes for a full-strength nonce', async () => {
    setupAppleSuccess();
    await signInWithApple();
    expect(Crypto.getRandomBytesAsync).toHaveBeenCalledWith(32);
  });

  test('throws a normalised error (with .code) when supabase returns an error', async () => {
    setupAppleSuccess();
    supabase.auth.signInWithIdToken.mockResolvedValue({ error: { message: 'invalid token' } });
    const err = await signInWithApple().catch(e => e);
    expect(err.message).toBe('invalid token');
    expect(err.code).toBe('APPLE_AUTH_ERROR');
  });

  test('returns null when user cancels (ERR_REQUEST_CANCELED) — no error shown', async () => {
    Crypto.getRandomBytesAsync.mockResolvedValue(FAKE_BYTES);
    Crypto.digestStringAsync.mockResolvedValue(FAKE_HASHED_NONCE);
    const cancelErr = new Error('cancelled');
    cancelErr.code = 'ERR_REQUEST_CANCELED';
    AppleAuthentication.signInAsync.mockRejectedValue(cancelErr);
    const result = await signInWithApple();
    expect(result).toBeNull();
    expect(supabase.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  test('throws a normalised error for non-cancellation native errors', async () => {
    Crypto.getRandomBytesAsync.mockResolvedValue(FAKE_BYTES);
    Crypto.digestStringAsync.mockResolvedValue(FAKE_HASHED_NONCE);
    AppleAuthentication.signInAsync.mockRejectedValue(new Error('biometric failure'));
    const err = await signInWithApple().catch(e => e);
    expect(err.message).toBe('biometric failure');
    expect(err.code).toBe('APPLE_SIGN_IN_ERROR');
    expect(supabase.auth.signInWithIdToken).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// signInWithGoogle
// ---------------------------------------------------------------------------
describe('signInWithGoogle', () => {
  beforeEach(() => {
    GoogleSignin.hasPlayServices.mockResolvedValue(true);
  });

  test('happy path (v16 API): uses data.idToken and calls supabase', async () => {
    GoogleSignin.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'google-id-token' } });
    await signInWithGoogle();
    expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'google',
      token: 'google-id-token',
    });
  });

  test('happy path (legacy API): falls back to top-level idToken when data is absent', async () => {
    // v15 Google SDK returned idToken directly on the result object.
    GoogleSignin.signIn.mockResolvedValue({ idToken: 'legacy-google-token' });
    await signInWithGoogle();
    expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'legacy-google-token' })
    );
  });

  test('returns null without calling supabase when user cancels', async () => {
    GoogleSignin.signIn.mockResolvedValue({ type: 'cancelled' });
    const result = await signInWithGoogle();
    expect(result).toBeNull();
    expect(supabase.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  test('throws a normalised error with code MISSING_ID_TOKEN when no idToken', async () => {
    GoogleSignin.signIn.mockResolvedValue({ type: 'success', data: {} });
    const err = await signInWithGoogle().catch(e => e);
    expect(err.message).toMatch(/ID token/i);
    expect(err.code).toBe('MISSING_ID_TOKEN');
    expect(supabase.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  test('throws a normalised error with code GOOGLE_AUTH_ERROR when supabase fails', async () => {
    GoogleSignin.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'tok' } });
    supabase.auth.signInWithIdToken.mockResolvedValue({ error: { message: 'expired' } });
    const err = await signInWithGoogle().catch(e => e);
    expect(err.message).toBe('expired');
    expect(err.code).toBe('GOOGLE_AUTH_ERROR');
  });

  test('configures GoogleSignin before calling hasPlayServices', async () => {
    GoogleSignin.signIn.mockResolvedValue({ type: 'cancelled' });
    const order = [];
    GoogleSignin.configure.mockImplementation(() => order.push('configure'));
    GoogleSignin.hasPlayServices.mockImplementation(async () => { order.push('hasPlayServices'); return true; });
    await signInWithGoogle();
    expect(order).toEqual(['configure', 'hasPlayServices']);
  });

  test('propagates when hasPlayServices throws (e.g. Play Services unavailable)', async () => {
    GoogleSignin.hasPlayServices.mockRejectedValue(new Error('Play Services not available'));
    await expect(signInWithGoogle()).rejects.toThrow('Play Services not available');
    expect(supabase.auth.signInWithIdToken).not.toHaveBeenCalled();
  });
});
