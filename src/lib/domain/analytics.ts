import type {
  CategoryKind,
  DailyEnergyLogRow,
  EnergySlot,
  GoalProgressViewRow,
  ScheduledTaskRow,
  SessionKind,
  SessionStatus,
  TaskActualsViewRow,
  TaskPriority,
  TaskSessionRow,
  TaskStatus,
  TaskTemplateRow,
} from '@/lib/types/database';
import {
  type DayKey,
  addDaysToKey,
  dayKeyOf,
  diffInDays,
  eachDayKey,
  elapsedDaysIn,
  startOfWeekKey,
} from './time';

/**
 * Analytics.
 *
 * Every number the dashboard shows is computed here, from raw records, by a
 * pure function. No statistic is stored, cached into a column, or synthesised
 * to make an empty account look busy.
 *
 * The module deliberately refuses to produce a single "productivity score".
 * Consistency, effort and mastery are separate measurements and stay separate.
 */

export interface TaskFact {
  id: string;
  day: DayKey;
  status: TaskStatus;
  priority: TaskPriority;
  category: CategoryKind;
  durationMinutes: number;
  goalId: string | null;
  templateId: string | null;
  title: string;
  rescheduledFromDay: DayKey | null;
}

export interface SessionFact {
  id: string;
  taskId: string | null;
  kind: SessionKind;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  lastResumedAt: string | null;
  accumulatedSeconds: number;
}

export function toTaskFact(row: ScheduledTaskRow): TaskFact {
  return {
    id: row.id,
    day: row.scheduled_date,
    status: row.status,
    priority: row.priority,
    category: row.category,
    durationMinutes: row.duration_minutes,
    goalId: row.goal_id,
    templateId: row.template_id,
    title: row.title,
    rescheduledFromDay: row.rescheduled_from_date,
  };
}

export function toSessionFact(row: TaskSessionRow): SessionFact {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastResumedAt: row.last_resumed_at,
    accumulatedSeconds: row.accumulated_seconds,
  };
}

/** Active seconds for a session fact at `now`; mirrors the SQL function. */
export function sessionActiveSeconds(fact: SessionFact, now: Date): number {
  const base = Math.max(0, fact.accumulatedSeconds);
  if (fact.status !== 'running' || fact.lastResumedAt === null) return base;
  const openMs = now.getTime() - new Date(fact.lastResumedAt).getTime();
  if (!Number.isFinite(openMs) || openMs <= 0) return base;
  return base + Math.floor(openMs / 1000);
}

export function isCountedSession(fact: SessionFact): boolean {
  return fact.status === 'completed' || fact.status === 'abandoned';
}

/* ── Consistency ────────────────────────────────────────────────────────── */

export interface ConsistencyResult {
  /** `null` when nothing was due — never a misleading 0%. */
  score: number | null;
  completed: number;
  eligible: number;
  cancelled: number;
  notYetDue: number;
  /** Shown verbatim in the UI so the metric is never a black box. */
  definition: string;
}

export const CONSISTENCY_DEFINITION =
  'Completed scheduled tasks ÷ tasks that were due, × 100. Cancelled tasks are removed from the denominator; tasks due after today are excluded. Tracked focus time is reported separately.';

export function consistency(
  tasks: TaskFact[],
  from: DayKey,
  to: DayKey,
  asOf: DayKey,
): ConsistencyResult {
  let completed = 0;
  let eligible = 0;
  let cancelled = 0;
  let notYetDue = 0;

  for (const task of tasks) {
    if (diffInDays(task.day, from) < 0 || diffInDays(task.day, to) > 0) continue;
    if (task.status === 'cancelled') {
      cancelled += 1;
      continue;
    }
    if (diffInDays(task.day, asOf) > 0) {
      notYetDue += 1;
      continue;
    }
    eligible += 1;
    if (task.status === 'completed') completed += 1;
  }

  return {
    score: eligible === 0 ? null : Math.round((completed / eligible) * 1000) / 10,
    completed,
    eligible,
    cancelled,
    notYetDue,
    definition: CONSISTENCY_DEFINITION,
  };
}

/* ── Daily series ───────────────────────────────────────────────────────── */

export interface DailySeriesPoint {
  day: DayKey;
  label: string;
  planned: number;
  completed: number;
  skipped: number;
  cancelled: number;
  open: number;
  plannedMinutes: number;
}

export function completionByDay(tasks: TaskFact[], from: DayKey, to: DayKey): DailySeriesPoint[] {
  const index = new Map<DayKey, DailySeriesPoint>();
  for (const day of eachDayKey(from, to)) {
    index.set(day, {
      day,
      label: shortLabel(day),
      planned: 0,
      completed: 0,
      skipped: 0,
      cancelled: 0,
      open: 0,
      plannedMinutes: 0,
    });
  }

  for (const task of tasks) {
    const point = index.get(task.day);
    if (!point) continue;
    point.planned += 1;
    point.plannedMinutes += task.durationMinutes;
    if (task.status === 'completed') point.completed += 1;
    else if (task.status === 'skipped') point.skipped += 1;
    else if (task.status === 'cancelled') point.cancelled += 1;
    else point.open += 1;
  }

  return [...index.values()];
}

export interface FocusPoint {
  day: DayKey;
  label: string;
  minutes: number;
  breakMinutes: number;
  sessions: number;
  twoMinuteAttempts: number;
}

/**
 * Focus time bucketed by the day the work *actually happened*, not the day it
 * was planned for. A session you ran at 23:40 on Tuesday counts on Tuesday.
 */
export function focusMinutesByDay(
  sessions: SessionFact[],
  timeZone: string,
  from: DayKey,
  to: DayKey,
  now: Date,
): FocusPoint[] {
  const index = new Map<DayKey, FocusPoint>();
  for (const day of eachDayKey(from, to)) {
    index.set(day, { day, label: shortLabel(day), minutes: 0, breakMinutes: 0, sessions: 0, twoMinuteAttempts: 0 });
  }

  for (const session of sessions) {
    if (!isCountedSession(session)) continue;
    // Attribute the session to the first instant that belongs to it, so a long
    // session beginning before midnight is not split across two buckets.
    const day = dayKeyOf(session.startedAt, timeZone);
    const point = index.get(day);
    if (!point) continue;

    const seconds = sessionActiveSeconds(session, now);
    if (session.kind === 'break') {
      point.breakMinutes += Math.round(seconds / 60);
      continue;
    }
    point.minutes += Math.round(seconds / 60);
    point.sessions += 1;
    if (session.kind === 'two_minute') point.twoMinuteAttempts += 1;
  }

  return [...index.values()];
}

/* ── Planned vs actual ──────────────────────────────────────────────────── */

export interface PlannedVsActual {
  plannedMinutes: number;
  actualMinutes: number;
  breakMinutes: number;
  /** actual ÷ planned, clamped to 2 for chart sanity. `null` when nothing planned. */
  ratio: number | null;
  differenceMinutes: number;
  tasksPlanned: number;
  tasksCompleted: number;
}

export function plannedVsActual(
  tasks: TaskFact[],
  sessions: SessionFact[],
  from: DayKey,
  to: DayKey,
  now: Date,
): PlannedVsActual {
  const inWindow = tasks.filter(
    (t) => diffInDays(t.day, from) >= 0 && diffInDays(t.day, to) <= 0 && t.status !== 'cancelled',
  );
  const ids = new Set(inWindow.map((t) => t.id));

  let actualSeconds = 0;
  let breakSeconds = 0;
  for (const session of sessions) {
    if (!isCountedSession(session)) continue;
    if (session.taskId === null || !ids.has(session.taskId)) continue;
    const seconds = sessionActiveSeconds(session, now);
    if (session.kind === 'break') breakSeconds += seconds;
    else actualSeconds += seconds;
  }

  const plannedMinutes = inWindow.reduce((sum, t) => sum + t.durationMinutes, 0);
  const actualMinutes = Math.round(actualSeconds / 60);

  return {
    plannedMinutes,
    actualMinutes,
    breakMinutes: Math.round(breakSeconds / 60),
    ratio: plannedMinutes === 0 ? null : Math.min(2, Math.round((actualMinutes / plannedMinutes) * 100) / 100),
    differenceMinutes: actualMinutes - plannedMinutes,
    tasksPlanned: inWindow.length,
    tasksCompleted: inWindow.filter((t) => t.status === 'completed').length,
  };
}

/* ── Category allocation ────────────────────────────────────────────────── */

export interface CategorySlice {
  category: CategoryKind;
  actualMinutes: number;
  plannedMinutes: number;
  taskCount: number;
  completedCount: number;
  share: number;
}

export function categoryAllocation(
  tasks: TaskFact[],
  actualsByTask: Map<string, number>,
  from: DayKey,
  to: DayKey,
): CategorySlice[] {
  const buckets = new Map<CategoryKind, CategorySlice>();

  for (const task of tasks) {
    if (diffInDays(task.day, from) < 0 || diffInDays(task.day, to) > 0) continue;
    if (task.status === 'cancelled') continue;
    const bucket = buckets.get(task.category) ?? {
      category: task.category,
      actualMinutes: 0,
      plannedMinutes: 0,
      taskCount: 0,
      completedCount: 0,
      share: 0,
    };
    bucket.taskCount += 1;
    bucket.plannedMinutes += task.durationMinutes;
    bucket.actualMinutes += Math.round((actualsByTask.get(task.id) ?? 0) / 60);
    if (task.status === 'completed') bucket.completedCount += 1;
    buckets.set(task.category, bucket);
  }

  const slices = [...buckets.values()];
  const totalActual = slices.reduce((sum, s) => sum + s.actualMinutes, 0);
  for (const slice of slices) {
    slice.share = totalActual === 0 ? 0 : Math.round((slice.actualMinutes / totalActual) * 1000) / 10;
  }
  return slices.sort((a, b) => b.actualMinutes - a.actualMinutes);
}

export function actualsByTaskMap(rows: TaskActualsViewRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.task_id, row.active_seconds);
  return map;
}

/* ── Energy ─────────────────────────────────────────────────────────────── */

export interface EnergyPoint {
  day: DayKey;
  label: string;
  morning: number | null;
  afternoon: number | null;
  evening: number | null;
  average: number | null;
}

export function energySeries(logs: DailyEnergyLogRow[], from: DayKey, to: DayKey): EnergyPoint[] {
  const index = new Map<DayKey, EnergyPoint>();
  for (const day of eachDayKey(from, to)) {
    index.set(day, { day, label: shortLabel(day), morning: null, afternoon: null, evening: null, average: null });
  }

  for (const log of logs) {
    const point = index.get(log.log_date);
    if (!point) continue;
    point[log.slot as EnergySlot] = log.level;
  }

  for (const point of index.values()) {
    const values = [point.morning, point.afternoon, point.evening].filter(
      (v): v is number => typeof v === 'number',
    );
    point.average =
      values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  }

  return [...index.values()];
}

export function averageEnergyBySlot(logs: DailyEnergyLogRow[]): Record<EnergySlot, number | null> {
  const result: Record<EnergySlot, number | null> = { morning: null, afternoon: null, evening: null };
  for (const slot of ['morning', 'afternoon', 'evening'] as EnergySlot[]) {
    const values = logs.filter((l) => l.slot === slot).map((l) => l.level);
    result[slot] =
      values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  }
  return result;
}

/* ── Focus by hour of day ───────────────────────────────────────────────── */

export interface HourBucket {
  hour: number;
  label: string;
  minutes: number;
}

export function focusByHour(
  sessions: SessionFact[],
  timeZone: string,
  from: DayKey,
  to: DayKey,
  now: Date,
): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}`,
    minutes: 0,
  }));

  for (const session of sessions) {
    if (!isCountedSession(session) || session.kind === 'break') continue;
    const day = dayKeyOf(session.startedAt, timeZone);
    if (diffInDays(day, from) < 0 || diffInDays(day, to) > 0) continue;
    const hour = hourInZone(session.startedAt, timeZone);
    const bucket = buckets[hour];
    if (!bucket) continue;
    bucket.minutes += Math.round(sessionActiveSeconds(session, now) / 60);
  }

  return buckets;
}

function hourInZone(instant: string, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(new Date(instant));
  const parsed = Number.parseInt(formatted, 10);
  return Number.isFinite(parsed) ? (parsed === 24 ? 0 : parsed) : 0;
}

/* ── Comparisons — always against the user's own history ────────────────── */

export interface Comparison {
  key: string;
  label: string;
  current: number;
  previous: number;
  delta: number;
  /** Gentle, non-evaluative phrasing. Never a judgement. */
  message: string;
  unit: 'minutes' | 'tasks' | 'percent';
}

export function buildComparisons(current: WeekAggregate, previous: WeekAggregate): Comparison[] {
  return [
    compare(
      'focus',
      'Focus time',
      current.focusMinutes,
      previous.focusMinutes,
      'minutes',
      (d) => (d >= 0 ? `${d} more minutes of focus than last week.` : `${Math.abs(d)} fewer minutes than last week.`),
      'No comparison yet — this is your first week with tracked focus time.',
    ),
    compare(
      'completed',
      'Tasks completed',
      current.tasksCompleted,
      previous.tasksCompleted,
      'tasks',
      (d) =>
        d >= 0
          ? `You completed ${d} more task${d === 1 ? '' : 's'} than last week.`
          : `${Math.abs(d)} fewer than last week. That happens.`,
      'No comparison yet — last week had no completed tasks.',
    ),
    compare(
      'consistency',
      'Consistency',
      current.consistency ?? 0,
      previous.consistency ?? 0,
      'percent',
      (d) =>
        d >= 0
          ? `Your consistency is ${d} point${d === 1 ? '' : 's'} higher than last week.`
          : `${Math.abs(d)} points lower than last week. Worth a look, not a verdict.`,
      'Consistency needs a full week of scheduled tasks before it means anything.',
    ),
  ];
}

function compare(
  key: string,
  label: string,
  current: number,
  previous: number,
  unit: Comparison['unit'],
  phrase: (delta: number) => string,
  emptyMessage: string,
): Comparison {
  const delta = Math.round((current - previous) * 10) / 10;
  return {
    key,
    label,
    current,
    previous,
    delta,
    unit,
    message: previous === 0 && current === 0 ? emptyMessage : phrase(delta),
  };
}

export interface WeekAggregate {
  weekStart: DayKey;
  focusMinutes: number;
  tasksCompleted: number;
  tasksPlanned: number;
  consistency: number | null;
  breakMinutes: number;
  sessionCount: number;
}

export function aggregateRange(
  label: DayKey,
  tasks: TaskFact[],
  sessions: SessionFact[],
  timeZone: string,
  weekStartsOn: number,
  now: Date,
): WeekAggregate {
  const weekStart = startOfWeekKey(label, weekStartsOn);
  const weekEnd = addDaysToKey(weekStart, 6);
  const asOf = dayKeyOf(now, timeZone);
  const focus = focusMinutesByDay(sessions, timeZone, weekStart, weekEnd, now);
  const consistencyResult = consistency(tasks, weekStart, weekEnd, asOf);
  const tasksInWeek = tasks.filter(
    (t) => diffInDays(t.day, weekStart) >= 0 && diffInDays(t.day, weekEnd) <= 0 && t.status !== 'cancelled',
  );

  return {
    weekStart,
    focusMinutes: focus.reduce((sum, p) => sum + p.minutes, 0),
    breakMinutes: focus.reduce((sum, p) => sum + p.breakMinutes, 0),
    sessionCount: focus.reduce((sum, p) => sum + p.sessions, 0),
    tasksCompleted: tasksInWeek.filter((t) => t.status === 'completed').length,
    tasksPlanned: tasksInWeek.length,
    consistency: consistencyResult.score,
  };
}

/* ── Streaks and recovery ───────────────────────────────────────────────── */

export interface StreakInfo {
  current: number;
  longest: number;
  lastCompletionDay: DayKey | null;
  daysSinceLastCompletion: number | null;
  /** True when the last completion is recent enough that this is a pause, not a break. */
  isRecovering: boolean;
  message: string;
}

/**
 * Streaks here are descriptive, never punitive. A missed day does not "break"
 * anything the app takes away — it changes the wording. XP already earned is
 * never removed.
 */
export function streakInfo(tasks: TaskFact[], asOf: DayKey): StreakInfo {
  const daysWithCompletion = new Set(
    tasks.filter((t) => t.status === 'completed').map((t) => t.day),
  );

  if (daysWithCompletion.size === 0) {
    return {
      current: 0,
      longest: 0,
      lastCompletionDay: null,
      daysSinceLastCompletion: null,
      isRecovering: false,
      message: 'No completed tasks yet. The first one is the only one that matters today.',
    };
  }

  const sorted = [...daysWithCompletion].sort();
  const lastDay = sorted[sorted.length - 1]!;
  const daysSince = diffInDays(asOf, lastDay);

  // Current streak: count back from today, or from yesterday if today is still
  // open — an unfinished morning is not a broken streak.
  let cursor = daysWithCompletion.has(asOf) ? asOf : addDaysToKey(asOf, -1);
  let current = 0;
  while (daysWithCompletion.has(cursor)) {
    current += 1;
    cursor = addDaysToKey(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let previous: DayKey | null = null;
  for (const day of sorted) {
    if (previous !== null && diffInDays(day, previous) === 1) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
    previous = day;
  }

  const isRecovering = daysSince >= 2;
  let message: string;
  if (current === 0 && !isRecovering) {
    message = 'Today is still open. One task keeps the rhythm going.';
  } else if (current === 0) {
    message = 'A gap is not a failure. Start with the smallest thing on the list.';
  } else if (current === 1) {
    message = 'One day of showing up. That is a beginning, not a statistic.';
  } else {
    message = `${current} days in a row with something completed.`;
  }

  return {
    current,
    longest,
    lastCompletionDay: lastDay,
    daysSinceLastCompletion: daysSince,
    isRecovering,
    message,
  };
}

/* ── Personal records ───────────────────────────────────────────────────── */

export interface RecordsResult {
  bestFocusDay: { day: DayKey; minutes: number } | null;
  bestTaskDay: { day: DayKey; completed: number } | null;
  totalFocusMinutes: number;
  totalSessions: number;
  totalCompletedTasks: number;
  totalTwoMinuteStarts: number;
}

export function personalRecords(
  tasks: TaskFact[],
  sessions: SessionFact[],
  timeZone: string,
  now: Date,
): RecordsResult {
  const focusByDay = new Map<DayKey, number>();
  let totalSeconds = 0;
  let sessionCount = 0;
  let twoMinuteCount = 0;

  for (const session of sessions) {
    if (!isCountedSession(session)) continue;
    const seconds = sessionActiveSeconds(session, now);
    if (session.kind === 'break') continue;
    const day = dayKeyOf(session.startedAt, timeZone);
    focusByDay.set(day, (focusByDay.get(day) ?? 0) + seconds);
    totalSeconds += seconds;
    sessionCount += 1;
    if (session.kind === 'two_minute') twoMinuteCount += 1;
  }

  const completedByDay = new Map<DayKey, number>();
  for (const task of tasks) {
    if (task.status !== 'completed') continue;
    completedByDay.set(task.day, (completedByDay.get(task.day) ?? 0) + 1);
  }

  const focusMax = pickMax(focusByDay, (seconds) => Math.round(seconds / 60));
  const taskMax = pickMax(completedByDay, (n) => n);

  return {
    bestFocusDay: focusMax ? { day: focusMax.key, minutes: focusMax.value } : null,
    bestTaskDay: taskMax ? { day: taskMax.key, completed: taskMax.value } : null,
    totalFocusMinutes: Math.round(totalSeconds / 60),
    totalSessions: sessionCount,
    totalCompletedTasks: tasks.filter((t) => t.status === 'completed').length,
    totalTwoMinuteStarts: twoMinuteCount,
  };
}

function pickMax<K extends string>(
  map: Map<K, number>,
  transform: (value: number) => number,
): { key: K; value: number } | null {
  let bestKey: K | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const [key, value] of map) {
    const transformed = transform(value);
    if (transformed > bestValue) {
      bestValue = transformed;
      bestKey = key;
    }
  }
  return bestKey === null ? null : { key: bestKey, value: bestValue };
}

/* ── Behavioural observations ───────────────────────────────────────────── */

export interface Observation {
  id: string;
  kind: 'pattern' | 'possible-pattern' | 'insufficient-data';
  headline: string;
  detail: string;
  /** How many data points the claim rests on. Always shown. */
  sampleSize: number;
}

/**
 * Observations are only emitted when the recorded data supports them, and weak
 * evidence is labelled as such. Correlation is never presented as cause.
 */
export function observations(input: {
  energyLogs: DailyEnergyLogRow[];
  sessions: SessionFact[];
  tasks: TaskFact[];
  timeZone: string;
  now: Date;
  minSampleSize?: number;
}): Observation[] {
  const { energyLogs, sessions, tasks, timeZone, now, minSampleSize = 5 } = input;
  const out: Observation[] = [];

  // Afternoon energy vs afternoon focus length.
  const afternoonEnergy = energyLogs.filter((l) => l.slot === 'afternoon');
  const afternoonFocus = sessions.filter(
    (s) =>
      isCountedSession(s) &&
      s.kind === 'focus' &&
      hourInZone(s.startedAt, timeZone) >= 12 &&
      hourInZone(s.startedAt, timeZone) < 17,
  );

  if (afternoonEnergy.length >= minSampleSize && afternoonFocus.length >= minSampleSize) {
    const lowDays = new Set(
      energyLogs.filter((l) => l.slot === 'afternoon' && l.level <= 2).map((l) => l.log_date),
    );
    const lowFocus = afternoonFocus
      .filter((s) => lowDays.has(dayKeyOf(s.startedAt, timeZone)))
      .map((s) => sessionActiveSeconds(s, now) / 60);
    const otherFocus = afternoonFocus
      .filter((s) => !lowDays.has(dayKeyOf(s.startedAt, timeZone)))
      .map((s) => sessionActiveSeconds(s, now) / 60);

    if (lowFocus.length >= 3 && otherFocus.length >= 3) {
      const lowAvg = average(lowFocus);
      const otherAvg = average(otherFocus);
      const gap = otherAvg - lowAvg;
      if (Math.abs(gap) >= 5) {
        out.push({
          id: 'afternoon-energy',
          kind: lowFocus.length >= minSampleSize ? 'pattern' : 'possible-pattern',
          headline:
            gap > 0 ? 'Afternoon sessions run shorter on low-energy days' : 'Afternoon energy does not track with focus length for you',
          detail: `On days you rated afternoon energy 2 or lower, your afternoon sessions averaged ${Math.round(
            lowAvg,
          )} minutes, against ${Math.round(otherAvg)} minutes otherwise. This is a correlation in your own records; it does not establish cause.`,
          sampleSize: lowFocus.length + otherFocus.length,
        });
      }
    }
  }

  // Most rescheduled category.
  const rescheduled = tasks.filter((t) => t.rescheduledFromDay !== null);
  if (rescheduled.length >= minSampleSize) {
    const counts = new Map<CategoryKind, number>();
    for (const t of rescheduled) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    let topCategory: CategoryKind | null = null;
    let topCount = 0;
    for (const [category, count] of counts) {
      if (count > topCount) {
        topCount = count;
        topCategory = category;
      }
    }
    if (topCategory) {
      out.push({
        id: 'reschedule-category',
        kind: topCount >= minSampleSize ? 'pattern' : 'possible-pattern',
        headline: `${topCategory} tasks get moved most often`,
        detail: `${topCount} of your ${rescheduled.length} rescheduled tasks were in the ${topCategory} category. It may be worth scheduling them earlier, or making them smaller.`,
        sampleSize: rescheduled.length,
      });
    }
  }

  // Best focus window.
  const byHour = focusByHour(sessions, timeZone, '1970-01-01', '2999-12-31', now).filter((h) => h.minutes > 0);
  const totalFocus = byHour.reduce((sum, h) => sum + h.minutes, 0);
  if (byHour.length >= 4 && totalFocus >= 120) {
    const peak = [...byHour].sort((a, b) => b.minutes - a.minutes)[0]!;
    out.push({
      id: 'focus-window',
      kind: byHour.length >= minSampleSize ? 'pattern' : 'possible-pattern',
      headline: `Your strongest focus window starts around ${peak.label}:00`,
      detail: `${peak.minutes} of your ${totalFocus} tracked minutes fall in that hour. Consider putting the MAIN priority there.`,
      sampleSize: byHour.length,
    });
  }

  if (out.length === 0) {
    out.push({
      id: 'need-data',
      kind: 'insufficient-data',
      headline: 'Not enough recorded activity yet',
      detail:
        'Patterns appear here once there are at least five days of energy check-ins and focus sessions to compare. REBIRTH will not guess from less.',
      sampleSize: energyLogs.length,
    });
  }

  return out;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/* ── Routines ───────────────────────────────────────────────────────────── */

export interface RoutineConsistency {
  templateId: string;
  title: string;
  eligible: number;
  completed: number;
  score: number | null;
}

export function routineConsistency(
  templates: TaskTemplateRow[],
  tasks: TaskFact[],
  asOf: DayKey,
): RoutineConsistency[] {
  return templates
    .map((template) => {
      const instances = tasks.filter(
        (t) => t.templateId === template.id && t.status !== 'cancelled' && diffInDays(t.day, asOf) <= 0,
      );
      const completed = instances.filter((t) => t.status === 'completed').length;
      return {
        templateId: template.id,
        title: template.title,
        eligible: instances.length,
        completed,
        score: instances.length === 0 ? null : Math.round((completed / instances.length) * 1000) / 10,
      };
    })
    .filter((r) => r.eligible > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/* ── Goal progress, honestly measured ───────────────────────────────────── */

export interface GoalProgressSummary {
  goalId: string;
  /** Only set when the goal's declared measurement method can support a number. */
  percent: number | null;
  basisLabel: string;
  effortMinutes: number;
  sessionsCompleted: number;
  tasksPlanned: number;
  tasksCompleted: number;
  milestonesTotal: number;
  milestonesDone: number;
}

export function goalProgress(row: GoalProgressViewRow): GoalProgressSummary {
  const base = {
    goalId: row.goal_id,
    effortMinutes: row.focus_minutes,
    sessionsCompleted: row.sessions_completed,
    tasksPlanned: row.tasks_planned,
    tasksCompleted: row.tasks_completed,
    milestonesTotal: row.milestones_total,
    milestonesDone: row.milestones_done,
  };

  switch (row.measurement) {
    case 'effort': {
      if (!row.target_minutes) {
        return { ...base, percent: null, basisLabel: 'Effort — no minute target set' };
      }
      return {
        ...base,
        percent: Math.min(100, Math.round((row.focus_minutes / row.target_minutes) * 100)),
        basisLabel: `Effort — ${row.focus_minutes} of ${row.target_minutes} focused minutes`,
      };
    }
    case 'execution': {
      if (row.tasks_planned === 0) {
        return { ...base, percent: null, basisLabel: 'Execution — no tasks linked yet' };
      }
      return {
        ...base,
        percent: Math.round((row.tasks_completed / row.tasks_planned) * 100),
        basisLabel: `Execution — ${row.tasks_completed} of ${row.tasks_planned} linked tasks completed`,
      };
    }
    case 'milestone': {
      if (row.milestones_total === 0) {
        return { ...base, percent: null, basisLabel: 'Milestones — none defined yet' };
      }
      return {
        ...base,
        percent: Math.round((row.milestones_done / row.milestones_total) * 100),
        basisLabel: `Milestones — ${row.milestones_done} of ${row.milestones_total} reached`,
      };
    }
    case 'manual':
    default:
      return {
        ...base,
        percent: row.manual_progress ?? null,
        basisLabel: 'Self-assessed progress',
      };
  }
}

/* ── Daily dashboard summary ────────────────────────────────────────────── */

export interface DaySummary {
  day: DayKey;
  plannedMinutes: number;
  trackedMinutes: number;
  breakMinutes: number;
  tasksPlanned: number;
  tasksCompleted: number;
  tasksRemaining: number;
  adherencePercent: number | null;
  freeMinutes: number;
  mainTaskMinutes: number;
  energyAverage: number | null;
  definition: string;
}

export function daySummary(
  day: DayKey,
  tasks: TaskFact[],
  sessions: SessionFact[],
  energyLogs: DailyEnergyLogRow[],
  now: Date,
): DaySummary {
  const todays = tasks.filter((t) => t.day === day && t.status !== 'cancelled');
  const ids = new Set(todays.map((t) => t.id));

  let trackedSeconds = 0;
  let breakSeconds = 0;
  for (const session of sessions) {
    if (!isCountedSession(session)) continue;
    if (session.taskId === null || !ids.has(session.taskId)) continue;
    const seconds = sessionActiveSeconds(session, now);
    if (session.kind === 'break') breakSeconds += seconds;
    else trackedSeconds += seconds;
  }

  const completed = todays.filter((t) => t.status === 'completed').length;
  const remaining = todays.filter((t) => t.status === 'scheduled' || t.status === 'in_progress').length;
  const plannedMinutes = todays.reduce((sum, t) => sum + t.durationMinutes, 0);
  const trackedMinutes = Math.round(trackedSeconds / 60);
  const energy = energyLogs.filter((l) => l.log_date === day);

  return {
    day,
    plannedMinutes,
    trackedMinutes,
    breakMinutes: Math.round(breakSeconds / 60),
    tasksPlanned: todays.length,
    tasksCompleted: completed,
    tasksRemaining: remaining,
    adherencePercent:
      plannedMinutes === 0 ? null : Math.min(100, Math.round((trackedMinutes / plannedMinutes) * 100)),
    freeMinutes: Math.max(0, 16 * 60 - plannedMinutes - Math.round(breakSeconds / 60)),
    mainTaskMinutes: todays
      .filter((t) => t.priority === 'main')
      .reduce((sum, t) => sum + t.durationMinutes, 0),
    energyAverage:
      energy.length === 0
        ? null
        : Math.round((energy.reduce((sum, l) => sum + l.level, 0) / energy.length) * 10) / 10,
    definition:
      'Adherence compares tracked focus minutes against the minutes you scheduled today. It is not a measure of your worth or your ability.',
  };
}

/** Days elapsed in a range, used to avoid charting future days as zeros. */
export function chartableDays(from: DayKey, to: DayKey, asOf: DayKey): number {
  return elapsedDaysIn(from, to, asOf);
}

function shortLabel(day: DayKey): string {
  const date = new Date(`${day}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}
