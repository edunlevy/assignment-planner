// RFC 4122 v4 UUID generator. Hermes does not ship the WebCrypto API, so
// `crypto.randomUUID()` is not available across all targets — we use
// Math.random instead. That's not cryptographically strong, but UUID
// collisions for a single user's assignment rows are astronomically
// unlikely even with weak randomness (birthday bound on 122 random bits).
//
// We generate client-side IDs so we can mark a self-mutation BEFORE the
// DB insert, eliminating the window where a realtime echo could race the
// local path. See useAssignments insert/insertMany.
export function uuidv4() {
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
