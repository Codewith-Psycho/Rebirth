import type { ScheduledTaskRow, TaskPriority } from '@/lib/types/database';
import { type DayKey } from './time';

/**
 * Daily capacity limits.
 *
 * The authoritative enforcement lives in the database
 * (`enforce_daily_task_limits` trigger plus the partial unique index for MAIN).
 * These functions exist so the interface can explain the limit *before* the
 * user hits it, and so the behaviour can be unit-tested without a database.
 * If the two ever disagree, the database wins — that is the point of putting
 * the rule there.
 */

export type TaskLike = Pick<
  ScheduledTaskRow,
  'id' | 'scheduled_date' | 'priority' | 'status' | 'title'
>;

const OPEN_STATUSES = new Set(['scheduled', 'in_progress']);

export function isOpenTask(task: TaskLike): boolean {
  return OPEN_STATUSES.has(task.status);
}

export interface CapSummary {
  day: DayKey;
  cap: number;
  used: number;
  remaining: number;
  canAddSecondary: boolean;
  /** Human explanation, shown before the action is attempted. */
  blockedReason: string | null;
  openTasks: TaskLike[];
  /** Tasks that could be replaced to make room, best candidate first. */
  replaceable: TaskLike[];
}

export function capSummary(tasks: TaskLike[], day: DayKey, cap: number): CapSummary {
  const todays = tasks.filter((t) => t.scheduled_date === day);
  const openSecondary = todays.filter((t) => t.priority === 'secondary' && isOpenTask(t));
  const used = openSecondary.length;
  const remaining = Math.max(0, cap - used);
  const canAddSecondary = remaining > 0;

  return {
    day,
    cap,
    used,
    remaining,
    canAddSecondary,
    blockedReason: canAddSecondary
      ? null
      : `Today already holds ${cap} tasks besides the main one. Move one to another day, or replace one — the limit exists so the plan stays achievable, not to judge the day.`,
    openTasks: todays.filter(isOpenTask),
    replaceable: [...openSecondary].sort((a, b) => {
      // Suggest replacing the one that is least likely to be the point of the
      // day: not started, and later in the schedule.
      return (a.title > b.title ? 1 : -1);
    }),
  };
}

export function mainForDay<T extends TaskLike>(tasks: T[], day: DayKey): T | null {
  return (
    tasks.find(
      (t) =>
        t.scheduled_date === day &&
        t.priority === 'main' &&
        t.status !== 'cancelled' &&
        t.status !== 'skipped',
    ) ?? null
  );
}

export interface MainAssignmentCheck {
  ok: boolean;
  /** The task that would be demoted, if any. Shown in the confirmation copy. */
  displaced: TaskLike | null;
  message: string;
}

export function checkMainAssignment(
  tasks: TaskLike[],
  day: DayKey,
  candidateId: string,
): MainAssignmentCheck {
  const current = mainForDay(tasks, day);
  if (!current || current.id === candidateId) {
    return { ok: true, displaced: null, message: 'This will be the MAIN priority for the day.' };
  }
  return {
    ok: true,
    displaced: current,
    message: `"${current.title}" is currently the MAIN priority. It will become a secondary task, and there is only ever one MAIN per day.`,
  };
}

/** Mirrors the pending-secondary count so the UI can warn without a round trip. */
export function wouldExceedCap(
  tasks: TaskLike[],
  day: DayKey,
  cap: number,
  options: { replacingId?: string | null; priority?: TaskPriority } = {},
): boolean {
  const { replacingId = null, priority = 'secondary' } = options;
  if (priority === 'main') return false;
  const openSecondary = tasks.filter(
    (t) => t.scheduled_date === day && t.priority === 'secondary' && isOpenTask(t) && t.id !== replacingId,
  );
  return openSecondary.length >= cap;
}

/**
 * Interprets the database's refusal so the user never sees a raw error code.
 * Postgres surfaces the `hint` set by the trigger.
 */
export function explainDatabaseError(message: string, hint?: string | null): string {
  const text = `${message} ${hint ?? ''}`.toLowerCase();
  if (text.includes('daily_secondary_limit') || text.includes('secondary tasks')) {
    return 'That would take the day past your secondary-task limit. Move one to another day, or replace one.';
  }
  if (text.includes('scheduled_tasks_one_main_per_day') || text.includes('duplicate key')) {
    return 'There is already a MAIN priority for that day. Choose it again to make the swap.';
  }
  if (text.includes('timer_already_running')) {
    return 'A timer is already running. Stop it first, or choose to replace it.';
  }
  if (text.includes('reward_not_eligible')) {
    return 'That reward has not been earned yet — its condition is not met.';
  }
  if (text.includes('reward_already_claimed')) {
    return 'You have already claimed this reward for this period.';
  }
  if (text.includes('not_authenticated')) {
    return 'Your session has expired. Sign in again and the change will be there to make.';
  }
  if (text.includes('task_not_found')) {
    return 'That task no longer exists. It may have been removed on another device.';
  }
  if (text.includes('future_move_into_past')) {
    return 'A whole-routine move can only go to today or a later day. Choose "Only this one" to move this occurrence earlier.';
  }
  if (text.includes('row level security') || text.includes('permission denied')) {
    return 'You do not have access to that record.';
  }
  return message;
}
