-- ═══════════════════════════════════════════════════════════════════════════
-- REBIRTH · 0004 · deferred foreign keys, functions and triggers
--
-- Design notes
--   · Interactive invariants (one MAIN per day, the daily secondary cap, one
--     open timer per user) live in the *database*, not the UI. The UI explains
--     them; it does not enforce them.
--   · Routines are edited through RPCs so that "this occurrence / this and
--     future / the whole series" is a single transaction. A partially applied
--     routine edit would corrupt history, so it must not be possible.
--   · Nothing here deletes completed history.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Deferred foreign keys (cyclic references) ──────────────────────────────
do $$ begin
  alter table public.rewards
    add constraint rewards_condition_task_fk
    foreign key (condition_task_id) references public.scheduled_tasks (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ── Helper: stable week start honouring the user's preference ──────────────
create or replace function public.fn_week_start(d date, p_week_starts_on smallint default 1)
returns date
language sql
immutable
as $$
  select (d - ((extract(dow from d)::smallint - p_week_starts_on + 7) % 7))::date;
$$;

-- ── Helper: instance duration in minutes ───────────────────────────────────
create or replace function public.fn_task_minutes(t public.scheduled_tasks)
returns integer
language sql
immutable
as $$
  select t.duration_minutes::integer;
$$;

-- ── Helper: consistency score ──────────────────────────────────────────────
-- Definition (shown to the user verbatim in Insights):
--   numerator   = eligible instances that reached 'completed'
--   denominator = instances that were *due* in the window as of `p_as_of`
--   cancelled   = removed from the denominator (the user chose not to do it)
--   future      = excluded (you cannot fail a task that is not due yet)
-- Active tracked time is reported separately and never folded into this score.
create or replace function public.fn_consistency_score(
  p_user uuid,
  p_from date,
  p_to date,
  p_as_of date default current_date
)
returns numeric
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with window_tasks as (
    select status
      from public.scheduled_tasks
     where user_id = p_user
       and scheduled_date between p_from and p_to
       and scheduled_date <= p_as_of
       and status <> 'cancelled'
  )
  select case
           when count(*) = 0 then null
           else round(
             100.0 * count(*) filter (where status = 'completed') / count(*),
             1
           )
         end
    from window_tasks;
$$;

-- ── Helper: active seconds in a session, derived — never counted in memory ──
create or replace function public.fn_session_active_seconds(
  p_accumulated integer,
  p_last_resumed_at timestamptz,
  p_status public.session_status,
  p_at timestamptz default now()
)
returns integer
language sql
immutable
as $$
  select p_accumulated + case
    when p_status = 'running' and p_last_resumed_at is not null
      then greatest(0, floor(extract(epoch from (p_at - p_last_resumed_at))))::integer
    else 0
  end;
$$;

-- ── updated_at maintenance ─────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'user_preferences', 'goals', 'goal_milestones', 'rewards',
    'task_templates', 'scheduled_tasks', 'task_sessions', 'task_micro_steps',
    'daily_energy_logs', 'daily_reflections', 'calendar_events',
    'important_events', 'weekly_plans', 'parking_lot_ideas', 'daydream_logs',
    'distraction_sessions', 'meal_logs', 'sleep_logs', 'voice_notes',
    'networking_contacts', 'networking_interactions', 'case_studies',
    'innovation_logs', 'expenses', 'budgets', 'share_tokens'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sign-up provisioning
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '')
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id, timezone)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'timezone', ''), 'UTC'))
  on conflict (user_id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Idempotent repair path for accounts that predate the trigger.
create or replace function public.rpc_ensure_user()
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  insert into public.profiles (id, email)
  select u.id, u.email from auth.users u where u.id = v_user
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id) values (v_user)
  on conflict (user_id) do nothing;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Invariant 1 — at most `daily_task_cap` open secondary tasks per day
--
-- Counted over *open* tasks, so finishing something frees room to plan
-- something else. Cancelled/skipped tasks never occupy a slot.
-- `rebirth.bypass_task_cap` is set by the materialiser (a routine the user
-- deliberately created is not an over-planning decision) and by the RPCs that
-- legitimately rearrange a day.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.enforce_daily_task_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cap    smallint;
  v_open   integer;
  v_bypass text := current_setting('rebirth.bypass_task_cap', true);
begin
  if v_bypass = 'on' then
    return new;
  end if;

  if new.status in ('cancelled', 'skipped') then
    return new;
  end if;

  if new.priority <> 'secondary' then
    return new;
  end if;

  select coalesce(p.daily_task_cap, 3) into v_cap
    from public.user_preferences p
   where p.user_id = new.user_id;
  v_cap := coalesce(v_cap, 3);

  select count(*) into v_open
    from public.scheduled_tasks t
   where t.user_id = new.user_id
     and t.scheduled_date = new.scheduled_date
     and t.priority = 'secondary'
     and t.status in ('scheduled', 'in_progress')
     and t.id <> new.id;

  if v_open >= v_cap then
    raise exception
      'This day already holds % secondary tasks.', v_cap
      using errcode = 'P0001',
            hint    = 'daily_secondary_limit';
  end if;

  return new;
end $$;

drop trigger if exists enforce_daily_task_limits on public.scheduled_tasks;
create trigger enforce_daily_task_limits
  before insert or update of priority, status, scheduled_date on public.scheduled_tasks
  for each row execute function public.enforce_daily_task_limits();

-- ═══════════════════════════════════════════════════════════════════════════
-- Invariant 2 — a task marked completed must also stamp its history
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.stamp_task_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  elsif new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  end if;

  if new.status = 'completed' then
    new.skipped_at := null;
    new.cancelled_at := null;
  elsif new.status = 'skipped' then
    new.completed_at := null;
    new.cancelled_at := null;
    new.skipped_at := coalesce(new.skipped_at, now());
  elsif new.status = 'cancelled' then
    new.completed_at := null;
    new.skipped_at := null;
    new.cancelled_at := coalesce(new.cancelled_at, now());
  else
    new.completed_at := null;
    new.skipped_at := null;
    new.cancelled_at := null;
  end if;
  return new;
end $$;

drop trigger if exists stamp_task_status on public.scheduled_tasks;
create trigger stamp_task_status
  before insert or update of status on public.scheduled_tasks
  for each row execute function public.stamp_task_status();

-- ═══════════════════════════════════════════════════════════════════════════
-- XP — append-only, awarded for genuine effort, never revoked
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.award_task_completion_xp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_amount integer;
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  -- 10 for showing up, plus a little more if real focus time was logged.
  v_amount := 10
    + least(
        12,
        coalesce((
          select sum(public.fn_session_active_seconds(
                       s.accumulated_seconds, s.last_resumed_at, s.status, coalesce(s.ended_at, now())
                     )) / 600
            from public.task_sessions s
           where s.task_id = new.id and s.status = 'completed' and s.kind <> 'break'
        ), 0)::integer
      );

  insert into public.xp_events (user_id, amount, reason, source_type, source_id, occurred_on)
  values (new.user_id, greatest(v_amount, 1), 'Task completed', 'task_completion', new.id, new.scheduled_date)
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists award_task_completion_xp on public.scheduled_tasks;
create trigger award_task_completion_xp
  after update of status on public.scheduled_tasks
  for each row execute function public.award_task_completion_xp();

create or replace function public.award_session_xp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seconds integer;
  v_amount  integer;
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  v_seconds := public.fn_session_active_seconds(
    new.accumulated_seconds, new.last_resumed_at, new.status, coalesce(new.ended_at, now())
  );

  if new.kind = 'two_minute' then
    -- An attempt is real effort even when it is short. Two minutes that
    -- happened is worth more than a perfect plan that did not.
    v_amount := 3;
  else
    v_amount := greatest(2, least(20, (v_seconds / 300) * 2));
  end if;

  insert into public.xp_events (user_id, amount, reason, source_type, source_id, occurred_on)
  values (
    new.user_id,
    greatest(v_amount, 1),
    case when new.kind = 'two_minute' then 'Two-minute start' else 'Focus session' end,
    'session',
    new.id,
    (new.started_at at time zone coalesce(
      (select p.timezone from public.user_preferences p where p.user_id = new.user_id), 'UTC'
    ))::date
  )
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists award_session_xp on public.task_sessions;
create trigger award_session_xp
  after update of status on public.task_sessions
  for each row execute function public.award_session_xp();

-- Achievements are derived from records at read time; this only keeps a
-- durable unlock timestamp so the first time is not re-announced.
create or replace function public.rpc_unlock_achievement(p_key text, p_meta jsonb default '{}'::jsonb)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid(); v_inserted boolean;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  insert into public.user_achievements (user_id, key, meta)
  values (v_user, p_key, coalesce(p_meta, '{}'::jsonb))
  on conflict (user_id, key) do nothing;
  v_inserted := found;
  return v_inserted;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Recurrence materialisation
--
-- Instances are the unit of completion, timing and analytics, so they are real
-- rows. The (template_id, occurrence_date) unique index makes this idempotent:
-- running it twice adds nothing, and a slot the user already moved is never
-- regenerated because its row still occupies its original slot key.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_recurrence_hits(
  p_recurrence public.recurrence_kind,
  p_weekdays smallint[],
  p_date date
)
returns boolean
language sql
immutable
as $$
  select case p_recurrence
    when 'daily'         then true
    when 'weekdays'      then extract(dow from p_date)::smallint between 1 and 5
    when 'weekends'      then extract(dow from p_date)::smallint in (0, 6)
    when 'custom_weekly' then extract(dow from p_date)::smallint = any (coalesce(p_weekdays, '{}'::smallint[]))
    else false
  end;
$$;

create or replace function public.rpc_ensure_recurring_instances(
  p_from date default current_date,
  p_to date default current_date + 60
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user      uuid := auth.uid();
  v_tpl       public.task_templates;
  v_slot      date;
  v_last      date;
  v_prio      public.task_priority;
  v_main_used boolean;
  v_inserted  integer := 0;
  v_g         integer;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_to < p_from then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
  if (p_to - p_from) > 400 then
    raise exception 'range_too_large' using errcode = 'P0001';
  end if;

  -- A routine the user deliberately created is a commitment, not an
  -- over-planning decision, so it is exempt from the ad-hoc daily cap.
  perform set_config('rebirth.bypass_task_cap', 'on', true);

  for v_tpl in
    select * from public.task_templates
     where user_id = v_user and is_active and recurrence <> 'none'
  loop
    if v_tpl.starts_on > p_to or (v_tpl.ends_on is not null and v_tpl.ends_on < p_from) then
      continue;
    end if;

    v_slot := greatest(p_from, v_tpl.starts_on);
    v_last := least(p_to, coalesce(v_tpl.ends_on, p_to));

    for v_g in 0 .. (v_last - v_slot) loop
      declare
        v_day date := v_slot + v_g;
      begin
        if not public.fn_recurrence_hits(v_tpl.recurrence, v_tpl.weekdays, v_day) then
          continue;
        end if;

        select exists (
          select 1 from public.scheduled_tasks t
           where t.user_id = v_user
             and t.scheduled_date = v_day
             and t.priority = 'main'
             and t.status not in ('cancelled', 'skipped')
        ) into v_main_used;

        v_prio := case
          when v_tpl.priority = 'main' and not v_main_used then 'main'::public.task_priority
          else 'secondary'::public.task_priority
        end;

        insert into public.scheduled_tasks (
          user_id, template_id, title, description, category, priority, status,
          scheduled_date, occurrence_date, start_time, duration_minutes,
          goal_id, reward_id, reminder_minutes, checklist,
          is_auto_generated, is_override
        ) values (
          v_user, v_tpl.id, v_tpl.title, v_tpl.description, v_tpl.category, v_prio, 'scheduled',
          v_day, v_day, v_tpl.start_time, v_tpl.duration_minutes,
          v_tpl.goal_id, v_tpl.reward_id, v_tpl.reminder_minutes, v_tpl.checklist,
          true, false
        )
        on conflict do nothing;

        if found then
          v_inserted := v_inserted + 1;
        end if;
      end;
    end loop;
  end loop;

  return v_inserted;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- MAIN priority — one per day, swapped atomically
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rpc_set_main_priority(p_task_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_day  date;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select scheduled_date into v_day
    from public.scheduled_tasks
   where id = p_task_id and user_id = v_user;

  if v_day is null then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;

  -- Rearranging a day must not trip the secondary cap mid-transaction.
  perform set_config('rebirth.bypass_task_cap', 'on', true);

  update public.scheduled_tasks
     set priority = 'secondary', updated_at = now()
   where user_id = v_user
     and scheduled_date = v_day
     and priority = 'main'
     and id <> p_task_id
     and status not in ('cancelled', 'skipped');

  update public.scheduled_tasks
     set priority = 'main', updated_at = now()
   where id = p_task_id and user_id = v_user;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Persistent focus timers
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rpc_start_session(
  p_task_id uuid default null,
  p_kind public.session_kind default 'focus',
  p_planned_seconds integer default null,
  p_replace_open boolean default true
)
returns public.task_sessions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_open  public.task_sessions;
  v_row   public.task_sessions;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select * into v_open
    from public.task_sessions
   where user_id = v_user and status in ('running', 'paused')
   limit 1;

  if found then
    if not p_replace_open then
      raise exception 'A timer is already running.' using
        errcode = 'P0001', hint = 'timer_already_running';
    end if;
    -- Close the previous timer cleanly so its elapsed time is still counted.
    perform public.rpc_finish_session(v_open.id, 'completed', false, null);
  end if;

  insert into public.task_sessions (
    user_id, task_id, kind, status, started_at, last_resumed_at, planned_seconds
  ) values (
    v_user, p_task_id, p_kind, 'running', now(), now(), p_planned_seconds
  )
  returning * into v_row;

  if p_task_id is not null then
    update public.scheduled_tasks
       set status = 'in_progress', updated_at = now()
     where id = p_task_id and user_id = v_user and status = 'scheduled';
  end if;

  return v_row;
end $$;

create or replace function public.rpc_pause_session(p_session_id uuid)
returns public.task_sessions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.task_sessions;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  update public.task_sessions
     set status = 'paused',
         accumulated_seconds = public.fn_session_active_seconds(
           accumulated_seconds, last_resumed_at, status, now()
         ),
         last_resumed_at = null,
         updated_at = now()
   where id = p_session_id and user_id = v_user and status = 'running'
  returning * into v_row;

  if not found then
    raise exception 'session_not_running' using errcode = 'P0001';
  end if;

  update public.task_session_pauses
     set resumed_at = now()
   where session_id = p_session_id and resumed_at is null;

  insert into public.task_session_pauses (user_id, session_id, paused_at)
  values (v_user, p_session_id, now());

  return v_row;
end $$;

create or replace function public.rpc_resume_session(p_session_id uuid)
returns public.task_sessions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.task_sessions;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  update public.task_session_pauses
     set resumed_at = now()
   where session_id = p_session_id
     and user_id = v_user
     and resumed_at is null;

  update public.task_sessions
     set status = 'running',
         last_resumed_at = now(),
         updated_at = now()
   where id = p_session_id and user_id = v_user and status = 'paused'
  returning * into v_row;

  if not found then
    raise exception 'session_not_paused' using errcode = 'P0001';
  end if;

  return v_row;
end $$;

create or replace function public.rpc_finish_session(
  p_session_id uuid,
  p_status public.session_status default 'completed',
  p_complete_task boolean default false,
  p_note text default null
)
returns public.task_sessions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.task_sessions;
  v_task uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_status not in ('completed', 'abandoned') then
    raise exception 'invalid_final_status' using errcode = 'P0001';
  end if;

  update public.task_sessions
     set status = p_status,
         ended_at = now(),
         accumulated_seconds = public.fn_session_active_seconds(
           accumulated_seconds, last_resumed_at, status, now()
         ),
         last_resumed_at = null,
         note = coalesce(p_note, note),
         updated_at = now()
   where id = p_session_id and user_id = v_user and status in ('running', 'paused')
  returning * into v_row;

  if not found then
    raise exception 'session_not_open' using errcode = 'P0001';
  end if;

  v_task := v_row.task_id;

  update public.task_session_pauses
     set resumed_at = now()
   where session_id = p_session_id and resumed_at is null;

  if v_task is not null then
    if p_complete_task then
      update public.scheduled_tasks
         set status = 'completed', updated_at = now()
       where id = v_task and user_id = v_user and status <> 'completed';
    else
      -- No timer is open any more, so the task is no longer in progress.
      update public.scheduled_tasks
         set status = 'scheduled', updated_at = now()
       where id = v_task and user_id = v_user and status = 'in_progress';
    end if;
  end if;

  return v_row;
end $$;

-- Used when returning to the app after a long absence, or explicitly by the
-- user ("stop and record the attempt"). Never destructive.
create or replace function public.rpc_abandon_open_sessions()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_count integer := 0;
  v_row public.task_sessions;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  for v_row in
    select * from public.task_sessions
     where user_id = v_user and status in ('running', 'paused')
  loop
    perform public.rpc_finish_session(v_row.id, 'abandoned', false, 'Stopped without finishing.');
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Micro-steps ("I'm stuck")
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rpc_seed_micro_steps(p_task_id uuid, p_titles text[])
returns setof public.task_micro_steps
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_i    integer;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.scheduled_tasks where id = p_task_id and user_id = v_user
  ) then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;

  -- Never overwrite steps the user has already started working through.
  if exists (select 1 from public.task_micro_steps where task_id = p_task_id) then
    return query select * from public.task_micro_steps where task_id = p_task_id order by ordinal;
    return;
  end if;

  for v_i in 1 .. least(coalesce(array_length(p_titles, 1), 0), 12) loop
    insert into public.task_micro_steps (user_id, task_id, ordinal, title, source)
    values (v_user, p_task_id, v_i::smallint, p_titles[v_i], 'suggested')
    on conflict (task_id, ordinal) do nothing;
  end loop;

  update public.scheduled_tasks
     set micro_steps_generated = true, updated_at = now()
   where id = p_task_id and user_id = v_user;

  return query select * from public.task_micro_steps where task_id = p_task_id order by ordinal;
end $$;

create or replace function public.rpc_set_micro_step_state(
  p_step_id uuid,
  p_state public.micro_step_state
)
returns public.task_micro_steps
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.task_micro_steps;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  update public.task_micro_steps
     set state = p_state,
         resolved_at = case when p_state = 'pending' then null else now() end,
         updated_at = now()
   where id = p_step_id and user_id = v_user
  returning * into v_row;

  if not found then
    raise exception 'step_not_found' using errcode = 'P0001';
  end if;
  return v_row;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Recurring routine editing — atomic, history-preserving
--
-- p_scope: 'occurrence' | 'future' | 'series'
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rpc_update_recurring_task(
  p_task_id uuid,
  p_scope text,
  p_patch jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user     uuid := auth.uid();
  v_task     public.scheduled_tasks;
  v_tpl      public.task_templates;
  v_new_tpl  uuid;
  v_from     date;
  v_horizon  date := current_date + 120;
  v_title    text;
  v_desc     text;
  v_cat      public.category_kind;
  v_prio     public.task_priority;
  v_goal     uuid;
  v_reward   uuid;
  v_time     time;
  v_dur      smallint;
  v_reminder smallint;
  v_check    jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_scope not in ('occurrence', 'future', 'series') then
    raise exception 'invalid_scope' using errcode = 'P0001';
  end if;

  select * into v_task
    from public.scheduled_tasks
   where id = p_task_id and user_id = v_user;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;

  perform set_config('rebirth.bypass_task_cap', 'on', true);

  -- ── Occurrence only ──────────────────────────────────────────────────────
  if p_scope = 'occurrence' or v_task.template_id is null then
    update public.scheduled_tasks
       set title            = coalesce(p_patch ->> 'title', title),
           description      = coalesce(p_patch ->> 'description', description),
           category         = coalesce((p_patch ->> 'category')::public.category_kind, category),
           priority         = coalesce((p_patch ->> 'priority')::public.task_priority, priority),
           start_time       = coalesce((p_patch ->> 'start_time')::time, start_time),
           duration_minutes = coalesce((p_patch ->> 'duration_minutes')::smallint, duration_minutes),
           goal_id          = case when p_patch ? 'goal_id'
                                   then nullif(p_patch ->> 'goal_id', '')::uuid else goal_id end,
           reward_id        = case when p_patch ? 'reward_id'
                                   then nullif(p_patch ->> 'reward_id', '')::uuid else reward_id end,
           reminder_minutes = case when p_patch ? 'reminder_minutes'
                                   then nullif(p_patch ->> 'reminder_minutes', '')::smallint
                                   else reminder_minutes end,
           checklist        = coalesce(p_patch -> 'checklist', checklist),
           scheduled_date   = coalesce((p_patch ->> 'scheduled_date')::date, scheduled_date),
           notes            = coalesce(p_patch ->> 'notes', notes),
           original_start_time = case
             when p_patch ? 'start_time' and original_start_time is null then v_task.start_time
             else original_start_time end,
           rescheduled_from_date = case
             when p_patch ? 'scheduled_date'
                  and (p_patch ->> 'scheduled_date')::date <> v_task.scheduled_date
               then coalesce(rescheduled_from_date, v_task.scheduled_date)
             else rescheduled_from_date end,
           is_override      = true,
           updated_at       = now()
     where id = p_task_id and user_id = v_user;
    return;
  end if;

  -- ── Recurring: resolve the merged field values ───────────────────────────
  select * into v_tpl from public.task_templates where id = v_task.template_id and user_id = v_user;
  if not found then
    raise exception 'template_not_found' using errcode = 'P0001';
  end if;

  v_title    := coalesce(p_patch ->> 'title', v_tpl.title);
  v_desc     := coalesce(p_patch ->> 'description', v_tpl.description);
  v_cat      := coalesce((p_patch ->> 'category')::public.category_kind, v_tpl.category);
  v_prio     := coalesce((p_patch ->> 'priority')::public.task_priority, v_tpl.priority);
  v_goal     := case when p_patch ? 'goal_id' then nullif(p_patch ->> 'goal_id', '')::uuid else v_tpl.goal_id end;
  v_reward   := case when p_patch ? 'reward_id' then nullif(p_patch ->> 'reward_id', '')::uuid else v_tpl.reward_id end;
  v_time     := coalesce((p_patch ->> 'start_time')::time, v_tpl.start_time);
  v_dur      := coalesce((p_patch ->> 'duration_minutes')::smallint, v_tpl.duration_minutes);
  v_reminder := case when p_patch ? 'reminder_minutes'
                     then nullif(p_patch ->> 'reminder_minutes', '')::smallint
                     else v_tpl.reminder_minutes end;
  v_check    := coalesce(p_patch -> 'checklist', v_tpl.checklist);
  v_from     := coalesce((p_patch ->> 'scheduled_date')::date, v_task.occurrence_date, v_task.scheduled_date);

  if p_scope = 'series' then
    update public.task_templates
       set title = v_title, description = v_desc, category = v_cat, priority = v_prio,
           goal_id = v_goal, reward_id = v_reward, start_time = v_time,
           duration_minutes = v_dur, reminder_minutes = v_reminder,
           checklist = v_check, updated_at = now()
     where id = v_tpl.id and user_id = v_user;

    v_new_tpl := v_tpl.id;
    v_from    := coalesce(v_task.occurrence_date, v_task.scheduled_date);

  else -- 'future': split the series at this slot
    if v_tpl.ends_on is not null and v_tpl.ends_on < v_from then
      raise exception 'series_already_ended' using errcode = 'P0001';
    end if;

    update public.task_templates
       set ends_on = v_from - 1, updated_at = now()
     where id = v_tpl.id and user_id = v_user;

    insert into public.task_templates (
      user_id, title, description, category, priority, goal_id, reward_id,
      recurrence, weekdays, starts_on, ends_on, start_time, duration_minutes,
      reminder_minutes, checklist, is_active
    ) values (
      v_user, v_title, v_desc, v_cat, v_prio, v_goal, v_reward,
      v_tpl.recurrence, v_tpl.weekdays, v_from, v_tpl.ends_on, v_time, v_dur,
      v_reminder, v_check, v_tpl.is_active
    )
    returning id into v_new_tpl;
  end if;

  -- Remove only *future, untouched* materialised instances. Completed,
  -- skipped, cancelled and user-overridden rows are historical record and are
  -- never rewritten. The old (template, occurrence) unique key is released at
  -- the same moment the template stops covering that slot.
  delete from public.scheduled_tasks t
   where t.user_id = v_user
     and t.template_id = v_tpl.id
     and t.occurrence_date >= v_from
     and t.status = 'scheduled'
     and t.is_override = false;

  perform public.rpc_ensure_recurring_instances(greatest(v_from, current_date), v_horizon);
end $$;

create or replace function public.rpc_delete_recurring_task(
  p_task_id uuid,
  p_scope text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_task public.scheduled_tasks;
  v_from date;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_scope not in ('occurrence', 'future', 'series') then
    raise exception 'invalid_scope' using errcode = 'P0001';
  end if;

  select * into v_task from public.scheduled_tasks where id = p_task_id and user_id = v_user;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;

  perform set_config('rebirth.bypass_task_cap', 'on', true);
  v_from := coalesce(v_task.occurrence_date, v_task.scheduled_date);

  if p_scope = 'occurrence' or v_task.template_id is null then
    -- Cancelled rather than deleted: a generated occurrence must keep
    -- occupying its slot key, otherwise the materialiser would resurrect it.
    update public.scheduled_tasks
       set status = 'cancelled', updated_at = now()
     where id = p_task_id and user_id = v_user;
    return;
  end if;

  update public.scheduled_tasks
     set status = 'cancelled', updated_at = now()
   where user_id = v_user
     and template_id = v_task.template_id
     and occurrence_date >= v_from
     and status in ('scheduled', 'in_progress');

  if p_scope = 'series' then
    delete from public.task_templates where id = v_task.template_id and user_id = v_user;
  else
    update public.task_templates
       set ends_on = v_from - 1, updated_at = now()
     where id = v_task.template_id and user_id = v_user;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Smart rescheduling
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rpc_reschedule_task(
  p_task_id uuid,
  p_new_date date,
  p_new_start_time time default null,
  p_scope text default 'occurrence'
)
returns public.scheduled_tasks
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.scheduled_tasks;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  perform set_config('rebirth.bypass_task_cap', 'on', true);

  update public.scheduled_tasks
     set scheduled_date = p_new_date,
         start_time = coalesce(p_new_start_time, start_time),
         rescheduled_from_date = coalesce(rescheduled_from_date, scheduled_date),
         is_override = (template_id is not null),
         -- Moving a task re-opens it: a rescheduled task is not a missed one.
         status = case when status = 'skipped' then 'scheduled' else status end,
         updated_at = now()
   where id = p_task_id and user_id = v_user
  returning * into v_row;

  if not found then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;

  if p_scope in ('future', 'series') and v_row.template_id is not null then
    perform public.rpc_update_recurring_task(
      p_task_id,
      case when p_scope = 'series' then 'series' else 'future' end,
      jsonb_build_object('scheduled_date', p_new_date, 'start_time', p_new_start_time)
    );
  end if;

  return v_row;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Motivation — a deterministic quote of the day, persisted per user per day
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rpc_daily_quote(p_date date default current_date)
returns table (
  id uuid,
  body text,
  attribution text,
  source_title text,
  language_note text,
  verification_ref text,
  content_type public.quote_content_type,
  is_favorite boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_tones   text[];
  v_enabled boolean;
  v_id      uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select quote_id into v_id
    from public.daily_quote_deliveries
   where user_id = v_user and delivered_on = p_date;

  if v_id is null then
    select coalesce(p.quotes_enabled, true), p.quote_tones
      into v_enabled, v_tones
      from public.user_preferences p
     where p.user_id = v_user;

    if coalesce(v_enabled, true) then
      select q.id into v_id
        from public.quote_library q
       where q.is_active
         and (v_tones is null or cardinality(v_tones) = 0 or q.tones && v_tones)
       order by hashtextextended(q.id::text || p_date::text || v_user::text, 0)
       limit 1;

      if v_id is not null then
        insert into public.daily_quote_deliveries (user_id, quote_id, delivered_on)
        values (v_user, v_id, p_date)
        on conflict (user_id, delivered_on) do nothing;

        select quote_id into v_id
          from public.daily_quote_deliveries
         where user_id = v_user and delivered_on = p_date;
      end if;
    end if;
  end if;

  if v_id is null then
    return;
  end if;

  return query
    select q.id, q.body, q.attribution, q.source_title, q.language_note,
           q.verification_ref, q.content_type,
           exists (select 1 from public.user_favorite_quotes f
                    where f.user_id = v_user and f.quote_id = q.id)
      from public.quote_library q
     where q.id = v_id;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Rewards — eligibility is re-verified server-side, never trusted from a client
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_reward_period_key(
  p_repeatable boolean,
  p_period text,
  p_at date default current_date
)
returns text
language sql
immutable
as $$
  select case
    when not p_repeatable then 'once'
    when p_period = 'day'   then to_char(p_at, 'YYYY-MM-DD')
    when p_period = 'month' then to_char(p_at, 'YYYY-MM')
    else to_char(p_at, 'IYYY-"W"IW')
  end;
$$;

create or replace function public.fn_reward_eligible(p_reward public.rewards, p_user uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_from   date;
  v_to     date := current_date;
  v_ok     boolean := false;
  v_secs   integer;
  v_week0  smallint := 1;
begin
  if p_reward.condition_kind = 'manual' then
    return true;
  end if;

  select coalesce(pref.week_starts_on, 1) into v_week0
    from public.user_preferences pref
   where pref.user_id = p_user;
  v_week0 := coalesce(v_week0, 1);

  if p_reward.is_repeatable then
    v_from := case p_reward.repeat_period
                when 'day'   then current_date
                when 'month' then date_trunc('month', current_date)::date
                else public.fn_week_start(current_date, v_week0)
              end;
  else
    v_from := 'epoch'::date;
  end if;

  if p_reward.condition_kind = 'sessions' then
    select count(*) into v_secs
      from public.task_sessions s
     where s.user_id = p_user
       and s.status = 'completed'
       and s.kind <> 'break'
       and s.started_at::date between v_from and v_to;
    return coalesce(v_secs, 0) >= coalesce(p_reward.condition_sessions, 0);

  elsif p_reward.condition_kind = 'minutes' then
    select coalesce(sum(public.fn_session_active_seconds(
             s.accumulated_seconds, s.last_resumed_at, s.status, coalesce(s.ended_at, now())
           )) / 60, 0) into v_secs
      from public.task_sessions s
     where s.user_id = p_user
       and s.status = 'completed'
       and s.kind <> 'break'
       and s.started_at::date between v_from and v_to;
    return coalesce(v_secs, 0) >= coalesce(p_reward.condition_minutes, 0);

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
               public.fn_week_start(current_date, v_week0),
               public.fn_week_start(current_date, v_week0) + 6,
               current_date
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

  if not public.fn_reward_eligible(v_reward, v_user) then
    raise exception 'This reward has not been earned yet.' using
      errcode = 'P0001', hint = 'reward_not_eligible';
  end if;

  v_key := public.fn_reward_period_key(v_reward.is_repeatable, v_reward.repeat_period);

  insert into public.reward_claims (user_id, reward_id, period_key, xp_awarded, note)
  values (v_user, p_reward_id, v_key, v_reward.xp_value, p_note)
  returning * into v_row;

  if v_reward.xp_value > 0 then
    insert into public.xp_events (user_id, amount, reason, source_type, source_id, occurred_on)
    values (v_user, v_reward.xp_value, 'Reward claimed: ' || v_reward.name, 'reward', v_row.id, current_date)
    on conflict do nothing;
  end if;

  return v_row;
exception
  when unique_violation then
    raise exception 'You have already claimed this reward for this period.' using
      errcode = 'P0001', hint = 'reward_already_claimed';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Personal records — every comparison is against the user's own history
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rpc_personal_records()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with me as (select auth.uid() as uid),
  daily as (
    select t.scheduled_date as d,
           sum(public.fn_session_active_seconds(
                 s.accumulated_seconds, s.last_resumed_at, s.status, coalesce(s.ended_at, now())
               )) / 60 as minutes
      from public.task_sessions s
      join public.scheduled_tasks t on t.id = s.task_id
      join me on me.uid = s.user_id
     where s.status = 'completed' and s.kind <> 'break'
     group by 1
  ),
  completed as (
    select t.scheduled_date as d, count(*) as n
      from public.scheduled_tasks t
      join me on me.uid = t.user_id
     where t.status = 'completed'
     group by 1
  )
  select jsonb_build_object(
    'best_focus_day_minutes', coalesce((select max(minutes) from daily), 0),
    'best_focus_day',         (select d from daily order by minutes desc nulls last limit 1),
    'most_tasks_day',         coalesce((select max(n) from completed), 0),
    'most_tasks_day_date',    (select d from completed order by n desc nulls last limit 1),
    'total_focus_minutes',    coalesce((select sum(minutes) from daily), 0),
    'total_sessions',         (select count(*) from public.task_sessions s join me on me.uid = s.user_id
                                where s.status = 'completed' and s.kind <> 'break')
  );
$$;
