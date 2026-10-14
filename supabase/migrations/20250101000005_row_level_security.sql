-- ═══════════════════════════════════════════════════════════════════════════
-- REBIRTH · 0005 · Row Level Security
--
-- Every user-owned table has RLS enabled and four policies — one per verb —
-- each keyed on `auth.uid()`. Hiding a component in the browser is not a
-- security measure and nothing here relies on that.
--
-- `profiles` keys on `id` because the row's primary key *is* the user id.
-- `quote_library` is global reference content: readable by any signed-in user,
-- writable by nobody through the API.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tables owned through `user_id` ─────────────────────────────────────────
do $$
declare
  t text;
  owner_tables text[] := array[
    'user_preferences', 'goals', 'goal_milestones', 'rewards', 'reward_claims',
    'task_templates', 'scheduled_tasks', 'task_sessions', 'task_session_pauses',
    'task_micro_steps', 'daily_energy_logs', 'user_favorite_quotes',
    'daily_quote_deliveries', 'xp_events', 'user_achievements',
    'daily_reflections', 'calendar_events',
    -- Phase 2 / 3 tables are locked down now, not when the module ships.
    'important_events', 'weekly_plans', 'parking_lot_ideas', 'daydream_logs',
    'distraction_sessions', 'meal_logs', 'sleep_logs', 'voice_notes',
    'networking_contacts', 'networking_interactions', 'case_studies',
    'innovation_logs', 'expenses', 'budgets', 'share_tokens'
  ];
begin
  foreach t in array owner_tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_owner_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)',
      t || '_owner_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_owner_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (auth.uid() = user_id)',
      t || '_owner_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_owner_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_owner_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_owner_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)',
      t || '_owner_delete', t);
  end loop;
end $$;

-- ── profiles ───────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists profiles_owner_select on public.profiles;
create policy profiles_owner_select on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists profiles_owner_insert on public.profiles;
create policy profiles_owner_insert on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_owner_delete on public.profiles;
create policy profiles_owner_delete on public.profiles
  for delete to authenticated using (auth.uid() = id);

-- ── quote_library — global reference content ───────────────────────────────
alter table public.quote_library enable row level security;

drop policy if exists quote_library_read on public.quote_library;
create policy quote_library_read on public.quote_library
  for select to authenticated using (is_active);

-- Deliberately no insert/update/delete policy: the library is curated through
-- migrations and is read-only through every API surface.

-- ── Verify no user-owned table was left without RLS ────────────────────────
do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity
  loop
    raise warning 'REBIRTH: table public.% has no row level security enabled', r.relname;
  end loop;
end $$;

-- ── Explicit grants ───────────────────────────────────────────────────────
-- Supabase configures default privileges for these roles already; stating them
-- explicitly makes the migration portable to a bare PostgreSQL instance and
-- makes the intent auditable. Roles that do not exist (a plain PostgreSQL
-- install) are skipped rather than failing the migration.
do $$
declare
  r text;
  has_role boolean;
begin
  -- Anonymous visitors get nothing at all from the tables. The only thing an
  -- anonymous caller can reach is the explicitly whitelisted share-token
  -- function granted in migration 0006.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
  end if;

  -- Function EXECUTE is granted to PUBLIC by default, which would silently
  -- re-open every RPC to anonymous callers. Revoke it and grant explicitly.
  execute 'revoke execute on all functions in schema public from public';

  foreach r in array array['authenticated', 'service_role'] loop
    select exists (select 1 from pg_roles where rolname = r) into has_role;
    if has_role then
      execute format('grant usage on schema public to %I', r);
      execute format(
        'grant select, insert, update, delete on all tables in schema public to %I', r);
      execute format('grant execute on all functions in schema public to %I', r);
      execute format('grant usage, select on all sequences in schema public to %I', r);
    end if;
  end loop;
end $$;
