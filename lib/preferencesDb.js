import { DEFAULT_RANKING, RANKING_FACTORS } from './ordering';
import { supabase } from './supabase';

// Re-exported so existing/future callers can import ranking constants from
// either module; lib/ordering.js is the canonical source (also keep in sync
// with the DB check constraint in db/migrations/2026-07-13_user_preferences.sql).
export { DEFAULT_RANKING, RANKING_FACTORS };

// True iff `ranking` is an array containing each of RANKING_FACTORS exactly once.
export function isValidRanking(ranking) {
  if (!Array.isArray(ranking) || ranking.length !== RANKING_FACTORS.length) return false;
  const seen = new Set(ranking);
  if (seen.size !== RANKING_FACTORS.length) return false;
  return RANKING_FACTORS.every(f => seen.has(f));
}

// Fetch the caller's ranking preference. Returns null when no row exists yet
// (new account, or an account created before this feature shipped) so
// callers can distinguish "no preference set" from "explicitly default".
export async function dbFetchPreferences(userId) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('ranking')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? data.ranking : null;
}

// Create or update the caller's ranking preference. Throws if `ranking`
// isn't a valid permutation — callers should validate user input before
// this point, but this is the last line of defense before it hits RLS.
export async function dbUpsertPreferences(userId, ranking) {
  if (!isValidRanking(ranking)) {
    throw new Error(`Invalid ranking: ${JSON.stringify(ranking)}`);
  }
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, ranking, updated_at: new Date().toISOString() })
    .select('ranking')
    .single();
  if (error) throw error;
  return data.ranking;
}
