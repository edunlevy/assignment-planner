// Parse a Supabase auth redirect URL.
// Supports both fragment-based tokens (implicit flow) and query-param codes (PKCE flow):
//   assignmentplanner://reset-password#access_token=abc&type=recovery
//   assignmentplanner://reset-password?code=xyz
// Returns a flat object, or {} if the URL has nothing parseable.
export function parseAuthRedirect(url) {
  if (!url || typeof url !== 'string') return {};
  try {
    const out = {};

    const hashIdx = url.indexOf('#');
    if (hashIdx !== -1) {
      const fragment = url.slice(hashIdx + 1);
      if (fragment) {
        for (const [k, v] of new URLSearchParams(fragment).entries()) out[k] = v;
      }
    }

    const qIdx = url.indexOf('?');
    if (qIdx !== -1) {
      const end = hashIdx !== -1 && hashIdx > qIdx ? hashIdx : url.length;
      const qs = url.slice(qIdx + 1, end);
      if (qs) {
        for (const [k, v] of new URLSearchParams(qs).entries()) {
          if (!(k in out)) out[k] = v;
        }
      }
    }

    return out;
  } catch {
    return {};
  }
}
