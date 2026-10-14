import type { SessionKind, SessionStatus, TaskSessionRow } from '@/lib/types/database';

/**
 * Focus timer maths.
 *
 * The database stores three facts and derives everything else:
 *   `started_at`          when the timer was first opened
 *   `accumulated_seconds` total active time from all *closed* intervals
 *   `last_resumed_at`     when the current open interval began (NULL if paused)
 *
 * Because elapsed time is a function of stored timestamps and the current
 * clock, it survives a refresh, a suspended tab, device sleep and reopening the
 * app. Nothing here keeps a counter in memory, so nothing can drift, and no
 * second-by-second rows are ever written.
 */

export const TWO_MINUTE_SECONDS = 120;

export interface SessionTiming {
  status: SessionStatus;
  started_at: string;
  ended_at: string | null;
  last_resumed_at: string | null;
  accumulated_seconds: number;
  kind: SessionKind;
}

export function isOpen(session: Pick<TaskSessionRow, 'status'>): boolean {
  return session.status === 'running' || session.status === 'paused';
}

export function isRunning(session: Pick<TaskSessionRow, 'status'>): boolean {
  return session.status === 'running';
}

/**
 * Active seconds at `now`.
 *
 * `now` should be a *server-corrected* instant (see `correctedNow`) so a device
 * with a skewed clock cannot invent or destroy tracked time. A negative open
 * interval — which can only happen if the clock jumps backwards — contributes
 * zero rather than subtracting time.
 */
export function activeSeconds(session: SessionTiming, now: Date): number {
  const base = Math.max(0, session.accumulated_seconds);
  if (session.status !== 'running' || session.last_resumed_at === null) {
    return base;
  }
  const resumedAt = new Date(session.last_resumed_at).getTime();
  const openMs = now.getTime() - resumedAt;
  if (!Number.isFinite(openMs) || openMs <= 0) return base;
  return base + Math.floor(openMs / 1000);
}

/** Seconds spent paused across the whole session. */
export function pausedSeconds(session: SessionTiming, now: Date): number {
  const end = session.ended_at ? new Date(session.ended_at).getTime() : now.getTime();
  const total = Math.max(0, Math.floor((end - new Date(session.started_at).getTime()) / 1000));
  return Math.max(0, total - activeSeconds(session, now));
}

/** Wall-clock span from first start to now (or to the end, if closed). */
export function wallClockSeconds(session: SessionTiming, now: Date): number {
  const end = session.ended_at ? new Date(session.ended_at).getTime() : now.getTime();
  return Math.max(0, Math.floor((end - new Date(session.started_at).getTime()) / 1000));
}

export function remainingSeconds(session: SessionTiming, now: Date, target: number): number {
  return Math.max(0, target - activeSeconds(session, now));
}

/** Progress of a fixed-length session, clamped to 0–1. */
export function sessionProgress(session: SessionTiming, now: Date, target: number): number {
  if (target <= 0) return 0;
  return Math.min(1, activeSeconds(session, now) / target);
}

/**
 * A two-minute start is an *attempt*, not a completion. It is reported
 * separately everywhere so that "I showed up" is never silently rounded up
 * into "I finished".
 */
export function twoMinuteOutcome(
  session: SessionTiming,
  now: Date,
): { seconds: number; targetSeconds: number; reachedTarget: boolean; progress: number } {
  const seconds = activeSeconds(session, now);
  return {
    seconds,
    targetSeconds: TWO_MINUTE_SECONDS,
    reachedTarget: seconds >= TWO_MINUTE_SECONDS,
    progress: Math.min(1, seconds / TWO_MINUTE_SECONDS),
  };
}

export interface TimerSnapshot {
  activeSeconds: number;
  pausedSeconds: number;
  wallClockSeconds: number;
  isRunning: boolean;
  /** `null` for open-ended focus sessions. */
  targetSeconds: number | null;
  remainingSeconds: number | null;
  progress: number | null;
}

export function snapshot(
  session: SessionTiming,
  now: Date,
  targetSeconds: number | null = null,
): TimerSnapshot {
  const active = activeSeconds(session, now);
  return {
    activeSeconds: active,
    pausedSeconds: pausedSeconds(session, now),
    wallClockSeconds: wallClockSeconds(session, now),
    isRunning: session.status === 'running',
    targetSeconds,
    remainingSeconds: targetSeconds === null ? null : Math.max(0, targetSeconds - active),
    progress: targetSeconds === null ? null : Math.min(1, active / targetSeconds),
  };
}

/** Human-readable timer state for screen readers and the status strip. */
export function describeTimer(session: SessionTiming | null, now: Date): string {
  if (!session) return 'No timer running.';
  const active = activeSeconds(session, now);
  const minutes = Math.floor(active / 60);
  const seconds = active % 60;
  const state = session.status === 'running' ? 'running' : 'paused';
  const label =
    session.kind === 'two_minute'
      ? 'Two-minute start'
      : session.kind === 'break'
        ? 'Break'
        : 'Focus session';
  return `${label} ${state}, ${minutes} minute${minutes === 1 ? '' : 's'} and ${seconds} second${
    seconds === 1 ? '' : 's'
  } elapsed.`;
}

/**
 * Given a list of sessions for one task, the total active time.
 * Overlapping intervals cannot inflate the total because each session's active
 * time is clamped to its own [started_at, ended_at] window and the database
 * permits only one open session per user.
 */
export function totalActiveSeconds(sessions: SessionTiming[], now: Date): number {
  return sessions.reduce((sum, s) => sum + activeSeconds(s, now), 0);
}

/** Pomodoro bookkeeping offered after a session ends. */
export function suggestNextStep(activeTotal: number, kind: SessionKind): 'break' | 'continue' | 'wrap-up' {
  if (kind === 'two_minute') return activeTotal >= TWO_MINUTE_SECONDS ? 'continue' : 'wrap-up';
  if (activeTotal >= 50 * 60) return 'wrap-up';
  return 'break';
}
