-- Issue #261: entitlement enforcement in RLS (epic #255 Phase A).
--
-- Enforcement belongs in the database: the client cannot be trusted and
-- route handlers are not the only path to the data. Two design mistakes are
-- closed off here deliberately:
--
-- 1. A write check in WITH CHECK alone leaves DELETE unguarded, because
--    WITH CHECK does not apply to DELETE (or to the USING clause of
--    UPDATE). Every gated write policy below carries can_write() in USING
--    for UPDATE and DELETE, and in WITH CHECK for INSERT and UPDATE.
--
-- 2. Adding a permissive policy WIDENS access (permissive policies are
--    OR'd). Narrowing is done by AND-ing can_write() into the existing
--    policy expressions. No new permissive policy is added; the one table
--    that still had FOR ALL (bills) is split into per-command policies
--    first, mirroring the accounts precedent (20260807000001) — a FOR ALL
--    write policy beside a careful SELECT policy silently grants reads on
--    its own looser terms.
--
-- Scope (deliberate, reviewable):
-- - Gated write surfaces are the household ledger tables: accounts,
--   transactions, budgets, bills. SELECT policies are untouched everywhere:
--   per ADR 0001 downgrade is read-only, never data loss, so reads keep
--   working for unentitled households.
-- - NOT gated: categories / categorization_rules / import_* / fx_overrides /
--   push_subscriptions / bill_instances / household_members / invites. Those
--   are setup, integration, device, or derived data with no revenue wedge,
--   and blocking them would hinder downgrade remediation (re-categorize,
--   archive, re-invite). Member-seat and invite gating belong to a later
--   issue with the member-cap trigger the soft-delete migration anticipates.
-- - The one counted feature enforced here is accounts (free: 4, plus:
--   unlimited, missing row: 0). history_days is view-only per ADR 0001;
--   export / long_range_reports are app-layer gates (#264).
--
-- Deploy ordering: this enforcement fails closed, so households without a
-- live subscription lose writes. #263 (comped founder plan + backfill) must
-- land before or with this or production writes break between the two
-- deploys. Signup stays working because create_household() below grants a
-- perpetual free/active subscription before inserting the default account.

-- ============================================================================
-- 1. write_access vocabulary. Both catalogue plans can write; households
--    with no live subscription (none/expired) fail closed through
--    has_feature()'s missing-plan -> false arm. #263's comped plan grants
--    this feature as well.
-- ============================================================================

insert into public.plan_features (plan_code, feature_key, enabled, limit_value) values
  ('free', 'write_access', true, null),
  ('plus', 'write_access', true, null);

-- ============================================================================
-- 2. can_write() helper, built on has_feature(). SECURITY INVOKER like the
--    hardened #257 helpers: as DEFINER any authenticated user could probe
--    another household's entitlement by passing its UUID; as INVOKER the
--    caller's RLS applies and cross-household probes fail closed.
-- ============================================================================

create or replace function public.can_write(p_household uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.has_feature(p_household, 'write_access')
$$;

revoke execute on function public.can_write(uuid) from public;
grant execute on function public.can_write(uuid) to authenticated;

comment on function public.can_write(uuid) is
  'Issue #261: write entitlement for the household ledger tables (accounts, transactions, budgets, bills). Fail-closed via has_feature: no subscription, an expired subscription, or a plan without a write_access row all yield false.';

-- ============================================================================
-- 3. Narrow the ledger write policies. SELECT everywhere is untouched.
-- ============================================================================

-- -- accounts (ownership/visibility clauses from 20260807000001 preserved) --

drop policy if exists accounts_insert on public.accounts;
create policy accounts_insert on public.accounts
  for insert to authenticated
  with check (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
    and public.can_write(household_id)
  );

drop policy if exists accounts_update on public.accounts;
create policy accounts_update on public.accounts
  for update to authenticated
  using (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
    and public.can_write(household_id)
  )
  with check (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
    and public.can_write(household_id)
  );

drop policy if exists accounts_delete on public.accounts;
create policy accounts_delete on public.accounts
  for delete to authenticated
  using (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
    and public.can_write(household_id)
  );

-- -- transactions (account-visibility clauses from 20260808004306 preserved) --

drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions
  for insert to authenticated
  with check (
    account_id in (select id from public.accounts)
    and entered_by = public.current_member_id(household_id)
    and public.can_write(household_id)
  );

drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions
  for update to authenticated
  using (
    account_id in (select id from public.accounts)
    and public.can_write(household_id)
  )
  with check (
    account_id in (select id from public.accounts)
    and public.can_write(household_id)
  );

drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions
  for delete to authenticated
  using (
    account_id in (select id from public.accounts)
    and public.can_write(household_id)
  );

-- -- budgets (ownership clauses from 20260809190000 preserved) --

drop policy if exists budgets_insert on public.budgets;
create policy budgets_insert on public.budgets
  for insert to authenticated
  with check (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
    and public.can_write(household_id)
  );

drop policy if exists budgets_update on public.budgets;
create policy budgets_update on public.budgets
  for update to authenticated
  using (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
    and public.can_write(household_id)
  )
  with check (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
    and public.can_write(household_id)
  );

drop policy if exists budgets_delete on public.budgets;
create policy budgets_delete on public.budgets
  for delete to authenticated
  using (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
    and public.can_write(household_id)
  );

-- -- bills: split the last FOR ALL into per-command policies, then narrow.
--    A FOR ALL policy cannot carry a write-only gate: its USING clause also
--    governs SELECT, so AND-ing can_write into bills_all would have made
--    reads fail for unentitled households (data loss on downgrade,
--    forbidden by ADR 0001). --

drop policy if exists bills_all on public.bills;

create policy bills_select on public.bills
  for select to authenticated
  using (public.is_member(household_id));

create policy bills_insert on public.bills
  for insert to authenticated
  with check (
    public.is_member(household_id)
    and public.can_write(household_id)
  );

create policy bills_update on public.bills
  for update to authenticated
  using (
    public.is_member(household_id)
    and public.can_write(household_id)
  )
  with check (
    public.is_member(household_id)
    and public.can_write(household_id)
  );

create policy bills_delete on public.bills
  for delete to authenticated
  using (
    public.is_member(household_id)
    and public.can_write(household_id)
  );

-- ============================================================================
-- 4. Accounts count trigger against feature_limit(). RLS answers "may this
--    caller write at all"; the trigger answers "does the plan have room".
--
--    SECURITY DEFINER (like tg_skip_deleted_bill_instance) so the count is
--    exact: an INVOKER trigger would miss accounts hidden from the caller by
--    the private-account SELECT policy and undercount. BEFORE INSERT triggers
--    fire before the RLS WITH CHECK, so the trigger must not probe another
--    household's subscription: it returns early for non-members and lets RLS
--    produce the 42501 denial (otherwise P0001 vs 42501 fingerprints the
--    victim's plan tier). The check is otherwise confined to
--    NEW.household_id, which the RLS policy authorizes for members, so no
--    cross-household read is opened. Fail-closed: feature_limit() returns 0
--    for a plan with no accounts row, so the first insert already raises.
--
--    Archiving (or touching an archived row) always passes the *trigger*:
--    ADR 0001 remediation is "archive an account", which must work for an
--    entitled-but-over-limit household. An unentitled household
--    (expired/no subscription) still cannot archive: accounts_update
--    requires can_write() in USING and WITH CHECK, so downgrade stays fully
--    read-only until resubscribe. No concurrency guard beyond the row lock: two racing inserts can both
--    pass, same as every other non-unique limit in this schema; the RLS
--    gate plus UI gating (#264) make this a Phase A non-issue.
-- ============================================================================

create or replace function public.tg_enforce_account_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_count int;
begin
  -- Non-members return early: let the RLS WITH CHECK deny with 42501 so the
  -- trigger never leaks the target household's plan tier (P0001 vs 42501).
  if not public.is_member(new.household_id) then
    return new;
  end if;

  if new.is_archived then
    return new;
  end if;

  v_limit := public.feature_limit(new.household_id, 'accounts');

  select count(*) into v_count
    from public.accounts
   where household_id = new.household_id
     and not is_archived
     and id is distinct from new.id;

  if v_count >= v_limit then
    raise exception 'account limit reached for this plan (limit %)', v_limit
      using errcode = 'raise_exception';
  end if;

  return new;
end $$;

comment on function public.tg_enforce_account_limit() is
  'Issue #261: rejects the account insert (or un-archive / move) that would exceed feature_limit(household, accounts). Archived rows do not count; a plan with no accounts row has limit 0.';

drop trigger if exists accounts_enforce_plan_limit on public.accounts;
create trigger accounts_enforce_plan_limit
  before insert or update of household_id, is_archived on public.accounts
  for each row execute function public.tg_enforce_account_limit();

-- ============================================================================
-- 5. Signup stays entitled. create_household() inserts the default Cash
--    account in the same DEFINER function, and the trigger above fires even
--    for the table owner — a subscription-less household has limit 0, so
--    signup would break without this grant. A perpetual free/active row
--    (no period end -> household_plan resolves through infinity, immune to
--    the #260 sweeper which never touches active rows) preserves exactly
--    today's behavior. #263 upgrades this grant to comped; the backfill
--    there covers households created before this migration.
-- ============================================================================

create or replace function public.create_household(
  p_name text,
  p_country text,
  p_base_currency text,
  p_display_name text,
  p_timezone text default null,
  p_locale text default null,
  p_signup_source text default null
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

  insert into public.households (name, country, base_currency, timezone, locale, signup_source)
  values (p_name, p_country, p_base_currency, p_timezone, p_locale, p_signup_source)
  returning id into h_id;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (h_id, auth.uid(), 'owner', p_display_name);

  -- #261: grant before the default-account insert below trips the
  -- accounts_enforce_plan_limit trigger (limit 0 with no subscription).
  -- #263 replaces 'free' with 'comped'.
  insert into public.subscriptions (household_id, plan_code, provider, status)
  values (h_id, 'free', 'stub', 'active');

  -- Implicit default: a joint cash account in the household base currency.
  -- This removes the "which account?" blocker before the first transaction.
  -- The account is visible and renameable via the normal account edit flow.
  -- Name is localized from p_locale so Spanish/PT households don't get an
  -- English-only "Cash" row that immediately looks untranslated.
  insert into public.accounts (household_id, name, kind, currency, opening_balance, balance_mode, is_shared, owner_member_id, display_order, is_archived)
  values (
    h_id,
    case p_locale when 'es' then 'Efectivo' when 'pt-BR' then 'Dinheiro' else 'Cash' end,
    'cash', p_base_currency, 0, 'ledger', true, null, 0, false
  );

  return h_id;
end;
$$;

revoke all on function public.create_household(text, text, text, text, text, text, text) from public;
grant execute on function public.create_household(text, text, text, text, text, text, text) to authenticated;
