-- 20261020000010_rpc_update_recurring_task_scope_fixes.sql
--
-- Confirmed scheduling defects in the recurring-task RPCs:
--
--   1. Moving a recurring occurrence with the "future" scope left the moved
--      row attached to the old template *and* materialised a second row for
--      the same day on the new template, so the day showed two tasks.
--   2. Splitting a series at a past occurrence deleted every untouched row
--      from that date onward — including rows strictly between the selected
--      date and today — and re-materialisation starts at the boundary, so
--      those rows were never restored.
--   3. rpc_delete_recurring_task unconditionally set ends_on = v_from - 1,
--      which moved a template's end forward again when the selected row was a
--      preserved occurrence beyond a template a previous split had shortened,
--      re-opening slots owned by the replacement template. The same assignment
--      also failed outright when the first occurrence was removed, because
--      ends_on = starts_on - 1 violates task_templates_range.
--
-- Both functions keep their signatures, security-invoker mode, search_path,
-- authorization checks, exception codes and grants; no table, index, policy
-- or data change. The delete function lives here because the split produced by
-- the update function is exactly what exposes its non-monotonic end.
--
-- Repeat dates are derived from the affected user's configured timezone
-- (user_preferences.timezone), falling back to UTC when the row is absent or
-- the value is not a known zone. One date drives the deletion /
-- re-materialisation boundary, the horizon and the template boundaries; the
-- database session's current_date is never used.
--
-- A move is detected because rpc_reschedule_task has already written the new
-- scheduled_date before calling this function. The moved row keeps its
-- original occurrence_date — the model's name for the series slot a row
-- belongs to, which is also what an occurrence-scoped move does — so its
-- (template_id, occurrence_date) key stays occupied and the old template
-- cannot recreate it. The old template ends the day before the rewrite
-- boundary (the day before the destination for a forward move), which keeps
-- the untouched occurrences between the original slot and the destination
-- inside its range; the replacement template starts the day after the
-- destination, so no template materialises a second row on that day.
--
-- A future-scope move is forward-only: the continuation may not be moved to a
-- day before the user's local today. The dialog blocks it and this function
-- re-checks it, because both RPCs are directly callable; a single-occurrence
-- move may still go backwards. The check sits in rpc_update_recurring_task
-- because rpc_reschedule_task delegates its future-scope work here, so raising
-- it rolls the reschedule's pre-write back with the rest of the transaction.
--
-- Because every surviving row of the old template remains inside its range,
-- its ends_on can only ever be shortened by a later edit or delete: those
-- RPCs derive their split date from a row that is at or before that end. An
-- intervening occurrence therefore cannot re-extend the template or
-- resurrect the moved original slot, and no cancelled tombstones are needed.
--
-- For a split at a past date, the old template ends at
-- min(its configured end, yesterday) instead of at the selected date, so
-- untouched rows between the selected date and today stay covered by the old
-- template rather than becoming orphans. The replacement template starts
-- today and carries the edited values forward.

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
  v_user      uuid := auth.uid();
  v_task      public.scheduled_tasks;
  v_tpl       public.task_templates;
  v_from      date;
  v_today     date;
  v_tz        text;
  v_split     date;
  v_old_end   date;
  v_new_start date;
  v_horizon   date;
  v_moved     boolean := false;
  v_title     text;
  v_desc      text;
  v_cat       public.category_kind;
  v_prio      public.task_priority;
  v_goal      uuid;
  v_reward    uuid;
  v_time      time;
  v_dur       smallint;
  v_reminder  smallint;
  v_check     jsonb;
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

  -- ── The user's day, not the database session's day ───────────────────────
  -- user_preferences is the app's single source of the viewer's timezone. The
  -- row is read under RLS as the invoker; a missing row or an unknown zone
  -- falls back to UTC, matching the rest of the project.
  v_tz := null;
  select nullif(btrim(pref.timezone), '')
    into v_tz
    from public.user_preferences pref
   where pref.user_id = v_user;
  if v_tz is null
     or not exists (select 1 from pg_timezone_names tz where lower(tz.name) = lower(v_tz)) then
    v_tz := 'UTC';
  end if;
  v_today   := (now() at time zone v_tz)::date;
  v_horizon := v_today + 120;

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

  -- rpc_reschedule_task has already moved the row before calling us, so a
  -- patch date equal to the row's scheduled_date identifies a move rather
  -- than a field edit.
  v_moved := p_scope = 'future'
             and p_patch ? 'scheduled_date'
             and (p_patch ->> 'scheduled_date')::date = v_task.scheduled_date;

  if p_scope = 'series' then
    update public.task_templates
       set title = v_title, description = v_desc, category = v_cat, priority = v_prio,
           goal_id = v_goal, reward_id = v_reward, start_time = v_time,
           duration_minutes = v_dur, reminder_minutes = v_reminder,
           checklist = v_check, updated_at = now()
     where id = v_tpl.id and user_id = v_user;

    v_from    := coalesce(v_task.occurrence_date, v_task.scheduled_date);
    v_split   := greatest(v_from, v_today);

  else -- 'future': split the series at this slot
    -- "This one and all that follow" is forward-only. A continuation moved
    -- before the user's local today would put the unlocked half of the series
    -- behind the old template's new end and leave the moved row's slot outside
    -- that range — the backward-move duplicate. The guard runs after
    -- rpc_reschedule_task has written the new date, so raising here rolls its
    -- pre-update back with the rest of the transaction. A single-occurrence
    -- move (p_scope = 'occurrence') is untouched and may still go backwards.
    if v_moved and v_task.scheduled_date < v_today then
      raise exception 'future_move_into_past' using errcode = 'P0001';
    end if;

    if v_tpl.ends_on is not null and v_tpl.ends_on < v_from then
      raise exception 'series_already_ended' using errcode = 'P0001';
    end if;

    v_split := greatest(v_from, v_today);

    -- The old template may keep every untouched row it still owns, but it may
    -- never grow: cap its end at the configured end and at the day before the
    -- rewrite boundary. For a past split that means yesterday, so rows between
    -- the selected date and today stay inside the old template's range.
    v_old_end := v_split - 1;
    if v_tpl.ends_on is not null and v_tpl.ends_on < v_old_end then
      v_old_end := v_tpl.ends_on;
    end if;

    -- A moved occurrence keeps its slot on the old template. Resume the series
    -- the day after the destination, so neither the old template (which ends
    -- before the boundary) nor the new one can materialise on the day the
    -- moved row occupies.
    v_new_start := v_split;
    if v_moved then
      v_new_start := greatest(v_split, v_task.scheduled_date + 1);
    end if;

    -- Splitting at the very first slot leaves the old template with no days.
    -- Deactivating it keeps the row and its history without violating
    -- ends_on >= starts_on.
    if v_old_end < v_tpl.starts_on then
      update public.task_templates
         set is_active = false, updated_at = now()
       where id = v_tpl.id and user_id = v_user;
    else
      update public.task_templates
         set ends_on = v_old_end, updated_at = now()
       where id = v_tpl.id and user_id = v_user;
    end if;

    -- A series that has already ended before the continuation point has no
    -- future occurrence to continue; do not create an empty template that
    -- would violate ends_on >= starts_on.
    if v_tpl.ends_on is null or v_tpl.ends_on >= v_new_start then
      insert into public.task_templates (
        user_id, title, description, category, priority, goal_id, reward_id,
        recurrence, weekdays, starts_on, ends_on, start_time, duration_minutes,
        reminder_minutes, checklist, is_active
      ) values (
        v_user, v_title, v_desc, v_cat, v_prio, v_goal, v_reward,
        v_tpl.recurrence, v_tpl.weekdays, v_new_start, v_tpl.ends_on, v_time, v_dur,
        v_reminder, v_check, v_tpl.is_active
      );
    end if;
  end if;

  if v_moved then
    -- The destination's own untouched occurrence is replaced by the moved one.
    -- This is the one past slot a move may legitimately clear: keeping it would
    -- draw two tasks on the day the user chose.
    delete from public.scheduled_tasks t
     where t.user_id = v_user
       and t.template_id = v_tpl.id
       and t.occurrence_date = v_task.scheduled_date
       and t.status = 'scheduled'
       and t.is_override = false
       and t.id <> v_task.id;
  end if;

  -- Remove only untouched materialised instances from the rewrite boundary
  -- onward. Completed, skipped, cancelled and user-overridden rows are
  -- historical record and are never rewritten, and nothing before the
  -- boundary is deleted.
  delete from public.scheduled_tasks t
   where t.user_id = v_user
     and t.template_id = v_tpl.id
     and t.occurrence_date >= v_split
     and t.status = 'scheduled'
     and t.is_override = false
     -- A direct caller may hand us a move patch before marking the row as an
     -- override; never delete the row that is being moved.
     and (not v_moved or t.id <> v_task.id);

  perform public.rpc_ensure_recurring_instances(v_split, v_horizon);
end $$;

-- ── rpc_delete_recurring_task: a delete may only shorten a routine ─────────
--
-- The applied function set ends_on = v_from - 1 unconditionally. A split,
-- move or earlier delete can leave preserved occurrences (completed,
-- overridden, or rescheduled) beyond the shortened end; deleting from one of
-- them moved the end forward and let the materialiser recreate slots that now
-- belong to the replacement template. The new end is capped at the existing
-- one, so the boundary is monotonic. NULL still means open-ended and closes at
-- v_from - 1, as before.
--
-- Removing the first occurrence computes an end before starts_on, which
-- task_templates_range forbids. The template is deactivated instead: its
-- occurrences are already cancelled by the statements above and keep their
-- slot keys, and rpc_ensure_recurring_instances ignores inactive templates,
-- so nothing is recreated. The occurrence and series branches are unchanged:
-- "only this day" cancels the row, and "the whole routine" deletes the
-- template row while completed history keeps its records.
--
-- Deliberately unchanged behavior: a "future" delete still closes only the
-- template of the selected row, so occurrences already materialised by a
-- replacement template from an earlier split or move survive. That is the
-- existing product behavior, not something this fix alters.
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
  v_user    uuid := auth.uid();
  v_task    public.scheduled_tasks;
  v_tpl     public.task_templates;
  v_from    date;
  v_new_end date;
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
    return;
  end if;

  select * into v_tpl
    from public.task_templates
   where id = v_task.template_id and user_id = v_user;
  if not found then
    raise exception 'template_not_found' using errcode = 'P0001';
  end if;

  -- Monotonic end: an open-ended routine closes the day before the selected
  -- occurrence; a routine that already ends earlier keeps its current end.
  v_new_end := least(coalesce(v_tpl.ends_on, v_from - 1), v_from - 1);

  if v_new_end < v_tpl.starts_on then
    -- The first occurrence is going, so no valid range remains to record.
    -- Deactivating preserves the template row, its cancelled slot keys and its
    -- completed history without violating ends_on >= starts_on.
    update public.task_templates
       set is_active = false, updated_at = now()
     where id = v_tpl.id and user_id = v_user;
  else
    update public.task_templates
       set ends_on = v_new_end, updated_at = now()
     where id = v_tpl.id and user_id = v_user;
  end if;
end $$;
