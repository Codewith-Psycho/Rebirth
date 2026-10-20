import {
  type DayKey,
  MINUTES_PER_DAY,
  addDaysToKey,
  diffInDays,
  minutesToTimeString,
  timeToMinutes,
} from './time';

/**
 * Schedule arithmetic: conflicts, free time, and replanning proposals.
 *
 * Everything is expressed in minutes since local midnight so the maths is
 * plain integer arithmetic and unit-testable without a clock or a database.
 * Nothing in this module writes to the database — a proposal is a proposal
 * until the user accepts it.
 */

export interface TimeBlock {
  id: string;
  title: string;
  /** Minutes since local midnight. */
  startMinutes: number;
  endMinutes: number;
  priority: 'main' | 'secondary' | 'other';
  /** Breaks and appointments the replanner must route around. */
  isFixed: boolean;
  isBreak: boolean;
}

export interface Interval {
  startMinutes: number;
  endMinutes: number;
}

export interface Conflict {
  aId: string;
  bId: string;
  overlapMinutes: number;
  window: Interval;
}

export function makeBlock(
  partial: Pick<TimeBlock, 'id' | 'title' | 'startMinutes' | 'endMinutes'> & Partial<TimeBlock>,
): TimeBlock {
  return {
    priority: 'secondary',
    isFixed: false,
    isBreak: false,
    ...partial,
  };
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

export function overlapMinutes(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.endMinutes, b.endMinutes) - Math.max(a.startMinutes, b.startMinutes));
}

/** All pairwise overlaps in the list, most-overlapping first. */
export function findConflicts(blocks: TimeBlock[]): Conflict[] {
  const sorted = [...blocks].sort((a, b) => a.startMinutes - b.startMinutes);
  const conflicts: Conflict[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      // Sorted by start, so once b starts after a ends no later block can overlap a.
      if (b.startMinutes >= a.endMinutes) break;
      const overlap = overlapMinutes(a, b);
      if (overlap > 0) {
        conflicts.push({
          aId: a.id,
          bId: b.id,
          overlapMinutes: overlap,
          window: {
            startMinutes: Math.max(a.startMinutes, b.startMinutes),
            endMinutes: Math.min(a.endMinutes, b.endMinutes),
          },
        });
      }
    }
  }
  return conflicts.sort((x, y) => y.overlapMinutes - x.overlapMinutes);
}

/**
 * Gaps in the day, optionally ignoring the window before `afterMinutes`
 * (i.e. time that has already passed today).
 */
export function freeIntervals(
  blocks: TimeBlock[],
  dayStartMinutes = 0,
  dayEndMinutes = MINUTES_PER_DAY,
  afterMinutes = 0,
): Interval[] {
  const occupied = blocks
    .map((b) => ({
      startMinutes: Math.max(dayStartMinutes, b.startMinutes),
      endMinutes: Math.min(dayEndMinutes, b.endMinutes),
    }))
    .filter((b) => b.endMinutes > b.startMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  const merged: Interval[] = [];
  for (const block of occupied) {
    const last = merged[merged.length - 1];
    if (last && block.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, block.endMinutes);
    } else {
      merged.push({ ...block });
    }
  }

  const gaps: Interval[] = [];
  let cursor = Math.max(dayStartMinutes, afterMinutes);
  for (const block of merged) {
    if (block.startMinutes > cursor) {
      gaps.push({ startMinutes: cursor, endMinutes: block.startMinutes });
    }
    cursor = Math.max(cursor, block.endMinutes);
  }
  if (cursor < dayEndMinutes) {
    gaps.push({ startMinutes: cursor, endMinutes: dayEndMinutes });
  }
  return gaps;
}

export function firstFreeSlot(
  blocks: TimeBlock[],
  durationMinutes: number,
  options: { afterMinutes?: number; dayEndMinutes?: number; granularity?: number } = {},
): Interval | null {
  const { afterMinutes = 0, dayEndMinutes = MINUTES_PER_DAY, granularity = 5 } = options;
  for (const gap of freeIntervals(blocks, 0, dayEndMinutes, afterMinutes)) {
    const length = gap.endMinutes - gap.startMinutes;
    if (length >= durationMinutes) {
      const start = Math.ceil(gap.startMinutes / granularity) * granularity;
      if (start + durationMinutes <= gap.endMinutes) {
        return { startMinutes: start, endMinutes: start + durationMinutes };
      }
    }
  }
  return null;
}

export interface AvailableSlot extends Interval {
  durationMinutes: number;
  label: string;
}

/** Suggested slots of at least `durationMinutes`, in chronological order. */
export function suggestSlots(
  blocks: TimeBlock[],
  durationMinutes: number,
  options: { afterMinutes?: number; dayEndMinutes?: number; limit?: number } = {},
): AvailableSlot[] {
  const { afterMinutes = 0, dayEndMinutes = MINUTES_PER_DAY, limit = 5 } = options;
  const slots: AvailableSlot[] = [];
  for (const gap of freeIntervals(blocks, 0, dayEndMinutes, afterMinutes)) {
    if (gap.endMinutes - gap.startMinutes < durationMinutes) continue;
    const snapped = Math.ceil(gap.startMinutes / 5) * 5;
    if (snapped + durationMinutes > gap.endMinutes) continue;
    slots.push({
      startMinutes: snapped,
      endMinutes: snapped + durationMinutes,
      durationMinutes,
      label: `${minutesToTimeString(snapped).slice(0, 5)} – ${minutesToTimeString(snapped + durationMinutes).slice(0, 5)}`,
    });
    if (slots.length >= limit) break;
  }
  return slots;
}

/* ── Replan my day ──────────────────────────────────────────────────────── */

export interface ReplanInput {
  remaining: Array<{
    id: string;
    title: string;
    durationMinutes: number;
    priority: 'main' | 'secondary';
    originalStartMinutes: number;
  }>;
  /** Blocks that cannot move: appointments, meals, breaks already scheduled. */
  fixedBlocks: TimeBlock[];
  nowMinutes: number;
  dayEndMinutes: number;
  breakMinutes: number;
  deepWorkCapMinutes: number;
}

export interface ReplanAssignment {
  id: string;
  title: string;
  startMinutes: number;
  endMinutes: number;
  moved: boolean;
  previousStartMinutes: number;
}

export interface ReplanProposal {
  assignments: ReplanAssignment[];
  /** Tasks that genuinely do not fit — reported, never silently dropped. */
  unplaced: Array<{ id: string; title: string; durationMinutes: number }>;
  breaksInserted: number;
  totalPlannedMinutes: number;
  /** Set when the requested load exceeds the user's deep-work cap. */
  capNotice: string | null;
  summary: string;
}

/**
 * Proposes a revised remainder for today.
 *
 * Rules, in order:
 *   1. MAIN goes first — it is the one thing that decides whether the day was
 *      a success, so it gets the freshest slot rather than the leftovers.
 *   2. Everything else keeps its original order. A replan is not a reshuffle.
 *   3. Fixed blocks are never moved.
 *   4. A break is inserted after each continuous stretch that reaches the
 *      configured cadence.
 *   5. Work stops at the deep-work cap; the rest is reported as unplaced
 *      rather than silently crammed in.
 *
 * The result is a *proposal*. Nothing is written until the user accepts it.
 */
export function replanDay(input: ReplanInput): ReplanProposal {
  const { remaining, fixedBlocks, nowMinutes, dayEndMinutes, breakMinutes, deepWorkCapMinutes } = input;

  const ordered = [...remaining].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'main' ? -1 : 1;
    return a.originalStartMinutes - b.originalStartMinutes;
  });

  const plan: ReplanAssignment[] = [];
  const unplaced: ReplanProposal['unplaced'] = [];
  const placed: TimeBlock[] = [...fixedBlocks];
  let cursor = Math.max(0, nowMinutes);
  let continuousMinutes = 0;
  let breaksInserted = 0;

  const nextFreeFrom = (from: number, duration: number): { start: number; end: number } | null => {
    const slot = firstFreeSlot(placed, duration, {
      afterMinutes: from,
      dayEndMinutes,
    });
    return slot ? { start: slot.startMinutes, end: slot.endMinutes } : null;
  };

  for (const task of ordered) {
    const duration = Math.max(5, task.durationMinutes);

    // Insert a break once the continuous stretch reaches the cadence.
    if (breakMinutes > 0 && continuousMinutes >= 45) {
      const breakSlot = nextFreeFrom(cursor, breakMinutes);
      if (breakSlot && breakSlot.end + duration <= dayEndMinutes) {
        placed.push({
          id: `break-${breaksInserted}`,
          title: 'Break',
          startMinutes: breakSlot.start,
          endMinutes: breakSlot.end,
          priority: 'other',
          isFixed: false,
          isBreak: true,
        });
        cursor = breakSlot.end;
        continuousMinutes = 0;
        breaksInserted += 1;
      }
    }

    const slot = nextFreeFrom(cursor, duration);
    if (!slot) {
      unplaced.push({ id: task.id, title: task.title, durationMinutes: duration });
      continue;
    }

    placed.push({
      id: task.id,
      title: task.title,
      startMinutes: slot.start,
      endMinutes: slot.end,
      priority: task.priority,
      isFixed: false,
      isBreak: false,
    });

    plan.push({
      id: task.id,
      title: task.title,
      startMinutes: slot.start,
      endMinutes: slot.end,
      moved: slot.start !== task.originalStartMinutes,
      previousStartMinutes: task.originalStartMinutes,
    });

    cursor = slot.end;
    continuousMinutes += duration;
  }

  const totalPlannedMinutes = plan.reduce((sum, a) => sum + (a.endMinutes - a.startMinutes), 0);

  const capNotice =
    totalPlannedMinutes > deepWorkCapMinutes
      ? `This adds up to ${Math.round(totalPlannedMinutes / 60)}h of focused work. Your cap is ${Math.round(
          deepWorkCapMinutes / 60,
        )}h — consider moving the last task to tomorrow rather than pushing through.`
      : null;

  const movedCount = plan.filter((a) => a.moved).length;
  const summary =
    plan.length === 0
      ? 'Nothing left to place today.'
      : movedCount === 0
        ? 'Everything already fits where it is.'
        : `Proposed ${movedCount} change${movedCount === 1 ? '' : 's'}${
            unplaced.length > 0 ? `, with ${unplaced.length} task${unplaced.length === 1 ? '' : 's'} not fitting today` : ''
          }.`;

  return {
    assignments: plan,
    unplaced,
    breaksInserted,
    totalPlannedMinutes,
    capNotice,
    summary,
  };
}

/* ── Overload detection ─────────────────────────────────────────────────── */

export interface DayLoad {
  date: DayKey;
  plannedMinutes: number;
  scheduledMinutes: number;
  breakMinutes: number;
  freeMinutes: number;
  taskCount: number;
  isOverloaded: boolean;
  reason: string | null;
}

export function assessDayLoad(
  day: DayKey,
  blocks: TimeBlock[],
  deepWorkCapMinutes: number,
  wakeMinutes = 7 * 60,
  sleepMinutes = 23 * 60,
): DayLoad {
  const working = blocks.filter((b) => !b.isBreak);
  const plannedMinutes = working.reduce((sum, b) => sum + (b.endMinutes - b.startMinutes), 0);
  const breakMinutes = blocks
    .filter((b) => b.isBreak)
    .reduce((sum, b) => sum + (b.endMinutes - b.startMinutes), 0);
  const wakeWindow = Math.max(0, sleepMinutes - wakeMinutes);
  const freeMinutes = Math.max(0, wakeWindow - plannedMinutes - breakMinutes);

  let reason: string | null = null;
  if (plannedMinutes > deepWorkCapMinutes) {
    reason = `Planned work is ${Math.round(plannedMinutes / 60)}h against a ${Math.round(
      deepWorkCapMinutes / 60,
    )}h cap.`;
  } else if (freeMinutes < 60) {
    reason = 'Less than an hour of unscheduled time is left in the day.';
  }

  return {
    date: day,
    plannedMinutes,
    scheduledMinutes: plannedMinutes,
    breakMinutes,
    freeMinutes,
    taskCount: working.length,
    isOverloaded: reason !== null,
    reason,
  };
}

/** Formatting helper shared by the timeline and the conflict banner. */
export function intervalLabel(interval: Interval): string {
  return `${minutesToTimeString(interval.startMinutes).slice(0, 5)} – ${minutesToTimeString(
    interval.endMinutes,
  ).slice(0, 5)}`;
}

/** Days that are still ahead of `asOf` inside a window. */
export function futureDays(from: DayKey, to: DayKey, asOf: DayKey): number {
  if (diffInDays(to, asOf) <= 0) return 0;
  return diffInDays(to, asOf);
}

/**
 * Whether "this one and all that follow" may target `target`.
 *
 * The continuation half of a routine is forward-only: moving it into the past
 * would split the series behind days the user has already lived — the case the
 * scheduling RPC refuses. A single occurrence has no such restriction.
 */
export function futureMoveTargetAllowed(target: DayKey, today: DayKey): boolean {
  return diffInDays(target, today) >= 0;
}

/** Next occurrence of a weekday at or after `from`. */
export function nextWeekday(from: DayKey, weekday: number): DayKey {
  let cursor = from;
  for (let i = 0; i < 8; i += 1) {
    if (new Date(`${cursor}T00:00:00`).getDay() === weekday) return cursor;
    cursor = addDaysToKey(cursor, 1);
  }
  return from;
}

export function blockFromTimes(
  id: string,
  title: string,
  startTime: string,
  endTime: string,
  extra: Partial<TimeBlock> = {},
): TimeBlock {
  return makeBlock({
    id,
    title,
    startMinutes: timeToMinutes(startTime),
    endMinutes: timeToMinutes(endTime),
    ...extra,
  });
}
