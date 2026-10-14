import { toTaskFact, streakInfo } from './analytics';
import { completionMessage, type CompletionFacts, type CompletionMessage } from './messages';
import { activeSeconds } from './timer';
import {
  addDaysToKey,
  diffInDays,
  timeToMinutes,
  type DayKey,
} from './time';
import type { GoalMeasurement, TaskSessionRow, ScheduledTaskRow } from '@/lib/types/database';

/**
 * Turning a genuine completion into an earned sentence.
 *
 * The message library in `messages.ts` refuses to speak without facts, so this
 * module's whole job is to supply them honestly. Where a fact is unavailable it
 * is passed as `null` or `0`, which makes the corresponding line ineligible —
 * that is the intended behaviour. A sentence the app cannot support is a
 * sentence the app should not print.
 */

export interface CompletionContext {
  task: Pick<
    ScheduledTaskRow,
    'id' | 'title' | 'template_id' | 'goal_id' | 'scheduled_date' | 'start_time'
  >;
  /** The user's local day, which is the day the completion belongs to. */
  day: DayKey;
  now: Date;
  /** Today's rows, including the task being completed. */
  todayTasks: ScheduledTaskRow[];
  todaySessions: TaskSessionRow[];
  /** Completed and open rows from the preceding weeks, for streak and pace. */
  historyTasks: ScheduledTaskRow[];
  historySessions: TaskSessionRow[];
  goalMeasurements: Map<string, GoalMeasurement>;
  goalTitles: Map<string, string>;
  progress: Array<{
    goal_id: string;
    sessions_completed: number;
    tasks_completed: number;
    milestones_done: number;
    milestones_total: number;
  }>;
}

/** Active seconds on a session, derived from its stored timestamps. */
function sessionSeconds(session: TaskSessionRow, now: Date): number {
  return activeSeconds(session, now);
}

/** Every session belonging to one task. */
function sessionsForTask(sessions: TaskSessionRow[], taskId: string): TaskSessionRow[] {
  return sessions.filter((session) => session.task_id === taskId);
}

export function buildCompletionFacts(context: CompletionContext): CompletionFacts {
  const {
    task,
    day,
    now,
    todayTasks,
    todaySessions,
    historyTasks,
    historySessions,
    goalMeasurements,
    goalTitles,
    progress,
  } = context;

  const trackedSeconds = sessionsForTask(todaySessions, task.id).reduce(
    (sum, session) => sum + sessionSeconds(session, now),
    0,
  );
  const trackedMinutes = Math.round(trackedSeconds / 60);

  /*
   * The pace this routine usually runs at. Computed per *session* rather than
   * per day so a routine done twice on one day does not skew the baseline.
   */
  const templateId = task.template_id;
  const routineSessions =
    templateId === null
      ? []
      : historySessions.filter((session) =>
          historyTasks.some((row) => row.id === session.task_id && row.template_id === templateId),
        );
  const usualMinutesForRoutine =
    routineSessions.length === 0
      ? null
      : Math.max(
          1,
          Math.round(
            routineSessions.reduce((sum, session) => sum + sessionSeconds(session, now), 0) /
              60 /
              routineSessions.length,
          ),
        );

  /*
   * Whether the user started earlier than the same weekday last week. Only
   * reported when a comparable occurrence actually exists — the alternative is
   * to invent a comparison, and an invented comparison is a lie about progress.
   */
  const previousWeekDay = addDaysToKey(day, -7);
  const comparable =
    templateId === null
      ? null
      : historyTasks.find(
          (row) => row.template_id === templateId && row.scheduled_date === previousWeekDay,
        ) ?? null;
  const startDeltaVsLastWeek =
    comparable === null
      ? null
      : timeToMinutes(task.start_time) - timeToMinutes(comparable.start_time);

  const goalId = task.goal_id;
  const goalProgress = goalId ? progress.find((row) => row.goal_id === goalId) ?? null : null;

  const completedDays = [...historyTasks, ...todayTasks]
    .filter((row) => row.status === 'completed')
    .map((row) => row.scheduled_date);

  const historyCompleted = historyTasks.filter((row) => row.status === 'completed');
  const lastCompletionDay =
    historyCompleted.length === 0
      ? null
      : historyCompleted
          .map((row) => row.scheduled_date)
          .sort()
          .at(-1) ?? null;

  const streak = streakInfo([...historyTasks, ...todayTasks].map(toTaskFact), day);

  return {
    taskTitle: task.title,
    goalTitle: goalId ? (goalTitles.get(goalId) ?? null) : null,
    goalMeasurement: goalId ? (goalMeasurements.get(goalId) ?? null) : null,
    trackedMinutes,
    usualMinutesForRoutine,
    startDeltaVsLastWeek,
    sessionsForGoal: goalProgress?.sessions_completed ?? 0,
    completedTasksForGoal: goalProgress?.tasks_completed ?? 0,
    milestonesReachedNow: goalProgress?.milestones_done ?? 0,
    totalMilestones: goalProgress?.milestones_total ?? 0,
    // `streakInfo` already treats an open today as unbroken, so a completion
    // being announced now is counted by the same rule as one already stored.
    streakDays: streak.current,
    isFirstEverCompletion: completedDays.length === 0,
    isFirstForGoal:
      goalId !== null && !historyTasks.some((row) => row.status === 'completed' && row.goal_id === goalId),
    gapDays: lastCompletionDay === null ? null : Math.max(0, diffInDays(day, lastCompletionDay)),
    seed: `${task.id}:${task.scheduled_date}`,
  };
}

export function completionFor(context: CompletionContext): CompletionMessage {
  return completionMessage(buildCompletionFacts(context));
}

/** A one-line summary of a completed day, for the header. Built from the same
 * records as everything else, and stays silent when there is nothing to say. */
export function dayProgressLine(completed: number, planned: number, trackedMinutes: number): string | null {
  if (planned === 0) return null;
  if (completed === 0) {
    return trackedMinutes > 0
      ? `${trackedMinutes} minutes tracked. The first completion is still ahead of you, and that is fine.`
      : null;
  }
  if (completed >= planned) {
    return 'Everything you planned for today has been done. The rest of the day is yours.';
  }
  return `${completed} of ${planned} done. The remainder is a list, not an obligation.`;
}
