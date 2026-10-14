import type { CalendarItem } from '@/lib/domain/calendar';
import type { DaySummary } from '@/lib/domain/analytics';
import { daySummary, toSessionFact, toTaskFact } from '@/lib/domain/analytics';
import { resolveDayMode, type DayModeResult } from '@/lib/domain/mode';
import { addDaysToKey, combineLocalDateTime, type DayKey } from '@/lib/domain/time';
import type { DailyQuoteResult } from '@/lib/types/database';
import type { CalendarWindow, ImportantPeriod } from './calendar';
import { listImportantPeriods, loadCalendarWindow } from './calendar';
import type { Goal, GoalProgress } from './goals';
import { goalTitleMap, listGoalProgress, listGoals } from './goals';
import type { EnergyLog, Reflection } from './practice';
import { listEnergyLogs, listReflections } from './practice';
import { dailyQuote } from './quotes';
import { ok, type Result } from './result';
import type { MicroStep, ScheduledTask, TaskSession, TaskSessionPause } from './tasks';
import {
  ensureRecurringInstances,
  getOpenSession,
  listMicroSteps,
  listOpenPastTasks,
  listSessionPauses,
  listSessionsInRange,
  listTasksForDay,
  listTasksInRange,
} from './tasks';
import type { Db } from './types';
import type { Preferences } from './settings';

/**
 * Everything the Today screen needs, in one consistent snapshot.
 *
 * One loader, not nine: the metrics, the task list, the timeline and the energy
 * cards are then all computed from the same instant. A page that fetched its
 * numbers at a different moment from its list is a page that can contradict
 * itself on screen, and the user has no way to tell which half is stale.
 *
 * This function runs on the server for the first paint and in the browser for
 * refreshes, so the numbers a user sees after Realtime fires are produced by
 * exactly the same code as the ones they saw on load.
 */

export interface TodayFacts {
  day: DayKey;
  timeZone: string;
  /** A non-fatal problem worth mentioning — never used to blank the screen. */
  warning: string | null;

  tasks: ScheduledTask[];
  /** Open tasks from the previous week, offered back rather than hidden. */
  carriedOver: ScheduledTask[];
  /*
   * The preceding five weeks, used for two things only: the streak a completion
   * message may legitimately mention, and the pace a routine usually runs at.
   * Both are facts about the records — neither is estimated.
   */
  historyTasks: ScheduledTask[];
  historySessions: TaskSession[];
  items: CalendarItem[];
  periods: ImportantPeriod[];

  sessions: TaskSession[];
  pauses: TaskSessionPause[];
  openSession: TaskSession | null;
  /** Yesterday's open timer, if it is still running past midnight. */
  spanningSession: boolean;

  microSteps: MicroStep[];
  energy: EnergyLog[];
  reflection: Reflection | null;

  goals: Goal[];
  progress: GoalProgress[];
  goalTitles: Map<string, string>;

  quote: DailyQuoteResult | null;
  dayMode: DayModeResult;
  summary: DaySummary;
}

export interface TodayParams {
  day: DayKey;
  timeZone: string;
  preferences: Preferences;
  /**
   * The server-corrected "now". Passed in rather than read here so that every
   * derived figure on the page agrees with the clock the timer is showing.
   */
  now: Date;
}

const LOOKBACK_DAYS = 7;
const LOOKAHEAD_DAYS = 14;
/** How far back completion messages are allowed to look for evidence. */
const HISTORY_DAYS = 35;

export async function loadToday(db: Db, params: TodayParams): Promise<Result<TodayFacts>> {
  const { day, timeZone, preferences, now } = params;

  const lookback = addDaysToKey(day, -LOOKBACK_DAYS);
  const lookahead = addDaysToKey(day, LOOKAHEAD_DAYS);

  /*
   * Materialise today's recurring tasks before reading them.
   *
   * A routine edited on another device, or one whose horizon has simply run
   * out, would otherwise be invisible here. This is idempotent — the unique
   * index on (template_id, occurrence_date) means a second call changes nothing
   * — and its failure is reported as a warning rather than an error, because a
   * maintenance step going wrong should not hide the day the user already has.
   */
  let warning: string | null = null;
  const ensured = await ensureRecurringInstances(db, day, lookahead);
  if (!ensured.ok) {
    warning =
      'Repeating routines could not be checked just now, so a recurring task may be missing from today. Reloading will try again — nothing you have already recorded is affected.';
  }

  const fromInstant = combineLocalDateTime(day, '00:00', timeZone).toISOString();
  const toInstant = combineLocalDateTime(day, '23:59:59', timeZone).toISOString();

  const historyFrom = addDaysToKey(day, -HISTORY_DAYS);
  const historyTo = addDaysToKey(day, -1);
  const historyFromInstant = combineLocalDateTime(historyFrom, '00:00', timeZone).toISOString();
  const historyToInstant = combineLocalDateTime(historyTo, '23:59:59', timeZone).toISOString();

  const [
    tasksResult,
    carriedResult,
    historyTasksResult,
    historySessionsResult,
    sessionsResult,
    openSessionResult,
    energyResult,
    reflectionsResult,
    goalsResult,
    progressResult,
    periodsResult,
    quoteResult,
  ] = await Promise.all([
    listTasksForDay(db, day),
    listOpenPastTasks(db, lookback, day),
    listTasksInRange(db, historyFrom, historyTo),
    listSessionsInRange(db, historyFromInstant, historyToInstant),
    listSessionsInRange(db, fromInstant, toInstant),
    getOpenSession(db),
    listEnergyLogs(db, day, day),
    listReflections(db, day, day),
    listGoals(db),
    listGoalProgress(db),
    listImportantPeriods(db, day, lookahead),
    dailyQuote(db, day),
  ]);

  const firstError =
    tasksResult.ok === false
      ? tasksResult
      : carriedResult.ok === false
        ? carriedResult
        : historyTasksResult.ok === false
          ? historyTasksResult
          : historySessionsResult.ok === false
            ? historySessionsResult
            : sessionsResult.ok === false
              ? sessionsResult
              : openSessionResult.ok === false
                ? openSessionResult
                : energyResult.ok === false
                  ? energyResult
                  : reflectionsResult.ok === false
                    ? reflectionsResult
                    : goalsResult.ok === false
                      ? goalsResult
                      : progressResult.ok === false
                        ? progressResult
                        : periodsResult.ok === false
                          ? periodsResult
                          : null;

  if (firstError) return firstError;

  const tasks = tasksResult.ok ? tasksResult.data : [];
  const carriedOver = carriedResult.ok ? carriedResult.data : [];
  const historyTasks = historyTasksResult.ok ? historyTasksResult.data : [];
  const historySessions = historySessionsResult.ok ? historySessionsResult.data : [];
  const sessions = sessionsResult.ok ? sessionsResult.data : [];
  const openSession = openSessionResult.ok ? openSessionResult.data : null;
  const energy = energyResult.ok ? energyResult.data : [];
  const reflection = reflectionsResult.ok ? (reflectionsResult.data[0] ?? null) : null;
  const goals = goalsResult.ok ? goalsResult.data : [];
  const progress = progressResult.ok ? progressResult.data : [];
  const periods = periodsResult.ok ? periodsResult.data : [];

  /*
   * A timer started late yesterday and still open belongs to today's timeline as
   * well as to yesterday's. It is added rather than replaced so the session is
   * drawn continuously across the boundary.
   */
  const spanningSession =
    openSession !== null && new Date(openSession.started_at).toISOString() < fromInstant;
  const allSessions =
    openSession && spanningSession && !sessions.some((s) => s.id === openSession.id)
      ? [openSession, ...sessions]
      : sessions;

  const taskIds = [...tasks, ...carriedOver].map((task) => task.id);
  const sessionIds = allSessions.map((session) => session.id);

  const [stepsResult, pausesResult] = await Promise.all([
    listMicroSteps(db, taskIds),
    listSessionPauses(db, sessionIds),
  ]);

  if (!stepsResult.ok) return stepsResult;
  if (!pausesResult.ok) return pausesResult;

  const goalTitles = goalTitleMap(goals);

  const windowResult: Result<CalendarWindow> = await loadCalendarWindow(db, {
    from: day,
    to: day,
    asOf: day,
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

  const dayMode = resolveDayMode({
    day,
    plannerDay: preferences.planner_day,
    override: preferences.day_mode_override,
    pressureEvents: periods.map((period) => ({
      title: period.title,
      startsOn: period.starts_on,
      endsOn: period.ends_on,
      pressureLeadDays: period.pressure_lead_days,
      recoveryDays: period.recovery_days,
    })),
  });

  const summary = daySummary(
    day,
    tasks.map(toTaskFact),
    allSessions.map(toSessionFact),
    energy,
    now,
  );

  return ok({
    day,
    timeZone,
    warning,
    tasks,
    carriedOver,
    historyTasks,
    historySessions,
    items: windowResult.data.items,
    periods,
    sessions: allSessions,
    pauses: pausesResult.data,
    openSession,
    spanningSession,
    microSteps: stepsResult.data,
    energy,
    reflection,
    goals,
    progress,
    goalTitles,
    quote: quoteResult.ok ? quoteResult.data : null,
    dayMode,
    summary,
  });
}
