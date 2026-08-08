-- Issue #23: transactions ledger refinement — signed amount, generated
-- base_amount, entered_by/spent_by split, transfer_group_id, receipt_url,
-- import_hash, cross-household containment, and RLS that inherits account
-- visibility (#19) instead of migration 11's blanket transactions_all
-- FOR ALL policy.
--
-- Migration 5 created the original table (direction + positive magnitude,
-- occurred_at, a single created_by); this migration rewrites it to the #23
-- spec forward-only, per #1's "never edit applied migrations" rule. No real
-- transaction data exists yet (pre-launch), so conversions below are
-- schema-only except the direction -> signed amount backfill.

-- ============================================================================
-- 1. amount: (direction enum + positive magnitude) -> a single signed
--    numeric, negative = money out. Convert existing rows before the check
--    constraint and enum are dropped, and before the constraint would reject
--    the newly-negative debit rows.
-- ============================================================================

alter table public.transactions
  drop constraint if exists transactions_amount_check;

update public.transactions
  set amount = case direction when 'debit' then -amount else amount end;

alter table public.transactions
  drop column direction;

drop type public.transaction_direction;

alter table public.transactions
  alter column amount type numeric(18,4),
  add constraint transactions_amount_nonzero_check check (amount <> 0);

comment on column public.transactions.amount is
  'Signed, in `currency`. Negative = money out. Report on base_amount, never this column, once more than one currency is in play. numeric(18,4) per #23 spec — do not widen without also widening base_amount.';

-- ============================================================================
-- 2. fx_rate: snapshot rate from `currency` to the household's base_currency
--    at entry time. Was nullable with no default; #23 makes it mandatory so
--    base_amount below never has a null input.
-- ============================================================================

update public.transactions set fx_rate = 1 where fx_rate is null;

alter table public.transactions
  alter column fx_rate set default 1,
  alter column fx_rate set not null;

comment on column public.transactions.fx_rate is
  'currency -> household base_currency, snapshotted at entry (see fx_rate_on()). 1 when currency already is the base.';

-- ============================================================================
-- 3. base_amount: generated so it can never drift from amount * fx_rate.
--    Every report/balance calculation reads this column, never `amount`.
-- ============================================================================

alter table public.transactions
  add column base_amount numeric(18,4)
    generated always as (round(amount * fx_rate, 4)) stored;

-- ============================================================================
-- 4. entered_by / spent_by split.
--    entered_by = who typed the row (audit; frozen after insert below).
--    spent_by   = whose spending this is (reporting; freely editable, null
--                 = joint). created_by (migration 5) conflated both questions.
-- ============================================================================

alter table public.transactions rename column created_by to entered_by;

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'transactions_created_by_fkey'
      and table_schema = 'public' and table_name = 'transactions'
  ) then
    alter table public.transactions
      rename constraint transactions_created_by_fkey
      to transactions_entered_by_fkey;
  end if;
end $$;

alter table public.transactions
  add column spent_by uuid references public.household_members(id) on delete restrict;

comment on column public.transactions.entered_by is
  'Who recorded this row. Write-once (see transactions_freeze_entered_by trigger) — the audit trail.';
comment on column public.transactions.spent_by is
  'Whose spending this is. Null = joint. Freely editable — correcting attribution is a normal user action, forging authorship is not.';

create or replace function public.tg_transactions_freeze_entered_by()
returns trigger
language plpgsql
as $$
begin
  if new.entered_by is distinct from old.entered_by then
    raise exception 'entered_by is immutable (edit spent_by instead)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger transactions_freeze_entered_by
  before update on public.transactions
  for each row execute function public.tg_transactions_freeze_entered_by();

-- ============================================================================
-- 5. account_id: cascade instead of restrict — deleting an account deletes
--    its transactions (the #23 AC). category_id keeps migration 5's
--    on delete set null; #22's categories_delete_in_use trigger already
--    reassigns in-use categories to a fallback before a delete can reach
--    this FK, so the plain SET NULL only fires for the fallback-missing
--    exception path, never silently.
-- ============================================================================

alter table public.transactions
  drop constraint if exists transactions_account_id_fkey,
  add constraint transactions_account_id_fkey
    foreign key (account_id) references public.accounts(id) on delete cascade;

-- ============================================================================
-- 6. transfer_group_id replaces transfer_pair_id. A transfer is two rows
--    sharing one group id, not two rows pointing at each other — a mutual
--    self-FK can't express "both legs" without one leg always being written
--    second. No transfer data exists yet (the transfer-creation RPC is a
--    later issue), so this is a straight drop+add.
-- ============================================================================

alter table public.transactions drop column if exists transfer_pair_id;
alter table public.transactions add column transfer_group_id uuid;

create index transactions_transfer_group_idx
  on public.transactions (transfer_group_id) where transfer_group_id is not null;

comment on column public.transactions.transfer_group_id is
  'Both legs of a transfer share this id. Set by the transfer-creation RPC (later issue), never by hand.';

-- ============================================================================
-- 7. receipt_url + import_hash. import_hash was scoped in #1's original
--    design but never added when migration 8 built the import tables — add
--    it now so import dedup (a later issue) has somewhere to land.
-- ============================================================================

alter table public.transactions add column receipt_url text;
alter table public.transactions add column import_hash text;

create unique index transactions_account_import_hash_uidx
  on public.transactions (account_id, import_hash) where import_hash is not null;

-- ============================================================================
-- 8. occurred_at -> occurred_on (#23 naming). Indexes renamed to match.
-- ============================================================================

alter table public.transactions rename column occurred_at to occurred_on;

alter index if exists public.transactions_household_date_idx
  rename to transactions_household_occurred_idx;
alter index if exists public.transactions_account_date_idx
  rename to transactions_account_occurred_idx;

-- ============================================================================
-- 9. Containment: entered_by/spent_by must be members of THIS household;
--    account_id/category_id must be rows of THIS household. Reuses
--    check_member_in_household (#19, migration 20260807000001) and
--    assert_same_household (#22, migration 20260807180000).
-- ============================================================================

create or replace function public.tg_transactions_containment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_member_in_household(new.entered_by, new.household_id);
  perform public.check_member_in_household(new.spent_by, new.household_id);

  perform public.assert_same_household(
    (select household_id from public.accounts where id = new.account_id),
    new.household_id,
    'transactions.account_id must belong to the same household'
  );

  if new.category_id is not null then
    perform public.assert_same_household(
      (select household_id from public.categories where id = new.category_id),
      new.household_id,
      'transactions.category_id must belong to the same household'
    );
  end if;

  return new;
end;
$$;

create trigger transactions_containment
  before insert or update of entered_by, spent_by, account_id, category_id, household_id
  on public.transactions
  for each row execute function public.tg_transactions_containment();

-- ============================================================================
-- 10. RLS: replace migration 11's single transactions_all FOR ALL policy
--     with one policy per command. Visibility inherits from accounts — the
--     inner `select id from accounts` is itself RLS-filtered by the #19
--     accounts policies, so a private account's transactions are invisible
--     to anyone but its owner with no separate is_shared check needed here.
--     entered_by is pinned to the caller's own member id at insert time so
--     attribution can never be forged.
-- ============================================================================

drop policy if exists transactions_all on public.transactions;

create policy transactions_select on public.transactions
  for select to authenticated
  using (account_id in (select id from public.accounts));

create policy transactions_insert on public.transactions
  for insert to authenticated
  with check (
    account_id in (select id from public.accounts)
    and entered_by = public.current_member_id(household_id)
  );

create policy transactions_update on public.transactions
  for update to authenticated
  using (account_id in (select id from public.accounts))
  with check (account_id in (select id from public.accounts));

create policy transactions_delete on public.transactions
  for delete to authenticated
  using (account_id in (select id from public.accounts));

-- ============================================================================
-- 11. budget_status (migration 6) reads transactions.amount and
--     transactions.occurred_at directly: the column rename and the sign flip
--     from step 1 both need to be reflected here or "spent" silently breaks.
-- ============================================================================

create or replace view public.budget_status
with (security_invoker = true) as
select
  b.id                                        as budget_id,
  b.household_id,
  b.category_id,
  b.period,
  b.amount                                    as budgeted,
  b.currency,
  coalesce(-sum(t.amount), 0)                 as spent,
  b.amount - coalesce(-sum(t.amount), 0)      as remaining,
  case
    when b.amount = 0 then 0
    else round((coalesce(-sum(t.amount), 0) / b.amount * 100)::numeric, 2)
  end                                         as pct_used
from public.budgets b
left join public.transactions t
  on t.household_id  = b.household_id
 and (b.category_id is null or t.category_id = b.category_id)
 and t.occurred_on  >= b.starts_on
 and t.amount       <  0
 and case b.period
       when 'weekly'  then t.occurred_on <  b.starts_on + interval '7 days'
       when 'monthly' then t.occurred_on <  b.starts_on + interval '1 month'
       when 'yearly'  then t.occurred_on <  b.starts_on + interval '1 year'
     end
where b.is_active
group by b.id, b.household_id, b.category_id, b.period, b.amount, b.currency, b.starts_on;

comment on view public.budget_status is
  'Active budgets with spent/remaining for the current period. Recomputed on read. Spent = -sum(amount) WHERE amount < 0 (only money-out rows contribute); does not yet convert cross-currency transactions into the budget''s own currency.';
