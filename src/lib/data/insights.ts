import type { DayKey } from '@/lib/domain/time';
import { combineLocalDateTime } from '@/lib/domain/time';
import type { PersonalRecords, Tables, Views } from '@/lib/types/database';
import type { Goal, GoalProgress, Milestone } from './goals';
import type { EnergyLog, Reflection } from './practice';
import type { ScheduledTask, TaskSession } from './tasks';
import { personalRecords } from './rewards';
import { fromPostgrest, ok, type Result } from './result';
import type { Db } from './types';

/**
 * Everything the Insights screens need, in one round trip.
 *
 * One loader rather than eight means the charts on a page are all computed from
 * a single consistent snapshot — no chart disagreeing with the one beside it
 * because it was fetched a second later.
 */

export type TaskActuals = Views<'v_task_actuals'>;
export type GoalRow = Tables<'goals'>;

export interface InsightFacts {
  from: DayKey;
  to: DayKey;
  timeZone: string;
  tasks: ScheduledTask[];
  sessions: TaskSession[];
  actuals: TaskActuals[];
  energy: EnergyLog[];
  reflections: Reflection[];
  goals: Goal[];
  progress: GoalProgress[];
  milestones: Milestone[];
  records: PersonalRecords | null;
}

export async function loadInsightFacts(
  db: Db,
  params: { from: DayKey; to: DayKey; timeZone: string; includeRecords?: boolean },
): Promise<Result<InsightFacts>> {
  const { from, to, timeZone } = params;
  const fromInstant = combineLocalDateTime(from, '00:00', timeZone).toISOString();
  const toInstant = combineLocalDateTime(to, '23:59', timeZone).toISOString();

  const [tasksResult, sessionsResult, energyResult, reflectionsResult, goalsResult, progressResult, milestonesResult, recordsResult] =
    await Promise.all([
      db
        .from('scheduled_tasks')
        .select('*')
        .gte('scheduled_date', from)
        .lte('scheduled_date', to)
        .order('scheduled_date', { ascending: true }),
      db
        .from('task_sessions')
        .select('*')
        .gte('started_at', fromInstant)
        .lte('started_at', toInstant)
        .order('started_at', { ascending: true }),
      db
        .from('daily_energy_logs')
        .select('*')
        .gte('log_date', from)
        .lte('log_date', to)
        .order('log_date', { ascending: true }),
      db
        .from('daily_reflections')
        .select('*')
        .gte('reflection_date', from)
        .lte('reflection_date', to)
        .order('reflection_date', { ascending: true }),
      db.from('goals').select('*').order('created_at', { ascending: true }),
      db.from('v_goal_progress').select('*'),
      db.from('goal_milestones').select('*').order('sort_order', { ascending: true }),
      params.includeRecords === false ? Promise.resolve(null) : personalRecords(db),
    ]);

  const firstError =
    tasksResult.error ??
    sessionsResult.error ??
    energyResult.error ??
    reflectionsResult.error ??
    goalsResult.error ??
    progressResult.error ??
    milestonesResult.error;
  if (firstError) return fromPostgrest(firstError, 'We could not load your insights.');

  const tasks = tasksResult.data ?? [];

  // Tracked time is read from the view so it is the same arithmetic the
  // database uses, rather than a second implementation that could drift.
  let actuals: TaskActuals[] = [];
  if (tasks.length > 0) {
    const { data, error } = await db
      .from('v_task_actuals')
      .select('*')
      .in(
        'task_id',
        tasks.map((task) => task.id),
      );
    if (error) return fromPostgrest(error, 'We could not load your tracked time.');
    actuals = data ?? [];
  }

  return ok({
    from,
    to,
    timeZone,
    tasks,
    sessions: sessionsResult.data ?? [],
    actuals,
    energy: energyResult.data ?? [],
    reflections: reflectionsResult.data ?? [],
    goals: goalsResult.data ?? [],
    progress: progressResult.data ?? [],
    milestones: milestonesResult.data ?? [],
    records: recordsResult && recordsResult.ok ? recordsResult.data : null,
  });
}

/** Actuals keyed by task id, for the planned-vs-actual chart. */
export function actualsByTask(actuals: TaskActuals[]): Map<string, TaskActuals> {
  return new Map(actuals.map((row) => [row.task_id, row]));
}
