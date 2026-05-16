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
});
