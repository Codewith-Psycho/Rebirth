import type { GoalMeasurement } from '@/lib/types/database';

/**
 * Contextual messages.
 *
 * Two rules govern everything in this file:
 *
 *   1. **A message must be earned by a recorded fact.** Every message carries
 *      a `basis` array naming the numbers it was derived from, and the UI shows
 *      it. If nothing was recorded, no message is produced.
 *   2. **Effort is never presented as mastery.** Completing today's practice is
 *      reported as today's practice. It is never converted into "you are now
 *      X% better at this", because the app cannot know that.
 *
 * Variety is achieved by choosing among the candidates that the recorded facts
 * actually qualify for, seeded by a stable key, so the same completion does not
 * produce a different sentence on every render.
 */

export interface CompletionFacts {
  taskTitle: string;
  goalTitle: string | null;
  goalMeasurement: GoalMeasurement | null;
  /** Minutes of active focus actually tracked against this task. */
  trackedMinutes: number;
  /** Minutes previously tracked on this same routine, when there is history. */
  usualMinutesForRoutine: number | null;
  /** Negative means started earlier than the same weekday last week. */
  startDeltaVsLastWeek: number | null;
  sessionsForGoal: number;
  completedTasksForGoal: number;
  milestonesReachedNow: number;
  totalMilestones: number;
  streakDays: number;
  isFirstEverCompletion: boolean;
  isFirstForGoal: boolean;
  /** Days since the previous completion, when returning after a gap. */
  gapDays: number | null;
  seed: string;
}

export interface CompletionMessage {
  headline: string;
  body: string;
  /** The recorded numbers this message rests on. Rendered under the message. */
  basis: string[];
  tone: 'goal' | 'effort' | 'progress' | 'recovery';
}

/* ── Message libraries ──────────────────────────────────────────────────── */

const GOAL_LINES: Array<(f: CompletionFacts) => string> = [
  (f) => `That is another piece of work done for ${f.goalTitle}.`,
  (f) => `${f.taskTitle} is complete, and it counts toward ${f.goalTitle}.`,
  (f) => `You kept the promise you made to ${f.goalTitle} today.`,
  (f) => `Another ordinary day, another deposit into ${f.goalTitle}.`,
  (f) => `${f.goalTitle} moved forward by exactly one session today. That is how it moves.`,
];

const GOAL_EFFORT_LINES: Array<(f: CompletionFacts) => string> = [
  (f) =>
    `You showed up for ${f.goalTitle} and completed today's work. Consistency is built out of unremarkable days like this one.`,
  (f) =>
    `Today's ${f.goalTitle} session is on the record. Effort you can point at is worth more than effort you meant to make.`,
  (f) =>
    `${f.trackedMinutes} focused minutes went into ${f.goalTitle} today. That is the part you control, and you did it.`,
];

const PROGRESS_LINES: Array<(f: CompletionFacts) => string> = [
  (f) => `That is ${f.completedTasksForGoal} tasks completed toward ${f.goalTitle} so far.`,
  (f) => `${f.sessionsForGoal} sessions logged for ${f.goalTitle} now.`,
  (f) =>
    `You're one step closer to ${lowerFirst(f.goalTitle ?? 'your goal')}. Today's practice is on the record.`,
];

const MILESTONE_LINES: Array<(f: CompletionFacts) => string> = [
  (f) =>
    `A milestone for ${f.goalTitle} is marked complete. That is an achievement recorded, not an estimate — ${f.milestonesReachedNow} of ${f.totalMilestones} reached.`,
];

const EFFORT_LINES: string[] = [
  'Done. That is one less thing waiting for you.',
  'You started before you felt like it. That is the whole trick.',
  'Finished. The next one starts easier because of this one.',
  'That counts. Small, repeated, unremarkable — that is what progress usually looks like from the inside.',
  'You chose the task over the avoidance. Worth noticing.',
];

const STREAK_LINES: Array<(f: CompletionFacts) => string> = [
  (f) => `${f.streakDays} days in a row with something completed. The rhythm is doing the work now.`,
  (f) => `Day ${f.streakDays} of the current run. Nothing dramatic — which is the point.`,
];

const EARLIER_LINES: Array<(f: CompletionFacts) => string> = [
  (f) =>
    `You started ${Math.abs(f.startDeltaVsLastWeek ?? 0)} minutes earlier than the same day last week. Small changes like this are how consistency gets easier.`,
];

const RECOVERY_LINES: Array<(f: CompletionFacts) => string> = [
  (f) =>
    `${f.gapDays ?? 0} days since the last completed task, and you came back to it anyway. Returning is the skill that matters most.`,
  () => 'You picked the thread back up. That is a return, and returns are what consistency is actually made of.',
];

const FIRST_EVER_LINES: string[] = [
  'First completed task. From here the numbers come from what you actually do — nothing in this app is invented.',
  'That is the first one on the record. Everything measured from now on is real.',
];

const FIRST_FOR_GOAL_LINES: Array<(f: CompletionFacts) => string> = [
  (f) => `First completed task for ${f.goalTitle}. The goal now has something real to measure.`,
];

const LONGER_LINES: Array<(f: CompletionFacts) => string> = [
  (f) =>
    `${f.trackedMinutes} focused minutes, against about ${f.usualMinutesForRoutine} minutes on this routine before. Worth noticing, not worth demanding.`,
];

/* ── Selection ──────────────────────────────────────────────────────────── */

export function completionMessage(facts: CompletionFacts): CompletionMessage {
  const basis = buildBasis(facts);
  const candidates: Array<{ tone: CompletionMessage['tone']; body: string }> = [];

  if (facts.isFirstEverCompletion) {
    candidates.push({ tone: 'progress', body: pick(FIRST_EVER_LINES, facts.seed) });
  }

  if (facts.goalTitle) {
    if (facts.milestonesReachedNow > 0) {
      candidates.push({ tone: 'progress', body: pick(MILESTONE_LINES, `${facts.seed}:milestone`)(facts) });
    }
    if (facts.isFirstForGoal) {
      candidates.push({ tone: 'goal', body: pick(FIRST_FOR_GOAL_LINES, `${facts.seed}:firstgoal`)(facts) });
    }
    if (facts.trackedMinutes > 0) {
      candidates.push({ tone: 'goal', body: pick(GOAL_EFFORT_LINES, `${facts.seed}:effort`)(facts) });
    }
    if (facts.completedTasksForGoal >= 3 || facts.sessionsForGoal >= 3) {
      candidates.push({ tone: 'progress', body: pick(PROGRESS_LINES, `${facts.seed}:progress`)(facts) });
    }
    candidates.push({ tone: 'goal', body: pick(GOAL_LINES, `${facts.seed}:goal`)(facts) });
  } else {
    candidates.push({ tone: 'effort', body: pick(EFFORT_LINES, `${facts.seed}:effort`) });
  }

  if (facts.startDeltaVsLastWeek !== null && facts.startDeltaVsLastWeek <= -5) {
    candidates.push({ tone: 'progress', body: pick(EARLIER_LINES, `${facts.seed}:earlier`)(facts) });
  }

  if (
    facts.usualMinutesForRoutine !== null &&
    facts.usualMinutesForRoutine > 0 &&
    facts.trackedMinutes >= facts.usualMinutesForRoutine * 1.25 &&
    facts.trackedMinutes >= 10
  ) {
    candidates.push({ tone: 'effort', body: pick(LONGER_LINES, `${facts.seed}:longer`)(facts) });
  }

  if (facts.streakDays >= 3) {
    candidates.push({ tone: 'progress', body: pick(STREAK_LINES, `${facts.seed}:streak`)(facts) });
  }

  if (facts.gapDays !== null && facts.gapDays >= 3) {
    candidates.push({ tone: 'recovery', body: pick(RECOVERY_LINES, `${facts.seed}:recovery`)(facts) });
  }

  if (candidates.length === 0) {
    candidates.push({ tone: 'effort', body: pick(EFFORT_LINES, `${facts.seed}:effort`) });
  }

  const chosen = candidates[stableIndex(facts.seed, candidates.length)] ?? candidates[0]!;

  return {
    headline: facts.goalTitle ? `Toward ${facts.goalTitle}` : 'Task complete',
    body: chosen.body,
    basis,
    tone: chosen.tone,
  };
}

function buildBasis(facts: CompletionFacts): string[] {
  const basis: string[] = [];
  if (facts.trackedMinutes > 0) {
    basis.push(`${facts.trackedMinutes} focused minute${facts.trackedMinutes === 1 ? '' : 's'} tracked on this task`);
  } else {
    basis.push('Completed without a tracked timer');
  }
  if (facts.goalTitle) {
    basis.push(
      `${facts.completedTasksForGoal} completed task${facts.completedTasksForGoal === 1 ? '' : 's'} and ${
        facts.sessionsForGoal
      } session${facts.sessionsForGoal === 1 ? '' : 's'} recorded for this goal`,
    );
  }
  if (facts.totalMilestones > 0) {
    basis.push(`${facts.milestonesReachedNow} of ${facts.totalMilestones} milestones reached`);
  }
  if (facts.startDeltaVsLastWeek !== null) {
    basis.push(
      facts.startDeltaVsLastWeek <= 0
        ? `Started ${Math.abs(facts.startDeltaVsLastWeek)} minutes earlier than the same day last week`
        : `Started ${facts.startDeltaVsLastWeek} minutes later than the same day last week`,
    );
  }
  if (facts.streakDays > 1) {
    basis.push(`${facts.streakDays} consecutive days with a completed task`);
  }
  if (facts.gapDays !== null) {
    basis.push(`${facts.gapDays} days since the previous completed task`);
  }
  return basis;
}

/** "Still not finished" is a state, not a failing. Copy for partial attempts. */
export function attemptMessage(seconds: number, taskTitle: string): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) {
    return `You opened ${taskTitle} and stayed with it. That is the part that was hard. Nothing is lost — the attempt is recorded.`;
  }
  if (minutes < 5) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} on ${taskTitle}. Short attempts still count as showing up, and they make the next one cheaper.`;
  }
  return `${minutes} minutes on ${taskTitle}. Not finished, and still forward. The record is honest about both.`;
}

export function inactivityNudge(taskTitle: string, hours: number): string {
  return `${taskTitle} has been waiting ${Math.round(hours)} hours. Just open it. Two minutes.`;
}

/** Copy for the escape-limit guard. Calm, actionable, never scolding. */
export function escapeLimitMessage(minutes: number, limitMinutes: number): string {
  return `You have logged ${minutes} minutes of escape time today against a ${limitMinutes}-minute limit. Pause. Take a five-minute walk, then return to one task.`;
}

export function overloadMessage(tasksNotFitting: number, minutesOver: number): string {
  return `${tasksNotFitting} task${tasksNotFitting === 1 ? '' : 's'} do not fit in the time left today — about ${minutesOver} minutes over. Moving one to tomorrow is a plan, not a failure.`;
}

export function milestoneMessage(milestoneTitle: string, goalTitle: string): string {
  return `${milestoneTitle} is complete. That is a real checkpoint toward ${goalTitle} — recorded, not estimated.`;
}

/* ── Deterministic variety ──────────────────────────────────────────────── */

function stableIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  return hashString(seed) % length;
}

/*
 * Selection is driven entirely by `seed`. A call site that needs a different
 * line for a different family folds the family into the seed itself
 * (e.g. `${seed}:milestone`).
 */
function pick<T>(options: T[], seed: string): T {
  return options[stableIndex(seed, options.length)] ?? options[0]!;
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * Copy for the day's small motivational line. These are original REBIRTH
 * lines, distinct from the quote library, and are never attributed to anyone.
 */
export const DAILY_LINES: string[] = [
  'You do not need to finish everything. Start with two minutes.',
  'A smaller step still counts.',
  'Let’s make tomorrow a little easier.',
  'The plan can bend. The direction does not have to.',
  'One honest hour beats six imagined ones.',
  'Start before you are interested. Interest usually turns up once you have.',
];

export function dailyLine(day: string): string {
  return DAILY_LINES[stableIndex(`daily:${day}`, DAILY_LINES.length)] ?? DAILY_LINES[0]!;
}
