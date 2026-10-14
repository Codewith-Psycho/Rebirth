'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Result } from '@/lib/data/result';

/**
 * The one data-loading hook.
 *
 * Every screen in REBIRTH is expected to have four states — loading, error with
 * a retry, empty, and filled — and this is what makes that easy enough to
 * actually do. Two details matter:
 *
 *   · A monotonically increasing request id means a slow first request cannot
 *     overwrite a fast second one. Without it, a page that reloads quickly can
 *     settle on stale data.
 *   · A failure stores its message and nothing else. There is no code path
 *     where a failed load leaves the previous data on screen looking current.
 */

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-runs the loader. Safe to call from a retry button. */
  reload: () => void;
  /** Local, optimistic replacement — used after a write we already know landed. */
  setData: (updater: T | ((current: T | null) => T | null)) => void;
}

export interface UseAsyncOptions {
  /** Skip loading entirely (e.g. while a required id is still undefined). */
  enabled?: boolean;
  /** Re-run whenever this string changes — handy for range or filter changes. */
  key?: string;
}

export function useAsync<T>(
  loader: () => Promise<Result<T>>,
  options: UseAsyncOptions = {},
): AsyncState<T> {
  const { enabled = true, key = '' } = options;

  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [nonce, setNonce] = useState(0);

  const requestId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const id = ++requestId.current;
    let cancelled = false;

    setLoading(true);
    setError(null);

    loaderRef
      .current()
      .then((result) => {
        if (cancelled || id !== requestId.current) return;
        if (result.ok) {
          setDataState(result.data);
          setError(null);
        } else {
          setError(result.error);
        }
      })
      .catch((thrown: unknown) => {
        if (cancelled || id !== requestId.current) return;
        setError(thrown instanceof Error ? thrown.message : 'Something went wrong loading this.');
      })
      .finally(() => {
        if (cancelled || id !== requestId.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, key, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const setData = useCallback((updater: T | ((current: T | null) => T | null)) => {
    setDataState((current) =>
      typeof updater === 'function' ? (updater as (c: T | null) => T | null)(current) : updater,
    );
  }, []);

  return { data, error, loading, reload, setData };
}
