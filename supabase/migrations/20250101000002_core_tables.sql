-- ═══════════════════════════════════════════════════════════════════════════
-- REBIRTH · 0002 · core tables (Phase 1 + Calendar)
--
-- Conventions
--   · UUID primary keys, `gen_random_uuid()`.
--   · `user_id` is the ownership column that every RLS policy keys off.
--   · Local-day concepts (`scheduled_date`, `log_date`, …) are PostgreSQL
--     `date` columns; instants are `timestamptz` stored in UTC.
--   · `created_at` / `updated_at` everywhere; `updated_at` maintained by the
--     `set_updated_at()` trigger from migration 0005.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- profiles — mirrors auth.users, one row per account
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  display_name  text check (display_name is null or length(trim(display_name)) between 1 and 80),
  avatar_url    text,
  timezone      text not null default 'UTC',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- user_preferences — one row per account, created by the sign-up trigger
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.user_preferences (
  user_id                      uuid primary key references auth.users (id) on delete cascade,
  theme                        public.theme_preference not null default 'system',
  timezone                     text not null default 'UTC',
  week_starts_on               smallint not null default 1 check (week_starts_on between 0 and 6),
  day_mode_override            public.day_mode check (day_mode_override is null or day_mode_override <> 'pressure'),

  -- Planning vs doing
  planner_day                  smallint not null default 0 check (planner_day between 0 and 6),
  planning_duration_minutes    smallint not null default 30 check (planning_duration_minutes between 5 and 180),

  -- Daily capacity. The three-secondary-task ceiling from the brief is the
  -- default; raising this number in Settings is the *only* documented way to
  -- exceed it, so the limit stays enforced by the database rather than by UI.
  daily_task_cap               smallint not null default 3 check (daily_task_cap between 1 and 12),
  deep_work_cap_minutes        integer  not null default 360 check (deep_work_cap_minutes between 30 and 1440),
  pomodoro_minutes             smallint not null default 25 check (pomodoro_minutes between 5 and 120),
  break_minutes                smallint not null default 5  check (break_minutes between 1 and 60),
  enforce_breaks               boolean  not null default true,

  -- Reminders
  reminders_enabled            boolean  not null default true,
  reminder_lead_minutes        smallint not null default 5 check (reminder_lead_minutes between 0 and 120),
  quiet_hours_start            time     not null default '22:00',
  quiet_hours_end              time     not null default '07:00',
  inactivity_nudge_hours       smallint not null default 24 check (inactivity_nudge_hours between 1 and 336),

  -- Motivation
  quotes_enabled               boolean  not null default true,
  quote_tones                  text[]   not null default array['gentle', 'reflective', 'stoic'],

  -- Owner-editable checklists (stored as JSON arrays of short strings)
  pre_focus_checklist          jsonb    not null
    default '["Phone in another room", "Study space ready", "Water filled"]'::jsonb,
  energy_tags                  jsonb    not null
    default '["Heavy meal", "Slept badly", "Stressed", "Well rested", "Anxious"]'::jsonb,

  -- Wellbeing (Phase 2 modules read these; harmless before then)
  escape_daily_limit_minutes   integer  not null default 90 check (escape_daily_limit_minutes between 0 and 1440),
  sleep_target_minutes         integer  not null default 450 check (sleep_target_minutes between 240 and 720),

  onboarding_completed         boolean  not null default false,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- goals
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.goals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  title           text not null check (length(trim(title)) between 1 and 160),
  description     text,
  reason          text,                       -- why this matters to *you*
  category        public.category_kind not null default 'personal',
  status          public.goal_status not null default 'active',
  measurement     public.goal_measurement not null default 'effort',
  target_date     date,
  -- Measurement targets. Only the ones relevant to `measurement` are used.
  target_minutes  integer check (target_minutes is null or target_minutes > 0),
  target_sessions integer check (target_sessions is null or target_sessions > 0),
  manual_progress smallint check (manual_progress is null or manual_progress between 0 and 100),
  color_index     smallint not null default 1 check (color_index between 1 and 6),
  achieved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint goals_manual_needs_progress
    check (measurement <> 'manual' or manual_progress is not null)
);

create index if not exists goals_user_status_idx on public.goals (user_id, status);
create index if not exists goals_user_target_date_idx on public.goals (user_id, target_date)
  where target_date is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- goal_milestones — the only honest basis for "skill mastery" claims
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.goal_milestones (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  goal_id       uuid not null references public.goals (id) on delete cascade,
  title         text not null check (length(trim(title)) between 1 and 200),
  description   text,
  due_date      date,
  weight        numeric(6, 2) not null default 1 check (weight > 0),
  sort_order    smallint not null default 0,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists goal_milestones_goal_idx on public.goal_milestones (goal_id, sort_order);
create index if not exists goal_milestones_user_idx on public.goal_milestones (user_id);

-- ───────────────────────────────────────────────────────────────────────────
-- rewards — entirely user-defined; nothing is awarded automatically here
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.rewards (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users (id) on delete cascade,
  name                        text not null check (length(trim(name)) between 1 and 120),
  description                 text,
  reward_type                 public.reward_type not null default 'custom',
  condition_kind              public.reward_condition not null default 'manual',
  condition_task_id           uuid,                       -- FK added in 0004
  condition_goal_id           uuid references public.goals (id) on delete set null,
  condition_milestone_id      uuid references public.goal_milestones (id) on delete set null,
  condition_sessions          smallint check (condition_sessions is null or condition_sessions > 0),
  condition_minutes           integer  check (condition_minutes is null or condition_minutes > 0),
  condition_weekly_consistency smallint check (
    condition_weekly_consistency is null or condition_weekly_consistency between 1 and 100
  ),
  xp_value                    integer not null default 25 check (xp_value between 0 and 10000),
  is_repeatable               boolean not null default false,
  repeat_period               text not null default 'week' check (repeat_period in ('day', 'week', 'month')),
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- A condition must carry the numbers it needs to be evaluable.
  constraint rewards_condition_fields check (
    case condition_kind
      when 'sessions'           then condition_sessions is not null
      when 'minutes'            then condition_minutes is not null
      when 'task_completed'     then condition_task_id is not null
      when 'goal_milestone'     then condition_milestone_id is not null
      when 'weekly_consistency' then condition_weekly_consistency is not null
      else true
    end
  )
);

create index if not exists rewards_user_active_idx on public.rewards (user_id, is_active);

create table if not exists public.reward_claims (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  reward_id    uuid not null references public.rewards (id) on delete cascade,
  -- 'once' for single-use rewards; an ISO day/week/month key otherwise. The
  -- unique constraint below is what actually prevents double-claiming.
  period_key   text not null default 'once',
  xp_awarded   integer not null default 0 check (xp_awarded >= 0),
  note         text,
  claimed_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (reward_id, period_key)
);

create index if not exists reward_claims_user_idx on public.reward_claims (user_id, claimed_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- task_templates — recurring routine definitions
--
-- Templates are *patterns*; they are never the thing you complete. Completing,
-- timing and analytics all operate on the materialised instances in
-- `scheduled_tasks`, which is what preserves history across routine edits.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.task_templates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  title             text not null check (length(trim(title)) between 1 and 160),
  description       text,
  category          public.category_kind not null default 'other',
  priority          public.task_priority not null default 'secondary',
  goal_id           uuid references public.goals (id) on delete set null,
  reward_id         uuid references public.rewards (id) on delete set null,
  recurrence        public.recurrence_kind not null default 'weekdays',
  weekdays          smallint[] not null default '{}',
  starts_on         date not null default current_date,
  ends_on           date,
  start_time        time not null default '09:00',
  duration_minutes  smallint not null default 45 check (duration_minutes between 5 and 1440),
  reminder_minutes  smallint check (reminder_minutes is null or reminder_minutes between 0 and 1440),
  checklist         jsonb not null default '[]'::jsonb,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint task_templates_range check (ends_on is null or ends_on >= starts_on),
  constraint task_templates_weekdays check (
    recurrence <> 'custom_weekly' or array_length(weekdays, 1) >= 1
  ),
  constraint task_templates_weekdays_domain check (
    weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  )
);

create index if not exists task_templates_user_active_idx
  on public.task_templates (user_id, is_active, starts_on);

-- ───────────────────────────────────────────────────────────────────────────
-- scheduled_tasks — the single source of truth for every task occurrence,
-- and the task half of the calendar.
--
-- `occurrence_date` is the slot in the recurrence series this row belongs to.
-- `scheduled_date` is where it currently sits. They differ only after a
-- reschedule, and the unique index on (template_id, occurrence_date) is what
-- stops the materialiser from regenerating a slot the user already moved.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.scheduled_tasks (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  template_id            uuid references public.task_templates (id) on delete set null,
  title                  text not null check (length(trim(title)) between 1 and 160),
  description            text,
  category               public.category_kind not null default 'other',
  priority               public.task_priority not null default 'secondary',
  status                 public.task_status not null default 'scheduled',
  scheduled_date         date not null,
  occurrence_date        date,
  start_time             time not null default '09:00',
  duration_minutes       smallint not null default 45 check (duration_minutes between 5 and 1440),
  goal_id                uuid references public.goals (id) on delete set null,
  reward_id              uuid references public.rewards (id) on delete set null,
  reminder_minutes       smallint check (reminder_minutes is null or reminder_minutes between 0 and 1440),
  checklist              jsonb not null default '[]'::jsonb,
  is_auto_generated      boolean not null default false,
  is_override            boolean not null default false,
  original_start_time    time,
  rescheduled_from_date  date,
  micro_steps_generated  boolean not null default false,
  completed_at           timestamptz,
  skipped_at             timestamptz,
  cancelled_at           timestamptz,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Terminal states must carry their timestamp; non-terminal states must not.
  constraint scheduled_tasks_completed_at check (
    (status = 'completed') = (completed_at is not null)
  ),
  constraint scheduled_tasks_skipped_at check (
    (status = 'skipped') = (skipped_at is not null)
  ),
  constraint scheduled_tasks_cancelled_at check (
    (status = 'cancelled') = (cancelled_at is not null)
  )
);

create index if not exists scheduled_tasks_user_date_idx
  on public.scheduled_tasks (user_id, scheduled_date, start_time);
create index if not exists scheduled_tasks_user_status_idx
  on public.scheduled_tasks (user_id, status);
create index if not exists scheduled_tasks_goal_idx
  on public.scheduled_tasks (goal_id) where goal_id is not null;
create index if not exists scheduled_tasks_template_idx
  on public.scheduled_tasks (template_id) where template_id is not null;

-- Exactly one MAIN per user per day, and only one live occurrence per series slot.
create unique index if not exists scheduled_tasks_one_main_per_day
  on public.scheduled_tasks (user_id, scheduled_date)
  where priority = 'main' and status not in ('cancelled', 'skipped');

create unique index if not exists scheduled_tasks_template_slot_unique
  on public.scheduled_tasks (template_id, occurrence_date)
  where template_id is not null and occurrence_date is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- task_sessions — persisted focus timers
--
-- Elapsed time is derived, never counted in memory:
--   live seconds = accumulated_seconds
--                + (now() - last_resumed_at)   -- only while `running`
-- so a refresh, a suspended tab or a device sleep cannot lose time and cannot
-- double-count it either.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.task_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  task_id             uuid references public.scheduled_tasks (id) on delete cascade,
  kind                public.session_kind not null default 'focus',
  status              public.session_status not null default 'running',
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  -- Non-null exactly while the timer is running; NULL exactly while paused.
  -- Defaults to `now()` so a freshly inserted 'running' row always satisfies
  -- the state constraint below.
  last_resumed_at     timestamptz default now(),
  accumulated_seconds integer not null default 0 check (accumulated_seconds >= 0),
  planned_seconds     integer check (planned_seconds is null or planned_seconds > 0),
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- A running session must have a resume point; a paused one must not; a
  -- finished one must have an end time and no open interval.
  constraint task_sessions_state check (
    case status
      when 'running'   then last_resumed_at is not null and ended_at is null
      when 'paused'    then last_resumed_at is null and ended_at is null
      when 'completed' then ended_at is not null and last_resumed_at is null
      when 'abandoned' then ended_at is not null and last_resumed_at is null
    end
  )
);

create index if not exists task_sessions_user_started_idx
  on public.task_sessions (user_id, started_at desc);
create index if not exists task_sessions_task_idx
  on public.task_sessions (task_id, started_at desc);

-- At most one open timer per user. This is the database-level guarantee that
-- two incompatible focus timers can never both be running.
create unique index if not exists task_sessions_one_open_per_user
  on public.task_sessions (user_id)
  where status in ('running', 'paused');

-- ───────────────────────────────────────────────────────────────────────────
-- task_session_pauses — interval log behind every timer
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.task_session_pauses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  session_id  uuid not null references public.task_sessions (id) on delete cascade,
  paused_at   timestamptz not null default now(),
  resumed_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint task_session_pauses_order check (resumed_at is null or resumed_at >= paused_at)
);

create index if not exists task_session_pauses_session_idx
  on public.task_session_pauses (session_id, paused_at);
create index if not exists task_session_pauses_user_idx
  on public.task_session_pauses (user_id);

-- ───────────────────────────────────────────────────────────────────────────
-- task_micro_steps — the "I'm stuck" decomposition
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.task_micro_steps (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  task_id       uuid not null references public.scheduled_tasks (id) on delete cascade,
  ordinal       smallint not null check (ordinal between 1 and 12),
  title         text not null check (length(trim(title)) between 1 and 200),
  state         public.micro_step_state not null default 'pending',
  source        text not null default 'suggested' check (source in ('suggested', 'user')),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (task_id, ordinal),
  constraint task_micro_steps_resolved check ((state = 'pending') = (resolved_at is null))
);

create index if not exists task_micro_steps_task_idx on public.task_micro_steps (task_id, ordinal);

-- ───────────────────────────────────────────────────────────────────────────
-- daily_energy_logs — three check-ins a day, 1–5
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.daily_energy_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  log_date     date not null,
  slot         public.energy_slot not null,
  level        smallint not null check (level between 1 and 5),
  tags         text[] not null default '{}',
  note         text,
  recorded_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, log_date, slot)
);

create index if not exists daily_energy_logs_user_date_idx
  on public.daily_energy_logs (user_id, log_date desc);

-- ───────────────────────────────────────────────────────────────────────────
-- quote_library — global reference content (seeded, read-only for users)
--
-- Every row declares whether it is a real, sourced quotation or an original
-- line written for REBIRTH. There is no third category.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.quote_library (
  id                uuid primary key default gen_random_uuid(),
  body              text not null check (length(trim(body)) between 1 and 600),
  attribution       text,                       -- character, for verified quotes
  source_title      text,                       -- anime title, for verified quotes
  language_note     text,                       -- translation provenance
  verification_ref  text,                       -- where the quotation was checked
  content_type      public.quote_content_type not null,
  tones             text[] not null default '{}',
  tags              text[] not null default '{}',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  -- A verified quote without a named source is not verifiable.
  constraint quote_library_verified_has_source check (
    content_type <> 'verified'
    or (attribution is not null and source_title is not null and verification_ref is not null)
  ),
  -- An original line must never be attributed to a character or a series.
  constraint quote_library_original_unattributed check (
    content_type <> 'original' or (attribution is null and source_title is null)
  )
);

create index if not exists quote_library_active_idx
  on public.quote_library (is_active, content_type);

-- Makes the seed file idempotent: re-running it refreshes tone/tag metadata
-- instead of inserting duplicates.
create unique index if not exists quote_library_body_unique
  on public.quote_library (body);

create table if not exists public.user_favorite_quotes (
  user_id    uuid not null references auth.users (id) on delete cascade,
  quote_id   uuid not null references public.quote_library (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, quote_id)
);

-- Storing the daily delivery makes the "quote of the day" identical across
-- devices and gives the "previous quotes" view something real to read.
create table if not exists public.daily_quote_deliveries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  quote_id      uuid not null references public.quote_library (id) on delete cascade,
  delivered_on  date not null,
  created_at    timestamptz not null default now(),
  unique (user_id, delivered_on)
);

create index if not exists daily_quote_deliveries_user_idx
  on public.daily_quote_deliveries (user_id, delivered_on desc);

-- ───────────────────────────────────────────────────────────────────────────
-- xp_events — append-only. XP is always summed from here, never stored as a
-- mutable counter, and the check constraint makes "removing earned XP" an
-- impossible operation rather than merely a discouraged one.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.xp_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  amount       integer not null check (amount > 0),
  reason       text not null,
  source_type  public.xp_source not null,
  source_id    uuid,
  occurred_on  date not null default current_date,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists xp_events_user_idx on public.xp_events (user_id, occurred_at desc);
-- Idempotency: the same source event can only ever award XP once.
create unique index if not exists xp_events_source_unique
  on public.xp_events (user_id, source_type, source_id)
  where source_id is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- user_achievements — milestones, personal records, graceful returns
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.user_achievements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  key          text not null check (length(trim(key)) between 1 and 64),
  unlocked_at  timestamptz not null default now(),
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (user_id, key)
);

-- ───────────────────────────────────────────────────────────────────────────
-- daily_reflections — never a lock-out: always writable after the fact
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.daily_reflections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  reflection_date   date not null,
  win_of_day        text,
  notes             text,
  mood              smallint check (mood is null or mood between 1 and 5),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, reflection_date)
);

create index if not exists daily_reflections_user_idx
  on public.daily_reflections (user_id, reflection_date desc);

-- ───────────────────────────────────────────────────────────────────────────
-- calendar_events — everything on the calendar that is not a task.
--
-- Same series model as tasks: a series master has recurrence <> 'none' and a
-- NULL parent; a diverged occurrence is an exception row carrying
-- (parent_event_id, occurrence_date). The renderer expands series in memory
-- and skips slots that have an exception, so a series can never also appear as
-- a duplicated materialised row.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.calendar_events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  parent_event_id     uuid references public.calendar_events (id) on delete cascade,
  title               text not null check (length(trim(title)) between 1 and 160),
  description         text,
  kind                public.event_kind not null default 'appointment',
  category            public.category_kind not null default 'personal',
  priority            public.task_priority not null default 'secondary',
  status              public.event_status not null default 'scheduled',
  goal_id             uuid references public.goals (id) on delete set null,
  is_all_day          boolean not null default false,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  timezone            text not null default 'UTC',
  location            text,
  reminder_minutes    smallint check (reminder_minutes is null or reminder_minutes between 0 and 10080),
  recurrence          public.recurrence_kind not null default 'none',
  weekdays            smallint[] not null default '{}',
  recurrence_starts_on date,
  recurrence_ends_on  date,
  occurrence_date     date,
  original_starts_at  timestamptz,
  cancelled_at        timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint calendar_events_order check (ends_at > starts_at),
  constraint calendar_events_weekdays check (
    recurrence <> 'custom_weekly' or array_length(weekdays, 1) >= 1
  ),
  constraint calendar_events_weekdays_domain check (
    weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint calendar_events_series_range check (
    recurrence_ends_on is null
    or recurrence_starts_on is null
    or recurrence_ends_on >= recurrence_starts_on
  ),
  -- Exception rows must belong to a series and name their slot.
  constraint calendar_events_exception_slot check (
    parent_event_id is null or occurrence_date is not null
  )
);

create index if not exists calendar_events_user_start_idx
  on public.calendar_events (user_id, starts_at);
create index if not exists calendar_events_user_occurrence_idx
  on public.calendar_events (user_id, occurrence_date);
create index if not exists calendar_events_parent_idx
  on public.calendar_events (parent_event_id) where parent_event_id is not null;

-- One live exception per series slot.
create unique index if not exists calendar_events_exception_unique
  on public.calendar_events (parent_event_id, occurrence_date)
  where parent_event_id is not null;
