-- ═══════════════════════════════════════════════════════════════════════════
-- REBIRTH · 0008 · Realtime publication
--
-- Realtime is an *addition* to persistence, never a substitute for it. Every
-- screen loads from the tables and then subscribes for changes; if Realtime is
-- unavailable the app still works, the other device just has to navigate or
-- reload. Nothing about correctness depends on a message arriving.
--
-- Tables are added to the default `supabase_realtime` publication. Row Level
-- Security still applies to the change stream: a subscriber only receives rows
-- their own policies would let them select.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  t text;
  realtime_tables text[] := array[
    'scheduled_tasks',
    'task_templates',
    'task_sessions',
    'task_micro_steps',
    'calendar_events',
    'important_events',
    'goals',
    'goal_milestones',
    'rewards',
    'reward_claims',
    'xp_events',
    'user_achievements',
    'daily_energy_logs',
    'daily_reflections',
    'user_preferences',
    'profiles'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime not present — skipping (run inside Supabase to enable Realtime).';
    return;
  end if;

  foreach t in array realtime_tables loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- already published
      when undefined_table then null;    -- table not created in this database
    end;
  end loop;
end $$;

-- `update` events only carry the changed columns unless the table is marked as
-- a full replica identity — and without the old row, a client cannot tell a
-- reschedule from a rename. FULL is the honest setting for tables the client
-- diffs rather than blindly refetches.
do $$
declare
  t text;
  full_identity text[] := array['scheduled_tasks', 'task_sessions', 'calendar_events', 'goals', 'rewards'];
begin
  foreach t in array full_identity loop
    begin
      execute format('alter table public.%I replica identity full', t);
    exception
      when undefined_table then null;
    end;
  end loop;
end $$;
