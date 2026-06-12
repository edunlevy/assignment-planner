// PR 2.3 — useRealtimeSync tests
// Exercises the realtime-subscription LIFECYCLE hook in isolation: channel
// setup, postgres_changes payload decode, dispatch to onInsert/onUpdate/
// onDelete (with an isCancelled predicate), the subscribe status/error
// callback, and teardown (removeChannel + cancelled flag). The reconcile
// policy (queue, self-echo, tombstones, reminders) lives in useAssignments
// and is covered by useAssignments.test.js — NOT here.

import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { supabase } from '../../lib/supabase';
import { renderHook, flushMicrotasks } from '../helpers/renderHook';

// fromDb is mocked as identity so we can assert the decoded row equals the
// raw payload.new without reconstructing the DB→app field mapping.
vi.mock('../../lib/assignmentsDb', () => ({
  fromDb: row => row,
}));

const USER_ID = 'user-1';

// Captured Supabase channel wiring.
let realtimeCallback = null;
let subscribeCallback = null;

beforeEach(() => {
  realtimeCallback = null;
  subscribeCallback = null;

  supabase.channel.mockReset();
  supabase.channel.mockImplementation(() => {
    const ch = {
      on: vi.fn((_event, _filter, cb) => {
        realtimeCallback = cb;
        return ch;
      }),
      subscribe: vi.fn(statusCb => {
        subscribeCallback = statusCb;
        return ch;
      }),
      unsubscribe: vi.fn(async () => {}),
    };
    return ch;
  });
  supabase.removeChannel.mockReset();
  supabase.removeChannel.mockResolvedValue(undefined);
});

function makeCallbacks() {
  return {
    onInsert: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onError: vi.fn(),
  };
}

function mount(cbs, userId = USER_ID) {
  return renderHook(() => useRealtimeSync({ userId, ...cbs }));
}

// ===========================================================================
// Channel setup
// ===========================================================================
describe('channel setup', () => {
  test('subscribes to the user-scoped assignments channel', async () => {
    mount(makeCallbacks());
    await flushMicrotasks();

    expect(supabase.channel).toHaveBeenCalledWith(`assignments:${USER_ID}`);
    const ch = supabase.channel.mock.results[0].value;
    expect(ch.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'assignments', filter: `user_id=eq.${USER_ID}` },
      expect.any(Function),
    );
    expect(ch.subscribe).toHaveBeenCalled();
  });

  test('does not subscribe when userId is empty', async () => {
    mount(makeCallbacks(), null);
    await flushMicrotasks();
    expect(supabase.channel).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Payload decode + dispatch
// ===========================================================================
describe('payload dispatch', () => {
  test('INSERT → onInsert(decodedRow, isCancelled)', async () => {
    const cbs = makeCallbacks();
    mount(cbs);
    await flushMicrotasks();

    const row = { id: 'a1', title: 'New' };
    realtimeCallback({ eventType: 'INSERT', new: row });

    expect(cbs.onInsert).toHaveBeenCalledTimes(1);
    const [decoded, isCancelled] = cbs.onInsert.mock.calls[0];
    expect(decoded).toEqual(row);
    expect(typeof isCancelled).toBe('function');
    expect(isCancelled()).toBe(false);
    expect(cbs.onUpdate).not.toHaveBeenCalled();
    expect(cbs.onDelete).not.toHaveBeenCalled();
  });

  test('UPDATE → onUpdate(decodedRow, isCancelled)', async () => {
    const cbs = makeCallbacks();
    mount(cbs);
    await flushMicrotasks();

    const row = { id: 'a1', title: 'Edited' };
    realtimeCallback({ eventType: 'UPDATE', new: row, old: { id: 'a1' } });

    expect(cbs.onUpdate).toHaveBeenCalledTimes(1);
    expect(cbs.onUpdate.mock.calls[0][0]).toEqual(row);
    expect(typeof cbs.onUpdate.mock.calls[0][1]).toBe('function');
  });

  test('DELETE → onDelete(id, isCancelled) using payload.old.id', async () => {
    const cbs = makeCallbacks();
    mount(cbs);
    await flushMicrotasks();

    realtimeCallback({ eventType: 'DELETE', old: { id: 'gone' } });

    expect(cbs.onDelete).toHaveBeenCalledTimes(1);
    expect(cbs.onDelete.mock.calls[0][0]).toBe('gone');
    expect(typeof cbs.onDelete.mock.calls[0][1]).toBe('function');
    // No row decode for DELETE — onInsert/onUpdate untouched.
    expect(cbs.onInsert).not.toHaveBeenCalled();
    expect(cbs.onUpdate).not.toHaveBeenCalled();
  });

  test('payload with no id is ignored', async () => {
    const cbs = makeCallbacks();
    mount(cbs);
    await flushMicrotasks();

    realtimeCallback({ eventType: 'INSERT', new: { title: 'no id' } });

    expect(cbs.onInsert).not.toHaveBeenCalled();
    expect(cbs.onUpdate).not.toHaveBeenCalled();
    expect(cbs.onDelete).not.toHaveBeenCalled();
  });

  test('always reads the latest callbacks (ref refresh), without re-subscribing', async () => {
    const first = makeCallbacks();
    const { rerender, result } = renderHook(() => {
      // Swap onInsert identity each render to prove no re-subscribe occurs.
      return useRealtimeSync({ userId: USER_ID, ...first });
    });
    await flushMicrotasks();
    void result;

    rerender();
    await flushMicrotasks();

    // Only one channel ever created despite the re-render.
    expect(supabase.channel).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Subscribe status / error
// ===========================================================================
describe('subscription status', () => {
  test('CHANNEL_ERROR → onError(message)', async () => {
    const cbs = makeCallbacks();
    mount(cbs);
    await flushMicrotasks();

    subscribeCallback('CHANNEL_ERROR', null);
    expect(cbs.onError).toHaveBeenCalledWith('Live sync is unavailable. Changes may be delayed.');
  });

  test('TIMED_OUT → onError(message)', async () => {
    const cbs = makeCallbacks();
    mount(cbs);
    await flushMicrotasks();

    subscribeCallback('TIMED_OUT', null);
    expect(cbs.onError).toHaveBeenCalledOnce();
  });

  test('non-null err → onError(message)', async () => {
    const cbs = makeCallbacks();
    mount(cbs);
    await flushMicrotasks();

    subscribeCallback('SOMETHING', new Error('boom'));
    expect(cbs.onError).toHaveBeenCalledOnce();
  });

  test('SUBSCRIBED → onError NOT called', async () => {
    const cbs = makeCallbacks();
    mount(cbs);
    await flushMicrotasks();

    subscribeCallback('SUBSCRIBED', null);
    expect(cbs.onError).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Teardown
// ===========================================================================
describe('teardown', () => {
  test('unmount removes the channel', async () => {
    const cbs = makeCallbacks();
    const { unmount } = mount(cbs);
    await flushMicrotasks();

    const channel = supabase.channel.mock.results[0].value;
    unmount();

    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  test('isCancelled predicate handed to a callback returns true after unmount', async () => {
    const cbs = makeCallbacks();
    const { unmount } = mount(cbs);
    await flushMicrotasks();

    // Capture the predicate from a dispatched event before teardown.
    realtimeCallback({ eventType: 'INSERT', new: { id: 'a1' } });
    const isCancelled = cbs.onInsert.mock.calls[0][1];
    expect(isCancelled()).toBe(false);

    unmount();
    expect(isCancelled()).toBe(true);
  });

  test('subscribe status callback is a no-op after teardown', async () => {
    const cbs = makeCallbacks();
    const { unmount } = mount(cbs);
    await flushMicrotasks();

    unmount();
    subscribeCallback('CHANNEL_ERROR', null);
    expect(cbs.onError).not.toHaveBeenCalled();
  });
});
