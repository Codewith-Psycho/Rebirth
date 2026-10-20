import { describe, expect, it } from 'vitest';

import {
  TWO_MINUTE_SECONDS,
  type SessionTiming,
  activeSeconds,
  describeTimer,
  isOpen,
  isRunning,
  pausedSeconds,
  remainingSeconds,
  sessionProgress,
  snapshot,
  suggestNextStep,
  totalActiveSeconds,
  twoMinuteOutcome,
  wallClockSeconds,
} from '@/lib/domain/timer';

/**
 * Focus-timer maths.
 *
 * Elapsed time is a function of stored timestamps and a clock that is passed
 * in, never a counter held in memory — that is what lets a refresh, a suspended
 * tab or device sleep neither lose nor invent tracked time. These tests hold
 * that property in place, including when the device clock moves backwards.
 */

const START = '2025-01-15T09:00:00.000Z';

function session(overrides: Partial<SessionTiming> = {}): SessionTiming {
  return {
    status: 'running',
    started_at: START,
    ended_at: null,
    last_resumed_at: START,
    accumulated_seconds: 0,
    kind: 'focus',
    ...overrides,
  };
}

function at(iso: string): Date {
  return new Date(iso);
}

describe('activeSeconds', () => {
  it('adds the open interval to the accumulated total', () => {
    const running = session({
      accumulated_seconds: 600,
      last_resumed_at: '2025-01-15T09:10:00.000Z',
    });
    expect(activeSeconds(running, at('2025-01-15T09:10:30.000Z'))).toBe(630);
  });

  it('ignores the open interval while paused', () => {
    const paused = session({
      status: 'paused',
      accumulated_seconds: 600,
      last_resumed_at: '2025-01-15T09:10:00.000Z',
    });
    expect(activeSeconds(paused, at('2025-01-15T09:10:30.000Z'))).toBe(600);
  });

  it('returns the accumulated total when no interval is open', () => {
    const running = session({ accumulated_seconds: 300, last_resumed_at: null });
    expect(activeSeconds(running, at('2025-01-15T09:10:30.000Z'))).toBe(300);
  });

  it('adds nothing for an interval that has only just opened', () => {
    const justResumed = session({
      accumulated_seconds: 45,
      last_resumed_at: '2025-01-15T09:10:30.000Z',
    });
    expect(activeSeconds(justResumed, at('2025-01-15T09:10:30.000Z'))).toBe(45);
  });

  it('never subtracts time when the clock jumps backwards', () => {
    const skewed = session({
      accumulated_seconds: 45,
      last_resumed_at: '2025-01-15T09:10:30.000Z',
    });
    expect(activeSeconds(skewed, at('2025-01-15T09:10:00.000Z'))).toBe(45);
  });

  it('never reports negative time from a corrupt total', () => {
    const corrupt = session({ status: 'paused', accumulated_seconds: -50 });
    expect(activeSeconds(corrupt, at('2025-01-15T09:10:30.000Z'))).toBe(0);
  });

  it('drops part-seconds rather than rounding them up', () => {
    expect(activeSeconds(session(), at('2025-01-15T09:00:01.900Z'))).toBe(1);
  });
});

describe('pausedSeconds and wallClockSeconds', () => {
  it('counts the whole open session as paused when nothing was ever tracked', () => {
    const paused = session({ status: 'paused', last_resumed_at: null });
    expect(pausedSeconds(paused, at('2025-01-15T09:10:00.000Z'))).toBe(600);
  });

  it('measures a closed session against its own end, not against now', () => {
    const closed = session({
      status: 'completed',
      ended_at: '2025-01-15T09:10:00.000Z',
      accumulated_seconds: 480,
    });
    // Ten minutes on the wall clock, eight of them tracked.
    expect(wallClockSeconds(closed, at('2025-01-15T11:00:00.000Z'))).toBe(600);
    expect(pausedSeconds(closed, at('2025-01-15T11:00:00.000Z'))).toBe(120);
  });

  it('measures a running session up to now', () => {
    expect(wallClockSeconds(session(), at('2025-01-15T09:10:30.000Z'))).toBe(630);
  });
});

describe('targets and progress', () => {
  it('floors the remaining time at zero instead of going negative', () => {
    const over = session({ accumulated_seconds: 700 });
    expect(remainingSeconds(over, at(START), 600)).toBe(0);
  });

  it('clamps progress to full rather than exceeding it', () => {
    const over = session({ accumulated_seconds: 700 });
    expect(sessionProgress(over, at(START), 600)).toBe(1);
    expect(sessionProgress(over, at(START), 0)).toBe(0);
  });

  it('reports half-way as half', () => {
    const half = session({ accumulated_seconds: 300 });
    expect(sessionProgress(half, at(START), 600)).toBeCloseTo(0.5, 6);
    expect(remainingSeconds(half, at(START), 600)).toBe(300);
  });
});

describe('the two-minute start', () => {
  it('is not reached one second early', () => {
    const outcome = twoMinuteOutcome(
      session({ status: 'paused', accumulated_seconds: TWO_MINUTE_SECONDS - 1 }),
      at(START),
    );
    expect(outcome.reachedTarget).toBe(false);
    expect(outcome.progress).toBeCloseTo(0.9917, 4);
  });

  it('is reached exactly at the target', () => {
    const outcome = twoMinuteOutcome(
      session({ status: 'paused', accumulated_seconds: TWO_MINUTE_SECONDS }),
      at(START),
    );
    expect(outcome.reachedTarget).toBe(true);
    expect(outcome.progress).toBe(1);
    expect(outcome.targetSeconds).toBe(TWO_MINUTE_SECONDS);
  });

  it('does not keep counting past the target', () => {
    const outcome = twoMinuteOutcome(session({ status: 'paused', accumulated_seconds: 600 }), at(START));
    expect(outcome.seconds).toBe(600);
    expect(outcome.progress).toBe(1);
  });
});

describe('snapshot', () => {
  it('reports no target for an open-ended focus session', () => {
    const state = snapshot(session({ accumulated_seconds: 600 }), at(START));
    expect(state.activeSeconds).toBe(600);
    expect(state.isRunning).toBe(true);
    expect(state.targetSeconds).toBeNull();
    expect(state.remainingSeconds).toBeNull();
    expect(state.progress).toBeNull();
  });

  it('reports remaining time and progress against a target', () => {
    const state = snapshot(
      session({ accumulated_seconds: 600, last_resumed_at: '2025-01-15T09:10:00.000Z' }),
      at('2025-01-15T09:10:30.000Z'),
      1200,
    );
    expect(state.activeSeconds).toBe(630);
    expect(state.remainingSeconds).toBe(570);
    expect(state.progress).toBeCloseTo(0.525, 6);
    expect(state.pausedSeconds).toBe(0);
  });
});

describe('describeTimer', () => {
  it('says so when there is no timer', () => {
    expect(describeTimer(null, at(START))).toBe('No timer running.');
  });

  it('uses singular units for a single minute and second', () => {
    expect(describeTimer(session({ accumulated_seconds: 61 }), at(START))).toBe(
      'Focus session running, 1 minute and 1 second elapsed.',
    );
  });

  it('names the kind and the state', () => {
    expect(
      describeTimer(session({ status: 'paused', kind: 'two_minute', accumulated_seconds: 120 }), at(START)),
    ).toBe('Two-minute start paused, 2 minutes and 0 seconds elapsed.');
    expect(describeTimer(session({ kind: 'break', accumulated_seconds: 0 }), at(START))).toBe(
      'Break running, 0 minutes and 0 seconds elapsed.',
    );
  });
});

describe('session state', () => {
  it('treats running and paused as open, and finished states as closed', () => {
    expect(isOpen({ status: 'running' })).toBe(true);
    expect(isOpen({ status: 'paused' })).toBe(true);
    expect(isOpen({ status: 'completed' })).toBe(false);
    expect(isOpen({ status: 'abandoned' })).toBe(false);
    expect(isRunning({ status: 'paused' })).toBe(false);
  });

  it('adds up the tracked time of several sessions', () => {
    const sessions = [
      session({ status: 'completed', accumulated_seconds: 600 }),
      session({ accumulated_seconds: 600, last_resumed_at: '2025-01-15T09:10:00.000Z' }),
    ];
    expect(totalActiveSeconds(sessions, at('2025-01-15T09:10:30.000Z'))).toBe(1230);
    expect(totalActiveSeconds([], at(START))).toBe(0);
  });
});

describe('suggestNextStep', () => {
  it('treats an unfinished two-minute attempt as a wrap-up, not a failure', () => {
    expect(suggestNextStep(TWO_MINUTE_SECONDS - 1, 'two_minute')).toBe('wrap-up');
    expect(suggestNextStep(TWO_MINUTE_SECONDS, 'two_minute')).toBe('continue');
  });

  it('offers a break before the fifty-minute mark and a wrap-up after it', () => {
    expect(suggestNextStep(49 * 60, 'focus')).toBe('break');
    expect(suggestNextStep(50 * 60, 'focus')).toBe('wrap-up');
  });
});
