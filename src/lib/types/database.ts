/**
 * Database types for REBIRTH.
 *
 * These mirror `supabase/migrations` by hand. They are intentionally explicit
 * rather than generated, because the hand-written version documents *why* a
 * column is optional (database default vs. genuinely nullable) at the point
 * where the client has to care.
 *
 * Conventions
 *   · `date` columns surface as `string` in `YYYY-MM-DD`.
 *   · `time` columns surface as `string` in `HH:MM:SS`.
 *   · `timestamptz` columns surface as ISO-8601 `string`.
 *   · `int8`/`numeric` surface as `number` — safe at this data scale, and
 *     PostgREST returns them as JSON numbers.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type TaskPriority = 'main' | 'secondary';
export type TaskStatus = 'scheduled' | 'in_progress' | 'completed' | 'skipped' | 'cancelled';
export type RecurrenceKind = 'none' | 'daily' | 'weekdays' | 'weekends' | 'custom_weekly';
export type CategoryKind =
  | 'study'
  | 'work'
  | 'health'
  | 'routine'
  | 'personal'
  | 'rest'
  | 'meal'
  | 'creative'
  | 'admin'
  | 'social'
  | 'travel'
  | 'other';
export type GoalStatus = 'active' | 'paused' | 'achieved' | 'archived';
export type GoalMeasurement = 'effort' | 'execution' | 'milestone' | 'manual';
export type SessionKind = 'focus' | 'two_minute' | 'break';
export type SessionStatus = 'running' | 'paused' | 'completed' | 'abandoned';
export type MicroStepState = 'pending' | 'done' | 'skipped';
export type EnergySlot = 'morning' | 'afternoon' | 'evening';
export type DayMode = 'do' | 'plan' | 'pressure';
export type ThemePreference = 'light' | 'dark' | 'system';
export type RewardType = 'time_block' | 'treat' | 'episode' | 'outing' | 'purchase' | 'custom';
export type RewardCondition =
  | 'sessions'
  | 'minutes'
  | 'task_completed'
  | 'goal_milestone'
  | 'weekly_consistency'
  | 'manual';
export type RepeatPeriod = 'day' | 'week' | 'month';
export type XpSource = 'session' | 'task_completion' | 'goal_milestone' | 'consistency' | 'reward';
export type QuoteContentType = 'verified' | 'original';
export type EventKind =
  | 'appointment'
  | 'deadline'
  | 'exam'
  | 'interview'
  | 'competition'
  | 'personal'
  | 'celebration'
  | 'travel'
  | 'other';
export type EventStatus = 'scheduled' | 'completed' | 'cancelled';

/* ── Row shapes ─────────────────────────────────────────────────────────── */

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface UserPreferencesRow {
  user_id: string;
  theme: ThemePreference;
  timezone: string;
  week_starts_on: number;
  day_mode_override: DayMode | null;
  planner_day: number;
  planning_duration_minutes: number;
  daily_task_cap: number;
  deep_work_cap_minutes: number;
  pomodoro_minutes: number;
  break_minutes: number;
  enforce_breaks: boolean;
  reminders_enabled: boolean;
  reminder_lead_minutes: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  inactivity_nudge_hours: number;
  quotes_enabled: boolean;
  quote_tones: string[];
  pre_focus_checklist: Json;
  energy_tags: Json;
  escape_daily_limit_minutes: number;
  sleep_target_minutes: number;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface GoalRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  reason: string | null;
  category: CategoryKind;
  status: GoalStatus;
  measurement: GoalMeasurement;
  target_date: string | null;
  target_minutes: number | null;
  target_sessions: number | null;
  manual_progress: number | null;
  color_index: number;
  achieved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalMilestoneRow {
  id: string;
  user_id: string;
  goal_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  weight: number;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RewardRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  reward_type: RewardType;
  condition_kind: RewardCondition;
  condition_task_id: string | null;
  condition_goal_id: string | null;
  condition_milestone_id: string | null;
  condition_sessions: number | null;
  condition_minutes: number | null;
  condition_weekly_consistency: number | null;
  xp_value: number;
  is_repeatable: boolean;
  repeat_period: RepeatPeriod;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RewardClaimRow {
  id: string;
  user_id: string;
  reward_id: string;
  period_key: string;
  xp_awarded: number;
  note: string | null;
  claimed_at: string;
  created_at: string;
}

export interface TaskTemplateRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: CategoryKind;
  priority: TaskPriority;
  goal_id: string | null;
  reward_id: string | null;
  recurrence: RecurrenceKind;
  weekdays: number[];
  starts_on: string;
  ends_on: string | null;
  start_time: string;
  duration_minutes: number;
  reminder_minutes: number | null;
  checklist: Json;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScheduledTaskRow {
  id: string;
  user_id: string;
  template_id: string | null;
  title: string;
  description: string | null;
  category: CategoryKind;
  priority: TaskPriority;
  status: TaskStatus;
  scheduled_date: string;
  occurrence_date: string | null;
  start_time: string;
  duration_minutes: number;
  goal_id: string | null;
  reward_id: string | null;
  reminder_minutes: number | null;
  checklist: Json;
  is_auto_generated: boolean;
  is_override: boolean;
  original_start_time: string | null;
  rescheduled_from_date: string | null;
  micro_steps_generated: boolean;
  completed_at: string | null;
  skipped_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskSessionRow {
  id: string;
  user_id: string;
  task_id: string | null;
  kind: SessionKind;
  status: SessionStatus;
  started_at: string;
  ended_at: string | null;
  last_resumed_at: string | null;
  accumulated_seconds: number;
  planned_seconds: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskSessionPauseRow {
  id: string;
  user_id: string;
  session_id: string;
  paused_at: string;
  resumed_at: string | null;
  created_at: string;
}

export interface TaskMicroStepRow {
  id: string;
  user_id: string;
  task_id: string;
  ordinal: number;
  title: string;
  state: MicroStepState;
  source: 'suggested' | 'user';
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyEnergyLogRow {
  id: string;
  user_id: string;
  log_date: string;
  slot: EnergySlot;
  level: number;
  tags: string[];
  note: string | null;
  recorded_at: string;
  created_at: string;
  updated_at: string;
}

export interface QuoteLibraryRow {
  id: string;
  body: string;
  attribution: string | null;
  source_title: string | null;
  language_note: string | null;
  verification_ref: string | null;
  content_type: QuoteContentType;
  tones: string[];
  tags: string[];
  is_active: boolean;
  created_at: string;
}

export interface UserFavoriteQuoteRow {
  user_id: string;
  quote_id: string;
  created_at: string;
}

export interface DailyQuoteDeliveryRow {
  id: string;
  user_id: string;
  quote_id: string;
  delivered_on: string;
  created_at: string;
}

export interface XpEventRow {
  id: string;
  user_id: string;
  amount: number;
  reason: string;
  source_type: XpSource;
  source_id: string | null;
  occurred_on: string;
  occurred_at: string;
  created_at: string;
}

export interface UserAchievementRow {
  id: string;
  user_id: string;
  key: string;
  unlocked_at: string;
  meta: Json;
  created_at: string;
}

export interface DailyReflectionRow {
  id: string;
  user_id: string;
  reflection_date: string;
  win_of_day: string | null;
  notes: string | null;
  mood: number | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventRow {
  id: string;
  user_id: string;
  parent_event_id: string | null;
  title: string;
  description: string | null;
  kind: EventKind;
  category: CategoryKind;
  priority: TaskPriority;
  status: EventStatus;
  goal_id: string | null;
  is_all_day: boolean;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location: string | null;
  reminder_minutes: number | null;
  recurrence: RecurrenceKind;
  weekdays: number[];
  recurrence_starts_on: string | null;
  recurrence_ends_on: string | null;
  occurrence_date: string | null;
  original_starts_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ── Insert / update helpers ────────────────────────────────────────────── */

/** Promotes the listed database-generated columns to optional. */
type InsertOf<Row, Generated extends keyof Row> = Omit<Row, Generated> &
  Partial<Pick<Row, Generated>>;

type UpdateOf<Row> = Partial<Row>;

type TableDefinition<Row, Generated extends keyof Row> = {
  Row: Row;
  Insert: InsertOf<Row, Generated>;
  Update: UpdateOf<Row>;
  Relationships: [];
};

export interface TaskActualsViewRow {
  task_id: string;
  user_id: string;
  active_seconds: number;
  break_seconds: number;
  sessions_logged: number;
  two_minute_attempts: number;
}

export interface GoalProgressViewRow {
  goal_id: string;
  user_id: string;
  title: string;
  status: GoalStatus;
  measurement: GoalMeasurement;
  target_date: string | null;
  target_minutes: number | null;
  target_sessions: number | null;
  manual_progress: number | null;
  color_index: number;
  focus_minutes: number;
  sessions_completed: number;
  tasks_planned: number;
  tasks_completed: number;
  milestones_total: number;
  milestones_done: number;
}

export interface DailyQuoteResult {
  id: string;
  body: string;
  attribution: string | null;
  source_title: string | null;
  language_note: string | null;
  verification_ref: string | null;
  content_type: QuoteContentType;
  is_favorite: boolean;
}

export interface PersonalRecords {
  best_focus_day_minutes: number;
  best_focus_day: string | null;
  most_tasks_day: number;
  most_tasks_day_date: string | null;
  total_focus_minutes: number;
  total_sessions: number;
}

/** Raw shape returned by PostgREST for `select('*, goal:goals(...)')` joins. */
export interface ScheduledTaskWithRelations extends ScheduledTaskRow {
  goal: Pick<GoalRow, 'id' | 'title' | 'color_index' | 'status'> | null;
}

export interface Database {
  public: {
    Tables: {
      profiles: TableDefinition<ProfileRow, 'created_at' | 'updated_at' | 'timezone'>;
      user_preferences: TableDefinition<
        UserPreferencesRow,
        | 'created_at'
        | 'updated_at'
        | 'theme'
        | 'timezone'
        | 'week_starts_on'
        | 'planner_day'
        | 'planning_duration_minutes'
        | 'daily_task_cap'
        | 'deep_work_cap_minutes'
        | 'pomodoro_minutes'
        | 'break_minutes'
        | 'enforce_breaks'
        | 'reminders_enabled'
        | 'reminder_lead_minutes'
        | 'quiet_hours_start'
        | 'quiet_hours_end'
        | 'inactivity_nudge_hours'
        | 'quotes_enabled'
        | 'quote_tones'
        | 'pre_focus_checklist'
        | 'energy_tags'
        | 'escape_daily_limit_minutes'
        | 'sleep_target_minutes'
        | 'onboarding_completed'
        | 'day_mode_override'
      >;
      goals: TableDefinition<
        GoalRow,
        'id' | 'created_at' | 'updated_at' | 'status' | 'measurement' | 'color_index' | 'achieved_at'
      >;
      goal_milestones: TableDefinition<
        GoalMilestoneRow,
        'id' | 'created_at' | 'updated_at' | 'weight' | 'sort_order' | 'completed_at'
      >;
      rewards: TableDefinition<
        RewardRow,
        | 'id'
        | 'created_at'
        | 'updated_at'
        | 'reward_type'
        | 'condition_kind'
        | 'xp_value'
        | 'is_repeatable'
        | 'repeat_period'
        | 'is_active'
      >;
      reward_claims: TableDefinition<RewardClaimRow, 'id' | 'created_at' | 'claimed_at' | 'period_key' | 'xp_awarded'>;
      task_templates: TableDefinition<
        TaskTemplateRow,
        | 'id'
        | 'created_at'
        | 'updated_at'
        | 'recurrence'
        | 'weekdays'
        | 'starts_on'
        | 'start_time'
        | 'duration_minutes'
        | 'checklist'
        | 'is_active'
        | 'priority'
        | 'category'
      >;
      scheduled_tasks: TableDefinition<
        ScheduledTaskRow,
        | 'id'
        | 'created_at'
        | 'updated_at'
        | 'status'
        | 'priority'
        | 'category'
        | 'start_time'
        | 'duration_minutes'
        | 'checklist'
        | 'is_auto_generated'
        | 'is_override'
        | 'micro_steps_generated'
      >;
      task_sessions: TableDefinition<
        TaskSessionRow,
        'id' | 'created_at' | 'updated_at' | 'kind' | 'status' | 'started_at' | 'last_resumed_at' | 'accumulated_seconds'
      >;
      task_session_pauses: TableDefinition<TaskSessionPauseRow, 'id' | 'created_at' | 'paused_at'>;
      task_micro_steps: TableDefinition<TaskMicroStepRow, 'id' | 'created_at' | 'updated_at' | 'state' | 'source'>;
      daily_energy_logs: TableDefinition<
        DailyEnergyLogRow,
        'id' | 'created_at' | 'updated_at' | 'recorded_at' | 'tags'
      >;
      quote_library: TableDefinition<QuoteLibraryRow, 'id' | 'created_at' | 'tones' | 'tags' | 'is_active'>;
      user_favorite_quotes: TableDefinition<UserFavoriteQuoteRow, 'created_at'>;
      daily_quote_deliveries: TableDefinition<DailyQuoteDeliveryRow, 'id' | 'created_at'>;
      xp_events: TableDefinition<XpEventRow, 'id' | 'created_at' | 'occurred_at' | 'occurred_on'>;
      user_achievements: TableDefinition<UserAchievementRow, 'id' | 'created_at' | 'unlocked_at' | 'meta'>;
      daily_reflections: TableDefinition<DailyReflectionRow, 'id' | 'created_at' | 'updated_at'>;
      calendar_events: TableDefinition<
        CalendarEventRow,
        | 'id'
        | 'created_at'
        | 'updated_at'
        | 'kind'
        | 'category'
        | 'priority'
        | 'status'
        | 'is_all_day'
        | 'timezone'
        | 'recurrence'
        | 'weekdays'
        | 'parent_event_id'
        | 'occurrence_date'
      >;
    };
    Views: {
      v_task_actuals: { Row: TaskActualsViewRow; Relationships: [] };
      v_goal_progress: { Row: GoalProgressViewRow; Relationships: [] };
    };
    Functions: {
      rpc_ensure_user: { Args: Record<string, never>; Returns: undefined };
      rpc_ensure_recurring_instances: {
        Args: { p_from?: string; p_to?: string };
        Returns: number;
      };
      rpc_set_main_priority: { Args: { p_task_id: string }; Returns: undefined };
      rpc_start_session: {
        Args: {
          p_task_id?: string | null;
          p_kind?: SessionKind;
          p_planned_seconds?: number | null;
          p_replace_open?: boolean;
        };
        Returns: TaskSessionRow;
      };
      rpc_pause_session: { Args: { p_session_id: string }; Returns: TaskSessionRow };
      rpc_resume_session: { Args: { p_session_id: string }; Returns: TaskSessionRow };
      rpc_finish_session: {
        Args: {
          p_session_id: string;
          p_status?: SessionStatus;
          p_complete_task?: boolean;
          p_note?: string | null;
        };
        Returns: TaskSessionRow;
      };
      rpc_abandon_open_sessions: { Args: Record<string, never>; Returns: number };
      rpc_seed_micro_steps: { Args: { p_task_id: string; p_titles: string[] }; Returns: TaskMicroStepRow[] };
      rpc_set_micro_step_state: {
        Args: { p_step_id: string; p_state: MicroStepState };
        Returns: TaskMicroStepRow;
      };
      rpc_update_recurring_task: {
        Args: { p_task_id: string; p_scope: 'occurrence' | 'future' | 'series'; p_patch: Json };
        Returns: undefined;
      };
      rpc_delete_recurring_task: {
        Args: { p_task_id: string; p_scope: 'occurrence' | 'future' | 'series' };
        Returns: undefined;
      };
      rpc_reschedule_task: {
        Args: {
          p_task_id: string;
          p_new_date: string;
          p_new_start_time?: string | null;
          p_scope?: 'occurrence' | 'future' | 'series';
        };
        Returns: ScheduledTaskRow;
      };
      rpc_unlock_achievement: { Args: { p_key: string; p_meta?: Json }; Returns: boolean };
      rpc_daily_quote: { Args: { p_date?: string }; Returns: DailyQuoteResult[] };
      rpc_claim_reward: { Args: { p_reward_id: string; p_note?: string | null }; Returns: RewardClaimRow };
      rpc_personal_records: { Args: Record<string, never>; Returns: PersonalRecords };
      fn_consistency_score: {
        Args: { p_user: string; p_from: string; p_to: string; p_as_of?: string };
        Returns: number | null;
      };
      rpc_public_shared_summary: { Args: { p_token: string }; Returns: Json };
    };
    Enums: {
      task_priority: TaskPriority;
      task_status: TaskStatus;
      recurrence_kind: RecurrenceKind;
      category_kind: CategoryKind;
      goal_status: GoalStatus;
      goal_measurement: GoalMeasurement;
      session_kind: SessionKind;
      session_status: SessionStatus;
      micro_step_state: MicroStepState;
      energy_slot: EnergySlot;
      day_mode: DayMode;
      theme_preference: ThemePreference;
      reward_type: RewardType;
      reward_condition: RewardCondition;
      xp_source: XpSource;
      quote_content_type: QuoteContentType;
      event_kind: EventKind;
      event_status: EventStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
export type Views<T extends keyof Database['public']['Views']> = Database['public']['Views'][T]['Row'];
