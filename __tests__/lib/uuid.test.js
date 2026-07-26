import { uuidv4 } from '../../lib/uuid';

// RFC 4122 v4: 8-4-4-4-12 hex, version nibble = 4, variant nibble = 8/9/a/b
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv4', () => {
  test('returns a string matching the RFC 4122 v4 format', () => {
    expect(uuidv4()).toMatch(UUID_V4_RE);
  });

  test('version nibble is always 4', () => {
    for (let i = 0; i < 50; i++) {
      expect(uuidv4()[14]).toBe('4');
    }
  });

  test('variant nibble is always 8, 9, a, or b', () => {
    for (let i = 0; i < 50; i++) {
      expect('89ab').toContain(uuidv4()[19]);
    }
  });

  test('produces unique values across 1000 calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, uuidv4));
    expect(ids.size).toBe(1000);
  });

  test('uses CSPRNG (globalThis.crypto.randomUUID) in this environment', () => {
    // Verify the fast path is taken in Node 19+ / Expo test env. If the
    // CSPRNG path is active, mocking it changes the output — proving that
    // the production code is calling it rather than Math.random.
    const origRandomUUID = globalThis.crypto?.randomUUID;
    if (typeof origRandomUUID !== 'function') {
      // CSPRNG not available in this env — Math.random fallback is fine.
      return;
    }
    try {
      // Replace with a deterministic stub
      globalThis.crypto.randomUUID = () => '00000000-0000-4000-8000-000000000000';
      expect(uuidv4()).toBe('00000000-0000-4000-8000-000000000000');
    } finally {
      globalThis.crypto.randomUUID = origRandomUUID;
    }
  });

  test('falls back to the CSPRNG (crypto.getRandomValues) when randomUUID is unavailable', () => {
    const c = globalThis.crypto;
    if (typeof c?.getRandomValues !== 'function') return; // env without WebCrypto
    const origRandomUUID = c.randomUUID;
    const getSpy = vi.spyOn(c, 'getRandomValues');
    try {
      c.randomUUID = undefined; // force the fallback path
      const id = uuidv4();
      expect(getSpy).toHaveBeenCalled(); // CSPRNG used, not Math.random
      expect(id).toMatch(UUID_V4_RE);
    } finally {
      c.randomUUID = origRandomUUID;
      getSpy.mockRestore();
    }
  });

  test('last-resort Math.random fallback still yields a valid v4 when no crypto exists', () => {
    const c = globalThis.crypto;
    const origRandomUUID = c?.randomUUID;
    // Shadow BOTH CSPRNG APIs with non-functions so uuidv4 takes the
    // Math.random branch. getRandomValues is a non-writable prototype method,
    // so it must be shadowed via defineProperty and restored by delete;
    // randomUUID is assignable on the instance.
    try {
      c.randomUUID = undefined;
      Object.defineProperty(c, 'getRandomValues', { value: undefined, configurable: true });
      for (let i = 0; i < 50; i++) expect(uuidv4()).toMatch(UUID_V4_RE);
    } finally {
      c.randomUUID = origRandomUUID;
      delete c.getRandomValues; // remove the own-property shadow → prototype method restored
    }
  });
});
