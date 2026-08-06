-- Hardening of the migration 14 RPCs, picked up in the Phase 0 review (PR #47).
--
-- Migration 14 already landed on `main`, so this is a forward-only replacement
-- (`create or replace function`) rather than an edit of the original — see
-- CLAUDE.md: never edit an applied migration.
--
-- Two narrow changes:
--   1. create_household: reject a base currency whose `currencies.is_enabled`
--      is false (migration 12). The FK only proves the code exists; an owner
--      shouldn't be able to anchor a household to a currency the app hides
--      from the picker, since there's no update UI in Phase 0 to undo it.
--   2. accept_invite: insert a 'partner' member instead of copying
--      `invited_by`-time `household_invites.role`. There is no UI path to
--      issue an owner-role invite today, so honoring the column meant a
--      future bug in the invite-creation code could mint a second owner with
--      no revoke path. Hardcoding 'partner' makes the privilege invariant
--      structural — the column stays for the accept-RPC's own bookkeeping,
--      but it no longer escalates privileges.

-- ============================================================================
-- create_household (replace). Same signature + grants as migration 14, so the
-- existing `revoke ... from public; grant ... to authenticated` is preserved
-- unchanged by the `or replace` — Postgres keeps the function's ACL across a
-- drop+recreate only for `create or replace`, which is exactly what we want.
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

  -- Reject a disabled base currency up front. The FK on households.base_currency
  -- guarantees the code exists in `currencies`, but an `is_enabled = false` row
  -- is intentionally hidden from the signup picker (migration 12); anchoring a
  -- new household to it would leave the owner stuck (no Phase 0 update flow).
  if not exists (
    select 1 from public.currencies
    where code = p_base_currency and is_enabled
  ) then
    raise exception 'base currency is not enabled';
  end if;

  insert into public.households (name, country, base_currency, timezone, locale)
  values (p_name, p_country, p_base_currency, p_timezone, p_locale)
  returning id into h_id;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (h_id, auth.uid(), 'owner', p_display_name);

  return h_id;
end;
$$;

-- ============================================================================
-- accept_invite (replace). Same signature + grants as migration 14. The only
-- behavior change is the hardcoded 'partner' on the member insert.
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

  -- Hardcoded 'partner' (not inv.role): there is no UI path to issue an
  -- owner-role invite in Phase 0, so copying the column only created a path
  -- for a future invite-creation bug to mint a second owner. Making the
  -- privilege invariant structural removes that risk; household_invites.role
  -- stays in the schema for the RPC's own bookkeeping but is no longer
  -- authoritative for the granted role.
  insert into public.household_members (household_id, user_id, role, display_name)
  values (inv.household_id, auth.uid(), 'partner', coalesce(new_display_name, 'Partner'));

  update public.household_invites set accepted_at = now() where id = inv.id;

  return inv.household_id;
end;
$$;