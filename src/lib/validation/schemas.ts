import { z } from 'zod';

/**
 * Validation.
 *
 * Every write path validates on the client *and* is re-checked by the database
 * (constraints, triggers and RLS). Client-side validation exists to give good
 * messages quickly; it is never the thing that keeps data correct.
 */

/* ── Primitives ─────────────────────────────────────────────────────────── */

export const dayKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in the form YYYY-MM-DD')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), 'That date does not exist');

export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use a time in the form HH:MM');

export const timezoneSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone');

export const categorySchema = z.enum([
  'study',
  'work',
  'health',
  'routine',
  'personal',
  'rest',
  'meal',
  'creative',
  'admin',
  'social',
  'travel',
  'other',
]);

export const prioritySchema = z.enum(['main', 'secondary']);
export const recurrenceSchema = z.enum(['none', 'daily', 'weekdays', 'weekends', 'custom_weekly']);
export const energySlotSchema = z.enum(['morning', 'afternoon', 'evening']);
export const themeSchema = z.enum(['light', 'dark', 'system']);
export const goalMeasurementSchema = z.enum(['effort', 'execution', 'milestone', 'manual']);
export const goalStatusSchema = z.enum(['active', 'paused', 'achieved', 'archived']);
export const rewardTypeSchema = z.enum(['time_block', 'treat', 'episode', 'outing', 'purchase', 'custom']);
export const rewardConditionSchema = z.enum([
  'sessions',
  'minutes',
  'task_completed',
  'goal_milestone',
  'weekly_consistency',
  'manual',
]);
export const eventKindSchema = z.enum([
  'appointment',
  'deadline',
  'exam',
  'interview',
  'competition',
  'personal',
  'celebration',
  'travel',
  'other',
]);
export const scopeSchema = z.enum(['occurrence', 'future', 'series']);

export const uuidSchema = z.string().uuid('Expected an identifier');
export const nullableUuid = z
  .union([uuidSchema, z.literal(''), z.null()])
  .transform((value) => (value === '' || value === null ? null : value))
  .nullable();

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length >= min, `${label} is required`)
    .refine((value) => value.length <= max, `${label} must be ${max} characters or fewer`);

/* ── Authentication ─────────────────────────────────────────────────────── */

export const signInSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('That does not look like an email address'),
  password: z.string().min(1, 'Enter your password'),
});
export type SignInValues = z.infer<typeof signInSchema>;

export const signUpSchema = z
  .object({
    displayName: trimmed(1, 80, 'Your name'),
    email: z.string().trim().email('That does not look like an email address'),
    password: z
      .string()
      .min(8, 'Use at least 8 characters')
      .refine((value) => /[a-zA-Z]/.test(value), 'Include at least one letter')
      .refine((value) => /\d/.test(value), 'Include at least one number'),
    confirmPassword: z.string(),
    timezone: timezoneSchema,
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match',
  });
export type SignUpValues = z.infer<typeof signUpSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('That does not look like an email address'),
});
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const updatePasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Use at least 8 characters')
      .refine((value) => /[a-zA-Z]/.test(value), 'Include at least one letter')
      .refine((value) => /\d/.test(value), 'Include at least one number'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match',
  });
export type UpdatePasswordValues = z.infer<typeof updatePasswordSchema>;

/* ── Profile and preferences ────────────────────────────────────────────── */

export const profileSchema = z.object({
  display_name: trimmed(1, 80, 'Your name'),
  timezone: timezoneSchema,
});
export type ProfileValues = z.infer<typeof profileSchema>;

export const preferencesSchema = z.object({
  theme: themeSchema,
  timezone: timezoneSchema,
  week_starts_on: z.coerce.number().int().min(0).max(6),
  planner_day: z.coerce.number().int().min(0).max(6),
  planning_duration_minutes: z.coerce.number().int().min(5).max(180),
  daily_task_cap: z.coerce.number().int().min(1).max(12),
  deep_work_cap_minutes: z.coerce.number().int().min(30).max(1440),
  pomodoro_minutes: z.coerce.number().int().min(5).max(120),
  break_minutes: z.coerce.number().int().min(1).max(60),
  enforce_breaks: z.boolean(),
  reminders_enabled: z.boolean(),
  reminder_lead_minutes: z.coerce.number().int().min(0).max(120),
  quiet_hours_start: timeSchema,
  quiet_hours_end: timeSchema,
  inactivity_nudge_hours: z.coerce.number().int().min(1).max(336),
  quotes_enabled: z.boolean(),
  quote_tones: z.array(z.string()).max(8),
  pre_focus_checklist: z.array(z.string().trim().min(1).max(80)).max(8),
  sleep_target_minutes: z.coerce.number().int().min(240).max(720),
  escape_daily_limit_minutes: z.coerce.number().int().min(0).max(1440),
  day_mode_override: z.union([z.enum(['do', 'plan']), z.literal(''), z.null()]).transform((v) =>
    v === '' ? null : v,
  ),
});
export type PreferencesValues = z.infer<typeof preferencesSchema>;

/* ── Tasks ──────────────────────────────────────────────────────────────── */

export const taskSchema = z
  .object({
    title: trimmed(1, 160, 'A title'),
    description: z.string().max(2000).optional().nullable().or(z.literal('')),
    category: categorySchema,
    priority: prioritySchema,
    scheduled_date: dayKeySchema,
    start_time: timeSchema,
    duration_minutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(1440),
    goal_id: nullableUuid,
    reward_id: nullableUuid,
    reminder_minutes: z
      .union([z.coerce.number().int().min(0).max(1440), z.literal(''), z.null()])
      .transform((v) => (v === '' || v === null ? null : v))
      .nullable(),
    checklist: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    notes: z.string().max(2000).optional().nullable().or(z.literal('')),
  })
  .refine((v) => v.duration_minutes <= 1440, { path: ['duration_minutes'], message: 'That is longer than a day' });
export type TaskValues = z.infer<typeof taskSchema>;

export const routineSchema = taskSchema.extend({
  recurrence: recurrenceSchema,
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([]),
  starts_on: dayKeySchema,
  ends_on: z
    .union([dayKeySchema, z.literal(''), z.null()])
    .transform((v) => (v === '' || v === null ? null : v))
    .nullable(),
});

export const routineSchemaRefined = routineSchema
  .refine((v) => v.recurrence !== 'none' || true, { path: ['recurrence'], message: 'Unreachable' })
  .refine((v) => v.recurrence !== 'custom_weekly' || v.weekdays.length > 0, {
    path: ['weekdays'],
    message: 'Choose at least one day',
  })
  .refine((v) => v.ends_on === null || v.ends_on >= v.starts_on, {
    path: ['ends_on'],
    message: 'The end date must be on or after the start date',
  });
export type RoutineValues = z.infer<typeof routineSchemaRefined>;

export const rescheduleSchema = z.object({
  task_id: uuidSchema,
  scheduled_date: dayKeySchema,
  start_time: timeSchema.optional(),
  scope: scopeSchema.default('occurrence'),
});
export type RescheduleValues = z.infer<typeof rescheduleSchema>;

export const editScopeSchema = z.object({
  task_id: uuidSchema,
  scope: scopeSchema,
  values: taskSchema.partial(),
});

export const cancelSchema = z.object({
  task_id: uuidSchema,
  scope: scopeSchema,
  reason: z.string().max(280).optional().nullable(),
});
export type CancelValues = z.infer<typeof cancelSchema>;

/* ── Calendar events ────────────────────────────────────────────────────── */

export const eventSchema = z
  .object({
    title: trimmed(1, 160, 'A title'),
    description: z.string().max(2000).optional().nullable().or(z.literal('')),
    kind: eventKindSchema,
    category: categorySchema,
    priority: prioritySchema,
    goal_id: nullableUuid,
    is_all_day: z.boolean().default(false),
    start_date: dayKeySchema,
    start_time: timeSchema,
    end_date: dayKeySchema,
    end_time: timeSchema,
    location: z.string().max(200).optional().nullable().or(z.literal('')),
    reminder_minutes: z
      .union([z.coerce.number().int().min(0).max(10080), z.literal(''), z.null()])
      .transform((v) => (v === '' || v === null ? null : v))
      .nullable(),
    recurrence: recurrenceSchema,
    weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([]),
    recurrence_ends_on: z
      .union([dayKeySchema, z.literal(''), z.null()])
      .transform((v) => (v === '' || v === null ? null : v))
      .nullable(),
  })
  .refine((v) => v.recurrence !== 'custom_weekly' || v.weekdays.length > 0, {
    path: ['weekdays'],
    message: 'Choose at least one day',
  })
  .refine((v) => v.recurrence_ends_on === null || v.recurrence_ends_on >= v.start_date, {
    path: ['recurrence_ends_on'],
    message: 'The end date must be on or after the start date',
  })
  .refine(
    (v) => {
      // All-day events have no meaningful time comparison.
      if (v.is_all_day) return true;
      return `${v.end_date}T${v.end_time}` > `${v.start_date}T${v.start_time}`;
    },
    { path: ['end_time'], message: 'The event must end after it starts' },
  );
export type EventValues = z.infer<typeof eventSchema>;

/* ── Goals ──────────────────────────────────────────────────────────────── */

export const goalSchema = z
  .object({
    title: trimmed(1, 160, 'A goal title'),
    description: z.string().max(2000).optional().nullable().or(z.literal('')),
    reason: z.string().max(1000).optional().nullable().or(z.literal('')),
    category: categorySchema,
    measurement: goalMeasurementSchema,
    target_date: z
      .union([dayKeySchema, z.literal(''), z.null()])
      .transform((v) => (v === '' || v === null ? null : v))
      .nullable(),
    target_minutes: z
      .union([z.coerce.number().int().min(1).max(100000), z.literal(''), z.null()])
      .transform((v) => (v === '' || v === null ? null : v))
      .nullable(),
    target_sessions: z
      .union([z.coerce.number().int().min(1).max(10000), z.literal(''), z.null()])
      .transform((v) => (v === '' || v === null ? null : v))
      .nullable(),
    manual_progress: z
      .union([z.coerce.number().int().min(0).max(100), z.literal(''), z.null()])
      .transform((v) => (v === '' || v === null ? null : v))
      .nullable(),
  })
  .refine((v) => v.measurement !== 'effort' || v.target_minutes !== null, {
    path: ['target_minutes'],
    message: 'Effort goals need a target in minutes',
  })
  .refine((v) => v.measurement !== 'manual' || v.manual_progress !== null, {
    path: ['manual_progress'],
    message: 'Self-assessed goals need a current percentage',
  });
export type GoalValues = z.infer<typeof goalSchema>;

export const milestoneSchema = z.object({
  goal_id: uuidSchema,
  title: trimmed(1, 200, 'A milestone title'),
  description: z.string().max(1000).optional().nullable().or(z.literal('')),
  due_date: z
    .union([dayKeySchema, z.literal(''), z.null()])
    .transform((v) => (v === '' || v === null ? null : v))
    .nullable(),
  weight: z.coerce.number().min(0.1).max(100).default(1),
  sort_order: z.coerce.number().int().min(0).max(99).default(0),
});
export type MilestoneValues = z.infer<typeof milestoneSchema>;

/* ── Rewards ────────────────────────────────────────────────────────────── */

export const rewardSchema = z
  .object({
    name: trimmed(1, 120, 'A reward name'),
    description: z.string().max(1000).optional().nullable().or(z.literal('')),
    reward_type: rewardTypeSchema,
    condition_kind: rewardConditionSchema,
    condition_task_id: nullableUuid,
    condition_goal_id: nullableUuid,
    condition_milestone_id: nullableUuid,
    condition_sessions: z
      .union([z.coerce.number().int().min(1).max(500), z.literal(''), z.null()])
      .transform((v) => (v === '' || v === null ? null : v))
      .nullable(),
    condition_minutes: z
      .union([z.coerce.number().int().min(1).max(100000), z.literal(''), z.null()])
      .transform((v) => (v === '' || v === null ? null : v))
      .nullable(),
    condition_weekly_consistency: z
      .union([z.coerce.number().int().min(1).max(100), z.literal(''), z.null()])
      .transform((v) => (v === '' || v === null ? null : v))
      .nullable(),
    xp_value: z.coerce.number().int().min(0).max(10000).default(25),
    is_repeatable: z.boolean().default(false),
    repeat_period: z.enum(['day', 'week', 'month']).default('week'),
    is_active: z.boolean().default(true),
  })
  .refine((v) => v.condition_kind !== 'sessions' || v.condition_sessions !== null, {
    path: ['condition_sessions'],
    message: 'How many sessions?',
  })
  .refine((v) => v.condition_kind !== 'minutes' || v.condition_minutes !== null, {
    path: ['condition_minutes'],
    message: 'How many minutes?',
  })
  .refine((v) => v.condition_kind !== 'task_completed' || v.condition_task_id !== null, {
    path: ['condition_task_id'],
    message: 'Choose the task that unlocks this',
  })
  .refine((v) => v.condition_kind !== 'goal_milestone' || v.condition_milestone_id !== null, {
    path: ['condition_milestone_id'],
    message: 'Choose the milestone that unlocks this',
  })
  .refine((v) => v.condition_kind !== 'weekly_consistency' || v.condition_weekly_consistency !== null, {
    path: ['condition_weekly_consistency'],
    message: 'What consistency percentage?',
  });
export type RewardValues = z.infer<typeof rewardSchema>;

/* ── Daily practice ─────────────────────────────────────────────────────── */

export const energySchema = z.object({
  log_date: dayKeySchema,
  slot: energySlotSchema,
  level: z.coerce.number().int().min(1).max(5),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  note: z.string().max(500).optional().nullable().or(z.literal('')),
});
export type EnergyValues = z.infer<typeof energySchema>;

export const reflectionSchema = z.object({
  reflection_date: dayKeySchema,
  win_of_day: z.string().max(300).optional().nullable().or(z.literal('')),
  notes: z.string().max(2000).optional().nullable().or(z.literal('')),
  mood: z
    .union([z.coerce.number().int().min(1).max(5), z.literal(''), z.null()])
    .transform((v) => (v === '' || v === null ? null : v))
    .nullable(),
});
export type ReflectionValues = z.infer<typeof reflectionSchema>;

/* ── Micro steps ────────────────────────────────────────────────────────── */

export const microStepStateSchema = z.enum(['pending', 'done', 'skipped']);

export const microStepsSchema = z.object({
  task_id: uuidSchema,
  titles: z.array(trimmed(1, 200, 'A step')).min(1).max(12),
});
export type MicroStepsValues = z.infer<typeof microStepsSchema>;

/* ── Share tokens (Phase 3, table exists) ───────────────────────────────── */

export const shareTokenSchema = z.object({
  label: z.string().max(120).optional().nullable(),
  expires_in_days: z.coerce.number().int().min(1).max(90).default(7),
});
export type ShareTokenValues = z.infer<typeof shareTokenSchema>;
