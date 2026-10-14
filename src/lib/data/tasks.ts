import type { DayKey, TimeString } from '@/lib/domain/time';
import { addDaysToKey, todayInZone } from '@/lib/domain/time';
import type { RoutineValues, TaskValues } from '@/lib/validation/schemas';
import type { MicroStepState, SessionKind, SessionStatus, TaskStatus, Tables } from '@/lib/types/database';
import { fail, fromPostgrest, ok, type Result } from './result';
import type { Db } from './types';

/**
 * Task, routine, session and micro-step access.
 *
 * Two rules are visible in almost every function here:
 *
 *   1. Anything that could break one of the day's invariants (one MAIN, the
 *      secondary cap, a single running timer) goes through a database function
 *      rather than a chain of client-side statements, so it is atomic.
 *   2. Nothing rewrites history. Editing a routine touches only future rows
 *      that are still `scheduled` and untouched.
 */

export type ScheduledTask = Tables<'scheduled_tasks'>;
export type TaskTemplate = Tables<'task_templates'>;
export type TaskSession = Tables<'task_sessions'>;
export type TaskSessionPause = Tables<'task_session_pauses'>;
export type MicroStep = Tables<'task_micro_steps'>;

/** How far ahead the materialiser keeps real rows for. */
export const SCHEDULE_HORIZON_DAYS = 120;

/* ── Reads ──────────────────────────────────────────────────────────────── */

export async function listTasksInRange(
  db: Db,
  from: DayKey,
  to: DayKey,
): Promise<Result<ScheduledTask[]>> {
  const { data, error } = await db
    .from('scheduled_tasks')
    .select('*')
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
    .order('scheduled_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) return fromPostgrest(error, 'We could not load your tasks.');
  return ok(data ?? []);
}

export async function listTasksForDay(db: Db, day: DayKey): Promise<Result<ScheduledTask[]>> {
  return listTasksInRange(db, day, day);
}

/**
 * Tasks that were never completed or explicitly dropped, on days before today.
 * These are shown as "moved on" rather than as failures.
 */
export async function listOpenPastTasks(
  db: Db,
  from: DayKey,
  asOf: DayKey,
): Promise<Result<ScheduledTask[]>> {
  const { data, error } = await db
    .from('scheduled_tasks')
    .select('*')
    .gte('scheduled_date', from)
    .lt('scheduled_date', asOf)
    .in('status', ['scheduled', 'in_progress'])
    .order('scheduled_date', { ascending: false });

  if (error) return fromPostgrest(error, 'We could not load earlier tasks.');
  return ok(data ?? []);
}

export async function listTemplates(db: Db): Promise<Result<TaskTemplate[]>> {
  const { data, error } = await db
    .from('task_templates')
    .select('*')
    .order('start_time', { ascending: true });

  if (error) return fromPostgrest(error, 'We could not load your routines.');
  return ok(data ?? []);
}

export async function getTemplate(db: Db, id: string): Promise<Result<TaskTemplate | null>> {
  const { data, error } = await db.from('task_templates').select('*').eq('id', id).maybeSingle();
  if (error) return fromPostgrest(error, 'We could not load that routine.');
  return ok(data ?? null);
}

export async function listMicroSteps(db: Db, taskIds: string[]): Promise<Result<MicroStep[]>> {
  if (taskIds.length === 0) return ok([]);
  const { data, error } = await db
    .from('task_micro_steps')
    .select('*')
    .in('task_id', taskIds)
    .order('ordinal', { ascending: true });

  if (error) return fromPostgrest(error, 'We could not load the steps for those tasks.');
  return ok(data ?? []);
}

/**
 * The open timer, if there is one.
 *
 * There is at most one by database constraint, so `maybeSingle` is safe and the
 * `[]` guard is only defensive.
 */
export async function getOpenSession(db: Db): Promise<Result<TaskSession | null>> {
  const { data, error } = await db
    .from('task_sessions')
    .select('*')
    .in('status', ['running', 'paused'])
    .limit(1)
    .maybeSingle();

  if (error) return fromPostgrest(error, 'We could not check for a running timer.');
  return ok(data ?? null);
}

export async function listSessionsInRange(
  db: Db,
  fromInstant: string,
  toInstant: string,
): Promise<Result<TaskSession[]>> {
  const { data, error } = await db
    .from('task_sessions')
    .select('*')
    .gte('started_at', fromInstant)
    .lte('started_at', toInstant)
    .order('started_at', { ascending: true });

  if (error) return fromPostgrest(error, 'We could not load your focus sessions.');
  return ok(data ?? []);
}

/**
 * The pause windows belonging to a set of sessions.
 *
 * Needed because a session stores an accumulated total rather than its
 * intervals; the pauses are what make it possible to draw what actually
 * happened on a timeline instead of a single opaque block.
 */
export async function listSessionPauses(
  db: Db,
  sessionIds: string[],
): Promise<Result<TaskSessionPause[]>> {
  if (sessionIds.length === 0) return ok([]);
  const { data, error } = await db
    .from('task_session_pauses')
    .select('*')
    .in('session_id', sessionIds)
    .order('paused_at', { ascending: true });

  if (error) return fromPostgrest(error, 'We could not load your timer history.');
  return ok(data ?? []);
}

/* ── Materialisation ────────────────────────────────────────────────────── */

/**
 * Ensures real rows exist for every recurring routine in the window.
 *
 * Idempotent: the unique index on `(template_id, occurrence_date)` means a
 * second call cannot duplicate a slot. Already-moved or completed occurrences
 * are left exactly as they are.
 */
export async function ensureRecurringInstances(
  db: Db,
  from?: DayKey,
  to?: DayKey,
): Promise<Result<number>> {
  const { data, error } = await db.rpc('rpc_ensure_recurring_instances', {
    p_from: from ?? undefined,
    p_to: to ?? undefined,
  });

  if (error) return fromPostgrest(error, 'We could not prepare your recurring tasks.');
  return ok(typeof data === 'number' ? data : 0);
}

/** Convenience wrapper for the common "keep the next four months real" call. */
export async function ensureScheduleHorizon(db: Db, timeZone: string): Promise<Result<number>> {
  const today = todayInZone(timeZone);
  return ensureRecurringInstances(db, today, addDaysToKey(today, SCHEDULE_HORIZON_DAYS));
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

/**
 * Creates a single, non-recurring task.
 *
 * The database may still refuse it — the secondary cap and the one-MAIN-per-day
 * rule are enforced by constraints, not here — and that refusal arrives as a
 * `Failure` with the calm explanation already attached.
 */
export async function createOneOffTask(
  db: Db,
  userId: string,
  values: TaskValues,
): Promise<Result<ScheduledTask>> {
  const { data, error } = await db
    .from('scheduled_tasks')
    .insert({
      user_id: userId,
      title: values.title,
      description: emptyToNull(values.description),
      category: values.category,
      priority: values.priority,
      status: 'scheduled',
      scheduled_date: values.scheduled_date,
      occurrence_date: null,
      start_time: values.start_time,
      duration_minutes: values.duration_minutes,
      goal_id: values.goal_id,
      reward_id: values.reward_id,
      reminder_minutes: values.reminder_minutes,
      checklist: values.checklist,
      notes: emptyToNull(values.notes),
      is_auto_generated: false,
      is_override: false,
    })
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That task was not saved.');
  return ok(data);
}

/** Creates a routine and immediately materialises its next occurrences. */
export async function createRoutine(
  db: Db,
  userId: string,
  values: RoutineValues,
): Promise<Result<TaskTemplate>> {
  const { data, error } = await db
    .from('task_templates')
    .insert({
      user_id: userId,
      title: values.title,
      description: emptyToNull(values.description),
      category: values.category,
      priority: values.priority,
      goal_id: values.goal_id,
      reward_id: values.reward_id,
      recurrence: values.recurrence,
      weekdays: values.weekdays,
      starts_on: values.starts_on,
      ends_on: values.ends_on,
      start_time: values.start_time,
      duration_minutes: values.duration_minutes,
      reminder_minutes: values.reminder_minutes,
      checklist: values.checklist,
      is_active: true,
    })
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That routine was not saved.');

  await ensureRecurringInstances(db, values.starts_on, addDaysToKey(values.starts_on, SCHEDULE_HORIZON_DAYS));
  return ok(data);
}

/** The subset of a task the editors are allowed to change. */
export interface TaskPatch {
  title?: string;
  description?: string | null;
  category?: TaskValues['category'];
  priority?: TaskValues['priority'];
  start_time?: TimeString;
  duration_minutes?: number;
  scheduled_date?: DayKey;
  goal_id?: string | null;
  reward_id?: string | null;
  reminder_minutes?: number | null;
  checklist?: string[];
  notes?: string | null;
}

export type EditScope = 'occurrence' | 'future' | 'series';

/**
 * Applies an edit.
 *
 * Scope is the whole point:
 *   · `occurrence` — this day only; the row is flagged as an override and the
 *                    rest of the series is untouched.
 *   · `future`     — this slot and every later one. The series is *split*: the
 *                    old template ends the day before, a new one begins here.
 *   · `series`     — the whole routine, past occurrences included in what the
 *                    pattern describes but never rewritten in what it recorded.
 */
export async function updateTaskWithScope(
  db: Db,
  taskId: string,
  scope: EditScope,
  patch: TaskPatch,
): Promise<Result<null>> {
  const { error } = await db.rpc('rpc_update_recurring_task', {
    p_task_id: taskId,
    p_scope: scope,
    p_patch: normalisePatch(patch),
  });

  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(null);
}

export async function deleteTaskWithScope(
  db: Db,
  taskId: string,
  scope: EditScope,
): Promise<Result<null>> {
  const { error } = await db.rpc('rpc_delete_recurring_task', {
    p_task_id: taskId,
    p_scope: scope,
  });

  if (error) return fromPostgrest(error, 'That was not removed.');
  return ok(null);
}

/**
 * Moves a task to another day (and optionally another time).
 *
 * A rescheduled task is reopened if it had been skipped: moving something is a
 * decision to do it, not a second way of dropping it.
 */
export async function rescheduleTask(
  db: Db,
  taskId: string,
  newDate: DayKey,
  newStartTime: TimeString | null = null,
  scope: EditScope = 'occurrence',
): Promise<Result<ScheduledTask>> {
  const { data, error } = await db.rpc('rpc_reschedule_task', {
    p_task_id: taskId,
    p_new_date: newDate,
    p_new_start_time: newStartTime ?? undefined,
    p_scope: scope,
  });

  if (error) return fromPostgrest(error, 'That task was not moved.');
  if (!data) return fail('That task was not moved.');
  return ok(data);
}

/** Promotes a task to MAIN, atomically demoting whatever held it. */
export async function setMainPriority(db: Db, taskId: string): Promise<Result<null>> {
  const { error } = await db.rpc('rpc_set_main_priority', { p_task_id: taskId });
  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(null);
}

/**
 * Direct status change.
 *
 * `completed` stamps `completed_at` and awards XP through database triggers, so
 * the client never writes those columns itself.
 */
export async function setTaskStatus(
  db: Db,
  taskId: string,
  status: Extract<TaskStatus, 'scheduled' | 'completed' | 'skipped' | 'cancelled'>,
): Promise<Result<ScheduledTask>> {
  const { data, error } = await db
    .from('scheduled_tasks')
    .update({ status })
    .eq('id', taskId)
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(data);
}

/** Reopens a completed or skipped task without touching anything already earned. */
export async function reopenTask(db: Db, taskId: string): Promise<Result<ScheduledTask>> {
  return setTaskStatus(db, taskId, 'scheduled');
}

/* ── Timer ──────────────────────────────────────────────────────────────── */

export interface StartSessionInput {
  taskId?: string | null;
  kind?: SessionKind;
  plannedSeconds?: number | null;
  /** `false` refuses to displace an open timer instead of closing it. */
  replaceOpen?: boolean;
}

/**
 * Starts a timer.
 *
 * Elapsed time is never sent to the server as a number — only `now()` is
 * recorded. Everything the UI shows is derived from the stored timestamps, so a
 * refresh or a suspended tab cannot lose or double-count time.
 *
 * If another timer is open it is closed cleanly first, which is why the caller
 * passes `replaceOpen: false` when the user has not opted into switching.
 */
export async function startSession(
  db: Db,
  input: StartSessionInput = {},
): Promise<Result<TaskSession>> {
  const { data, error } = await db.rpc('rpc_start_session', {
    p_task_id: input.taskId ?? undefined,
    p_kind: input.kind ?? 'focus',
    p_planned_seconds: input.plannedSeconds ?? undefined,
    p_replace_open: input.replaceOpen ?? true,
  });

  if (error) return fromPostgrest(error, 'The timer did not start.');
  if (!data) return fail('The timer did not start.');
  return ok(data);
}

export async function pauseSession(db: Db, sessionId: string): Promise<Result<TaskSession>> {
  const { data, error } = await db.rpc('rpc_pause_session', { p_session_id: sessionId });
  if (error) return fromPostgrest(error, 'The timer did not pause.');
  if (!data) return fail('The timer did not pause.');
  return ok(data);
}

export async function resumeSession(db: Db, sessionId: string): Promise<Result<TaskSession>> {
  const { data, error } = await db.rpc('rpc_resume_session', { p_session_id: sessionId });
  if (error) return fromPostgrest(error, 'The timer did not resume.');
  if (!data) return fail('The timer did not resume.');
  return ok(data);
}

export interface FinishSessionInput {
  sessionId: string;
  status?: Extract<SessionStatus, 'completed' | 'abandoned'>;
  /** True when finishing the timer also finishes the task. */
  completeTask?: boolean;
  note?: string | null;
}

export async function finishSession(
  db: Db,
  input: FinishSessionInput,
): Promise<Result<TaskSession>> {
  const { data, error } = await db.rpc('rpc_finish_session', {
    p_session_id: input.sessionId,
    p_status: input.status ?? 'completed',
    p_complete_task: input.completeTask ?? false,
    p_note: input.note ?? undefined,
  });

  if (error) return fromPostgrest(error, 'The session was not recorded.');
  if (!data) return fail('The session was not recorded.');
  return ok(data);
}

/**
 * Closes any timer left open — used when returning after a long absence, or
 * when the user chooses "stop and record". The time already spent is kept.
 */
export async function abandonOpenSessions(db: Db): Promise<Result<number>> {
  const { data, error } = await db.rpc('rpc_abandon_open_sessions');
  if (error) return fromPostgrest(error, 'We could not close the open timer.');
  return ok(typeof data === 'number' ? data : 0);
}

/* ── Micro-steps ────────────────────────────────────────────────────────── */

/**
 * Writes the suggested steps for a task.
 *
 * Existing steps are never overwritten — if the user has already begun working
 * through them, that progress stands.
 */
export async function seedMicroSteps(
  db: Db,
  taskId: string,
  titles: string[],
): Promise<Result<MicroStep[]>> {
  const { data, error } = await db.rpc('rpc_seed_micro_steps', {
    p_task_id: taskId,
    p_titles: titles,
  });

  if (error) return fromPostgrest(error, 'We could not prepare those steps.');
  return ok(data ?? []);
}

export async function setMicroStepState(
  db: Db,
  stepId: string,
  state: MicroStepState,
): Promise<Result<MicroStep>> {
  const { data, error } = await db.rpc('rpc_set_micro_step_state', {
    p_step_id: stepId,
    p_state: state,
  });

  if (error) return fromPostgrest(error, 'That step was not updated.');
  if (!data) return fail('That step was not updated.');
  return ok(data);
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * `rpc_update_recurring_task` distinguishes "field absent" from "field set to
 * null" using the `?` operator, so an explicit null has to survive the trip.
 */
function normalisePatch(patch: TaskPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}
