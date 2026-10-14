-- ═══════════════════════════════════════════════════════════════════════════
-- REBIRTH · 0003 · later-phase tables
--
-- These are created now, with full ownership columns and RLS (migration 0005),
-- so that Phase 2 and Phase 3 modules can be built without a schema rewrite.
-- No Phase 1 code reads or writes them, and nothing is seeded into them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- important_events · Phase 2 · drives Pressure-Week Mode
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.important_events (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  title                    text not null check (length(trim(title)) between 1 and 160),
  kind                     public.event_kind not null default 'deadline',
  starts_on                date not null,
  ends_on                  date,
  -- Per-event overrides. NULL means "inherit from user_preferences".
  pressure_mode_enabled    boolean not null default true,
  pressure_lead_days       smallint not null default 14 check (pressure_lead_days between 1 and 90),
  deep_work_cap_minutes    integer check (deep_work_cap_minutes is null or deep_work_cap_minutes between 30 and 1440),
  minimum_sleep_minutes    integer check (minimum_sleep_minutes is null or minimum_sleep_minutes between 240 and 720),
  recovery_days            smallint not null default 1 check (recovery_days between 0 and 7),
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint important_events_range check (ends_on is null or ends_on >= starts_on)
);

create index if not exists important_events_user_idx
  on public.important_events (user_id, starts_on);

-- ───────────────────────────────────────────────────────────────────────────
-- weekly_plans · Phase 2 · Plan Mode
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_plans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  week_start        date not null,
  planned_minutes   smallint check (planned_minutes is null or planned_minutes >= 0),
  notes             text,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, week_start)
);

-- ───────────────────────────────────────────────────────────────────────────
-- parking_lot_ideas · Phase 2 · 30-day cooling rule
--
-- `earliest_promotion_date` is computed on insert from the user's configured
-- cooling period, so the rule cannot be bypassed by a client that forgets it.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.parking_lot_ideas (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  content                  text not null check (length(trim(content)) between 1 and 500),
  category                 public.category_kind not null default 'other',
  reason                   text,
  cooling_days             smallint not null default 30 check (cooling_days between 0 and 365),
  earliest_promotion_date  date not null,
  promoted_at              timestamptz,
  promoted_goal_id         uuid references public.goals (id) on delete set null,
  dismissed_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists parking_lot_ideas_user_idx
  on public.parking_lot_ideas (user_id, earliest_promotion_date);

-- ───────────────────────────────────────────────────────────────────────────
-- daydream_logs · Phase 2 · Daydream Catcher
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.daydream_logs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  occurred_at      timestamptz not null default now(),
  occurred_on      date not null default current_date,
  next_real_step   text,
  task_id          uuid references public.scheduled_tasks (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists daydream_logs_user_idx
  on public.daydream_logs (user_id, occurred_on desc);

-- ───────────────────────────────────────────────────────────────────────────
-- distraction_sessions · Phase 2 · manual escape logs only.
-- There is deliberately no column for an automatically observed application:
-- REBIRTH does not monitor the device.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.distraction_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          public.distraction_kind not null default 'entertainment',
  note          text,
  log_date      date not null default current_date,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  minutes       integer check (minutes is null or minutes >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint distraction_sessions_order check (ended_at is null or ended_at >= started_at)
);

create index if not exists distraction_sessions_user_idx
  on public.distraction_sessions (user_id, log_date desc);

-- ───────────────────────────────────────────────────────────────────────────
-- meal_logs · Phase 2
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.meal_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  log_date    date not null default current_date,
  logged_at   timestamptz not null default now(),
  weight      public.meal_weight not null default 'regular',
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists meal_logs_user_idx on public.meal_logs (user_id, log_date desc);

-- ───────────────────────────────────────────────────────────────────────────
-- sleep_logs · Phase 2 · overnight periods cross midnight naturally because
-- both ends are instants.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.sleep_logs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  log_date          date not null default current_date,
  bedtime           timestamptz not null,
  wake_at           timestamptz not null,
  quality           smallint check (quality is null or quality between 1 and 5),
  note              text,
  duration_minutes  integer generated always as (
                      (floor(extract(epoch from (wake_at - bedtime)) / 60))::integer
                    ) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint sleep_logs_order check (wake_at > bedtime),
  constraint sleep_logs_plausible check (
    extract(epoch from (wake_at - bedtime)) <= 24 * 60 * 60
  )
);

create index if not exists sleep_logs_user_idx on public.sleep_logs (user_id, log_date desc);

-- ───────────────────────────────────────────────────────────────────────────
-- voice_notes · Phase 3 · "Explain it out loud"
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.voice_notes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  title            text,
  storage_path     text not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 30 and 300),
  note             text,
  self_rating      smallint check (self_rating is null or self_rating between 1 and 5),
  recorded_on      date not null default current_date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists voice_notes_user_idx on public.voice_notes (user_id, recorded_on desc);

-- ───────────────────────────────────────────────────────────────────────────
-- Networking mini CRM · Phase 3
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.networking_contacts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 120),
  role            text,
  organization    text,
  notes           text,
  next_action     text,
  follow_up_on    date,
  follow_up_days  smallint not null default 7 check (follow_up_days between 1 and 365),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists networking_contacts_user_idx
  on public.networking_contacts (user_id, follow_up_on);

create table if not exists public.networking_interactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  contact_id     uuid not null references public.networking_contacts (id) on delete cascade,
  occurred_on    date not null default current_date,
  channel        text,
  notes          text,
  next_action    text,
  follow_up_on   date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists networking_interactions_contact_idx
  on public.networking_interactions (contact_id, occurred_on desc);

-- ───────────────────────────────────────────────────────────────────────────
-- case_studies · Phase 3 · strategic thinking log
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.case_studies (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null check (length(trim(title)) between 1 and 200),
  problem       text,
  approach      text,
  missed        text,
  outcome       text,
  lessons       text,
  completed_on  date not null default current_date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists case_studies_user_idx on public.case_studies (user_id, completed_on desc);

-- ───────────────────────────────────────────────────────────────────────────
-- innovation_logs · Phase 3 · weekly "try one new thing"
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.innovation_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  week_start  date not null,
  item        text not null check (length(trim(item)) between 1 and 200),
  reason      text,
  outcome     text,
  lesson      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, week_start)
);

-- ───────────────────────────────────────────────────────────────────────────
-- Finance · Phase 3
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.expenses (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  amount             numeric(12, 2) not null check (amount > 0),
  currency           text not null default 'USD' check (length(currency) between 3 and 3),
  category           text not null default 'general' check (length(trim(category)) between 1 and 60),
  spent_on           date not null default current_date,
  spent_at           timestamptz,
  note               text,
  is_large           boolean not null default false,
  reflection_need_want      text,
  reflection_verified_with  boolean,
  reflection_wait_48h       boolean,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists expenses_user_idx on public.expenses (user_id, spent_on desc);

create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  category    text not null check (length(trim(category)) between 1 and 60),
  period      text not null default 'month' check (period in ('week', 'month')),
  amount      numeric(12, 2) not null check (amount > 0),
  currency    text not null default 'USD' check (length(currency) between 3 and 3),
  starts_on   date not null default current_date,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists budgets_user_idx on public.budgets (user_id, is_active);

-- ───────────────────────────────────────────────────────────────────────────
-- share_tokens · Phase 3 · read-only, revocable, expiring, opt-in
--
-- The token row is the *only* thing a share link can read. The anonymous
-- reader never gets a database session: the token is resolved by a
-- SECURITY DEFINER function that returns an explicitly whitelisted projection
-- (see migration 0006), so goals, notes, health and finance data are not
-- reachable through a share link at all.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.share_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  token        text not null unique check (length(token) between 24 and 128),
  label        text,
  scope        text not null default 'daily_summary' check (scope in ('daily_summary')),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists share_tokens_user_idx on public.share_tokens (user_id);
