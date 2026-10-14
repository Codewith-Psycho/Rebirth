import type { CategoryKind, DayMode, EventKind } from '@/lib/types/database';

/**
 * Visual and copy metadata for the fixed vocabularies.
 *
 * Colour is never the only carrier of meaning — every category and status also
 * has a label and an icon, because roughly one in twelve men has a colour
 * vision deficiency and a calendar that only distinguishes things by hue is
 * unreadable for them.
 */

export interface CategoryMeta {
  label: string;
  /** One of the six categorical chart slots. */
  chartIndex: 1 | 2 | 3 | 4 | 5 | 6;
  /** Lucide icon name, resolved in `components/icons/category-icon.tsx`. */
  icon: string;
}

export const CATEGORY_META: Record<CategoryKind, CategoryMeta> = {
  study: { label: 'Study', chartIndex: 5, icon: 'GraduationCap' },
  work: { label: 'Work', chartIndex: 1, icon: 'Briefcase' },
  health: { label: 'Health', chartIndex: 4, icon: 'HeartPulse' },
  routine: { label: 'Routine', chartIndex: 2, icon: 'Repeat' },
  personal: { label: 'Personal', chartIndex: 6, icon: 'User' },
  rest: { label: 'Rest', chartIndex: 3, icon: 'Moon' },
  meal: { label: 'Meal', chartIndex: 3, icon: 'UtensilsCrossed' },
  creative: { label: 'Creative', chartIndex: 6, icon: 'Palette' },
  admin: { label: 'Admin', chartIndex: 5, icon: 'FolderCog' },
  social: { label: 'Social', chartIndex: 4, icon: 'Users' },
  travel: { label: 'Travel', chartIndex: 5, icon: 'Plane' },
  other: { label: 'Other', chartIndex: 2, icon: 'Circle' },
};

export const CATEGORY_ORDER: CategoryKind[] = [
  'study',
  'work',
  'health',
  'routine',
  'personal',
  'creative',
  'admin',
  'social',
  'rest',
  'meal',
  'travel',
  'other',
];

export function categoryLabel(category: CategoryKind): string {
  return CATEGORY_META[category]?.label ?? 'Other';
}

/**
 * The categorical slot a category draws from.
 *
 * Returned as a number rather than a class name on purpose: a Tailwind class
 * built by string concatenation is never generated, so the surface that colours
 * blocks by category composes the actual declaration from this index instead.
 */
export function categoryColorIndex(category: CategoryKind): 1 | 2 | 3 | 4 | 5 | 6 {
  return CATEGORY_META[category]?.chartIndex ?? 2;
}

export interface StatusMeta {
  label: string;
  /** Description used by screen readers and tooltips. */
  description: string;
  /** Renders as a distinct glyph as well as a colour. */
  glyph: 'open' | 'active' | 'done' | 'missed' | 'skipped' | 'cancelled';
}

export const TASK_STATUS_META: Record<string, StatusMeta> = {
  planned: { label: 'Scheduled', description: 'Planned and not started', glyph: 'open' },
  in_progress: { label: 'In progress', description: 'A timer is open against this task', glyph: 'active' },
  completed: { label: 'Completed', description: 'Finished', glyph: 'done' },
  missed: { label: 'Not done', description: 'Its day passed without being completed', glyph: 'missed' },
  skipped: { label: 'Skipped', description: 'Deliberately set aside', glyph: 'skipped' },
  cancelled: { label: 'Removed', description: 'Taken off the plan', glyph: 'cancelled' },
};

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  appointment: 'Appointment',
  deadline: 'Deadline',
  exam: 'Exam',
  interview: 'Interview',
  competition: 'Competition',
  personal: 'Personal',
  celebration: 'Celebration',
  travel: 'Travel',
  other: 'Other',
};

export const PRIORITY_LABELS = { main: 'MAIN', secondary: 'Secondary' } as const;

/* ── Day modes ──────────────────────────────────────────────────────────── */

export interface DayModeMeta {
  label: string;
  short: string;
  description: string;
  /** Long-form planning surfaces are available. */
  planningUnlocked: boolean;
  icon: string;
}

export const DAY_MODE_META: Record<DayMode, DayModeMeta> = {
  do: {
    label: 'Do Mode',
    short: 'Do',
    description:
      'Today is for executing. Planning is set aside so the only decision left is which task to start.',
    planningUnlocked: false,
    icon: 'Play',
  },
  plan: {
    label: 'Plan Mode',
    short: 'Plan',
    description:
      'Planning is open. Look at the week, distribute the work honestly, and protect recovery time.',
    planningUnlocked: true,
    icon: 'Compass',
  },
  pressure: {
    label: 'Pressure-Week',
    short: 'Pressure',
    description:
      'An important event is close. Deep work is capped and breaks are enforced so the sprint stays survivable.',
    planningUnlocked: false,
    icon: 'Shield',
  },
};

/* ── Reward vocabulary ──────────────────────────────────────────────────── */

export const REWARD_TYPE_LABELS: Record<string, string> = {
  time_block: 'Guilt-free time',
  treat: 'A treat',
  episode: 'An episode',
  outing: 'An outing',
  purchase: 'A purchase',
  custom: 'Something else',
};

export const REWARD_CONDITION_LABELS: Record<string, string> = {
  sessions: 'After a number of focus sessions',
  minutes: 'After a number of focused minutes',
  task_completed: 'After a specific task is completed',
  goal_milestone: 'After a milestone is reached',
  weekly_consistency: 'After a consistent week',
  manual: 'I decide when it is earned',
};

export const ENERGY_SLOT_LABELS = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
} as const;

export const ENERGY_TAG_OPTIONS = [
  'Heavy meal',
  'Slept badly',
  'Slept well',
  'Stressed',
  'Calm',
  'Anxious',
  'Well rested',
  'Unwell',
  'Exercised',
] as const;
