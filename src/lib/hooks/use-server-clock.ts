'use client';

import { useEffect, useState } from 'react';

/**
 * A clock that is corrected against the server.
 *
 * This exists because a timer that trusts the device clock is wrong the moment
 * the device clock is wrong — a phone that has drifted, or a user who changed
 * the date. Timers in REBIRTH are always derived from server timestamps; this
 * hook only supplies the "now" they are compared against, and it is offset so
 * that `now()` here means the same thing as `now()` in the database.
 *
 * The offset is measured from a same-origin request and is deliberately allowed
 * to be zero if that request fails: a slightly approximate clock is a much
 * better outcome than a timer that never starts.
 */

const DEFAULT_TICK_MS = 1000;

export interface ServerClockOptions {
  /** How often to re-render. Only matters while something is visibly ticking. */
  tickMs?: number;
  /** When false the clock still corrects itself but stops re-rendering. */
  ticking?: boolean;
}

export function useServerClock(options: ServerClockOptions = {}): Date {
  const { tickMs = DEFAULT_TICK_MS, ticking = true } = options;
  const [offsetMs, setOffsetMs] = useState(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const sample = async () => {
      try {
        const before = Date.now();
        const response = await fetch('/api/time', { method: 'GET', cache: 'no-store' });
        const after = Date.now();
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (cancelled) return;
        if (typeof body === 'object' && body !== null && 'now' in body) {
          const serverNow = new Date(String((body as { now: unknown }).now)).getTime();
          if (Number.isFinite(serverNow)) {
            // Assume the request took half the round trip in each direction.
            setOffsetMs(serverNow + (after - before) / 2 - after);
          }
        }
      } catch {
        // Offline or blocked: keep the device clock rather than freezing.
      }
    };

    void sample();

    // Re-sample when the tab wakes, because a suspended tab's clock is the
    // least trustworthy one.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sample();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (!ticking) return;
    const interval = window.setInterval(() => setTick((value) => value + 1), tickMs);
    return () => window.clearInterval(interval);
  }, [tickMs, ticking]);

  return new Date(Date.now() + offsetMs);
}
