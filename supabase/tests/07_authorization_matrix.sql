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
-- Several cases in the issue assume columns/functions that live in OTHER,
-- still-open issues (accounts.is_shared / owner_member_id + split RLS from
-- #19; transactions.spent_by from #23; fx_rate_on()/fx_usd_rate() from #18).
-- Tests 2/3/4/5 gate on `information_schema` at run time via psql's `\if`:
-- the moment the relevant column lands, the branch flips from `skip()` to a
-- real assertion with no edits here. See the issue: "mark them as TODO-skips
-- and enable them in the relevant phase rather than omitting them."
--
-- Tests 9/11/12 are permanent skips instead, even once their column/function
-- exists: this file doesn't own #18/#19, so hard-failing CI the instant that
-- schema lands (e.g. via a hard `ok(false)`) would break unrelated work on
-- whatever PR happens to introduce it. Whoever implements #18/#19 replaces
-- the skip with the real assertion as part of that work.

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

  insert into public.accounts (id, household_id, name, type, currency) values
    (acct_joint, hh_a, 'Joint checking',  'checking', 'CLP'),
    -- Stands in for the "private account" fixture the issue asks for. There
    -- is no is_shared concept yet (blocked by #19) — tests 2/12 gate on that
    -- column's existence and skip until it lands; this row just gives them
    -- something to point at once it does.
    (acct_alice, hh_a, 'Alice checking',  'checking', 'CLP'),
    (acct_carol, hh_b, 'Carol checking',  'checking', 'BRL');

  insert into public.categories (id, household_id, name) values
    (cat_a, hh_a, 'Groceries'),
    (cat_b, hh_b, 'Groceries');

  insert into public.budgets (id, household_id, category_id, period, amount, currency, starts_on) values
    (budget_a, hh_a, null, 'monthly', 500000, 'CLP', date_trunc('month', current_date)::date);

  insert into public.transactions
    (id, household_id, account_id, category_id, direction, amount, currency, occurred_at, description, created_by)
  values
    (tx_a1, hh_a, acct_joint, cat_a, 'debit', 20000, 'CLP', current_date, 'Alice groceries', alice_member);

  insert into public.bills (id, household_id, name, amount, currency, account_id, category_id, frequency) values
    (bill_a, hh_a, 'Internet', 15000, 'CLP', acct_joint, cat_a, 'monthly');

  insert into public.bill_instances (id, bill_id, household_id, due_on, amount, is_paid) values
    (bill_inst_a, bill_a, hh_a, current_date, 15000, false);
end
$$;

select plan(17);

-- ============================================================================
-- 1. budget_status view — Carol (household B, no budgets of her own) must
--    see 0 rows even though household A has an active budget. The view
--    already declares `security_invoker = true` (migration 6); this is the
--    regression guard that keeps it that way.
-- ============================================================================

select tests.authenticate_as('b1000000-0000-0000-0000-000000000001');

select is_empty(
  $$ select * from public.budget_status $$,
  'Carol sees 0 rows in budget_status despite household A having an active budget (security_invoker holds)'
);

-- ============================================================================
-- 2. Private account visibility — a member-scoped FOR ALL policy must never
--    widen reads past what a dedicated SELECT policy allows. Gated on
--    accounts.is_shared, which doesn't exist yet (blocked by #19: today
--    accounts_all is a single FOR ALL policy with no privacy concept at all).
-- ============================================================================

select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'accounts' and column_name = 'is_shared'
) as has_is_shared \gset

\if :has_is_shared
-- TODO(#19): the fixture's acct_alice row still needs is_shared = false (and
-- owner_member_id = alice_member) set explicitly once those columns exist —
-- is_shared defaults to true per #19's spec, so without that update this row
-- isn't actually private and this assertion would pass for the wrong reason.
select tests.authenticate_as('a1000000-0000-0000-0000-000000000002');
select is_empty(
  $$ select * from public.accounts where id = 'a3000000-0000-0000-0000-000000000002'::uuid $$,
  'Bob cannot SELECT Alice''s private account (is_shared = false)'
);
\else
select skip('accounts.is_shared not yet implemented — blocked by #19', 1);
\endif

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
       (household_id, account_id, category_id, direction, amount, currency,
        occurred_at, description, entered_by, spent_by)
     values (
       'a0000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001',
       'a4000000-0000-0000-0000-000000000001', 'debit', 5000, 'CLP', current_date,
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
--    household". Gated on accounts.owner_member_id (blocked by #19).
-- ============================================================================

select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'accounts' and column_name = 'owner_member_id'
) as has_owner_member_id \gset

\if :has_owner_member_id
select tests.authenticate_as('a1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ insert into public.accounts (household_id, owner_member_id, name, type, currency)
     values ('a0000000-0000-0000-0000-00000000000a', 'b2000000-0000-0000-0000-000000000001', 'Sneaky', 'checking', 'CLP') $$,
  null,
  null,
  'inserting an account owned by a member of another household is rejected (containment check)'
);
\else
select skip('accounts.owner_member_id + cross-household containment trigger not yet implemented — blocked by #19', 1);
\endif

-- ============================================================================
-- 6. The invited partner must not be a second-class member: Bob (role =
--    partner, not owner) can record a transaction and mark a bill paid.
-- ============================================================================

select tests.authenticate_as('a1000000-0000-0000-0000-000000000002');

select results_eq(
  $$ insert into public.transactions
       (household_id, account_id, category_id, direction, amount, currency,
        occurred_at, description, created_by)
     values (
       'a0000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001',
       'a4000000-0000-0000-0000-000000000001', 'debit', 3000, 'CLP', current_date,
       'Bob buys groceries', 'a2000000-0000-0000-0000-000000000002'
     )
     returning 1 $$,
  $$ values (1) $$,
  'Bob (partner) can INSERT a transaction'
);

select results_eq(
  $$ with updated as (
       update public.bill_instances set is_paid = true, paid_at = now()
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
--    over the global rate. Gated on fx_rate_on existing — today's
--    fx_overrides (migration 10) is a different, transaction-keyed design
--    with no such resolution function (blocked by #18).
-- ============================================================================

-- Permanent skip (see file header): don't hard-fail CI for whoever lands #18.
select skip('fx_rate_on()/fx_usd_rate() household-override resolution not yet implemented — blocked by #18', 1);

-- ============================================================================
-- 10. Basic cross-tenant isolation for Carol against household A, all four
--     commands. The most important test in the file.
-- ============================================================================

select tests.authenticate_as('b1000000-0000-0000-0000-000000000001');

select is_empty(
  $$ select * from public.accounts where household_id = 'a0000000-0000-0000-0000-00000000000a'::uuid $$,
  'Carol SELECT on household A accounts: 0 rows'
);

select throws_ok(
  $$ insert into public.transactions
       (household_id, account_id, category_id, direction, amount, currency,
        occurred_at, description, created_by)
     values (
       'a0000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001',
       'a4000000-0000-0000-0000-000000000001', 'debit', 100, 'CLP', current_date,
       'sneak', 'b2000000-0000-0000-0000-000000000001'
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
-- 11. Ownership reassignment: ordinarily-shaped WITH CHECK should permit
--     assigning to the joint pool but block assigning to someone else's
--     membership row. Gated on accounts.owner_member_id (blocked by #19).
-- ============================================================================

-- Permanent skip (see file header): don't hard-fail CI for whoever lands #19.
select skip('accounts.owner_member_id reassignment WITH CHECK semantics not yet implemented — blocked by #19', 1);

-- ============================================================================
-- 12. Transaction visibility must inherit account visibility: Bob must not
--     see transactions posted against Alice's private account. Gated on
--     accounts.is_shared (blocked by #19).
-- ============================================================================

-- Permanent skip (see file header): don't hard-fail CI for whoever lands #19.
select skip('accounts.is_shared / transaction visibility inheritance not yet implemented — blocked by #19', 1);

select * from finish();
rollback;
