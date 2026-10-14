import type { CalendarEventRow, RecurrenceKind, ScheduledTaskRow } from '@/lib/types/database';
import {
  type DayKey,
  addDaysToKey,
  combineLocalDateTime,
  dayOfWeek,
  diffInDays,
  eachDayKey,
  instantToLocalMinutes,
  minutesBetween,
} from './time';

/**
 * Recurrence.
 *
 * Two different mechanisms, chosen deliberately per entity:
 *
 *   · **Tasks** are *materialised* into real rows (see
 *     `rpc_ensure_recurring_instances`). A task instance is what you time,
 *     complete and score, so it has to exist in the database. The unique index
 *     on `(template_id, occurrence_date)` makes materialisation idempotent.
 *
 *   · **Calendar events** are *expanded in memory* right here. They carry no
 *     completion state, so writing rows for them would only create a duplicate
 *     to keep in sync. A diverged occurrence is stored as an exception row
 *     carrying `(parent_event_id, occurrence_date)`, and the expander skips any
 *     slot that has one.
 *
 * Both avoid the same failure mode: a series appearing twice.
 */

export interface RecurrenceRule {
  kind: RecurrenceKind;
  weekdays: number[];
  startsOn: DayKey;
  endsOn: DayKey | null;
}

export function weekdayName(index: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index] ?? '';
}

export function weekdayShort(index: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index] ?? '';
}

/** Does the rule produce an occurrence on `day`? */
export function occursOn(rule: RecurrenceRule, day: DayKey): boolean {
  if (diffInDays(day, rule.startsOn) < 0) return false;
  if (rule.endsOn !== null && diffInDays(day, rule.endsOn) > 0) return false;

  const dow = dayOfWeek(day);
  switch (rule.kind) {
    case 'daily':
      return true;
    case 'weekdays':
      return dow >= 1 && dow <= 5;
    case 'weekends':
      return dow === 0 || dow === 6;
    case 'custom_weekly':
      return rule.weekdays.includes(dow);
    case 'none':
    default:
      return diffInDays(day, rule.startsOn) === 0;
  }
}

/** Every occurrence day the rule produces inside `[from, to]`, ascending. */
export function expandOccurrences(rule: RecurrenceRule, from: DayKey, to: DayKey): DayKey[] {
  if (diffInDays(to, from) < 0) return [];
  const start = diffInDays(from, rule.startsOn) < 0 ? rule.startsOn : from;
  const end = rule.endsOn !== null && diffInDays(rule.endsOn, to) < 0 ? rule.endsOn : to;
  if (diffInDays(end, start) < 0) return [];

  const out: DayKey[] = [];
  for (const day of eachDayKey(start, end)) {
    if (occursOn(rule, day)) out.push(day);
  }
  return out;
}

export function describeRecurrence(rule: RecurrenceRule): string {
  switch (rule.kind) {
    case 'daily':
      return 'Every day';
    case 'weekdays':
      return 'Monday to Friday';
    case 'weekends':
      return 'Weekends';
    case 'custom_weekly': {
      const days = [...rule.weekdays].sort((a, b) => a - b);
      if (days.length === 0) return 'No days selected';
      if (days.length === 7) return 'Every day';
      return days.map(weekdayShort).join(', ');
    }
    case 'none':
    default:
      return 'One time';
  }
}

/* ── Calendar event series expansion ────────────────────────────────────── */

export interface CalendarOccurrence {
  /** Stable across re-renders so React keys and selections do not jump. */
  key: string;
  /** The row this occurrence is rendered from (master or exception). */
  rowId: string;
  /** The master row id when this belongs to a series. */
  seriesId: string | null;
  /** The slot in the series this occurrence occupies. */
  occurrenceDate: DayKey;
  isException: boolean;
  isRecurring: boolean;
  title: string;
  description: string | null;
  kind: CalendarEventRow['kind'];
  category: CalendarEventRow['category'];
  priority: CalendarEventRow['priority'];
  status: CalendarEventRow['status'];
  goalId: string | null;
  isAllDay: boolean;
  start: Date;
  end: Date;
  timezone: string;
  location: string | null;
  reminderMinutes: number | null;
}

/**
 * Projects a calendar-event series onto `[from, to]`.
 *
 * @param masters   rows with `parent_event_id = null`
 * @param exceptions rows with `parent_event_id` set (moved or cancelled slots)
 */
export function expandEventSeries(
  masters: CalendarEventRow[],
  exceptions: CalendarEventRow[],
  from: DayKey,
  to: DayKey,
): CalendarOccurrence[] {
  const exceptionsBySeries = new Map<string, Map<DayKey, CalendarEventRow>>();
  for (const ex of exceptions) {
    if (!ex.parent_event_id || !ex.occurrence_date) continue;
    const bucket = exceptionsBySeries.get(ex.parent_event_id) ?? new Map<DayKey, CalendarEventRow>();
    bucket.set(ex.occurrence_date, ex);
    exceptionsBySeries.set(ex.parent_event_id, bucket);
  }

  const out: CalendarOccurrence[] = [];
  const consumedExceptions = new Set<string>();

  for (const master of masters) {
    const durationMinutes = Math.max(1, minutesBetween(new Date(master.starts_at), new Date(master.ends_at)));
    const startMinutes = instantToLocalMinutes(new Date(master.starts_at), master.timezone);
    const seriesExceptions = exceptionsBySeries.get(master.id);

    if (master.recurrence === 'none') {
      const day = keyOfInstantInZone(master.starts_at, master.timezone);
      // A non-recurring master that was moved is stored as an exception too.
      const override = seriesExceptions?.get(day);
      if (override) {
        consumedExceptions.add(override.id);
        if (override.status !== 'cancelled') out.push(toOccurrence(override, false));
        continue;
      }
      if (diffInDays(day, from) >= 0 && diffInDays(day, to) <= 0) {
        out.push(toOccurrence(master, false));
      }
      continue;
    }

    const rule: RecurrenceRule = {
      kind: master.recurrence,
      weekdays: master.weekdays ?? [],
      startsOn: master.recurrence_starts_on ?? keyOfInstantInZone(master.starts_at, master.timezone),
      endsOn: master.recurrence_ends_on,
    };

    for (const day of expandOccurrences(rule, from, to)) {
      const override = seriesExceptions?.get(day);
      if (override) {
        consumedExceptions.add(override.id);
        if (override.status !== 'cancelled') out.push(toOccurrence(override, true));
        continue;
      }
      const start = combineLocalDateTime(day, minutesToLocalTimeString(startMinutes), master.timezone);
      out.push({
        key: `${master.id}:${day}`,
        rowId: master.id,
        seriesId: master.id,
        occurrenceDate: day,
        isException: false,
        isRecurring: true,
        title: master.title,
        description: master.description,
        kind: master.kind,
        category: master.category,
        priority: master.priority,
        status: master.status,
        goalId: master.goal_id,
        isAllDay: master.is_all_day,
        start,
        end: new Date(start.getTime() + durationMinutes * 60_000),
        timezone: master.timezone,
        location: master.location,
        reminderMinutes: master.reminder_minutes,
      });
    }
  }

  // Exceptions whose slot falls inside the window but whose master is not
  // loaded (or whose master is non-recurring and out of range) still render.
  for (const ex of exceptions) {
    if (consumedExceptions.has(ex.id)) continue;
    if (ex.status === 'cancelled') continue;
    const day = keyOfInstantInZone(ex.starts_at, ex.timezone);
    if (diffInDays(day, from) >= 0 && diffInDays(day, to) <= 0) {
      out.push(toOccurrence(ex, true));
    }
  }

  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function toOccurrence(row: CalendarEventRow, isException: boolean): CalendarOccurrence {
  const day = keyOfInstantInZone(row.starts_at, row.timezone);
  return {
    key: isException ? row.id : `${row.id}:${day}`,
    rowId: row.id,
    seriesId: row.parent_event_id,
    occurrenceDate: row.occurrence_date ?? day,
    isException,
    isRecurring: row.parent_event_id !== null || row.recurrence !== 'none',
    title: row.title,
    description: row.description,
    kind: row.kind,
    category: row.category,
    priority: row.priority,
    status: row.status,
    goalId: row.goal_id,
    isAllDay: row.is_all_day,
    start: new Date(row.starts_at),
    end: new Date(row.ends_at),
    timezone: row.timezone,
    location: row.location,
    reminderMinutes: row.reminder_minutes,
  };
}

function keyOfInstantInZone(instant: string | Date, timeZone: string): DayKey {
  // Local helper to avoid importing the whole time module twice.
  const value = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
  return parts;
}

function minutesToLocalTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/* ── Task-series helpers used by the schedule editor ────────────────────── */

/**
 * Given a materialised task, which slot in its series does it belong to?
 * `occurrence_date` is authoritative; `scheduled_date` is the fallback for
 * rows created outside the materialiser.
 */
export function taskSlot(task: Pick<ScheduledTaskRow, 'occurrence_date' | 'scheduled_date'>): DayKey {
  return task.occurrence_date ?? task.scheduled_date;
}

/** Preview of the days a draft routine would land on, for the editor. */
export function previewRoutineDays(
  rule: RecurrenceRule,
  from: DayKey,
  count = 14,
): DayKey[] {
  const to = addDaysToKey(from, Math.max(count * 3, 30));
  return expandOccurrences(rule, from, to).slice(0, count);
}
