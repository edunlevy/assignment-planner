// Parse the fragment portion of a Supabase auth redirect URL.
// Example input: assignmentplanner://reset-password#access_token=abc&refresh_token=xyz&type=recovery
// Returns a flat object, or {} if the URL has no fragment / is malformed.
//
// We use URLSearchParams (via the react-native-url-polyfill registered in
// lib/supabase.js) so + → space, %xx decoding, and odd pairs are handled correctly.
export function parseAuthRedirect(url) {
  if (!url || typeof url !== 'string') return {};
  const hashIdx = url.indexOf('#');
  if (hashIdx === -1) return {};
  const fragment = url.slice(hashIdx + 1);
  if (!fragment) return {};
  try {
    const params = new URLSearchParams(fragment);
    const out = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
  } catch {
    return {};
  }
}
