// RFC 4122 v4 UUID generator.
//
// Uses the platform CSPRNG (globalThis.crypto.randomUUID) when available:
//   - Node 19+  — available natively (test environment)
//   - React Native + Expo — available via Expo's crypto polyfill on Hermes
//
// When randomUUID is unavailable it still prefers the CSPRNG via
// crypto.getRandomValues (the same WebCrypto surface / Expo polyfill), building
// the v4 UUID from those bytes. Math.random() is only a last resort for
// environments with no crypto source at all. Collision risk at single-user
// scale is negligible either way, but a CSPRNG avoids predictable ids.
//
// We generate client-side IDs so we can mark a self-mutation BEFORE the
// DB insert, eliminating the window where a realtime echo could race the
// local path. See useAssignments insert/insertMany.

// byte → 2-digit hex lookup, built once.
const BYTE_TO_HEX = Array.from({ length: 256 }, (_, i) => (i + 0x100).toString(16).slice(1));

export function uuidv4() {
  const cryptoObj = globalThis.crypto;
  if (typeof cryptoObj?.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoObj?.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    // No CSPRNG available at all — last-resort non-cryptographic fallback.
    for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0;
  }

  // RFC 4122 §4.4: set the version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const h = BYTE_TO_HEX;
  return (
    h[bytes[0]] + h[bytes[1]] + h[bytes[2]] + h[bytes[3]] + '-' +
    h[bytes[4]] + h[bytes[5]] + '-' +
    h[bytes[6]] + h[bytes[7]] + '-' +
    h[bytes[8]] + h[bytes[9]] + '-' +
    h[bytes[10]] + h[bytes[11]] + h[bytes[12]] + h[bytes[13]] + h[bytes[14]] + h[bytes[15]]
  );
}
