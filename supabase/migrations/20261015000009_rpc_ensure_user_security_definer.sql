-- ═══════════════════════════════════════════════════════════════════════════
-- REBIRTH · 0009 · rpc_ensure_user runs as SECURITY DEFINER
--
-- 0004 created this repair path as SECURITY INVOKER, and that is why it never
-- repaired anything: it reads `auth.users`, which the `authenticated` role has
-- no access to, so the select raised and the whole function rolled back —
-- inserting neither row and telling nobody, because the caller discarded the
-- error. An account missing its profile therefore stayed missing for good.
--
-- Changing the security mode is safe here for one specific reason: the
-- function takes no arguments. The rows it writes are derived from
-- `auth.uid()` alone (`where u.id = v_user`, `values (v_user)`), so a caller
-- can only ever repair their own account, and there is no user id in the
-- signature for anyone to substitute. `search_path` is fixed, every object is
-- schema-qualified, and `pg_temp` stays last, as everywhere else in this
-- schema.
--
-- The inserts now mirror `handle_new_user()` (0004), so a repaired account
-- gets the row the sign-up trigger would have written — name and timezone
-- taken from the sign-up metadata — instead of a profile left on the UTC
-- default. Both keep `on conflict do nothing`, so an existing row is never
-- overwritten. No backfill: an affected account heals on its next page load.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_ensure_user()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, email, display_name)
  select u.id,
         u.email,
         nullif(trim(coalesce(u.raw_user_meta_data ->> 'display_name', '')), '')
    from auth.users u
   where u.id = v_user
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id, timezone)
  select v_user,
         coalesce(nullif(u.raw_user_meta_data ->> 'timezone', ''), 'UTC')
    from auth.users u
   where u.id = v_user
  on conflict (user_id) do nothing;
end $$;

-- ── Explicit grants ────────────────────────────────────────────────────────
-- `create or replace` preserves the existing ACL, but stating it keeps the
-- intent auditable and survives a future drop-and-recreate: a signed-in user
-- may repair their own account, and nobody else may call the function at all.
-- The anonymous role is named explicitly so that a later blanket grant cannot
-- quietly re-open it.
revoke execute on function public.rpc_ensure_user() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.rpc_ensure_user() from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.rpc_ensure_user() to authenticated';
  end if;
end $$;
