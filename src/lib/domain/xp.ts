import type { XpSource } from '@/lib/types/database';

/**
 * XP and achievements.
 *
 * Two invariants, both enforced by the database rather than by convention:
 *
 *   · XP is **append-only**. The total is always `sum(amount)` over the
 *     `xp_events` table, and a check constraint makes a negative amount an
 *     impossible row. Nothing in this app can take earned XP away.
 *   · Achievements are **derived from records**, not from a counter. The stored
 *     row exists only so the first unlock is not announced twice.
 */

export const LEVEL_TITLES = [
  'Beginning',
  'Apprentice',
  'Steady',
  'Consistent',
  'Disciplined',
  'Composed',
  'Unhurried',
  'Established',
] as const;

export interface LevelInfo {
  level: number;
  title: string;
  totalXp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  /** 0–1 */
  progress: number;
  isMaxLevel: boolean;
}

/** Triangular curve: reaching level L needs 100·(L−1)·L/2 total XP. */
export function cumulativeXpForLevel(level: number): number {
  if (level <= 1) return 0;
  return (100 * (level - 1) * level) / 2;
}

export function levelFromXp(totalXp: number): LevelInfo {
  const safeTotal = Math.max(0, Math.floor(totalXp));
  let level = 1;
  while (level < 99 && cumulativeXpForLevel(level + 1) <= safeTotal) {
    level += 1;
  }
  const floorXp = cumulativeXpForLevel(level);
  const ceilingXp = cumulativeXpForLevel(level + 1);
  const span = ceilingXp - floorXp;
  // Titles stop growing at level 8; the curve itself keeps going indefinitely.
  const isMaxLevel = false;

  return {
    level,
    title: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)] ?? 'Steady',
    totalXp: safeTotal,
    xpIntoLevel: safeTotal - floorXp,
    xpForNextLevel: span,
    progress: span <= 0 ? 1 : (safeTotal - floorXp) / span,
    isMaxLevel,
  };
}

export const XP_SOURCE_LABELS: Record<XpSource, string> = {
  session: 'Focus session',
  task_completion: 'Task completed',
  goal_milestone: 'Milestone reached',
  consistency: 'Consistent week',
  reward: 'Reward claimed',
};

/* ── Achievements ───────────────────────────────────────────────────────── */

export interface AchievementFacts {
  completedTasks: number;
  completedSessions: number;
  twoMinuteStarts: number;
  longestStreak: number;
  bestFocusDayMinutes: number;
  earliestSessionHour: number | null;
  completedMilestones: number;
  bestWeekConsistency: number | null;
  /** Completed a task after a gap of three days or more. */
  hasReturnedAfterGap: boolean;
  /** Days on which at least one task was completed, as day keys. */
  completionDays: string[];
}

export interface AchievementDefinition {
  key: string;
  title: string;
  description: string;
  icon: string;
  achieved: (facts: AchievementFacts) => boolean;
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    key: 'first_step',
    title: 'The first step',
    description: 'Complete your first task.',
    icon: 'Footprints',
    achieved: (f) => f.completedTasks >= 1,
  },
  {
    key: 'first_session',
    title: 'First focus session',
    description: 'Finish a timed focus session.',
    icon: 'Timer',
    achieved: (f) => f.completedSessions >= 1,
  },
  {
    key: 'first_two_minute',
    title: 'Two minutes',
    description: 'Start a task with a two-minute attempt.',
    icon: 'PlayCircle',
    achieved: (f) => f.twoMinuteStarts >= 1,
  },
  {
    key: 'ten_sessions',
    title: 'Ten sessions in',
    description: 'Complete ten focus sessions.',
    icon: 'Layers',
    achieved: (f) => f.completedSessions >= 10,
  },
  {
    key: 'fifty_sessions',
    title: 'Fifty sessions in',
    description: 'Complete fifty focus sessions.',
    icon: 'Layers',
    achieved: (f) => f.completedSessions >= 50,
  },
  {
    key: 'ten_tasks',
    title: 'Ten completed',
    description: 'Complete ten tasks.',
    icon: 'CheckCheck',
    achieved: (f) => f.completedTasks >= 10,
  },
  {
    key: 'fifty_tasks',
    title: 'Fifty completed',
    description: 'Complete fifty tasks.',
    icon: 'CheckCheck',
    achieved: (f) => f.completedTasks >= 50,
  },
  {
    key: 'week_rhythm',
    title: 'Seven days',
    description: 'Complete something seven days in a row.',
    icon: 'CalendarCheck',
    achieved: (f) => f.longestStreak >= 7,
  },
  {
    key: 'month_rhythm',
    title: 'Thirty days',
    description: 'Complete something thirty days in a row.',
    icon: 'CalendarCheck',
    achieved: (f) => f.longestStreak >= 30,
  },
  {
    key: 'deep_day',
    title: 'A deep day',
    description: 'Track five hours of focus in a single day.',
    icon: 'Mountain',
    achieved: (f) => f.bestFocusDayMinutes >= 300,
  },
  {
    key: 'early_start',
    title: 'Before the day starts',
    description: 'Begin a session before 07:30.',
    icon: 'Sunrise',
    achieved: (f) => f.earliestSessionHour !== null && f.earliestSessionHour < 7,
  },
  {
    key: 'first_milestone',
    title: 'Checkpoint reached',
    description: 'Complete a goal milestone.',
    icon: 'Flag',
    achieved: (f) => f.completedMilestones >= 1,
  },
  {
    key: 'consistent_week',
    title: 'A consistent week',
    description: 'Reach 80% consistency across a full week.',
    icon: 'TrendingUp',
    achieved: (f) => f.bestWeekConsistency !== null && f.bestWeekConsistency >= 80,
  },
  {
    key: 'returned',
    title: 'You came back',
    description: 'Return to a task after a gap of three days or more.',
    icon: 'Undo2',
    achieved: (f) => f.hasReturnedAfterGap,
  },
];

export function evaluateAchievements(facts: AchievementFacts): string[] {
  return ACHIEVEMENTS.filter((a) => a.achieved(facts)).map((a) => a.key);
}

export function describeUnlocked(key: string): AchievementDefinition | null {
  return ACHIEVEMENTS.find((a) => a.key === key) ?? null;
}

/* ── Weekly reward selection ────────────────────────────────────────────── */

/**
 * Suggests which reward to surface this week. Purely a presentation hint — the
 * user always chooses, and claiming is verified server-side.
 */
export function suggestRewardForWeek<T extends { id: string; is_repeatable: boolean }>(
  rewards: T[],
  claimedRewardIds: Set<string>,
  weekStart: string,
): T | null {
  const unclaimed = rewards.filter((r) => r.is_repeatable || !claimedRewardIds.has(r.id));
  if (unclaimed.length === 0) return null;
  const seed = hashStringCode(weekStart) % unclaimed.length;
  return unclaimed[seed] ?? null;
}

function hashStringCode(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}
