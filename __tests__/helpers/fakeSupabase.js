// In-memory Supabase double for INTEGRATION flow tests.
//
// Unlike the unit tests (which mock lib/assignmentsDb), the flow tests run the
// REAL lib/assignmentsDb (toDb/fromDb column mapping), lib/notifications, and
// the orchestration hooks on top of this fake — so the only thing stubbed is
// the network boundary. The fake:
//   - stores DB-shaped rows (snake_case columns) in memory
//   - supports the exact query chains lib/assignmentsDb uses:
//       .from(t).select('*').eq().order()                     (dbFetch)
//       .from(t).insert(row).select().single()                (dbInsert)
//       .from(t).insert([rows]).select()                      (dbInsertMany)
//       .from(t).update(payload).eq().eq().select().single()  (dbUpdate)
//       .from(t).delete().eq().eq()                            (dbDelete / series)
//   - emits realtime postgres_changes events on every mutation, so a write's
//     own echo reaches useAssignments' self-mutation suppression exactly as it
//     would in production. External (other-device) events can be injected via
//     the returned `emit(...)` helper.
//
// The query builder is both chainable and awaitable: awaiting it runs the
// accumulated operation once (memoized) and resolves { data, error }.

function matches(row, filters) {
  return filters.every(([col, val]) => row[col] === val);
}

export function createFakeSupabase({ initialRows = [], deliverEchoes = true } = {}) {
  let store = initialRows.map(r => ({ ...r }));
  const channels = [];

  // Deliver a realtime event to every subscribed handler, asynchronously (a
  // microtask) so it lands after the triggering mutation's await resolves —
  // matching the real "echo arrives shortly after the write" ordering.
  function deliver(eventType, newRow, oldRow) {
    const payload = {
      eventType,
      new: newRow ? { ...newRow } : null,
      old: oldRow ? { ...oldRow } : null,
    };
    for (const ch of channels) {
      for (const handler of ch.handlers) {
        queueMicrotask(() => handler(payload));
      }
    }
  }

  function run(state) {
    switch (state.op) {
      case 'select': {
        const rows = store.filter(r => matches(r, state.filters));
        // dbFetch orders by due_date asc — the only ordering the app uses.
        rows.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
        return { data: rows.map(r => ({ ...r })), error: null };
      }
      case 'insert': {
        const inserted = state.rows.map(r => ({ ...r }));
        store.push(...inserted);
        if (deliverEchoes) inserted.forEach(r => deliver('INSERT', r, null));
        const data = state.single ? { ...inserted[0] } : inserted.map(r => ({ ...r }));
        return { data, error: null };
      }
      case 'update': {
        const targets = store.filter(r => matches(r, state.filters));
        targets.forEach(r => Object.assign(r, state.payload));
        if (deliverEchoes) targets.forEach(r => deliver('UPDATE', r, null));
        const data = state.single
          ? (targets[0] ? { ...targets[0] } : null)
          : targets.map(r => ({ ...r }));
        return { data, error: null };
      }
      case 'delete': {
        const removed = store.filter(r => matches(r, state.filters));
        store = store.filter(r => !matches(r, state.filters));
        if (deliverEchoes) removed.forEach(r => deliver('DELETE', null, r));
        return { data: null, error: null };
      }
      default:
        return { data: null, error: null };
    }
  }

  function makeBuilder() {
    const state = { op: 'select', filters: [], payload: null, rows: null, single: false };
    let executed = null;
    const builder = {
      select() { return builder; },
      single() { state.single = true; return builder; },
      eq(col, val) { state.filters.push([col, val]); return builder; },
      order() { return builder; },
      insert(rowOrRows) {
        state.op = 'insert';
        state.rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
        return builder;
      },
      update(payload) { state.op = 'update'; state.payload = payload; return builder; },
      delete() { state.op = 'delete'; return builder; },
      // Thenable: await runs the operation once.
      then(onFulfilled, onRejected) {
        if (!executed) executed = Promise.resolve().then(() => run(state));
        return executed.then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  const supabase = {
    from() { return makeBuilder(); },
    channel(name) {
      const ch = {
        name,
        handlers: [],
        on(_event, _filter, cb) { ch.handlers.push(cb); return ch; },
        subscribe(statusCb) {
          if (statusCb) queueMicrotask(() => statusCb('SUBSCRIBED', null));
          return ch;
        },
        unsubscribe: async () => {},
      };
      channels.push(ch);
      return ch;
    },
    removeChannel: async ch => {
      const i = channels.indexOf(ch);
      if (i >= 0) channels.splice(i, 1);
    },
    rpc: async () => ({ data: null, error: null }),
  };

  return {
    supabase,
    // No-op AppState auto-refresh (App.js wires this; hook-level tests ignore it).
    startAuthAutoRefresh: () => ({ remove: () => {} }),
    // Snapshot of the current stored (DB-shaped) rows.
    getStore: () => store.map(r => ({ ...r })),
    // Inject an event as if it came from ANOTHER device (updates the store to
    // stay consistent, then delivers to subscribers).
    emit(eventType, dbRow) {
      if (eventType === 'INSERT') {
        store.push({ ...dbRow });
        deliver('INSERT', dbRow, null);
      } else if (eventType === 'UPDATE') {
        const existing = store.find(r => r.id === dbRow.id);
        if (existing) Object.assign(existing, dbRow); else store.push({ ...dbRow });
        deliver('UPDATE', dbRow, null);
      } else if (eventType === 'DELETE') {
        store = store.filter(r => r.id !== dbRow.id);
        deliver('DELETE', null, dbRow);
      }
    },
  };
}
