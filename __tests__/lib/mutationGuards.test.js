import {
  createMutationGuards,
  SELF_MUTATION_TTL_MS,
  TOMBSTONE_TTL_MS,
} from '../../lib/mutationGuards';

const NOW = new Date('2026-05-15T08:00:00').getTime();

function row(overrides = {}) {
  return {
    id: 'a1', title: 'Essay', course: 'ENGL 200', dueDate: '2026-05-20',
    importance: 4, status: 'not_started', complexity: 'long',
    seriesId: null, dueTime: null, ...overrides,
  };
}

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => { Date.now.mockRestore(); });

describe('createMutationGuards', () => {
  test('instances are independent (no shared state)', () => {
    const a = createMutationGuards();
    const b = createMutationGuards();
    a.markPendingInsert('x');
    expect(a.isOwnEcho('x', 'INSERT', null)).toBe(true);
    expect(b.isOwnEcho('x', 'INSERT', null)).toBe(false);
  });
});

describe('self-mutation echo suppression', () => {
  test('no marker → not our echo', () => {
    const g = createMutationGuards();
    expect(g.isOwnEcho('a1', 'INSERT', row())).toBe(false);
    expect(g.isOwnEcho('a1', 'UPDATE', row())).toBe(false);
  });

  test('pending INSERT marker suppresses the INSERT echo (client-minted id)', () => {
    const g = createMutationGuards();
    g.markPendingInsert('a1');
    expect(g.isOwnEcho('a1', 'INSERT', row())).toBe(true);
  });

  test('settled UPDATE marker suppresses only a signature-matching echo', () => {
    const g = createMutationGuards();
    g.settleSelfMutation('a1', row({ title: 'Edited' }));
    expect(g.isOwnEcho('a1', 'UPDATE', row({ title: 'Edited' }))).toBe(true);
    // A genuine remote change to the same id has a different signature.
    expect(g.isOwnEcho('a1', 'UPDATE', row({ title: 'Remote edit' }))).toBe(false);
  });

  test('a pending (not-yet-settled) marker does not match an UPDATE echo', () => {
    const g = createMutationGuards();
    g.markPendingInsert('a1'); // phase: pending, no signature
    expect(g.isOwnEcho('a1', 'UPDATE', row())).toBe(false);
  });

  test('DELETE echoes are never suppressed', () => {
    const g = createMutationGuards();
    g.markPendingInsert('a1');
    g.settleSelfMutation('a1', row());
    expect(g.isOwnEcho('a1', 'DELETE', null)).toBe(false);
  });

  test('a settled marker expires after SELF_MUTATION_TTL_MS and is pruned', () => {
    const g = createMutationGuards();
    g.settleSelfMutation('a1', row());
    expect(g.isOwnEcho('a1', 'UPDATE', row())).toBe(true);

    Date.now.mockReturnValue(NOW + SELF_MUTATION_TTL_MS + 1);
    expect(g.isOwnEcho('a1', 'UPDATE', row())).toBe(false); // expired
    // Pruned: even rewinding the clock, the marker is gone.
    Date.now.mockReturnValue(NOW);
    expect(g.isOwnEcho('a1', 'UPDATE', row())).toBe(false);
  });

  test('a pending INSERT marker never expires (no TTL until it settles)', () => {
    const g = createMutationGuards();
    g.markPendingInsert('a1');
    // Far beyond any settled TTL — a slow network must not let the echo slip through.
    Date.now.mockReturnValue(NOW + TOMBSTONE_TTL_MS + SELF_MUTATION_TTL_MS + 1);
    expect(g.isOwnEcho('a1', 'INSERT', row())).toBe(true);
  });

  test('clearSelfMutation removes a pending marker (e.g. on DB failure)', () => {
    const g = createMutationGuards();
    g.markPendingInsert('a1');
    g.clearSelfMutation('a1');
    expect(g.isOwnEcho('a1', 'INSERT', row())).toBe(false);
  });

  test('clearSelfMutation removes a settled marker too', () => {
    const g = createMutationGuards();
    g.settleSelfMutation('a1', row());
    g.clearSelfMutation('a1');
    expect(g.isOwnEcho('a1', 'UPDATE', row())).toBe(false);
  });
});

describe('delete tombstones', () => {
  test('a tombstoned id reports true until the TTL elapses, then is pruned', () => {
    const g = createMutationGuards();
    expect(g.isTombstoned('a1')).toBe(false);

    g.markTombstone('a1');
    expect(g.isTombstoned('a1')).toBe(true);

    Date.now.mockReturnValue(NOW + TOMBSTONE_TTL_MS + 1);
    expect(g.isTombstoned('a1')).toBe(false); // expired + pruned
    Date.now.mockReturnValue(NOW);
    expect(g.isTombstoned('a1')).toBe(false);
  });
});

describe('per-id serialization queue', () => {
  test('work for the same id runs in enqueue order', async () => {
    const g = createMutationGuards();
    const order = [];
    const p1 = g.enqueueForId('a1', async () => {
      await Promise.resolve();
      order.push(1);
    });
    const p2 = g.enqueueForId('a1', async () => { order.push(2); });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  test('the returned promise resolves/rejects with the wrapped fn outcome', async () => {
    const g = createMutationGuards();
    await expect(g.enqueueForId('a1', async () => 'ok')).resolves.toBe('ok');
  });

  test('a rejection does not break the chain for subsequent work on that id', async () => {
    const g = createMutationGuards();
    const p1 = g.enqueueForId('a1', async () => { throw new Error('boom'); });
    await expect(p1).rejects.toThrow('boom');
    // The next task still runs (chained off the swallowed cleanup).
    await expect(g.enqueueForId('a1', async () => 'after')).resolves.toBe('after');
  });

  test('different ids run independently (not serialized against each other)', async () => {
    const g = createMutationGuards();
    const order = [];
    let releaseA;
    const a = g.enqueueForId('a', async () => {
      await new Promise(r => { releaseA = r; });
      order.push('a');
    });
    const b = g.enqueueForId('b', async () => { order.push('b'); });
    await b; // b finishes without waiting on a
    expect(order).toEqual(['b']);
    releaseA();
    await a;
    expect(order).toEqual(['b', 'a']);
  });
});
