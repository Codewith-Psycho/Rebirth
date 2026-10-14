import type { GoalStatus, Tables, Views } from '@/lib/types/database';
import type { GoalValues, MilestoneValues } from '@/lib/validation/schemas';
import { fromPostgrest, ok, type Result } from './result';
import type { Db } from './types';

/**
 * Goals, milestones and their progress.
 *
 * "Progress" is never invented here. The database view reports four separate
 * measurements — effort, execution, milestone counts and the user's own
 * assessment — and `goalProgress()` in the domain layer decides which of them
 * the goal declared as its measurement method. Nothing computes a blended
 * productivity percentage, because no such number would be honest.
 */

export type Goal = Tables<'goals'>;
export type Milestone = Tables<'goal_milestones'>;
export type GoalProgress = Views<'v_goal_progress'>;

export async function listGoals(db: Db): Promise<Result<Goal[]>> {
  const { data, error } = await db
    .from('goals')
    .select('*')
    .order('status', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) return fromPostgrest(error, 'We could not load your goals.');
  return ok(data ?? []);
}

export async function getGoal(db: Db, id: string): Promise<Result<Goal | null>> {
  const { data, error } = await db.from('goals').select('*').eq('id', id).maybeSingle();
  if (error) return fromPostgrest(error, 'We could not load that goal.');
  return ok(data ?? null);
}

export async function listGoalProgress(db: Db): Promise<Result<GoalProgress[]>> {
  const { data, error } = await db.from('v_goal_progress').select('*');
  if (error) return fromPostgrest(error, 'We could not load your goal progress.');
  return ok(data ?? []);
}

export async function listMilestones(db: Db, goalIds?: string[]): Promise<Result<Milestone[]>> {
  let query = db.from('goal_milestones').select('*');
  if (goalIds && goalIds.length > 0) query = query.in('goal_id', goalIds);
  const { data, error } = await query.order('sort_order', { ascending: true });

  if (error) return fromPostgrest(error, 'We could not load your milestones.');
  return ok(data ?? []);
}

export async function createGoal(db: Db, userId: string, values: GoalValues): Promise<Result<Goal>> {
  const { data, error } = await db
    .from('goals')
    .insert({
      user_id: userId,
      title: values.title,
      description: emptyToNull(values.description),
      reason: emptyToNull(values.reason),
      category: values.category,
      measurement: values.measurement,
      target_date: values.target_date,
      target_minutes: values.target_minutes,
      target_sessions: values.target_sessions,
      manual_progress: values.manual_progress,
      status: 'active',
    })
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That goal was not saved.');
  return ok(data);
}

export async function updateGoal(
  db: Db,
  id: string,
  values: Partial<GoalValues>,
): Promise<Result<Goal>> {
  const patch: Record<string, unknown> = {};
  if (values.title !== undefined) patch['title'] = values.title;
  if (values.description !== undefined) patch['description'] = emptyToNull(values.description);
  if (values.reason !== undefined) patch['reason'] = emptyToNull(values.reason);
  if (values.category !== undefined) patch['category'] = values.category;
  if (values.measurement !== undefined) patch['measurement'] = values.measurement;
  if (values.target_date !== undefined) patch['target_date'] = values.target_date;
  if (values.target_minutes !== undefined) patch['target_minutes'] = values.target_minutes;
  if (values.target_sessions !== undefined) patch['target_sessions'] = values.target_sessions;
  if (values.manual_progress !== undefined) patch['manual_progress'] = values.manual_progress;

  const { data, error } = await db.from('goals').update(patch).eq('id', id).select('*').single();
  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(data);
}

/**
 * Changing status.
 *
 * `achieved` stamps the moment; anything else clears it. Reopening a goal never
 * touches XP or history — nothing earned is ever taken back.
 */
export async function setGoalStatus(
  db: Db,
  id: string,
  status: GoalStatus,
): Promise<Result<Goal>> {
  const { data, error } = await db
    .from('goals')
    .update({ status, achieved_at: status === 'achieved' ? new Date().toISOString() : null })
    .eq('id', id)
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(data);
}

/** Removes a goal. Linked tasks keep their history but lose the link. */
export async function deleteGoal(db: Db, id: string): Promise<Result<null>> {
  const { error } = await db.from('goals').delete().eq('id', id);
  if (error) return fromPostgrest(error, 'That goal was not deleted.');
  return ok(null);
}

/* ── Milestones ─────────────────────────────────────────────────────────── */

export async function createMilestone(
  db: Db,
  userId: string,
  values: MilestoneValues,
): Promise<Result<Milestone>> {
  const { data, error } = await db
    .from('goal_milestones')
    .insert({
      user_id: userId,
      goal_id: values.goal_id,
      title: values.title,
      description: emptyToNull(values.description),
      due_date: values.due_date,
      weight: values.weight,
      sort_order: values.sort_order,
    })
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That milestone was not saved.');
  return ok(data);
}

export async function updateMilestone(
  db: Db,
  id: string,
  values: Partial<MilestoneValues>,
): Promise<Result<Milestone>> {
  const patch: Record<string, unknown> = {};
  if (values.title !== undefined) patch['title'] = values.title;
  if (values.description !== undefined) patch['description'] = emptyToNull(values.description);
  if (values.due_date !== undefined) patch['due_date'] = values.due_date;
  if (values.weight !== undefined) patch['weight'] = values.weight;
  if (values.sort_order !== undefined) patch['sort_order'] = values.sort_order;

  const { data, error } = await db.from('goal_milestones').update(patch).eq('id', id).select('*').single();
  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(data);
}

/**
 * Marks a milestone reached, or un-marks it.
 *
 * The XP award is a database trigger keyed on the transition into `completed`,
 * with a unique index behind it, so re-saving the same milestone cannot pay out
 * twice — and un-marking never removes what was already earned.
 */
export async function setMilestoneCompleted(
  db: Db,
  id: string,
  completed: boolean,
): Promise<Result<Milestone>> {
  const { data, error } = await db
    .from('goal_milestones')
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq('id', id)
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(data);
}

export async function deleteMilestone(db: Db, id: string): Promise<Result<null>> {
  const { error } = await db.from('goal_milestones').delete().eq('id', id);
  if (error) return fromPostgrest(error, 'That milestone was not deleted.');
  return ok(null);
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** Goal id → title, for the many places that show a linked goal's name. */
export function goalTitleMap(goals: Goal[]): Map<string, string> {
  return new Map(goals.map((goal) => [goal.id, goal.title]));
}

export function progressMap(rows: GoalProgress[]): Map<string, GoalProgress> {
  return new Map(rows.map((row) => [row.goal_id, row]));
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
