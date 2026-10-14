'use client';

import { describeTimer, snapshot, type SessionTiming, type TimerSnapshot } from '@/lib/domain/timer';
import { useServerClock } from './use-server-clock';

/**
 * A live view of a persisted timer.
 *
 * The clock below does *one* thing: it re-renders, once a second, and only
 * while a timer is actually running. Every number shown is derived from the
 * stored timestamps against a server-corrected "now", so:
 *
 *   · a refresh re-computes the same value instead of restarting from zero,
 *   · a suspended tab resumes showing the right elapsed time immediately,
 *   · device sleep cannot lose or invent time,
 *   · and no row is written per second.
 *
 * There is no memoisation here on purpose: the value is a function of the
 * current instant, so a render *is* the recomputation.
 */

export interface LiveTimer {
  session: SessionTiming;
  snapshot: TimerSnapshot;
  /** The corrected instant the snapshot was computed against. */
  now: Date;
  /** Screen-reader sentence describing the current state. */
  description: string;
  isRunning: boolean;
  isPaused: boolean;
}

export function useLiveTimer(
  session: SessionTiming | null,
  targetSeconds: number | null = null,
): LiveTimer | null {
  const running = session?.status === 'running';
  const now = useServerClock({ tickMs: 1000, ticking: running === true });

  if (!session) return null;

  return {
    session,
    snapshot: snapshot(session, now, targetSeconds),
    now,
    description: describeTimer(session, now),
    isRunning: session.status === 'running',
    isPaused: session.status === 'paused',
  };
}
