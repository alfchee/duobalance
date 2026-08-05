-- Issue #12: the create_household / accept_invite RPCs that resolve the
-- bootstrap deadlock — you can't INSERT a household_members row without
-- already being a member, and you can't be a member until the row exists.
-- Both run SECURITY DEFINER to cross that gap deliberately and narrowly;
-- every other RPC in this codebase is SECURITY INVOKER. `households` still
-- has no INSERT policy (migration 11) — creation only happens here.

-- ============================================================================
-- is_owner: third RLS helper (alongside is_member/current_member from
-- migration 11). Same recursion-avoidance rationale: a naive policy of
-- "household_members rows are visible/mutable to owners of that household"
-- would make Postgres evaluate household_members policies while evaluating
-- household_members policies. SECURITY DEFINER breaks the recursion.
-- `set search_path = public` is required, not decoration — without it a
-- SECURITY DEFINER function can be hijacked via a manipulated search path.
-- ============================================================================

create or replace function public.is_owner(household uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = household
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

-- households_update (migration 11) inlined this same "am I the owner"
-- subquery before this helper existed. Point it at is_owner() instead so
-- there's one definition of "owner" instead of two that can drift apart.
-- is_owner() implies membership, so the separate is_member(id) check the
-- using-clause also had is redundant and is dropped here. The with-check
-- clause (updated row must still belong to a household the caller is a
-- member of) is untouched.
alter policy households_update on public.households
  using (public.is_owner(id));

-- ============================================================================
-- create_household: creates the household and its first (owner) member row
-- atomically. Without this, signup is impossible — household_members has
-- no INSERT policy a brand-new user could satisfy on their own.
-- p_timezone/p_locale are optional; the migration 13 trigger derives them
-- from p_country via country_defaults when omitted.
-- ============================================================================

create or replace function public.create_household(
  p_name text,
  p_country text,
  p_base_currency text,
  p_display_name text,
  p_timezone text default null,
  p_locale text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  h_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  insert into public.households (name, country, base_currency, timezone, locale)
  values (p_name, p_country, p_base_currency, p_timezone, p_locale)
  returning id into h_id;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (h_id, auth.uid(), 'owner', p_display_name);

  return h_id;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default. Narrow it:
-- this mutates data via a SECURITY DEFINER escalation, so only authenticated
-- callers should reach it at all (anon has no auth.uid() and would just hit
-- the exception above, but there's no reason to let it try).
-- Note this also revokes the implicit PUBLIC grant from service_role: per
-- architecture-conventions, household creation is client-side only today,
-- so nothing server-side needs to call this. If a future route handler
-- ever does, it needs its own explicit `grant execute ... to service_role`.
revoke all on function public.create_household(text, text, text, text, text, text) from public;
grant execute on function public.create_household(text, text, text, text, text, text) to authenticated;

-- ============================================================================
-- accept_invite: same structural deadlock as create_household — the invitee
-- cannot see the household_invites row under RLS (household_invites_select
-- requires is_member) until they're already a member. Order of checks
-- matches the #12 spec exactly: lookup -> accepted/expired -> email match
-- -> insert -> stamp accepted_at -> return household_id.
-- ============================================================================

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.household_invites;
  new_display_name text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  -- FOR UPDATE: without a row lock, two concurrent calls with the same
  -- token (e.g. a double-click) can both read accepted_at is null before
  -- either writes, then race on the household_members unique constraint —
  -- the loser would see a raw 23505 instead of the intended, friendlier
  -- "invite already accepted" error below.
  select * into inv from public.household_invites where token = p_token for update;

  if not found then
    raise exception 'invite not found';
  end if;

  if inv.accepted_at is not null then
    raise exception 'invite already accepted';
  end if;

  if inv.expires_at < now() then
    raise exception 'invite expired';
  end if;

  -- Case-insensitive: household_invites.email is normalized lowercase on
  -- insert (migration 3), but auth.email() isn't guaranteed to be.
  -- Without this check, a leaked token lets anyone with an account join.
  if lower(coalesce(auth.email(), '')) <> inv.email then
    raise exception 'invite email does not match authenticated user';
  end if;

  new_display_name := nullif(split_part(coalesce(auth.email(), ''), '@', 1), '');

  -- inv.role (not a hardcoded 'partner') — household_invites.role already
  -- carries the intended role for whoever accepts, and honoring it means
  -- one column drives this instead of the invite table's role becoming
  -- unread dead data. In practice this is 'partner' for every invite the
  -- app issues today (there's no UI path to invite a second owner), so
  -- behavior matches the #12 spec as written; this only diverges if a
  -- future flow starts issuing owner-role invites.
  insert into public.household_members (household_id, user_id, role, display_name)
  values (inv.household_id, auth.uid(), inv.role, coalesce(new_display_name, 'Partner'));

  update public.household_invites set accepted_at = now() where id = inv.id;

  return inv.household_id;
end;
$$;

revoke all on function public.accept_invite(text) from public;
grant execute on function public.accept_invite(text) to authenticated;
