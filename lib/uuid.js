// RFC 4122 v4 UUID generator.
//
// Uses the platform CSPRNG (globalThis.crypto.randomUUID) when available:
//   - Node 19+  — available natively (test environment)
//   - React Native + Expo — available via Expo's crypto polyfill on Hermes
//
// Falls back to Math.random() on environments where the WebCrypto API is
// absent. Collision risk at single-user scale is negligible either way
// (birthday bound on 122 random bits), but the CSPRNG is strictly better.
//
// We generate client-side IDs so we can mark a self-mutation BEFORE the
// DB insert, eliminating the window where a realtime echo could race the
// local path. See useAssignments insert/insertMany.
export function uuidv4() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Math.random fallback for environments without WebCrypto
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += '-';
    } else if (i === 14) {
      out += '4'; // version
    } else if (i === 19) {
      out += hex[(Math.random() * 4 | 0) | 8]; // variant: 10xx
    } else {
      out += hex[Math.random() * 16 | 0];
    }
  }
  return out;
}
