import type { DayKey, TimeString } from './time';
import { MINUTES_PER_DAY, combineLocalDateTime, instantToLocalMinutes } from './time';
import type { SessionKind, TaskSessionRow } from '@/lib/types/database';

/**
 * Turning stored records into drawable time.
 *
 * Two jobs live here, and both exist so that the timeline shows what was
 * *recorded* rather than what was planned:
 *
 *   · Reconstructing the intervals a timer was actually running. A session is
 *     stored as a start, an accumulated total and a list of pause rows, so the
 *     intervals have to be rebuilt from those four facts rather than read off a
 *     counter. Pause rows are written by `rpc_pause_session` and closed by
 *     `rpc_resume_session`, so a pause with a null `resumed_at` really does mean
 *     "still paused".
 *   · Packing blocks into lanes so overlapping work is visible as overlap
 *     instead of being drawn on top of itself.
 */

/* ── Session intervals ──────────────────────────────────────────────────── */

export interface PauseRow {
  session_id: string;
  paused_at: string;
  resumed_at: string | null;
}

export interface SessionInterval {
  sessionId: string;
  taskId: string | null;
  kind: SessionKind;
  status: TaskSessionRow['status'];
  start: Date;
  end: Date;
  /** Whole seconds covered by this interval. */
  seconds: number;
  /** Still elapsing right now, i.e. its end is the current clock. */
  isOpen: boolean;
}

/**
 * The intervals during which a timer was genuinely running.
 *
 * The reconstruction is deliberately conservative: every interval is clamped to
 * `[started_at, ended_at ?? now]`, and a pause that begins before the previous
 * interval ended cannot create a negative-length block. Tracked time can
 * therefore never be inflated by a clock that moves backwards.
 */
export function sessionIntervals(
  session: Pick<
    TaskSessionRow,
    'id' | 'task_id' | 'kind' | 'status' | 'started_at' | 'ended_at' | 'last_resumed_at'
  >,
  pauses: PauseRow[],
  now: Date,
): SessionInterval[] {
  const start = new Date(session.started_at);
  const hardEnd = session.ended_at ? new Date(session.ended_at) : now;
  if (!Number.isFinite(start.getTime()) || hardEnd.getTime() <= start.getTime()) return [];

  const ordered = pauses
    .filter((pause) => pause.session_id === session.id)
    .map((pause) => ({ pausedAt: new Date(pause.paused_at), resumedAt: pause.resumed_at ? new Date(pause.resumed_at) : null }))
    .filter((pause) => Number.isFinite(pause.pausedAt.getTime()))
    .sort((a, b) => a.pausedAt.getTime() - b.pausedAt.getTime());

  const out: SessionInterval[] = [];
  let cursor = start;

  const push = (from: Date, to: Date): void => {
    const fromMs = Math.max(from.getTime(), start.getTime());
    const toMs = Math.min(to.getTime(), hardEnd.getTime());
    if (toMs <= fromMs) return;
    out.push({
      sessionId: session.id,
      taskId: session.task_id,
      kind: session.kind,
      status: session.status,
      start: new Date(fromMs),
      end: new Date(toMs),
      seconds: Math.floor((toMs - fromMs) / 1000),
      isOpen: !session.ended_at && session.status === 'running' && toMs === hardEnd.getTime(),
    });
  };

  for (const pause of ordered) {
    push(cursor, pause.pausedAt);
    // A pause with no resume is the end of the session's active life.
    cursor = pause.resumedAt ?? hardEnd;
    if (cursor.getTime() >= hardEnd.getTime()) return out;
  }

  push(cursor, hardEnd);
  return out;
}

export function intervalsForSessions(
  sessions: Array<
    Pick<
      TaskSessionRow,
      'id' | 'task_id' | 'kind' | 'status' | 'started_at' | 'ended_at' | 'last_resumed_at'
    >
  >,
  pauses: PauseRow[],
  now: Date,
): SessionInterval[] {
  return sessions
    .flatMap((session) => sessionIntervals(session, pauses, now))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Merges touching or overlapping intervals of the same kind.
 *
 * Used for the "actual" band so that pausing for ten seconds does not draw a
 * hairline gap in what was, in practice, one continuous stretch of work.
 */
export function mergeIntervals<T extends { start: Date; end: Date; seconds: number }>(
  intervals: T[],
  maxGapSeconds = 120,
): Array<{ start: Date; end: Date; seconds: number }> {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Array<{ start: Date; end: Date; seconds: number }> = [];

  for (const interval of sorted) {
    const last = out[out.length - 1];
    if (last && interval.start.getTime() - last.end.getTime() <= maxGapSeconds * 1000) {
      if (interval.end.getTime() > last.end.getTime()) last.end = interval.end;
      last.seconds += interval.seconds;
      continue;
    }
    out.push({ start: interval.start, end: interval.end, seconds: interval.seconds });
  }

  return out;
}

/* ── Placement on a 24-hour column ──────────────────────────────────────── */

export interface TimelineBlock {
  key: string;
  /** Percentage from the top of the 24-hour column. */
  topPercent: number;
  heightPercent: number;
  /** 0-based lane, and how many lanes the whole column needs. */
  lane: number;
  laneCount: number;
  startMinutes: number;
  endMinutes: number;
}

export interface PlaceableInput {
  key: string;
  start: Date;
  end: Date;
}

/**
 * Places blocks in a 24-hour column, giving overlapping blocks their own lanes.
 *
 * Lane assignment is greedy by start time, which keeps a block from moving
 * between renders as long as the data has not changed — important for a
 * component that re-renders every second while a timer runs.
 */
export function placeOnTimeline(
  items: PlaceableInput[],
  timeZone: string,
  options: { minHeightPercent?: number } = {},
): Map<string, TimelineBlock> {
  const { minHeightPercent = 0.7 } = options;

  const prepared = items
    .map((item) => {
      const startMinutes = clampMinutes(instantToLocalMinutes(item.start, timeZone));
      const rawEnd = startMinutes + (item.end.getTime() - item.start.getTime()) / 60_000;
      // An event running past midnight is drawn to the end of the column rather
      // than wrapping around, because a wrapped block reads as a second event.
      const endMinutes = Math.min(MINUTES_PER_DAY, Math.max(startMinutes + 8, Math.round(rawEnd)));
      return { ...item, startMinutes, endMinutes };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

  // Group into clusters of mutually overlapping blocks; lane counts are per
  // cluster, so one busy morning does not narrow a quiet afternoon.
  const placed: Array<{ key: string; startMinutes: number; endMinutes: number; lane: number }> = [];
  const laneCounts = new Map<string, number>();
  let clusterStart = -1;
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  let clusterMembers: Array<{ key: string; startMinutes: number; endMinutes: number; lane: number }> = [];

  const flushCluster = () => {
    const laneCount = Math.max(1, laneEnds.length);
    for (const member of clusterMembers) {
      placed.push(member);
      laneCounts.set(member.key, laneCount);
    }
    clusterMembers = [];
    laneEnds = [];
    clusterStart = -1;
    clusterEnd = -1;
  };

  for (const item of prepared) {
    if (clusterStart === -1 || item.startMinutes >= clusterEnd) {
      flushCluster();
      clusterStart = item.startMinutes;
      clusterEnd = item.endMinutes;
    } else {
      clusterEnd = Math.max(clusterEnd, item.endMinutes);
    }

    let lane = laneEnds.findIndex((end) => end <= item.startMinutes);
    if (lane === -1) {
      laneEnds.push(item.endMinutes);
      lane = laneEnds.length - 1;
    } else {
      laneEnds[lane] = item.endMinutes;
    }

    clusterMembers.push({
      key: item.key,
      startMinutes: item.startMinutes,
      endMinutes: item.endMinutes,
      lane,
    });
  }
  flushCluster();

  const out = new Map<string, TimelineBlock>();
  for (const block of placed) {
    const heightPercent = Math.max(
      minHeightPercent,
      ((block.endMinutes - block.startMinutes) / MINUTES_PER_DAY) * 100,
    );
    out.set(block.key, {
      key: block.key,
      topPercent: (block.startMinutes / MINUTES_PER_DAY) * 100,
      heightPercent,
      lane: block.lane,
      laneCount: laneCounts.get(block.key) ?? 1,
      startMinutes: block.startMinutes,
      endMinutes: block.endMinutes,
    });
  }

  return out;
}

function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.min(MINUTES_PER_DAY, Math.max(0, Math.round(minutes)));
}

/* ── Planned vs actual comparison ───────────────────────────────────────── */

export interface PlannedBlock {
  key: string;
  title: string;
  day: DayKey;
  startTime: TimeString;
  minutes: number;
}

export interface IntervalCoverage {
  /** Minutes of the planned block that have actually been worked on. */
  coveredMinutes: number;
  /** Minutes worked outside every planned block. */
  unplannedMinutes: number;
  plannedMinutes: number;
}

/**
 * How much of the plan was actually covered.
 *
 * Deliberately reports unplanned time as well: an hour of genuine work that
 * happened outside the schedule is real work, and a metric that only measured
 * adherence would train the user to hide it.
 */
export function coverage(
  planned: PlannedBlock[],
  actual: SessionInterval[],
  timeZone: string,
): IntervalCoverage {
  const plannedMinutes = planned.reduce((sum, block) => sum + block.minutes, 0);

  const plannedWindows = planned.map((block) => {
    const start = combineLocalDateTime(block.day, block.startTime, timeZone);
    return { startMinutes: instantToLocalMinutes(start, timeZone), minutes: block.minutes };
  });

  const actualWindows = actual.map((interval) => {
    const startMinutes = instantToLocalMinutes(interval.start, timeZone);
    const endMinutes = instantToLocalMinutes(interval.end, timeZone);
    return {
      startMinutes,
      // An interval whose end reads earlier than its start has crossed
      // midnight; it is counted up to the end of the day.
      endMinutes: endMinutes <= startMinutes ? MINUTES_PER_DAY : endMinutes,
    };
  });

  let coveredMinutes = 0;
  let unplannedMinutes = 0;

  for (const window of actualWindows) {
    let covered = 0;
    for (const target of plannedWindows) {
      const overlap = Math.max(
        0,
        Math.min(window.endMinutes, target.startMinutes + target.minutes) -
          Math.max(window.startMinutes, target.startMinutes),
      );
      covered += overlap;
    }
    const duration = Math.max(0, window.endMinutes - window.startMinutes);
    coveredMinutes += Math.min(covered, duration);
    unplannedMinutes += Math.max(0, duration - covered);
  }

  return { coveredMinutes, unplannedMinutes, plannedMinutes };
}

/**
 * The current-time indicator's position, as a percentage down the column.
 * Returns `null` when the reference instant is not on the day being drawn.
 */
export function nowMarkerPercent(
  now: Date,
  day: DayKey,
  timeZone: string,
  dayKeyOf: (instant: Date, timeZone: string) => DayKey,
): number | null {
  if (dayKeyOf(now, timeZone) !== day) return null;
  return (instantToLocalMinutes(now, timeZone) / MINUTES_PER_DAY) * 100;
}
