import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_RANKING,
  dbFetchPreferences,
  dbUpsertPreferences,
  isValidRanking,
} from '../lib/preferencesDb';

// AsyncStorage key for the cached ranking. One key per userId, mirroring
// hooks/useAssignments.js's storageKey pattern.
function storageKey(userId) {
  return `ranking_${userId}`;
}

// Owns the "Work on next" priority-ranking preference for a logged-in user.
//
// Reconciliation on first load after auth (covers every sign-up path):
//   1. A user_preferences row already exists → use it.
//   2. No row, but `pendingRanking` was captured at sign-up (passed through
//      supabase.auth.signUp's options.data and read off
//      session.user.user_metadata.rankingPreference by the caller) → adopt
//      it as the row.
//   3. Neither (first-time Apple/Google sign-in, which never goes through
//      the sign-up form) → fall back to DEFAULT_RANKING and persist it, so
//      later loads hit branch 1 instead of re-deciding every time.
//
// `pendingRanking` is intentionally a plain argument (not read from
// supabase here) so this hook stays decoupled from auth/session shape.
export function usePreferences(userId, pendingRanking) {
  const [ranking, setRanking] = useState(DEFAULT_RANKING);
  const [loaded, setLoaded] = useState(false);

  // Latest pendingRanking, read by the load effect below WITHOUT being one
  // of its dependencies. If a caller ever passes an unstable reference
  // (e.g. an inline `?? []` fallback that allocates a new array every
  // render), depending on it directly would re-run the load effect — and
  // its own setLoaded(false) call — on every single render, an infinite
  // loop. Mirrors the assignmentsRef pattern in hooks/useAssignments.js.
  const pendingRankingRef = useRef(pendingRanking);
  useEffect(() => { pendingRankingRef.current = pendingRanking; }, [pendingRanking]);

  useEffect(() => {
    // Reset to the default ranking unconditionally, before the null check —
    // this effect only re-runs on a genuine userId change, and clearing
    // only inside the `!userId` branch missed a direct switch from one
    // signed-in account to another with no intervening null (reachable via
    // App.js's deep-link handler; see the matching fix + comment in
    // hooks/useAssignments.js's load effect for the full scenario). Without
    // this, a new user whose preferences fetch then fails would see the
    // PREVIOUS user's ranking still applied instead of falling back to the
    // default.
    setRanking(DEFAULT_RANKING);

    if (!userId) {
      setLoaded(false);
      return;
    }
    let cancelled = false;

    setLoaded(false);

    (async () => {
      // Cached value first for instant paint. Isolated try so a corrupt
      // cache never blocks the network fetch.
      try {
        const cached = await AsyncStorage.getItem(storageKey(userId));
        if (!cancelled && cached) {
          const parsed = JSON.parse(cached);
          if (isValidRanking(parsed)) setRanking(parsed);
        }
      } catch {
        // Cache unreadable — proceed to fetch regardless.
      }

      try {
        let resolved = await dbFetchPreferences(userId);

        if (!resolved) {
          const pending = pendingRankingRef.current;
          const seed = isValidRanking(pending) ? pending : DEFAULT_RANKING;
          resolved = await dbUpsertPreferences(userId, seed);
        }

        if (cancelled) return;
        setRanking(resolved);
        await AsyncStorage.setItem(storageKey(userId), JSON.stringify(resolved));
      } catch {
        // Network/DB failure — keep whatever the cache (or default) already
        // set above; the "Work on next" card still works with a fallback order.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // Not yet called anywhere — there's no "edit my ranking" UI yet (a natural
  // fit for screens/ProfileModal.js later). Exposed now so that follow-up
  // doesn't require touching this hook's shape.
  const savePreferences = useCallback(async newRanking => {
    if (!userId || !isValidRanking(newRanking)) return;
    const saved = await dbUpsertPreferences(userId, newRanking);
    setRanking(saved);
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(saved));
  }, [userId]);

  return { ranking, loaded, savePreferences };
}
