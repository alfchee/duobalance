-- Issue #13: the RLS policy test suite. Each of the 12 required cases below
-- corresponds to a bug that was actually present in a draft of the design
-- (see the issue body for the full narrative) — this file is the automated
-- proof that each one stays fixed.
--
-- Fixture layout (per the issue spec):
--   Household A — Alice (owner), Bob (partner): a joint account, an account
--     that stands in for "Alice's account" (see the is_shared note below),
--     a household budget, a bill + unpaid instance, and one of Alice's
--     transactions.
--   Household B — Carol (owner): entirely unrelated, used for every
--     cross-tenant assertion.
--
-- Several cases in the issue originally assumed columns/functions that lived
-- in OTHER, still-open issues. Tests 3/4 gate on `information_schema` at run
-- time via psql's `\if`: the moment the relevant column lands, the branch
-- flips from `skip()` to a real assertion with no edits here — see the issue:
-- "mark them as TODO-skips and enable them in the relevant phase rather than
-- omitting them." All of the originally-deferred cases have since landed:
--
-- #19 (accounts ownership/visibility + split RLS) landed in migration
-- 20260807000001: tests 2, 5 and 11 are real assertions below, and tests 13/14
-- cover the #19 AC directly (partner INSERT ownership semantics; the
-- joint+private CHECK constraint).
--
-- Test 9 (fx_rate_on/fx_usd_rate override resolution) became a real assertion
-- when #18 landed — see test 9 below; the fuller suite lives in
-- 10_fx_overrides_resolution.sql.
--
-- #23 (transactions ledger refinement) landed in migration
-- 20260808004306: tests 3 and 4 flip live via the `\if` gates above (entered_by
-- write-once, spent_by independent of entered_by), and test 12 (transaction
-- visibility inheriting account visibility) is now a real assertion below.
-- The #23-specific coverage that doesn't fit this file's Household A/B
-- narrative (base_amount generation, entered_by pinned to the caller's own
-- member id, cross-household containment, account-delete cascade) lives in
-- 12_transactions_ledger.sql.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

-- Test 8's create_household call omits timezone/locale and relies on the
-- country_defaults trigger (migration 13) to fill them in from 'CL'.
-- Idempotent in case supabase/seed.sql hasn't run in this environment.
insert into public.country_defaults (country, timezone, locale) values
  ('CL', 'America/Santiago', 'es')
on conflict (country) do nothing;

do $$
declare
  hh_a          uuid := 'a0000000-0000-0000-0000-00000000000a';
  hh_b          uuid := 'b0000000-0000-0000-0000-00000000000b';
  alice_user    uuid := 'a1000000-0000-0000-0000-000000000001';
  bob_user      uuid := 'a1000000-0000-0000-0000-000000000002';
  carol_user    uuid := 'b1000000-0000-0000-0000-000000000001';
  newbie_user   uuid := 'c1000000-0000-0000-0000-000000000001';
  alice_member  uuid := 'a2000000-0000-0000-0000-000000000001';
  bob_member    uuid := 'a2000000-0000-0000-0000-000000000002';
  carol_member  uuid := 'b2000000-0000-0000-0000-000000000001';
  acct_joint    uuid := 'a3000000-0000-0000-0000-000000000001';
  acct_alice    uuid := 'a3000000-0000-0000-0000-000000000002';
  acct_carol    uuid := 'b3000000-0000-0000-0000-000000000001';
  cat_a         uuid := 'a4000000-0000-0000-0000-000000000001';
  cat_b         uuid := 'b4000000-0000-0000-0000-000000000001';
  budget_a      uuid := 'a5000000-0000-0000-0000-000000000001';
  tx_a1         uuid := 'a6000000-0000-0000-0000-000000000001';
  bill_a        uuid := 'a7000000-0000-0000-0000-000000000001';
  bill_inst_a   uuid := 'a7000000-0000-0000-0000-000000000002';
begin
  insert into auth.users (id, email) values
    (alice_user,  'alice13@test.local'),
    (bob_user,    'bob13@test.local'),
    (carol_user,  'carol13@test.local'),
    (newbie_user, 'newbie13@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'Household A', 'CL', 'CLP', 'America/Santiago'),
    (hh_b, 'Household B', 'BR', 'BRL', 'America/Sao_Paulo');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (alice_member, hh_a, alice_user, 'owner',   'Alice'),
    (bob_member,   hh_a, bob_user,   'partner', 'Bob'),
    (carol_member, hh_b, carol_user, 'owner',   'Carol');

  insert into public.accounts
    (id, household_id, name, kind, currency, is_shared, owner_member_id) values
    (acct_joint, hh_a, 'Joint checking', 'checking', 'CLP', true,  null),
    -- Alice's private account: invisible to Bob (is_shared = false, and
    -- owned by Alice, not by the joint pool). Test 2 asserts Bob can't see it.
    (acct_alice, hh_a, 'Alice checking', 'checking', 'CLP', false, alice_member),
    (acct_carol, hh_b, 'Carol checking', 'checking', 'BRL', true,  carol_member);

  insert into public.categories (id, household_id, name) values
    (cat_a, hh_a, 'Groceries'),
    (cat_b, hh_b, 'Groceries');

  insert into public.budgets (id, household_id, category_id, period_month, amount) values
    (budget_a, hh_a, cat_a, date_trunc('month', current_date)::date, 500000);

  insert into public.transactions
    (id, household_id, account_id, category_id, amount, currency, occurred_on, description, entered_by)
  values
    (tx_a1, hh_a, acct_joint, cat_a, -20000, 'CLP', current_date, 'Alice groceries', alice_member);

  insert into public.bills (id, household_id, name, default_amount, currency, account_id, category_id, rrule, starts_on) values
    (bill_a, hh_a, 'Internet', 15000, 'CLP', acct_joint, cat_a, 'FREQ=MONTHLY', current_date);

  insert into public.bill_instances (id, bill_id, household_id, due_on, amount) values
    (bill_inst_a, bill_a, hh_a, current_date, 15000);

  -- Global CLP rate for test 9's cross-tenant slice: household B (no override)
  -- must resolve this, while household A's override at value 1 wins over it.
  insert into public.fx_rates (rate_date, code, usd_rate) values
    (current_date, 'CLP', 940);
end
$$;

select plan(34);

-- ============================================================================
-- 1. budget_status view — Carol (household B, no budgets of her own) must
--    see 0 rows even though household A has an active budget. The view
--    declares `security_invoker = on` (issue #29); this is the regression
--    guard that keeps it that way.
-- ============================================================================

select tests.authenticate_as('b1000000-0000-0000-0000-000000000001');

select is_empty(
  $$ select * from public.budget_status $$,
  'Carol sees 0 rows in budget_status despite household A having an active budget (security_invoker holds)'
);

-- ============================================================================
-- 1b. budget_status — issue #29 math: budget_a = 500,000 CLP/mo,
--     tx_a1 = amount -20,000 (signed expense) within current month.
--     Expected: spent = 20000, remaining = 480000.
--     Runs as clear_auth so RLS bypass is not a factor — this is pure math.
-- ============================================================================

select tests.clear_auth();

select results_eq(
  $$ select amount::numeric, spent::numeric, remaining::numeric
     from public.budget_status
     where id = 'a5000000-0000-0000-0000-000000000001'::uuid $$,
  $$ values (500000::numeric, 20000::numeric, 480000::numeric) $$,
  'budget_status: math correct — amount = 500000, spent = 20000, remaining = 480000'
);

-- ============================================================================
-- 1c. budget_status — PR #55 issue #3 REGRESSION GUARD: a positive-amount
--     (income/refund) transaction matching the budget filters MUST NOT
--     reduce reported spent. Insert +5000 "grocery refund" on same household/
--     category/month as tx_a1; spent should remain 20000, NOT drop to 15000.
--     The fix: budget_status filters `t.amount < 0`.
-- ============================================================================

select results_eq(
  $$ with refund as (
       insert into public.transactions
         (id, household_id, account_id, category_id, amount, currency,
          occurred_on, description, entered_by)
         values (
           'a6000000-0000-0000-0000-000000000099',
           'a0000000-0000-0000-0000-00000000000a',
           'a3000000-0000-0000-0000-000000000001',
           'a4000000-0000-0000-0000-000000000001',
           5000, 'CLP', current_date,
           'Grocery refund — must NOT reduce budget spent',
           'a2000000-0000-0000-0000-000000000001'
         ) returning 1
     )
     select spent::numeric from public.budget_status
     where id = 'a5000000-0000-0000-0000-000000000001'::uuid $$,
  $$ values (20000::numeric) $$,
  'budget_status regression (#3): positive refund row does NOT reduce spent (amount<0 filter holds)'
);

select results_eq(
  $$ insert into public.transactions
       (id, household_id, account_id, category_id, amount, fx_rate, currency,
        occurred_on, description, entered_by)
     values (
       'a6000000-0000-0000-0000-000000000098',
       'a0000000-0000-0000-0000-00000000000a',
       'a3000000-0000-0000-0000-000000000001',
       'a4000000-0000-0000-0000-000000000001',
       -100, 1000, 'USD', current_date,
       'USD expense converted to CLP budget currency',
       'a2000000-0000-0000-0000-000000000001'
     ) returning base_amount $$,
  $$ values (-100000::numeric) $$,
  'foreign-currency expense stores its converted base_amount'
);

select results_eq(
  $$ select spent::numeric, remaining::numeric
     from public.budget_status
     where id = 'a5000000-0000-0000-0000-000000000001'::uuid $$,
  $$ values (120000::numeric, 380000::numeric) $$,
  'budget_status aggregates converted base_amount for a foreign-currency expense'
);

-- ============================================================================
-- 2. Private account visibility — a member-scoped FOR ALL policy must never
--    widen reads past what a dedicated SELECT policy allows. The #19 SELECT
--    policy is one of four; acct_alice is is_shared = false (see fixture), so
--    Bob must not see it even though he is a member of the same household.
-- ============================================================================

select tests.authenticate_as('a1000000-0000-0000-0000-000000000002');
select is_empty(
  $$ select * from public.accounts where id = 'a3000000-0000-0000-0000-000000000002'::uuid $$,
  'Bob cannot SELECT Alice''s private account (is_shared = false)'
);

-- And the mirror: Alice (its owner) CAN see it. Guards against the inverse
-- regression — a SELECT policy that drops the owner clause would leave private
-- accounts invisible to everyone, including their owner.
select tests.authenticate_as('a1000000-0000-0000-0000-000000000001');
select results_eq(
  $$ select count(*)::int from public.accounts where id = 'a3000000-0000-0000-0000-000000000002'::uuid $$,
  $$ values (1::int) $$,
  'Alice CAN see her own private account (owner = self)'
);

-- ============================================================================
-- 3. entered_by must be write-once — an audit trail a partner can rewrite is
--    forgeable. Gated on transactions.entered_by; today the column is named
--    created_by and has no immutability trigger (blocked by #23).
-- ============================================================================

select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'transactions' and column_name = 'entered_by'
) as has_entered_by \gset

\if :has_entered_by
select tests.authenticate_as('a1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ update public.transactions set entered_by = 'a2000000-0000-0000-0000-000000000002'::uuid
     where id = 'a6000000-0000-0000-0000-000000000001'::uuid $$,
  null,
  null,
  'entered_by is immutable once set (attribution cannot be forged)'
);
\else
select skip('transactions.entered_by (write-once attribution) not yet implemented — blocked by #23', 1);
\endif

-- ============================================================================
-- 4. spent_by must be independent of entered_by — one partner routinely
--    records the other's purchase. Gated on transactions.spent_by, which
--    doesn't exist yet (blocked by #23: today there's only created_by, so
--    "who typed it" and "whose spending it is" can't be told apart).
-- ============================================================================

select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'transactions' and column_name = 'spent_by'
) as has_spent_by \gset

\if :has_spent_by
select tests.authenticate_as('a1000000-0000-0000-0000-000000000002');
select results_eq(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by, spent_by)
     values (
       'a0000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001',
       'a4000000-0000-0000-0000-000000000001', -5000, 'CLP', current_date,
       'Bob records Alice''s purchase',
       'a2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001'
     )
     returning spent_by $$,
  $$ values ('a2000000-0000-0000-0000-000000000001'::uuid) $$,
  'Bob can enter a transaction attributed (spent_by) to Alice, independent of entered_by'
);
\else
select skip('transactions.spent_by (attribution independent of entered_by) not yet implemented — blocked by #23', 1);
\endif

-- ============================================================================
-- 5. Cross-household containment on accounts.owner_member_id — an FK to
--    household_members proves "is a member", not "is a member of *this*
--    household". Runs as superuser (RLS bypassed) so the check under test is
--    the containment trigger itself, not the INSERT policy.
-- ============================================================================

select tests.clear_auth();

select results_eq(
  $$ insert into public.accounts (household_id, owner_member_id, name, kind, currency)
     values ('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000001', 'Alice solo', 'checking', 'CLP')
     returning 1 $$,
  $$ values (1) $$,
  'an owner from the same household is accepted (containment trigger does not over-fire)'
);

select throws_ok(
  $$ insert into public.accounts (household_id, owner_member_id, name, kind, currency)
     values ('a0000000-0000-0000-0000-00000000000a', 'b2000000-0000-0000-0000-000000000001', 'Sneaky', 'checking', 'CLP') $$,
  null,
  null,
  'inserting an account owned by a member of another household is rejected (containment trigger)'
);

-- The trigger is before insert OR update; the reassignment path is covered here
-- too, still as superuser so the check under test is the trigger, not the RLS
-- UPDATE WITH CHECK.
select throws_ok(
  $$ update public.accounts
       set owner_member_id = 'b2000000-0000-0000-0000-000000000001'::uuid
       where id = 'a3000000-0000-0000-0000-000000000001'::uuid $$,
  null,
  null,
  'reassigning an account to a member of another household is rejected (containment trigger on UPDATE)'
);

-- ============================================================================
-- 6. The invited partner must not be a second-class member: Bob (role =
--    partner, not owner) can record a transaction and mark a bill paid.
-- ============================================================================

select tests.authenticate_as('a1000000-0000-0000-0000-000000000002');

select results_eq(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by)
     values (
       'a0000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001',
       'a4000000-0000-0000-0000-000000000001', -3000, 'CLP', current_date,
       'Bob buys groceries', 'a2000000-0000-0000-0000-000000000002'
     )
     returning 1 $$,
  $$ values (1) $$,
  'Bob (partner) can INSERT a transaction'
);

select results_eq(
  $$ with updated as (
       update public.bill_instances
       set status = 'paid', paid_on = current_date, paid_by_member_id = 'a2000000-0000-0000-0000-000000000002'
         where id = 'a7000000-0000-0000-0000-000000000002'::uuid
         returning 1
     )
     select count(*)::int from updated $$,
  $$ values (1::int) $$,
  'Bob (partner) can mark a bill instance paid'
);

-- ============================================================================
-- 7. fx_rates is shared reference data — no household member, owner or not,
--    may write to it. Only the service role (via the cron fetch) may.
-- ============================================================================

select throws_ok(
  $$ insert into public.fx_rates (rate_date, code, usd_rate) values (current_date, 'CLP', 900) $$,
  '42501',
  null,
  'a household member cannot INSERT into fx_rates (tenant poisoning of shared reference data)'
);

-- ============================================================================
-- 8. The bootstrap deadlock: a brand-new user with no household yet must be
--    able to call create_household() and become its owner in one shot.
-- ============================================================================

select tests.authenticate_as('c1000000-0000-0000-0000-000000000001', 'newbie13@test.local');

select isnt(
  ( select public.create_household('Newbie House', 'CL', 'CLP', 'Newbie') ),
  null,
  'a brand-new user can call create_household() and get a household id back'
);

select results_eq(
  $$ select count(*)::int from public.household_members
     where user_id = 'c1000000-0000-0000-0000-000000000001' and role = 'owner' $$,
  $$ values (1::int) $$,
  'create_household made the brand-new user the owner member (no prior membership required)'
);

-- ============================================================================
-- 9. fx_rate_on()/fx_usd_rate() must honor a household's manual override
--    over the global rate. The full suite lives in 10_fx_overrides_resolution
--    (#18); this is the cross-tenant slice the matrix owns: household A's
--    override must win for A, while Carol (household B) still resolves the
--    global feed rate.
-- ============================================================================

select tests.clear_auth();

insert into public.fx_overrides (household_id, rate_date, code, usd_rate, note)
values ('a0000000-0000-0000-0000-00000000000a', current_date, 'CLP', 1, 'A fix');

select results_eq(
  $$ select public.fx_rate_on('a0000000-0000-0000-0000-00000000000a', current_date, 'USD', 'CLP') $$,
  $$ values (1::numeric) $$,
  'household A override wins over the global CLP rate'
);

select tests.authenticate_as('b1000000-0000-0000-0000-000000000001');

select isnt(
  ( select public.fx_rate_on('b0000000-0000-0000-0000-00000000000b', current_date, 'USD', 'CLP') ),
  1::numeric,
  'household B resolves the global CLP rate, unaffected by household A override'
);

-- ============================================================================
-- 10. Basic cross-tenant isolation for Carol against household A, all four
--     commands. The most important test in the file.
-- ============================================================================

select tests.authenticate_as('b1000000-0000-0000-0000-000000000001');

select is_empty(
  $$ select * from public.accounts where household_id = 'a0000000-0000-0000-0000-00000000000a'::uuid $$,
  'Carol SELECT on household A accounts: 0 rows'
);

-- entered_by is Alice's member id (not Carol's) so the failure is isolated
-- to the RLS WITH CHECK — a mismatched entered_by would instead be rejected
-- by the transactions_containment trigger before RLS is ever reached.
select throws_ok(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by)
     values (
       'a0000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001',
       'a4000000-0000-0000-0000-000000000001', -100, 'CLP', current_date,
       'sneak', 'a2000000-0000-0000-0000-000000000001'
     ) $$,
  '42501',
  null,
  'Carol cannot INSERT into household A (WITH CHECK fails)'
);

select results_eq(
  $$ with updated as (
       update public.transactions set description = 'pwned'
         where id = 'a6000000-0000-0000-0000-000000000001'::uuid
         returning 1
     )
     select count(*)::int from updated $$,
  $$ values (0::int) $$,
  'Carol UPDATE on household A transaction affects 0 rows'
);

select results_eq(
  $$ with deleted as (
       delete from public.transactions
         where id = 'a6000000-0000-0000-0000-000000000001'::uuid
         returning 1
     )
     select count(*)::int from deleted $$,
  $$ values (0::int) $$,
  'Carol DELETE on household A transaction affects 0 rows'
);

-- ============================================================================
-- 11. Ownership reassignment: the UPDATE policy's WITH CHECK should permit
--     assigning to the joint pool and to yourself, but block assigning to
--     someone else's membership row. acct_joint starts as joint (owner null).
-- ============================================================================

select tests.authenticate_as('a1000000-0000-0000-0000-000000000002');

select results_eq(
  $$ with claimed as (
       update public.accounts
         set owner_member_id = 'a2000000-0000-0000-0000-000000000002'::uuid
         where id = 'a3000000-0000-0000-0000-000000000001'::uuid
         returning 1
     )
     select count(*)::int from claimed $$,
  $$ values (1::int) $$,
  'Bob can claim a joint account for himself (WITH CHECK: owner = current member)'
);

select throws_ok(
  $$ update public.accounts
       set owner_member_id = 'a2000000-0000-0000-0000-000000000001'::uuid
       where id = 'a3000000-0000-0000-0000-000000000001'::uuid $$,
  null,
  null,
  'Bob cannot reassign an account to Alice (WITH CHECK blocks partner ownership)'
);

-- Claiming a joint account is fine (above), but claiming it AND hiding it from
-- the other partner (is_shared -> false) in the same statement is blocked by the
-- accounts_check_claim_stays_shared trigger.
select results_eq(
  $$ insert into public.accounts (id, household_id, name, kind, currency)
     values ('a3000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'Joint 2', 'checking', 'CLP')
     returning 1 $$,
  $$ values (1) $$,
  'setup: a fresh joint account exists to claim'
);

select throws_ok(
  $$ update public.accounts
       set is_shared = false, owner_member_id = 'a2000000-0000-0000-0000-000000000002'::uuid
       where id = 'a3000000-0000-0000-0000-000000000003'::uuid $$,
  null,
  null,
  'Bob cannot claim a joint account and make it private in the same statement'
);

-- ============================================================================
-- 12. Transaction visibility must inherit account visibility: Bob must not
--     see transactions posted against Alice's private account, but Alice
--     (its owner) must. `account_id in (select id from accounts)` is itself
--     RLS-filtered by the #19 accounts_select policy, so this falls out of
--     the #23 transactions_select policy with no separate is_shared check.
-- ============================================================================

select tests.clear_auth();

select results_eq(
  $$ insert into public.transactions
       (id, household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by)
     values (
       'a6000000-0000-0000-0000-000000000002',
       'a0000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000002',
       'a4000000-0000-0000-0000-000000000001', -4000, 'CLP', current_date,
       'Alice private spend', 'a2000000-0000-0000-0000-000000000001'
     )
     returning 1 $$,
  $$ values (1) $$,
  'setup: a transaction exists against Alice''s private account'
);

select tests.authenticate_as('a1000000-0000-0000-0000-000000000002');
select is_empty(
  $$ select * from public.transactions where id = 'a6000000-0000-0000-0000-000000000002'::uuid $$,
  'Bob cannot see a transaction posted against Alice''s private account'
);

select tests.authenticate_as('a1000000-0000-0000-0000-000000000001');
select results_eq(
  $$ select count(*)::int from public.transactions where id = 'a6000000-0000-0000-0000-000000000002'::uuid $$,
  $$ values (1::int) $$,
  'Alice (owner of the private account) CAN see her own transaction'
);

-- ============================================================================
-- 13. INSERT ownership semantics (#19 AC): a partner can create a joint
--     account or their own private account, but not one owned by their spouse.
-- ============================================================================

select tests.authenticate_as('a1000000-0000-0000-0000-000000000002');

select results_eq(
  $$ insert into public.accounts (household_id, name, kind, currency)
     values ('a0000000-0000-0000-0000-00000000000a', 'Bob joint', 'checking', 'CLP')
     returning 1 $$,
  $$ values (1) $$,
  'Bob can create a joint account (owner null)'
);

select results_eq(
  $$ insert into public.accounts
       (household_id, name, kind, currency, is_shared, owner_member_id)
     values ('a0000000-0000-0000-0000-00000000000a', 'Bob personal', 'checking', 'CLP', false,
             'a2000000-0000-0000-0000-000000000002')
     returning 1 $$,
  $$ values (1) $$,
  'Bob can create his own private account (owner = self)'
);

select throws_ok(
  $$ insert into public.accounts (household_id, name, kind, currency, owner_member_id)
     values ('a0000000-0000-0000-0000-00000000000a', 'Alice account', 'checking', 'CLP',
             'a2000000-0000-0000-0000-000000000001') $$,
  null,
  null,
  'Bob cannot create an account owned by Alice (INSERT WITH CHECK)'
);

-- ============================================================================
-- 14. accounts_private_needs_owner (#19 AC): a joint (owner null) account that
--     isn't shared would be visible to nobody, including its creator — reject
--     it. Runs as superuser so the check under test is the CHECK constraint.
-- ============================================================================

select tests.clear_auth();

select throws_ok(
  $$ insert into public.accounts (household_id, name, kind, currency, is_shared)
     values ('a0000000-0000-0000-0000-00000000000a', 'Joint-private', 'checking', 'CLP', false) $$,
  '23514',
  null,
  'a joint + private account is rejected (accounts_private_needs_owner)'
);

select * from finish();
rollback;
