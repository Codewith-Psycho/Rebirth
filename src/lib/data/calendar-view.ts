import type { CalendarItem } from '@/lib/domain/calendar';
import type { CalendarOccurrence } from '@/lib/domain/recurrence';
import { type DayKey, combineLocalDateTime } from '@/lib/domain/time';
import type { CalendarEvent, CalendarWindow, ImportantPeriod } from './calendar';
import { loadCalendarWindow } from './calendar';
import type { Goal } from './goals';
import { goalTitleMap, listGoals } from './goals';
import { ok, type Result } from './result';
import type { ScheduledTask, TaskSession } from './tasks';
import {
  ensureRecurringInstances,
  listSessionsInRange,
  listTasksInRange,
} from './tasks';
import type { Db } from './types';

/**
 * One window of the calendar, loaded consistently.
 *
 * The calendar reads the *same* rows as every other screen — tasks from
 * `scheduled_tasks`, events from `calendar_events` — and composes them in one
 * pass, so a task edited in the schedule view and a task clicked in the month
 * grid are the same record seen twice. Nothing here caches a copy, which is the
 * only reliable way for two views of the same data not to drift.
 */

export interface CalendarFacts {
  from: DayKey;
  to: DayKey;
  /** The user's local day, used to classify what is past and what is ahead. */
  today: DayKey;
  timeZone: string;
  warning: string | null;

  items: CalendarItem[];
  events: CalendarOccurrence[];
  /** Series/one-off event rows, so a write can name the row it is changing. */
  masters: CalendarEvent[];
  periods: ImportantPeriod[];
  tasks: ScheduledTask[];
  sessions: TaskSession[];
  goals: Goal[];
  goalTitles: Map<string, string>;
}

export interface CalendarFactsParams {
  from: DayKey;
  to: DayKey;
  today: DayKey;
  timeZone: string;
}

export async function loadCalendarFacts(
  db: Db,
  params: CalendarFactsParams,
): Promise<Result<CalendarFacts>> {
  const { from, to, today, timeZone } = params;

  /*
   * Materialise recurring tasks across the window before reading it. Idempotent,
   * and its failure is a warning rather than an error: a maintenance step going
   * wrong should not blank a calendar the user can otherwise read.
   */
  let warning: string | null = null;
  const ensured = await ensureRecurringInstances(db, from, to);
  if (!ensured.ok) {
    warning =
      'Repeating tasks could not be checked just now, so a routine may be missing from this window. Reloading will try again — nothing already recorded is affected.';
  }

  const fromInstant = combineLocalDateTime(from, '00:00', timeZone).toISOString();
  const toInstant = combineLocalDateTime(to, '23:59:59', timeZone).toISOString();

  const [tasksResult, sessionsResult, goalsResult] = await Promise.all([
    listTasksInRange(db, from, to),
    listSessionsInRange(db, fromInstant, toInstant),
    listGoals(db),
  ]);

  if (!tasksResult.ok) return tasksResult;
  if (!sessionsResult.ok) return sessionsResult;
  if (!goalsResult.ok) return goalsResult;

  const tasks = tasksResult.data;
  const goals = goalsResult.data;
  const goalTitles = goalTitleMap(goals);

  const windowResult: Result<CalendarWindow> = await loadCalendarWindow(db, {
    from,
    to,
    asOf: today,
    timeZone,
    tasks: tasks.map((task) => ({
      id: task.id,
      template_id: task.template_id,
      title: task.title,
      description: task.description,
      category: task.category,
      priority: task.priority,
      status: task.status,
      scheduled_date: task.scheduled_date,
      start_time: task.start_time,
      duration_minutes: task.duration_minutes,
      goal_id: task.goal_id,
      rescheduled_from_date: task.rescheduled_from_date,
    })),
    goalTitles,
  });

  if (!windowResult.ok) return windowResult;

  return ok({
    from,
    to,
    today,
    timeZone,
    warning,
    items: windowResult.data.items,
    events: windowResult.data.events,
    masters: windowResult.data.masters,
    periods: windowResult.data.periods,
    tasks,
    sessions: sessionsResult.data,
    goals,
    goalTitles,
  });
}
