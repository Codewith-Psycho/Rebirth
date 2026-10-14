-- ═══════════════════════════════════════════════════════════════════════════
-- REBIRTH · 0001 · extensions and enumerated types
-- ═══════════════════════════════════════════════════════════════════════════

-- `gen_random_uuid()` is built into PostgreSQL 13+, which every Supabase
-- project runs, so no extension is strictly required. `pgcrypto` is present on
-- Supabase by default and this statement is a no-op there; it is guarded so the
-- schema also applies cleanly to a bare local PostgreSQL instance.
do $$
begin
  create extension if not exists "pgcrypto" with schema extensions;
exception
  when others then
    begin
      create extension if not exists "pgcrypto";
    exception when others then null;
    end;
end $$;

-- ── Scheduling ────────────────────────────────────────────────────────────
do $$ begin
  create type public.task_priority as enum ('main', 'secondary');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum (
    'scheduled',    -- planned, not started
    'in_progress',  -- a session is open against it
    'completed',
    'skipped',      -- the day passed without it being done (never punitive)
    'cancelled'     -- deliberately removed from the plan
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recurrence_kind as enum (
    'none',           -- single occurrence
    'daily',          -- every day
    'weekdays',       -- Mon–Fri
    'weekends',       -- Sat–Sun
    'custom_weekly'   -- explicit weekday list
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.category_kind as enum (
    'study', 'work', 'health', 'routine', 'personal',
    'rest', 'meal', 'creative', 'admin', 'social', 'travel', 'other'
  );
exception when duplicate_object then null; end $$;

-- ── Goals ─────────────────────────────────────────────────────────────────
do $$ begin
  create type public.goal_status as enum ('active', 'paused', 'achieved', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  -- How progress toward a goal is honestly measured. We never invent a
  -- percentage: 'effort' and 'execution' are derived from real records,
  -- 'milestone' counts completed milestones, 'manual' is user-declared.
  create type public.goal_measurement as enum ('effort', 'execution', 'milestone', 'manual');
exception when duplicate_object then null; end $$;

-- ── Focus sessions ────────────────────────────────────────────────────────
do $$ begin
  create type public.session_kind as enum ('focus', 'two_minute', 'break');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.session_status as enum ('running', 'paused', 'completed', 'abandoned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.micro_step_state as enum ('pending', 'done', 'skipped');
exception when duplicate_object then null; end $$;

-- ── Daily practice ────────────────────────────────────────────────────────
do $$ begin
  create type public.energy_slot as enum ('morning', 'afternoon', 'evening');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.day_mode as enum ('do', 'plan', 'pressure');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.theme_preference as enum ('light', 'dark', 'system');
exception when duplicate_object then null; end $$;

-- ── Rewards ───────────────────────────────────────────────────────────────
do $$ begin
  create type public.reward_type as enum (
    'time_block', 'treat', 'episode', 'outing', 'purchase', 'custom'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reward_condition as enum (
    'sessions', 'minutes', 'task_completed', 'goal_milestone',
    'weekly_consistency', 'manual'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.xp_source as enum (
    'session', 'task_completion', 'goal_milestone', 'consistency', 'reward'
  );
exception when duplicate_object then null; end $$;

-- ── Motivation ────────────────────────────────────────────────────────────
do $$ begin
  -- 'verified'  → a real quotation with a source reference.
  -- 'original'  → written for REBIRTH; must never be attributed to a character.
  create type public.quote_content_type as enum ('verified', 'original');
exception when duplicate_object then null; end $$;

-- ── Calendar ──────────────────────────────────────────────────────────────
do $$ begin
  create type public.event_kind as enum (
    'appointment', 'deadline', 'exam', 'interview', 'competition',
    'personal', 'celebration', 'travel', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.event_status as enum ('scheduled', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

-- ── Later phases ──────────────────────────────────────────────────────────
do $$ begin
  create type public.meal_weight as enum ('light', 'regular', 'heavy');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.distraction_kind as enum (
    'entertainment', 'scrolling', 'gaming', 'social', 'other'
  );
exception when duplicate_object then null; end $$;
