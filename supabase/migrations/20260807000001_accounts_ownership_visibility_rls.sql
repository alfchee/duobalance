-- Issue #19: accounts ownership (owner_member_id) + visibility (is_shared),
-- the cross-household containment trigger, and the split RLS policies.
--
-- Two orthogonal concepts, deliberately kept apart:
--   Ownership  — whose account is it? (owner_member_id, null = joint)
--   Visibility — can my partner see it at all? (is_shared)
--
-- Migration 4 created the original accounts table; this migration rewrites it
-- to the #19 spec forward-only. Migration 11's single `accounts_all` FOR ALL
-- policy is replaced here with one policy per command.

-- ============================================================================
-- 1. Schema: ownership, visibility, and the #19 account model
-- ============================================================================

-- FK to household_members, NOT auth.users: an account may only be owned by
-- someone who is actually a member. on delete restrict prevents removing a
-- member who still owns accounts.
alter table public.accounts add column owner_member_id uuid
  references public.household_members(id) on delete restrict;

alter table public.accounts add column is_shared boolean not null default true;

alter table public.accounts add column institution text;

-- `kind` replaces the `account_type` enum from migration 4. The new domain has
-- no 'other' slot; pre-release, so 'other' folds into 'checking' and 'credit'
-- into 'credit_card'.
alter table public.accounts add column kind text;
update public.accounts set kind = case type
  when 'credit' then 'credit_card'
  when 'other'  then 'checking'
  else type::text
end;
alter table public.accounts alter column kind set not null;
alter table public.accounts add constraint accounts_kind_check
  check (kind in ('cash','checking','savings','credit_card','loan','investment'));
alter table public.accounts drop column type;
drop type public.account_type;

-- Balance model: ledger (computed from transactions) vs manual (typed in).
alter table public.accounts add column balance_mode text not null default 'ledger';
alter table public.accounts add constraint accounts_balance_mode_check
  check (balance_mode in ('ledger','manual'));
alter table public.accounts add column manual_balance numeric(18,4);
alter table public.accounts add column balance_updated_at timestamptz;

alter table public.accounts add column credit_limit numeric(18,4);
alter table public.accounts add column display_order smallint default 0;

-- is_active (migration 4) inverts to is_archived.
alter table public.accounts add column is_archived boolean not null default false;
update public.accounts set is_archived = not is_active;
alter table public.accounts drop column is_active;

-- A joint account (owner null) that isn't shared would be visible to NOBODY,
-- including its creator — accounts_select would exclude every member.
alter table public.accounts add constraint accounts_private_needs_owner
  check (is_shared or owner_member_id is not null);

-- With ownership, (household_id, name) uniqueness is wrong: two partners can
-- each have a personal "Checking" account in the same household. The #19 spec
-- has no such constraint; drop migration 4's.
alter table public.accounts drop constraint if exists accounts_household_id_name_key;

-- FK columns aren't indexed automatically: the restrict-on-delete lookup (when a
-- member who owns accounts is removed) and the RLS owner clause both scan the
-- table without this.
create index accounts_owner_member_idx on public.accounts (owner_member_id);

-- ============================================================================
-- 2. Cross-household containment trigger
-- ============================================================================

-- An FK to household_members(id) proves "is a member", but not "is a member of
-- *this* household". Close it. Reuse this helper for every member reference in
-- later phases (e.g. transactions.entered_by / spent_by in #23).
create or replace function public.check_member_in_household(
  p_member_id uuid, p_household_id uuid) returns void
language plpgsql
set search_path = public
as $$
begin
  if p_member_id is not null and not exists (
    select 1 from public.household_members
    where id = p_member_id and household_id = p_household_id
  ) then
    raise exception 'member % does not belong to household %',
      p_member_id, p_household_id;
  end if;
end $$;

-- Row-level triggers must return `trigger`; the void helper is invoked with the
-- NEW row's values. (PG does not allow `new.col` references directly in the
-- CREATE TRIGGER ... EXECUTE FUNCTION argument list.)
create or replace function public.tg_check_account_owner_household()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.check_member_in_household(new.owner_member_id, new.household_id);
  return new;
end $$;

create trigger accounts_check_member_in_household
  before insert or update on public.accounts
  for each row execute function public.tg_check_account_owner_household();

-- Claiming a joint account (owner null -> me) must not silently hide it from the
-- other partner in the same statement. accounts_private_needs_owner already
-- blocks un-sharing a still-joint row (owner would be null); this closes the
-- combined claim + un-share path. After the claim the account is shared-owned,
-- so a separate, later un-share remains possible.
create or replace function public.tg_check_account_claim_stays_shared()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.owner_member_id is null
     and new.owner_member_id is not null
     and not new.is_shared then
    raise exception 'a joint account must stay shared when claimed (cannot be made private in the same update)';
  end if;
  return new;
end $$;

create trigger accounts_check_claim_stays_shared
  before update on public.accounts
  for each row execute function public.tg_check_account_claim_stays_shared();

-- The id of the current user's household_members row in a household, or NULL.
-- Shorthand the #19 policies use for "whose account is it" (mirrors the issue's
-- current_member_id(household_id)); the row-returning current_member() from
-- migration 11 stays for callers that need the full row.
create or replace function public.current_member_id(household uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.household_members
  where household_id = household and user_id = auth.uid()
  limit 1;
$$;

-- ============================================================================
-- 3. RLS — one policy per command. Never FOR ALL on this table: a FOR ALL
-- write policy beside a careful SELECT policy silently grants reads on its own
-- looser terms (the #13 test-2 bug: private accounts become readable).
-- ============================================================================

drop policy if exists accounts_all on public.accounts;

-- owner_member_id = current_member_id(...) means "mine". A null owner is
-- joint (shared). Private (is_shared = false) is readable only by its owner.
create policy accounts_select on public.accounts
  for select to authenticated
  using (
    public.is_member(household_id)
    and (is_shared or owner_member_id = public.current_member_id(household_id))
  );

-- I may create a joint account (owner null) or one I own, in a household I
-- belong to — but not one owned by my partner.
create policy accounts_insert on public.accounts
  for insert to authenticated
  with check (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
  );

-- USING gates which rows I may target; WITH CHECK gates the result, so I can't
-- reassign an account to my partner or to another household.
create policy accounts_update on public.accounts
  for update to authenticated
  using (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
  )
  with check (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
  );

create policy accounts_delete on public.accounts
  for delete to authenticated
  using (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
  );
