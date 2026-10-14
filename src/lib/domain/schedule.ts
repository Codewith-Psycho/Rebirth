import type {
  CategoryKind,
  ScheduledTaskRow,
  TaskStatus,
  TaskTemplateRow,
} from '@/lib/types/database';
import type { CalendarOccurrence } from './recurrence';
import {
  describeRecurrence,
  previewRoutineDays,
  type RecurrenceRule,
} from './recurrence';
import {
  assessDayLoad,
  findConflicts,
  freeIntervals,
  makeBlock,
  type Conflict,
  type DayLoad,
  type Interval,
  type TimeBlock,
} from './scheduling';
import {
  type DayKey,
  addDaysToKey,
  diffInDays,
  instantToLocalMinutes,
  timeToMinutes,
} from './time';

/**
 * Schedule arithmetic that only the schedule screen needs.
 *
 * Everything here is pure: rows in, plain values out. That is what lets the
 * availability panel and the routine list be unit-tested without a database, and
 * it is why the screen can never disagree with Today about how much of a day is
 * already spoken for — both compute it from the same rows with the same helpers.
 *
 * "Free time" here means free time *of planned work*, not free time of living.
 * The panel says so out loud rather than implying the user is idle.
 */

/** Statuses that still represent work ahead rather than a decision taken. */
export const OPEN_STATUSES: TaskStatus[] = ['scheduled', 'in_progress'];

export function isOpenTask(task: Pick<ScheduledTaskRow, 'status'>): boolean {
  return OPEN_STATUSES.includes(task.status);
}

/** The slot in a series a task belongs to: `occurrence_date` is authoritative. */
export function taskDay(task: Pick<ScheduledTaskRow, 'occurrence_date' | 'scheduled_date'>): DayKey {
  return task.occurrence_date ?? task.scheduled_date;
}

/** Categories that occupy time without being work — meals, rest, recovery. */
const BREAK_CATEGORIES: CategoryKind[] = ['meal', 'rest'];

export function ruleForTemplate(template: TaskTemplateRow): RecurrenceRule {
  return {
    kind: template.recurrence,
    weekdays: template.weekdays ?? [],
    startsOn: template.starts_on,
    endsOn: template.ends_on,
  };
}

/* ── Routines ───────────────────────────────────────────────────────────── */

export interface RoutineSummary {
  template: TaskTemplateRow;
  rule: RecurrenceRule;
  /** "Monday, Wednesday, Friday" — written from the stored rule, not a guess. */
  description: string;
  /** The next slots the materialiser will produce, ascending from today. */
  nextDays: DayKey[];
  /** Real materialised rows inside the loaded window. */
  occurrences: number;
  completed: number;
  /** True when this or a later occurrence was deliberately changed by the user. */
  hasOverrides: boolean;
  isPaused: boolean;
  /** Set when the routine has run out of days, so the editor can say why. */
  endedOn: DayKey | null;
  /** The most recent real row, used as the anchor for editing the series. */
  anchorTask: ScheduledTaskRow | null;
}

export function summariseRoutine(
  template: TaskTemplateRow,
  tasks: ScheduledTaskRow[],
  today: DayKey,
  previewCount = 3,
): RoutineSummary {
  const rule = ruleForTemplate(template);
  const mine = tasks.filter((task) => task.template_id === template.id);
  const ended = template.ends_on !== null && diffInDays(template.ends_on, today) < 0;

  const nextDays = template.is_active && !ended ? previewRoutineDays(rule, today, previewCount) : [];

  const anchorTask =
    mine.length === 0
      ? null
      : [...mine].sort((a, b) => diffInDays(taskDay(b), taskDay(a)))[0]!;

  return {
    template,
    rule,
    description: describeRecurrence(rule),
    nextDays,
    // "Ahead" means still to come, so a day the user already answered is not
    // counted as work waiting for them.
    occurrences: mine.filter(isOpenTask).length,
    completed: mine.filter((task) => task.status === 'completed').length,
    hasOverrides: mine.some((task) => task.is_override),
    isPaused: !template.is_active,
    endedOn: ended ? template.ends_on : null,
    anchorTask,
  };
}

export function routineSummaries(
  templates: TaskTemplateRow[],
  tasks: ScheduledTaskRow[],
  today: DayKey,
  previewCount = 3,
): RoutineSummary[] {
  return templates
    .map((template) => summariseRoutine(template, tasks, today, previewCount))
    .sort((a, b) => {
      // Paused and finished routines drop to the bottom: the list should lead
      // with what is actually going to happen.
      if (a.isPaused !== b.isPaused) return a.isPaused ? 1 : -1;
      if (a.template.start_time !== b.template.start_time) {
        return a.template.start_time < b.template.start_time ? -1 : 1;
      }
      return a.template.title.localeCompare(b.template.title);
    });
}

/* ── Days ───────────────────────────────────────────────────────────────── */

export function tasksByDay(tasks: ScheduledTaskRow[]): Map<DayKey, ScheduledTaskRow[]> {
  const map = new Map<DayKey, ScheduledTaskRow[]>();
  for (const task of tasks) {
    const day = taskDay(task);
    const bucket = map.get(day);
    if (bucket) bucket.push(task);
    else map.set(day, [task]);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
  }
  return map;
}

/** Open-task counts per day, for the day strip's "how full is this" hint. */
export function openCountByDay(tasks: ScheduledTaskRow[]): Map<DayKey, number> {
  const map = new Map<DayKey, number>();
  for (const task of tasks) {
    if (!isOpenTask(task)) continue;
    const day = taskDay(task);
    map.set(day, (map.get(day) ?? 0) + 1);
  }
  return map;
}

export function upcomingDays(from: DayKey, count: number): DayKey[] {
  const days: DayKey[] = [];
  for (let index = 0; index < count; index += 1) days.push(addDaysToKey(from, index));
  return days;
}

/* ── Availability ───────────────────────────────────────────────────────── */

/**
 * Planned tasks as time blocks.
 *
 * Tasks are never marked fixed: the whole point of the replanner is that they
 * can move. What cannot move is an appointment.
 */
export function taskBlocks(tasks: ScheduledTaskRow[]): TimeBlock[] {
  return tasks.map((task) =>
    makeBlock({
      id: `task:${task.id}`,
      title: task.title,
      startMinutes: timeToMinutes(task.start_time),
      endMinutes: timeToMinutes(task.start_time) + Math.max(5, task.duration_minutes),
      priority: task.priority,
      isFixed: false,
      isBreak: BREAK_CATEGORIES.includes(task.category),
    }),
  );
}

/**
 * Calendar occurrences as time blocks.
 *
 * All-day entries are skipped rather than stretched across 24 hours: an all-day
 * band says "this day is different", and turning it into 1440 planned minutes
 * would make every availability figure on the screen wrong.
 */
export function eventBlocks(events: CalendarOccurrence[], timeZone: string): TimeBlock[] {
  return events
    .filter((event) => !event.isAllDay && event.status !== 'cancelled')
    .map((event) => {
      const start = instantToLocalMinutes(event.start, timeZone);
      const end = instantToLocalMinutes(event.end, timeZone);
      return makeBlock({
        id: `event:${event.key}`,
        title: event.title,
        startMinutes: start,
        // An event that ends after midnight is clipped to the end of its day.
        endMinutes: Math.max(start + 5, end),
        priority: 'other',
        isFixed: true,
        isBreak: BREAK_CATEGORIES.includes(event.category),
      });
    });
}

export interface DayAvailability {
  day: DayKey;
  blocks: TimeBlock[];
  /** Gaps of at least 15 minutes between planned blocks, in order. */
  free: Interval[];
  /** Pairs of blocks that overlap, worst first. */
  conflicts: Conflict[];
  load: DayLoad;
}

export interface AvailabilityPreferences {
  deepWorkCapMinutes: number;
  wakeMinutes: number;
  sleepMinutes: number;
}

export const DEFAULT_AVAILABILITY: AvailabilityPreferences = {
  deepWorkCapMinutes: 300,
  wakeMinutes: 7 * 60,
  sleepMinutes: 23 * 60,
};

export function dayAvailability(
  day: DayKey,
  blocks: TimeBlock[],
  preferences: AvailabilityPreferences = DEFAULT_AVAILABILITY,
): DayAvailability {
  const sorted = [...blocks].sort((a, b) => a.startMinutes - b.startMinutes);
  const free = freeIntervals(
    sorted,
    preferences.wakeMinutes,
    preferences.sleepMinutes,
  ).filter((gap) => gap.endMinutes - gap.startMinutes >= 15);

  return {
    day,
    blocks: sorted,
    free,
    conflicts: findConflicts(sorted),
    load: assessDayLoad(
      day,
      sorted,
      preferences.deepWorkCapMinutes,
      preferences.wakeMinutes,
      preferences.sleepMinutes,
    ),
  };
}

/** Blocks for one day, from both sides of the schedule. */
export function blocksForDay(
  day: DayKey,
  tasks: ScheduledTaskRow[],
  events: CalendarOccurrence[],
  timeZone: string,
): TimeBlock[] {
  // Only work that is still ahead of the user counts towards a day's load. A
  // skipped task has been answered, and counting it would inflate the very
  // number the user is using to decide whether to take on more.
  const dayTasks = tasks.filter((task) => taskDay(task) === day && isOpenTask(task));
  return [
    ...taskBlocks(dayTasks),
    ...eventBlocks(
      events.filter((event) => event.occurrenceDate === day),
      timeZone,
    ),
  ];
}

/**
 * A calm one-line reading of a day's load.
 *
 * Deliberately never uses the word "overloaded" to the user: a full day is a
 * choice, and the sentence reports the arithmetic and then offers an option.
 */
export function loadSentence(availability: DayAvailability): string {
  const { load, blocks } = availability;
  if (blocks.length === 0) {
    return 'Nothing is planned. That is allowed — a quiet day is not a gap.';
  }
  if (load.plannedMinutes === 0) {
    return 'No work is planned; this day holds appointments or rest only.';
  }
  return `${formatHours(load.plannedMinutes)} of planned work, ${formatHours(load.freeMinutes)} untouched.`;
}

export function formatHours(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}
