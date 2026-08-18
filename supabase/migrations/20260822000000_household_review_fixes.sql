-- Fixes from the #122 integration review (PR #128):
--   1. create_household's cap counted raw household_members rows, so leaving
--      or deleting a household never freed a slot — a user who created 5
--      households and deleted 3 was still locked out forever. Count
--      active_membership instead, and apply the same cap to accept_invite,
--      which had no cap at all (a user could join unlimited households).
--   2. remove_member let an owner remove a co-owner. Since the target keeps
--      role = 'owner' on the removed row, this also let a removed ex-owner's
--      row satisfy is_owner()-adjacent checks if ever resurrected — block it
--      at the source instead.
--   3. check_household_has_owner scanned every household on every write to
--      household_members. Scope it to the households actually touched by the
--      statement via transition tables.
--   4. Nothing enforced that removed_at and removal_reason are set together;
--      every current write path already does, so make it a real constraint.
--   5. household_members_delete inlined a stale "role = 'owner'" check
--      instead of routing through is_owner() (soft-delete aware). Not
--      exploitable today (the SELECT policy already hides removed rows from
--      the DELETE scan), but it's the last policy relying on the old
--      definition of "owner" — tighten it for defense in depth.
--   6. bill_instances_due_for_reminder ignored households.deleted_at, so a
--      soft-deleted household kept generating reminder emails/push for the
--      full 30-day purge window.

-- ============================================================================
-- 1. Household creation cap: count active_membership, and apply to
--    accept_invite too.
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

  perform 1
  from auth.users
  where id = auth.uid()
  for update;

  if (
    select count(*)
    from public.active_membership
    where user_id = auth.uid()
  ) >= 5 then
    raise exception 'household limit reached';
  end if;

  insert into public.households (name, country, base_currency, timezone, locale)
  values (p_name, p_country, p_base_currency, p_timezone, p_locale)
  returning id into h_id;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (h_id, auth.uid(), 'owner', p_display_name);

  return h_id;
end;
$$;

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

  if exists (
    select 1 from public.active_membership
    where household_id = inv.household_id
      and user_id = auth.uid()
  ) then
    raise exception 'you already have an active membership in this household';
  end if;

  -- Same row lock create_household uses, and for the same reason: without
  -- it, a user accepting two invites concurrently could both pass the count
  -- check before either insert commits, ending up in 6+ households.
  perform 1
  from auth.users
  where id = auth.uid()
  for update;

  if (
    select count(*)
    from public.active_membership
    where user_id = auth.uid()
  ) >= 5 then
    raise exception 'household limit reached';
  end if;

  new_display_name := nullif(split_part(coalesce(auth.email(), ''), '@', 1), '');

  insert into public.household_members (household_id, user_id, role, display_name)
  values (inv.household_id, auth.uid(), inv.role, coalesce(new_display_name, 'Partner'));

  update public.household_invites set accepted_at = now() where id = inv.id;

  return inv.household_id;
end;
$$;

-- ============================================================================
-- 2. remove_member: block removing another owner. Ownership changes go
--    through transfer_ownership; remove_member is for partners only.
-- ============================================================================

create or replace function public.remove_member(
  p_household uuid,
  p_member uuid,
  p_account_disposition jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_member_id uuid;
  v_target public.household_members;
  v_acc record;
  v_disp text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.is_owner(p_household) then
    raise exception 'only active owners can remove members';
  end if;

  v_caller_member_id := public.current_member_id(p_household);

  if p_member = v_caller_member_id then
    raise exception 'owners cannot remove themselves; use transfer_ownership or leave_household';
  end if;

  select * into v_target
  from public.household_members
  where id = p_member and household_id = p_household;

  if not found then
    raise exception 'target member not found or not active in this household';
  end if;

  if v_target.removed_at is not null then
    return; -- Idempotent no-op
  end if;

  if v_target.role = 'owner' then
    raise exception 'cannot remove another owner; transfer ownership before removal';
  end if;

  -- Resolve owned shared accounts.
  -- Scope discipline: only touch shared accounts (is_shared = true). Never touch private accounts (is_shared = false).
  for v_acc in
    select id
    from public.accounts
    where household_id = p_household
      and owner_member_id = p_member
      and is_shared = true
  loop
    v_disp := p_account_disposition->>v_acc.id::text;
    if v_disp = 'transfer' then
      update public.accounts
        set owner_member_id = v_caller_member_id
        where id = v_acc.id;
    elsif v_disp = 'joint' then
      update public.accounts
        set owner_member_id = null
        where id = v_acc.id;
    else
      raise exception 'unresolved owned accounts';
    end if;
  end loop;

  -- Reassign bills assigned to the removed member to caller
  update public.bills
    set responsible_member_id = v_caller_member_id
    where household_id = p_household
      and responsible_member_id = p_member;

  -- Mark membership as removed
  update public.household_members
    set removed_at = now(),
        removal_reason = 'removed',
        removed_by = v_caller_member_id
    where id = p_member;
end;
$$;

-- ============================================================================
-- 3. check_household_has_owner: scope the scan to households touched by this
--    statement instead of every household in the system. Stays an immediate
--    (non-deferred) AFTER STATEMENT trigger — every write path is a single
--    RPC call, and deferring would stop pgTAP's throws_ok from observing the
--    violation at all (it never COMMITs).
-- ============================================================================

-- Postgres forbids a single trigger declaration with transition tables from
-- covering more than one event, so this is wired as three triggers (one per
-- event) sharing this function — TG_OP picks which transition table(s) the
-- current invocation actually has.
create or replace function public.check_household_has_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct household_id) into v_household_ids from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct household_id) into v_household_ids from old_rows;
  else
    select array_agg(distinct household_id) into v_household_ids
    from (
      select household_id from new_rows
      union all
      select household_id from old_rows
    ) affected;
  end if;

  if v_household_ids is null then
    return null;
  end if;

  if exists (
    select h.id
    from public.households h
    join public.household_members m on m.household_id = h.id
    where h.id = any(v_household_ids)
      and h.deleted_at is null
      and m.removed_at is null
    group by h.id
    having count(*) filter (where m.role = 'owner') = 0
  ) then
    raise exception 'household must retain at least one active owner';
  end if;

  return null;
end;
$$;

drop trigger if exists tg_enforce_household_owner on public.household_members;
drop trigger if exists tg_enforce_household_owner_ins on public.household_members;
drop trigger if exists tg_enforce_household_owner_upd on public.household_members;
drop trigger if exists tg_enforce_household_owner_del on public.household_members;

create trigger tg_enforce_household_owner_ins
  after insert on public.household_members
  referencing new table as new_rows
  for each statement execute function public.check_household_has_owner();

create trigger tg_enforce_household_owner_upd
  after update on public.household_members
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.check_household_has_owner();

create trigger tg_enforce_household_owner_del
  after delete on public.household_members
  referencing old table as old_rows
  for each statement execute function public.check_household_has_owner();

-- ============================================================================
-- 4. removed_at / removal_reason must be set (or null) together. Every write
--    path already does this; make it a real invariant instead of a
--    convention.
-- ============================================================================

alter table public.household_members
  add constraint household_members_removed_reason_consistency
  check ((removed_at is null) = (removal_reason is null));

-- ============================================================================
-- 5. household_members_delete: route through is_owner() (soft-delete aware)
--    instead of an inlined, stale "role = 'owner'" check.
-- ============================================================================

drop policy if exists household_members_delete on public.household_members;

create policy household_members_delete on public.household_members
  for delete to authenticated
  using (public.is_owner(household_id));

-- ============================================================================
-- 6. bill_instances_due_for_reminder: stop reminding for soft-deleted
--    households.
-- ============================================================================

create or replace function public.bill_instances_due_for_reminder()
returns table(
  instance_id       uuid,
  bill_id           uuid,
  household_id      uuid,
  due_on            date,
  amount            numeric(20,4),
  bill_name         text,
  currency          text,
  responsible_member_id uuid,
  household_name    text,
  household_timezone text,
  household_locale  text
)
language sql
stable
set search_path = public
as $$
  select
    bi.id,
    bi.bill_id,
    bi.household_id,
    bi.due_on,
    bi.amount,
    b.name,
    b.currency,
    b.responsible_member_id,
    h.name,
    h.timezone,
    h.locale
  from public.bill_instances bi
  join public.bills b on b.id = bi.bill_id
  join public.households h on h.id = bi.household_id
  where bi.status = 'due'
    and bi.reminded_at is null
    and bi.due_on - b.reminder_days_before <= (now() at time zone h.timezone)::date
    and b.is_active
    and h.deleted_at is null;
$$;
