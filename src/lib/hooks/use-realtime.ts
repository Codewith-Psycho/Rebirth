'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Keeps a screen in step with other devices.
 *
 * This is an *addition* to persistence, never a substitute for it. Every screen
 * loads from the database first and then subscribes; if Realtime is switched
 * off on the project, or the socket drops, the screen still works — it just
 * will not update until the next navigation. That is why the returned status is
 * surfaced rather than swallowed: the app can say "changes from other devices
 * may be delayed" instead of quietly going stale.
 *
 * Changes are coalesced. A routine edit can touch dozens of rows in one
 * transaction, and reloading once per row would be both wasteful and visually
 * noisy.
 */

export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'unavailable';

const COALESCE_MS = 400;

export function useRealtime(
  userId: string | null,
  tables: string[],
  onChange: () => void,
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>(userId ? 'connecting' : 'idle');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // The table list is a fresh array on every render; keying the subscription on
  // its contents rather than its identity avoids tearing it down constantly.
  const key = [...tables].sort().join(',');

  useEffect(() => {
    if (!userId || tables.length === 0) {
      setStatus('idle');
      return;
    }

    let channel: RealtimeChannel | null = null;
    let debounce: number | null = null;
    let disposed = false;

    const fire = () => {
      if (debounce !== null) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        debounce = null;
        onChangeRef.current();
      }, COALESCE_MS);
    };

    try {
      const supabase = getSupabaseBrowserClient();
      channel = supabase.channel(`rebirth:${userId}:${key}`);

      for (const table of tables) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` },
          fire,
        );
      }

      channel.subscribe((state) => {
        if (disposed) return;
        if (state === 'SUBSCRIBED') setStatus('live');
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setStatus('unavailable');
      });
    } catch {
      // Realtime misconfigured or blocked. Persistence is unaffected.
      setStatus('unavailable');
    }

    return () => {
      disposed = true;
      if (debounce !== null) window.clearTimeout(debounce);
      if (channel) void channel.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` encodes `tables`.
  }, [userId, key]);

  return status;
}
