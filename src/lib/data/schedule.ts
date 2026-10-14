import type { DayKey } from '@/lib/domain/time';
import { addDaysToKey } from '@/lib/domain/time';
import type { CalendarOccurrence } from '@/lib/domain/recurrence';
import { expandEventSeries } from '@/lib/domain/recurrence';
import { listEventRows } from './calendar';
import type { Goal } from './goals';
import { goalTitleMap, listGoals } from './goals';
import { fromPostgrest, ok, type Result } from './result';
import type { ScheduledTask, TaskTemplate } from './tasks';
import { ensureRecurringInstances, listTemplates, listTasksInRange } from './tasks';
import type { Db } from './types';

/**
 * One pass over everything the Schedule screen needs.
 *
 * Three things make this view honest:
 *
 *   · **Routines are read from `task_templates` and their occurrences from
 *     `scheduled_tasks`.** What the editor calls "the routine" is the template;
 *     what the days show are the real rows it produced. A routine edited for a
 *     single Thursday therefore reads correctly as both.
 *   · **The horizon is materialised before it is read.** Occurrences are rows, so
 *     they have to exist before a week can be shown. The call is idempotent, and
 *     its failure is a warning rather than a blank screen — the tasks are still
 *     there to read, and saying so is more useful than saying nothing.
 *   · **Appointments are part of availability.** Free time computed without the
 *     dentist at eleven would be a pleasant lie, so the same calendar rows the
 *     Calendar screen uses are expanded here into time the planner must route
 *     around.
 */

export const SCHEDULE_HORIZON_DAYS = 28;

export interface ScheduleFacts {
  today: DayKey;
  from: DayKey;
  to: DayKey;
  timeZone: string;
  warning: string | null;
  templates: TaskTemplate[];
  tasks: ScheduledTask[];
  events: CalendarOccurrence[];
  goals: Goal[];
  goalTitles: Map<string, string>;
}

export interface ScheduleFactsParams {
  today: DayKey;
  timeZone: string;
  horizonDays?: number;
}

export async function loadScheduleFacts(
  db: Db,
  params: ScheduleFactsParams,
): Promise<Result<ScheduleFacts>> {
  const { today, timeZone, horizonDays = SCHEDULE_HORIZON_DAYS } = params;
  const to = addDaysToKey(today, horizonDays);

  let warning: string | null = null;
  const ensured = await ensureRecurringInstances(db, today, to);
  if (!ensured.ok) {
    warning =
      'Repeating tasks could not be checked just now, so a day below may be missing an occurrence. Reloading tries again — nothing already recorded is affected.';
  }

  const [templatesResult, tasksResult, eventsResult, goalsResult] = await Promise.all([
    listTemplates(db),
    listTasksInRange(db, today, to),
    loadWindowEvents(db, today, to, timeZone),
    listGoals(db),
  ]);

  if (!templatesResult.ok) return templatesResult;
  if (!tasksResult.ok) return tasksResult;
  if (!eventsResult.ok) return eventsResult;
  if (!goalsResult.ok) return goalsResult;

  return ok({
    today,
    from: today,
    to,
    timeZone,
    warning,
    templates: templatesResult.data,
    tasks: tasksResult.data,
    events: eventsResult.data,
    goals: goalsResult.data,
    goalTitles: goalTitleMap(goalsResult.data),
  });
}

async function loadWindowEvents(
  db: Db,
  from: DayKey,
  to: DayKey,
  timeZone: string,
): Promise<Result<CalendarOccurrence[]>> {
  const rows = await listEventRows(db, from, to, timeZone);
  if (!rows.ok) return rows;
  return ok(expandEventSeries(rows.data.masters, rows.data.exceptions, from, to));
}

/* ── Routine-level writes ───────────────────────────────────────────────── */

/**
 * The row that an edit or a deletion of a whole routine is performed through.
 *
 * The database exposes recurring changes as RPCs that take a *task* id and a
 * scope, which is deliberate: every change to a routine is anchored to a real
 * occurrence, so the split point is unambiguous. That means a routine whose
 * occurrences have all been materialised outside the loaded window still needs a
 * row to speak through, and that is what this finds. The chosen row does not
 * affect a series-wide change — `series` rewrites the template itself.
 */
export async function findRoutineAnchorTask(
  db: Db,
  templateId: string,
): Promise<Result<ScheduledTask | null>> {
  const { data, error } = await db
    .from('scheduled_tasks')
    .select('*')
    .eq('template_id', templateId)
    .order('occurrence_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return fromPostgrest(error, 'We could not read that routine.');
  return ok(data);
}

/**
 * Pausing a routine stops it generating anything new.
 *
 * It is deliberately not a delete and deliberately not retroactive: the days
 * already written stay, because they are the record of days the user actually
 * lived. `rpc_ensure_recurring_instances` skips inactive templates, so this is
 * the whole of what pausing means.
 */
export async function setRoutineActive(
  db: Db,
  templateId: string,
  active: boolean,
): Promise<Result<TaskTemplate>> {
  const { data, error } = await db
    .from('task_templates')
    .update({ is_active: active })
    .eq('id', templateId)
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That routine was not changed.');
  return ok(data);
}

/**
 * Puts a paused routine's occurrences back on the schedule after resuming.
 *
 * Resuming has to re-materialise rather than just flipping the flag, because the
 * materialiser is what creates rows and it does nothing while a template is
 * inactive.
 */
export async function materialiseFrom(
  db: Db,
  startsOn: DayKey,
): Promise<Result<number>> {
  return ensureRecurringInstances(db, startsOn, addDaysToKey(startsOn, SCHEDULE_HORIZON_DAYS));
}
