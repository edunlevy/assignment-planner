import { parseAuthRedirect } from '../../lib/deepLink';

describe('parseAuthRedirect', () => {
  test('parses access/refresh tokens from a Supabase recovery URL', () => {
    const url =
      'assignmentplanner://reset-password#access_token=abc&refresh_token=xyz&type=recovery';
    expect(parseAuthRedirect(url)).toEqual({
      access_token: 'abc',
      refresh_token: 'xyz',
      type: 'recovery',
    });
  });

  test('decodes percent-encoded values', () => {
    const url = 'assignmentplanner://x#token=a%20b&other=1%2B2';
    expect(parseAuthRedirect(url)).toEqual({ token: 'a b', other: '1+2' });
  });

  test('returns {} when there is no fragment', () => {
    expect(parseAuthRedirect('assignmentplanner://reset-password')).toEqual({});
  });

  test('returns {} when fragment is empty', () => {
    expect(parseAuthRedirect('assignmentplanner://reset-password#')).toEqual({});
  });

  test('returns {} for non-string / falsy input', () => {
    expect(parseAuthRedirect(null)).toEqual({});
    expect(parseAuthRedirect(undefined)).toEqual({});
    expect(parseAuthRedirect(123)).toEqual({});
    expect(parseAuthRedirect('')).toEqual({});
  });

  test('ignores keys with no value but still parses the rest', () => {
    const out = parseAuthRedirect('app://x#foo&bar=baz');
    expect(out.bar).toBe('baz');
  });

  test('parses both ? query string and # fragment — fragment wins on duplicate keys', () => {
    // URL with both ?code= (PKCE) and #type= (fragment): both should be parsed.
    // Fragment keys are parsed first so a key in both uses the fragment value.
    const url = 'assignmentplanner://reset-password?code=pkce-code#type=recovery&code=frag-code';
    const out = parseAuthRedirect(url);
    // code appears in both; fragment is parsed first so fragment value wins.
    expect(out.code).toBe('frag-code');
    expect(out.type).toBe('recovery');
  });

  test('parses query string alone when there is no fragment', () => {
    // PKCE-only URLs have only a ? query string, no # fragment.
    // Lines 21-25 cover slicing the QS up to the hash position.
    const url = 'assignmentplanner://reset-password?code=pkce-only&state=s1';
    const out = parseAuthRedirect(url);
    expect(out.code).toBe('pkce-only');
    expect(out.state).toBe('s1');
  });

  test('ignores a bare ? with no query string', () => {
    // qIdx found, but qs === '' → the `if (qs)` branch is false → skip parse
    expect(parseAuthRedirect('assignmentplanner://x?')).toEqual({});
    expect(parseAuthRedirect('assignmentplanner://x?#type=recovery')).toEqual({ type: 'recovery' });
  });

  test('returns {} when URLSearchParams would throw on a pathological input', () => {
    // Force the catch branch (line 32) by passing something that the URL
    // parsing code might choke on. In practice URLSearchParams is very
    // resilient, so we exercise it by mocking the built-in.
    const orig = global.URLSearchParams;
    global.URLSearchParams = function () { throw new Error('forced'); };
    try {
      expect(parseAuthRedirect('app://x#foo=bar')).toEqual({});
    } finally {
      global.URLSearchParams = orig;
    }
  });
});
