// A per-key async mutex. `withLock(key, fn)` runs `fn` after any in-flight work
// for the same `key` has settled, serializing read-modify-write cycles that
// share a per-key resource so concurrent calls can't interleave and lose one
// another's updates.
//
// Why the orchestration layers need this: AsyncStorage has no atomic
// read-modify-write primitive, and several call sites can legitimately run
// concurrently for the SAME userId — a mutation's scheduleFor, a realtime
// echo's scheduleFor, and a load-time backfill can all overlap. Without
// serializing them, a classic lost-update race can drop one call's map entry:
// it reads the map before another call's write lands, then overwrites that
// write with its own stale copy (orphaning a reminder/event that's never
// cleaned up, and producing a duplicate on the next reconcile). Keyed by userId
// — NOT per-assignment-id like useAssignments' enqueueForId — because the
// underlying AsyncStorage key (reminder_ids_${userId} / calendar_events_
// ${userId}) is per-user; that is the correct serialization granularity.
//
// Create one lock instance PER resource: the reminder map and the calendar
// event map are independent (a reminder write and a calendar write for the
// same user don't conflict), so they get separate locks and never block each
// other.
export function createUserKeyedLock() {
  const locks = new Map();
  return function withLock(key, fn) {
    const prev = locks.get(key) ?? Promise.resolve();
    // `.then(fn, fn)` runs fn whether the previous chain settled or rejected,
    // so one failed critical section can't wedge the lock for the key.
    const settled = prev.then(fn, fn);
    // Chain the NEXT waiter off a swallowed copy so a rejection here doesn't
    // become an unhandled rejection; callers still see the real outcome via
    // the returned `settled`.
    const cleanup = settled.catch(() => {});
    locks.set(key, cleanup);
    return settled;
  };
}
