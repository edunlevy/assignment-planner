import { rowsMatch } from './assignment';

// Concurrency primitives that keep a local write's own realtime echo from
// being re-applied, without ever dropping a genuine concurrent change from
// another device. Extracted from useAssignments so the logic is framework-free
// and unit-testable in isolation; the hook holds one instance for its lifetime.
//
// Time is read via Date.now() so tests can drive expiry with a mocked clock.

// How long a settled self-mutation signature is trusted (UPDATE echoes).
export const SELF_MUTATION_TTL_MS = 8000;
// How long a delete tombstone suppresses resurrecting UPDATE/INSERT echoes.
export const TOMBSTONE_TTL_MS = 30000;

export function createMutationGuards() {
  // Self-mutation markers, per row id. See markPendingInsert / settleSelfMutation
  // / isOwnEcho for the per-event-kind reasoning:
  //
  //   INSERT — we mint the id client-side, so any INSERT echo for that id is
  //   necessarily ours (no other device can have produced this UUID). The
  //   marker has a `pending` phase (no TTL, lives until dbInsert settles) so a
  //   slow network can't expire it before the echo arrives.
  //
  //   UPDATE — concurrent updates from other devices can target the same id,
  //   so we cannot suppress by id alone. After the write settles we store the
  //   returned row as a `signature`; an UPDATE echo is treated as ours only
  //   when its (id, mapped fields) match. Anything else is a real remote write.
  //
  //   DELETE — applying a DELETE twice is a no-op, so there is no need to
  //   suppress at all; not suppressing means a concurrent same-id delete from
  //   another device is never silently dropped.
  const selfMutations = new Map();

  // Tombstones: ids of rows we DELETED on this device, kept for a short window.
  // The race they prevent: another device commits an UPDATE *before* our DELETE
  // lands at the DB, but its realtime event arrives *after* our delete
  // completes. That event is real, but applying it would resurrect a row whose
  // final server state is "deleted", so we drop UPDATE/INSERT events for that
  // id until the TTL elapses.
  const tombstones = new Map();

  // Per-id promise chains, shared by BOTH the local UPDATE path and the
  // realtime handler so a local write and its own echo (or a real concurrent
  // remote event for the same id) serialize instead of racing on the reminder
  // map / state.
  const queues = new Map();

  // Mark that an INSERT we minted is in flight. No TTL — lives until settled.
  function markPendingInsert(id) {
    selfMutations.set(id, { phase: 'pending', signature: null, expiresAt: null });
  }

  // Record the settled server row as the signature to match echoes against.
  function settleSelfMutation(id, signature) {
    selfMutations.set(id, {
      phase: 'settled',
      signature,
      expiresAt: Date.now() + SELF_MUTATION_TTL_MS,
    });
  }

  // Drop a marker (called on DB failure) so a stale marker can't outlive a
  // doomed write and block real remote events for that id.
  function clearSelfMutation(id) {
    selfMutations.delete(id);
  }

  // True iff this realtime event matches a write WE issued, by the narrowest
  // criterion provable for that event kind. Anything else is a remote event.
  function isOwnEcho(id, event, incomingRow) {
    const marker = selfMutations.get(id);
    if (!marker) return false;
    if (marker.phase === 'settled' && Date.now() > marker.expiresAt) {
      selfMutations.delete(id);
      return false;
    }
    if (event === 'INSERT') {
      // Brand-new UUID; if we have any marker for it, the event is ours.
      return true;
    }
    if (event === 'UPDATE') {
      return marker.phase === 'settled' && rowsMatch(marker.signature, incomingRow);
    }
    // DELETE: never suppress — local + remote delete converge on the same state.
    return false;
  }

  function markTombstone(id) {
    tombstones.set(id, Date.now() + TOMBSTONE_TTL_MS);
  }

  function isTombstoned(id) {
    const exp = tombstones.get(id);
    if (!exp) return false;
    if (Date.now() > exp) {
      tombstones.delete(id);
      return false;
    }
    return true;
  }

  // Chain `fn` after any in-flight work for `id`, returning a promise that
  // resolves/rejects with fn's own outcome (so callers still see the real
  // result). Cleans up the map entry once the chain settles and nothing newer
  // has replaced it.
  function enqueueForId(id, fn) {
    const chain = queues.get(id) ?? Promise.resolve();
    const result = chain.then(fn);
    const cleanup = result.catch(() => {});
    queues.set(id, cleanup);
    cleanup.then(() => {
      if (queues.get(id) === cleanup) queues.delete(id);
    });
    return result;
  }

  return {
    markPendingInsert,
    settleSelfMutation,
    clearSelfMutation,
    isOwnEcho,
    markTombstone,
    isTombstoned,
    enqueueForId,
  };
}
