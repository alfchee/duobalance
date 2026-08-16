-- #118: soft-delete membership schema foundation. Adding removed_at alone
-- changes nothing — every authorization helper still reads household_members
-- directly and would keep granting a removed member full access. This
-- migration adds the columns, the active_membership view they route through,
-- and rewrites the three core helpers + accept_invite to use it.
--
-- households.deleted_at also lands here (household deletion itself is #119)
-- because active_membership needs both soft-delete predicates from day one —
-- splitting them would mean re-opening and re-testing every helper twice.

-- ============================================================================
-- 1. Schema
-- ============================================================================

alter table public.household_members
  add column removed_at timestamptz,
  add column removed_by uuid references public.household_members(id),
  add column removal_reason text
    check (removal_reason in ('removed', 'left'));

alter table public.households
  add column deleted_at timestamptz;

-- The old unique constraint occupies (household_id, user_id) forever, even
-- after a member is removed — re-inviting the same person would 23505 on a
-- row nobody can see anymore. Replace it with a partial index so a removed
-- row and a fresh active row can coexist.
alter table public.household_members
  drop constraint if exists household_members_household_id_user_id_key;

create unique index household_members_active_uniq
  on public.household_members (household_id, user_id)
  where removed_at is null;

comment on column public.household_members.removed_at is
  'Soft-delete marker. Non-null means this membership no longer grants access — see active_membership.';
comment on column public.household_members.removal_reason is
  'Why this membership ended: owner removed them, or they left voluntarily. Null while active.';
comment on column public.households.deleted_at is
  'Soft-delete marker for the household itself (#119). Non-null means no member has access — see active_membership.';

-- ============================================================================
-- 2. active_membership — INTERNAL ONLY, never grant to anon/authenticated.
--
-- Deliberately does NOT set security_invoker = on, unlike every other view
-- in this codebase. The helpers below are SECURITY DEFINER precisely so they
-- can read household_members WITHOUT RLS — the policies on that table call
-- the helpers, so a helper subject to those policies would re-enter itself
-- and recurse. A security_invoker view pushes privilege resolution back onto
-- the caller and reintroduces exactly that risk. Leaving it off means the
-- view runs as its owner (same owner as household_members) and bypasses RLS,
-- which is what the helpers require. household_members has no FORCE ROW
-- LEVEL SECURITY, so the owner (and this view) are exempt from its policies.
-- ============================================================================

create view public.active_membership as
select m.*
from public.household_members m
join public.households h on h.id = m.household_id
where m.removed_at is null
  and h.deleted_at is null;

revoke all on public.active_membership from public, anon, authenticated;

comment on view public.active_membership is
  'INTERNAL. Not security_invoker, not granted to anon/authenticated — SECURITY DEFINER helpers only. Bypasses RLS by design; never expose to clients.';

-- ============================================================================
-- 3. Core helpers — route through active_membership instead of
--    household_members directly, so a removed member (or a member of a
--    soft-deleted household) loses access everywhere in one place.
-- ============================================================================

create or replace function public.is_member(household uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.active_membership
    where household_id = household
      and user_id = auth.uid()
  );
$$;

create or replace function public.current_member_id(household uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.active_membership
  where household_id = household and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_owner(household uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.active_membership
    where household_id = household
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

-- current_member() (migration 11, row-returning) is only used today by
-- push_subscriptions RLS, always alongside is_member() — so this isn't
-- fixing a live hole. It's updated anyway so active_membership is the one
-- place every helper agrees on, instead of leaving one silent exception.
create or replace function public.current_member(household uuid)
returns public.household_members
language sql
stable
security definer
set search_path = public
as $$
  select m.*
  from public.active_membership m
  where household_id = household
    and user_id = auth.uid()
  limit 1;
$$;

-- check_member_in_household() (#19) is deliberately NOT touched here. It
-- validates that a referenced member belongs to the household at all — a
-- pure containment check. Filtering it by removed_at would make every
-- update to a row still referencing a departed member (e.g. an old
-- transaction's entered_by) fail. Not assigning new work to a departed
-- member is the RPCs' and UI's job, not this function's.

-- household_plan() / can_write() / enforce_member_cap() don't exist yet —
-- they belong to a future SaaS phase. Nothing to guard here; when they land
-- they must read active_membership from the start.

-- ============================================================================
-- 4. accept_invite: insert a new membership row (never resurrect a removed
--    one — the partial unique index now permits both to coexist), and
--    reject up front if the invitee already has an active membership.
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

  if lower(coalesce(auth.email(), '')) <> inv.email then
    raise exception 'invite email does not match authenticated user';
  end if;

  -- Without this, a user who was removed and re-invited (or who was invited
  -- twice) would hit the partial unique index's 23505 instead of a clean
  -- error — or, if already active, would silently no-op into a duplicate.
  if exists (
    select 1 from public.active_membership
    where household_id = inv.household_id
      and user_id = auth.uid()
  ) then
    raise exception 'you already have an active membership in this household';
  end if;

  new_display_name := nullif(split_part(coalesce(auth.email(), ''), '@', 1), '');

  insert into public.household_members (household_id, user_id, role, display_name)
  values (inv.household_id, auth.uid(), inv.role, coalesce(new_display_name, 'Partner'));

  update public.household_invites set accepted_at = now() where id = inv.id;

  return inv.household_id;
end;
$$;

revoke all on function public.accept_invite(text) from public;
grant execute on function public.accept_invite(text) to authenticated;
