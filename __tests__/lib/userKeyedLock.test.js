import { createUserKeyedLock } from '../../lib/userKeyedLock';

describe('createUserKeyedLock', () => {
  test('serializes work for the same key in call order', async () => {
    const withLock = createUserKeyedLock();
    const order = [];
    const p1 = withLock('u1', async () => {
      await Promise.resolve();
      order.push(1);
    });
    const p2 = withLock('u1', async () => { order.push(2); });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  test('different keys run independently (not serialized against each other)', async () => {
    const withLock = createUserKeyedLock();
    const order = [];
    let releaseA;
    const a = withLock('a', async () => {
      await new Promise(r => { releaseA = r; });
      order.push('a');
    });
    const b = withLock('b', async () => { order.push('b'); });
    await b; // b does not wait on a
    expect(order).toEqual(['b']);
    releaseA();
    await a;
    expect(order).toEqual(['b', 'a']);
  });

  test('the returned promise resolves with the critical section result', async () => {
    const withLock = createUserKeyedLock();
    await expect(withLock('u1', async () => 'value')).resolves.toBe('value');
  });

  test('a rejected critical section rejects its own promise but does not wedge the key', async () => {
    const withLock = createUserKeyedLock();
    await expect(withLock('u1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // The next critical section for the same key still runs — `.then(fn, fn)`
    // invokes it as the previous chain's onRejected handler.
    await expect(withLock('u1', async () => 'after')).resolves.toBe('after');
  });

  test('its internal lock chain never emits an unhandled rejection', async () => {
    // The `settled.catch(() => {})` cleanup exists so the promise stored in the
    // lock map can reject without surfacing as an unhandled rejection. Guard
    // that property so a future "simplification" can't silently regress it.
    const withLock = createUserKeyedLock();
    const unhandled = [];
    const onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      // Rejecting section whose own returned promise is handled, followed by a
      // serialized waiter — the real usage pattern.
      await withLock('u1', async () => { throw new Error('boom'); }).catch(() => {});
      await withLock('u1', async () => 'ok');
      // Let any queued unhandled-rejection event fire.
      await new Promise(r => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  test('instances are independent (no shared lock map)', async () => {
    const lockA = createUserKeyedLock();
    const lockB = createUserKeyedLock();
    const order = [];
    let releaseA;
    // Hold lockA's 'u1' open; lockB's 'u1' must be unaffected.
    lockA('u1', async () => { await new Promise(r => { releaseA = r; }); order.push('A'); });
    await lockB('u1', async () => { order.push('B'); });
    expect(order).toEqual(['B']);
    releaseA();
  });
});
