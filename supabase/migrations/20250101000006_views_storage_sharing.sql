-- ═══════════════════════════════════════════════════════════════════════════
-- REBIRTH · 0006 · reporting views, private storage, read-only sharing
--
-- Every view is created `with (security_invoker = true)` so that reading a view
-- is exactly as restricted as reading the underlying tables. Without that
-- option a view executes as its owner and would quietly bypass RLS.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- v_task_actuals — derived, per-instance tracked time
--
-- Everything minute-level in the app is reconstructed from these timestamped
-- session rows; nothing is incremented per second.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_task_actuals
with (security_invoker = true)
as
select
  t.id  as task_id,
  t.user_id,
  coalesce(sum(
    public.fn_session_active_seconds(s.accumulated_seconds, s.last_resumed_at, s.status, coalesce(s.ended_at, now()))
  ) filter (where s.kind <> 'break'), 0)::integer as active_seconds,
  coalesce(sum(
    public.fn_session_active_seconds(s.accumulated_seconds, s.last_resumed_at, s.status, coalesce(s.ended_at, now()))
  ) filter (where s.kind = 'break'), 0)::integer as break_seconds,
  count(s.id) filter (where s.kind <> 'break')::integer as sessions_logged,
  count(s.id) filter (where s.kind = 'two_minute')::integer as two_minute_attempts
from public.scheduled_tasks t
left join public.task_sessions s
       on s.task_id = t.id
      and s.status in ('completed', 'abandoned')
group by t.id, t.user_id;

-- ───────────────────────────────────────────────────────────────────────────
-- v_goal_progress — four separate, honest measurements per goal.
--
-- Deliberately NOT a single percentage: effort, execution and milestone counts
-- are reported side by side and the client decides which one, if any, the goal
-- declared as its measurement method. Scalar subqueries are used rather than
-- joins so that session and milestone rows cannot multiply each other's sums.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_goal_progress
with (security_invoker = true)
as
select
  g.id as goal_id,
  g.user_id,
  g.title,
  g.status,
  g.measurement,
  g.target_date,
  g.target_minutes,
  g.target_sessions,
  g.manual_progress,
  g.color_index,

  -- Effort: real focus time attributed to this goal.
  coalesce((
    select sum(public.fn_session_active_seconds(
                 s.accumulated_seconds, s.last_resumed_at, s.status, coalesce(s.ended_at, now())
               )) / 60
      from public.task_sessions s
      join public.scheduled_tasks t on t.id = s.task_id
     where t.goal_id = g.id and s.status in ('completed', 'abandoned') and s.kind <> 'break'
  ), 0)::integer as focus_minutes,

  coalesce((
    select count(*)
      from public.task_sessions s
      join public.scheduled_tasks t on t.id = s.task_id
     where t.goal_id = g.id and s.status = 'completed' and s.kind <> 'break'
  ), 0)::integer as sessions_completed,

  -- Execution: scheduled vs completed instances linked to this goal.
  coalesce((
    select count(*) from public.scheduled_tasks t
     where t.goal_id = g.id and t.status <> 'cancelled'
  ), 0)::integer as tasks_planned,

  coalesce((
    select count(*) from public.scheduled_tasks t
     where t.goal_id = g.id and t.status = 'completed'
  ), 0)::integer as tasks_completed,

  -- Skill mastery: only ever counted from milestones the user actually closed.
  coalesce((
    select count(*) from public.goal_milestones m where m.goal_id = g.id
  ), 0)::integer as milestones_total,

  coalesce((
    select count(*) from public.goal_milestones m
     where m.goal_id = g.id and m.completed_at is not null
  ), 0)::integer as milestones_done

from public.goals g;

-- ───────────────────────────────────────────────────────────────────────────
-- Private storage for Phase 3 voice notes.
-- The bucket is private; every policy is scoped to the owner's own folder,
-- which is named after the user id.
-- ───────────────────────────────────────────────────────────────────────────
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('voice-notes', 'voice-notes', false)
  on conflict (id) do nothing;
exception
  when undefined_table then
    raise notice 'storage.buckets not present — skipping voice-note bucket (run inside Supabase to enable).';
end $$;

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects') then
    execute 'drop policy if exists voice_notes_owner_select on storage.objects';
    execute $p$
      create policy voice_notes_owner_select on storage.objects
        for select to authenticated
        using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;

    execute 'drop policy if exists voice_notes_owner_insert on storage.objects';
    execute $p$
      create policy voice_notes_owner_insert on storage.objects
        for insert to authenticated
        with check (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;

    execute 'drop policy if exists voice_notes_owner_update on storage.objects';
    execute $p$
      create policy voice_notes_owner_update on storage.objects
        for update to authenticated
        using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;

    execute 'drop policy if exists voice_notes_owner_delete on storage.objects';
    execute $p$
      create policy voice_notes_owner_delete on storage.objects
        for delete to authenticated
        using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- Read-only sharing · Phase 3
--
-- A share link grants access to *one function call* that returns an explicitly
-- whitelisted projection. The reader never obtains a database session, so the
-- RLS-protected tables remain unreachable regardless of what the token holder
-- tries to request. Goals, free-text notes, energy/sleep data and finances are
-- not in the projection and therefore cannot leak through a share link.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.rpc_public_shared_summary(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tok     public.share_tokens;
  v_user    uuid;
  v_day     date := current_date;
  v_done    integer := 0;
  v_planned integer := 0;
  v_minutes integer := 0;
  v_name    text;
begin
  if p_token is null or length(p_token) < 24 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  select * into v_tok
    from public.share_tokens
   where token = p_token
     and revoked_at is null
     and expires_at > now();

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  end if;

  v_user := v_tok.user_id;
  update public.share_tokens set last_used_at = now() where id = v_tok.id;

  select coalesce(p.display_name, 'A friend') into v_name
    from public.profiles p where p.id = v_user;

  select count(*) filter (where status = 'completed'),
         count(*) filter (where status <> 'cancelled')
    into v_done, v_planned
    from public.scheduled_tasks
   where user_id = v_user and scheduled_date = v_day;

  select coalesce(sum(public.fn_session_active_seconds(
           s.accumulated_seconds, s.last_resumed_at, s.status, coalesce(s.ended_at, now())
         )) / 60, 0)
    into v_minutes
    from public.task_sessions s
   where s.user_id = v_user
     and s.status in ('completed', 'abandoned')
     and s.kind <> 'break'
     and (s.started_at at time zone coalesce(
            (select pref.timezone from public.user_preferences pref where pref.user_id = v_user), 'UTC'
          ))::date = v_day;

  return jsonb_build_object(
    'ok', true,
    'date', v_day,
    'display_name', coalesce(v_name, 'A friend'),
    'tasks_completed', coalesce(v_done, 0),
    'tasks_planned', coalesce(v_planned, 0),
    'focus_minutes', coalesce(v_minutes, 0)
  );
end $$;

-- The single thing an anonymous caller is allowed to execute.
do $$
declare has_anon boolean;
begin
  select exists (select 1 from pg_roles where rolname = 'anon') into has_anon;
  if has_anon then
    execute 'revoke all on function public.rpc_public_shared_summary(text) from public';
    execute 'grant execute on function public.rpc_public_shared_summary(text) to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.rpc_public_shared_summary(text) to authenticated';
  end if;
end $$;
