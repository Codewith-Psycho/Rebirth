-- ═══════════════════════════════════════════════════════════════════════════
-- REBIRTH · 0007 · XP for closing a milestone, and ownership guards
--
-- Goal milestones are the only honest basis for a "skill mastery" claim, so
-- they earn XP like everything else. Two properties matter:
--
--   · The award fires on the *transition* into completed, and the unique index
--     on (user_id, source_type, source_id) means it can only ever pay out once
--     per milestone — saving the row again is a no-op, not a second payout.
--   · Un-marking a milestone deletes nothing. XP is append-only, so backing out
--     of a completed milestone does not remove what was already earned.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.award_milestone_xp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := new.user_id;
  v_tz   text;
begin
  if new.completed_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.completed_at is not null then
    return new;   -- still completed; nothing changed
  end if;

  select coalesce(p.timezone, 'UTC') into v_tz
    from public.user_preferences p
   where p.user_id = v_user;
  v_tz := coalesce(v_tz, 'UTC');

  insert into public.xp_events (user_id, amount, reason, source_type, source_id, occurred_on)
  values (
    v_user,
    -- Heavier milestones are worth more, within sane bounds. A default-weight
    -- milestone is worth 25.
    greatest(10, least(80, round(25 * coalesce(new.weight, 1))::integer)),
    'Milestone reached',
    'goal_milestone',
    new.id,
    (new.completed_at at time zone v_tz)::date
  )
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists award_milestone_xp on public.goal_milestones;
create trigger award_milestone_xp
  after insert or update of completed_at on public.goal_milestones
  for each row execute function public.award_milestone_xp();

-- ═══════════════════════════════════════════════════════════════════════════
-- Ownership guards
--
-- RLS policies test the row being written (`auth.uid() = user_id`). They say
-- nothing about the *other* rows that row points at. Without the checks below a
-- user could attach an exception to somebody else's series id, or link a task
-- to a goal they do not own, and read the linked title back through a join.
-- Hiding that in the client would not be a fix; the check has to be here.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.check_calendar_event_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.parent_event_id is null then
    return new;
  end if;

  if new.parent_event_id = new.id then
    raise exception 'calendar_event_self_parent' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.calendar_events e
     where e.id = new.parent_event_id
       and e.user_id = new.user_id
       and e.parent_event_id is null
  ) then
    raise exception 'calendar_event_parent_not_found' using errcode = 'P0001';
  end if;

  return new;
end $$;

drop trigger if exists check_calendar_event_parent on public.calendar_events;
create trigger check_calendar_event_parent
  before insert or update of parent_event_id on public.calendar_events
  for each row execute function public.check_calendar_event_parent();

create or replace function public.check_owned_references()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name in ('scheduled_tasks', 'task_templates') then
    if new.goal_id is not null and not exists (
      select 1 from public.goals g where g.id = new.goal_id and g.user_id = new.user_id
    ) then
      raise exception 'goal_not_owned' using errcode = 'P0001';
    end if;
    if new.reward_id is not null and not exists (
      select 1 from public.rewards r where r.id = new.reward_id and r.user_id = new.user_id
    ) then
      raise exception 'reward_not_owned' using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'calendar_events' then
    if new.goal_id is not null and not exists (
      select 1 from public.goals g where g.id = new.goal_id and g.user_id = new.user_id
    ) then
      raise exception 'goal_not_owned' using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'rewards' then
    if new.condition_goal_id is not null and not exists (
      select 1 from public.goals g where g.id = new.condition_goal_id and g.user_id = new.user_id
    ) then
      raise exception 'goal_not_owned' using errcode = 'P0001';
    end if;
    if new.condition_milestone_id is not null and not exists (
      select 1 from public.goal_milestones m
       where m.id = new.condition_milestone_id and m.user_id = new.user_id
    ) then
      raise exception 'milestone_not_owned' using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'goal_milestones' then
    if not exists (
      select 1 from public.goals g where g.id = new.goal_id and g.user_id = new.user_id
    ) then
      raise exception 'goal_not_owned' using errcode = 'P0001';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists check_owned_references_tasks on public.scheduled_tasks;
create trigger check_owned_references_tasks
  before insert or update of goal_id, reward_id on public.scheduled_tasks
  for each row execute function public.check_owned_references();

drop trigger if exists check_owned_references_templates on public.task_templates;
create trigger check_owned_references_templates
  before insert or update of goal_id, reward_id on public.task_templates
  for each row execute function public.check_owned_references();

drop trigger if exists check_owned_references_events on public.calendar_events;
create trigger check_owned_references_events
  before insert or update of goal_id on public.calendar_events
  for each row execute function public.check_owned_references();

drop trigger if exists check_owned_references_rewards on public.rewards;
create trigger check_owned_references_rewards
  before insert or update of condition_goal_id, condition_milestone_id on public.rewards
  for each row execute function public.check_owned_references();

drop trigger if exists check_owned_references_milestones on public.goal_milestones;
create trigger check_owned_references_milestones
  before insert or update of goal_id on public.goal_milestones
  for each row execute function public.check_owned_references();

-- ═══════════════════════════════════════════════════════════════════════════
-- Reward windows are counted in the *user's* local days
--
-- The first version of `fn_reward_eligible` bucketed sessions with
-- `s.started_at::date`, which is the UTC date. For anyone east or west of
-- Greenwich that puts late-evening and early-morning sessions in the wrong day,
-- so a "5 sessions this week" reward could include a session the user considers
-- part of last week. Everything else in REBIRTH counts local days; this makes
-- rewards agree with the rest of the app.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.fn_reward_eligible(p_reward public.rewards, p_user uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_from   date;
  v_to     date;
  v_tz     text;
  v_week0  smallint := 1;
  v_count  integer;
  v_mins   integer;
  v_ok     boolean := false;
begin
  if p_reward.condition_kind = 'manual' then
    return true;
  end if;

  select coalesce(pref.timezone, 'UTC'), coalesce(pref.week_starts_on, 1)
    into v_tz, v_week0
    from public.user_preferences pref
   where pref.user_id = p_user;
  v_tz    := coalesce(v_tz, 'UTC');
  v_week0 := coalesce(v_week0, 1);

  v_to := (now() at time zone v_tz)::date;

  if p_reward.is_repeatable then
    v_from := case p_reward.repeat_period
                when 'day'   then v_to
                when 'month' then date_trunc('month', v_to)::date
                else public.fn_week_start(v_to, v_week0)
              end;
  else
    v_from := 'epoch'::date;
  end if;

  if p_reward.condition_kind = 'sessions' then
    select count(*) into v_count
      from public.task_sessions s
     where s.user_id = p_user
       and s.status = 'completed'
       and s.kind <> 'break'
       and (s.started_at at time zone v_tz)::date between v_from and v_to;
    return coalesce(v_count, 0) >= coalesce(p_reward.condition_sessions, 0);

  elsif p_reward.condition_kind = 'minutes' then
    select coalesce(sum(public.fn_session_active_seconds(
             s.accumulated_seconds, s.last_resumed_at, s.status, coalesce(s.ended_at, now())
           )) / 60, 0)::integer into v_mins
      from public.task_sessions s
     where s.user_id = p_user
       and s.status = 'completed'
       and s.kind <> 'break'
       and (s.started_at at time zone v_tz)::date between v_from and v_to;
    return coalesce(v_mins, 0) >= coalesce(p_reward.condition_minutes, 0);

  elsif p_reward.condition_kind = 'task_completed' then
    select exists (
      select 1 from public.scheduled_tasks t
       where t.id = p_reward.condition_task_id
         and t.user_id = p_user
         and t.status = 'completed'
         and t.scheduled_date between v_from and v_to
    ) into v_ok;
    return v_ok;

  elsif p_reward.condition_kind = 'goal_milestone' then
    select exists (
      select 1 from public.goal_milestones m
       where m.id = p_reward.condition_milestone_id
         and m.user_id = p_user
         and m.completed_at is not null
    ) into v_ok;
    return v_ok;

  elsif p_reward.condition_kind = 'weekly_consistency' then
    select coalesce(
             public.fn_consistency_score(
               p_user,
               public.fn_week_start(v_to, v_week0),
               public.fn_week_start(v_to, v_week0) + 6,
               v_to
             ), 0
           ) >= coalesce(p_reward.condition_weekly_consistency, 100)
      into v_ok;
    return v_ok;
  end if;

  return false;
end $$;

create or replace function public.rpc_claim_reward(p_reward_id uuid, p_note text default null)
returns public.reward_claims
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_reward public.rewards;
  v_key    text;
  v_today  date;
  v_row    public.reward_claims;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select * into v_reward
    from public.rewards
   where id = p_reward_id and user_id = v_user and is_active;
  if not found then
    raise exception 'reward_not_found' using errcode = 'P0001';
  end if;

  -- Eligibility is recomputed here against the stored records. The client is
  -- allowed to *show* an unlocked badge, but it is never the authority.
  if not public.fn_reward_eligible(v_reward, v_user) then
    raise exception 'This reward has not been earned yet.' using
      errcode = 'P0001', hint = 'reward_not_eligible';
  end if;

  select (now() at time zone coalesce(p.timezone, 'UTC'))::date into v_today
    from public.user_preferences p
   where p.user_id = v_user;
  v_today := coalesce(v_today, current_date);

  v_key := public.fn_reward_period_key(v_reward.is_repeatable, v_reward.repeat_period, v_today);

  insert into public.reward_claims (user_id, reward_id, period_key, xp_awarded, note)
  values (v_user, p_reward_id, v_key, v_reward.xp_value, p_note)
  returning * into v_row;

  if v_reward.xp_value > 0 then
    insert into public.xp_events (user_id, amount, reason, source_type, source_id, occurred_on)
    values (v_user, v_reward.xp_value, 'Reward claimed: ' || v_reward.name, 'reward', v_row.id, v_today)
    on conflict do nothing;
  end if;

  return v_row;
exception
  when unique_violation then
    raise exception 'You have already claimed this reward for this period.' using
      errcode = 'P0001', hint = 'reward_already_claimed';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants for the functions introduced above.
--
-- `create function` grants EXECUTE to PUBLIC by default. Migration 0005 revoked
-- that for everything that existed at the time; the functions added here are
-- created afterwards, so the same revoke has to be repeated or they would be
-- callable by an unauthenticated role. The trigger functions cannot usefully be
-- invoked directly (PostgreSQL refuses to run a trigger function outside a
-- trigger), but leaving them PUBLIC is still the wrong default to leave behind.
-- ═══════════════════════════════════════════════════════════════════════════

revoke execute on function public.award_milestone_xp() from public;
revoke execute on function public.check_calendar_event_parent() from public;
revoke execute on function public.check_owned_references() from public;
revoke execute on function public.fn_reward_eligible(public.rewards, uuid) from public;
revoke execute on function public.rpc_claim_reward(uuid, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.rpc_claim_reward(uuid, text) to authenticated';
    execute 'grant execute on function public.fn_reward_eligible(public.rewards, uuid) to authenticated';
  end if;
end $$;
