import { useEffect, useRef } from 'react';
import { fromDb } from '../lib/assignmentsDb';
import { supabase } from '../lib/supabase';

// Owns the Supabase realtime-subscription LIFECYCLE for one user's
// assignments: channel setup, postgres_changes payload decoding, the
// subscribe status/error callback, and teardown (cancelled flag +
// removeChannel).
//
// It deliberately owns NONE of the reconcile policy — self-echo
// suppression, tombstones, the per-id queue, and reminder scheduling all
// live in useAssignments, because they are SHARED with the local mutation
// paths. This hook just decodes each payload and dispatches to one of four
// caller-supplied callbacks, threading an `isCancelled` predicate so those
// callbacks can bail after their own awaits if teardown ran meanwhile.
//
// Requires the table to be in the supabase_realtime publication:
//   alter publication supabase_realtime add table public.assignments;
// See NOTES.md.
export function useRealtimeSync({ userId, onInsert, onUpdate, onDelete, onError }) {
  // Hold the callbacks in a ref, refreshed every render. The effect below
  // keys on [userId] ONLY, so a changing callback identity must NOT
  // re-subscribe the channel — it would tear down + recreate the channel on
  // every parent render, breaking effect-identity-sensitive tests and
  // churning the subscription. Reading through the ref decouples the two.
  const cbRef = useRef({ onInsert, onUpdate, onDelete, onError });
  cbRef.current = { onInsert, onUpdate, onDelete, onError };

  useEffect(() => {
    if (!userId) return;

    // `cancelled` flips on logout / user switch / unmount. Exposed to the
    // callbacks via isCancelled so a slow handler that started under user A
    // can bail before writing to user B's state.
    let cancelled = false;
    const isCancelled = () => cancelled;

    const channel = supabase
      .channel(`assignments:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignments', filter: `user_id=eq.${userId}` },
        payload => {
          const event = payload.eventType;
          const id = payload.new?.id ?? payload.old?.id;
          if (!id) return;
          const row = payload.new ? fromDb(payload.new) : null;

          if (event === 'DELETE') {
            cbRef.current.onDelete(id, isCancelled);
          } else if (event === 'INSERT') {
            cbRef.current.onInsert(row, isCancelled);
          } else if (event === 'UPDATE') {
            cbRef.current.onUpdate(row, isCancelled);
          }
        },
      )
      .subscribe((status, err) => {
        // Surface a subscription failure so the UI can show a banner.
        // Guarded by `cancelled` so a late callback after logout can't write.
        if (cancelled) return;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || err) {
          cbRef.current.onError('Live sync is unavailable. Changes may be delayed.');
        }
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);
}
