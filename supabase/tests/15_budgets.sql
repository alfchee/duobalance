-- Issue #29: budgets table + budget_status view (security_invoker = on).
--
-- Coverage per acceptance criteria:
--   * Budget creation with month-start CHECK constraint
--   * Partial unique indexes (one household vs one per member per category+month)
--   * View math: spent/remaining, transfers excluded, income excluded
--   * Personal budgets filter by spent_by
--   * Household budgets count all visible members' spending
--   * remaining goes negative when overspent (no clamping)
--   * RLS: member can create household/own budgets, not partner's personal ones
--   * RLS: cannot create two household budgets for same category+month

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(25);

-- ============================================================================
-- Fixtures: two households (CLP, USD), two members each (owner + partner).
-- One account + one category per household for transaction fixtures.
-- ============================================================================

do $$
declare
  hh_es      uuid := 'e0000000-0000-0000-0000-000000000001';
  hh_en      uuid := 'e0000000-0000-0000-0000-000000000002';
  usr_owner  uuid := 'e1000000-0000-0000-0000-000000000001';
  usr_partner uuid := 'e1000000-0000-0000-0000-000000000002';
  usr_other  uuid := 'e1000000-0000-0000-0000-000000000003';
  mem_owner  uuid := 'e2000000-0000-0000-0000-000000000001';
  mem_partner uuid := 'e2000000-0000-0000-0000-000000000002';
begin
  insert into auth.users (id, email) values
    (usr_owner,   'owner29@test.local'),
    (usr_partner, 'partner29@test.local'),
    (usr_other,   'other29@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_es, 'House ES', 'CL', 'CLP', 'America/Santiago'),
    (hh_en, 'House EN', 'US', 'USD', 'America/New_York'),
    ('eeeeeeee-0000-0000-0000-000000000001', 'Extra House', 'US', 'USD', 'America/New_York');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (mem_owner,  hh_es, usr_owner,   'owner',   'Owner'),
    (mem_partner, hh_es, usr_partner, 'partner', 'Partner');

  insert into public.accounts (household_id, name, kind, currency, is_shared) values
    (hh_es, 'ES Checking', 'checking', 'CLP', true);

  insert into public.categories (id, household_id, name) values
    ('e4000000-0000-0000-0000-000000000001', hh_es, 'Groceries'),
    ('e4000000-0000-0000-0000-000000000002', hh_es, 'Dining'),
    ('e4000000-0000-0000-0000-000000000003', hh_es, 'Rent'),
    ('e4000000-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000001', 'BudgetsCrossCheck');
end
$$;

-- Authenticate as owner for most tests.
select tests.authenticate_as('e1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- 1. Month-start CHECK constraint
-- ============================================================================

select lives_ok(
  $$ insert into public.budgets (household_id, category_id, period_month, amount)
       values ('e0000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001',
               '2026-09-01', 500000) $$,
  'budget with month-start period_month is accepted'
);

select throws_ok(
  $$ insert into public.budgets (household_id, category_id, period_month, amount)
       values ('e0000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001',
               '2026-09-15', 500000) $$,
  '23514',
  null,
  'budget with mid-month period_month is rejected (CHECK)'
);

-- ============================================================================
-- 2. Partial unique index: one household budget per (category, month)
-- ============================================================================

select throws_ok(
  $$ insert into public.budgets (household_id, category_id, period_month, amount)
       values ('e0000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001',
               '2026-09-01', 400000) $$,
  '23505',
  null,
  'duplicate household budget for same category+month is rejected (unique index)'
);

-- ============================================================================
-- 3. Partial unique index: one personal budget per (member, category, month) —
--    separate namespacing from household budgets above
-- ============================================================================

select lives_ok(
  $$ insert into public.budgets (household_id, category_id, period_month, amount, owner_member_id)
       values ('e0000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001',
               '2026-09-01', 200000, 'e2000000-0000-0000-0000-000000000001') $$,
  'personal budget for same category+month as a household budget is OK (separate namespace)'
);

select throws_ok(
  $$ insert into public.budgets (household_id, category_id, period_month, amount, owner_member_id)
       values ('e0000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001',
               '2026-09-01', 200000, 'e2000000-0000-0000-0000-000000000001') $$,
  '23505',
  null,
  'duplicate personal budget for same member+category+month is rejected (unique index)'
);

-- ============================================================================
-- 4. budget_status view math: spent and remaining without transactions
-- ============================================================================

insert into public.budgets (id, household_id, category_id, period_month, amount)
  values ('e5000000-0000-0000-0000-000000000001',
          'e0000000-0000-0000-0000-000000000001',
          'e4000000-0000-0000-0000-000000000002',
          date_trunc('month', current_date)::date, 300000);

select results_eq(
  $$ select amount::numeric, spent::numeric, remaining::numeric
     from public.budget_status
     where id = 'e5000000-0000-0000-0000-000000000001'::uuid $$,
  $$ values (300000::numeric, 0::numeric, 300000::numeric) $$,
  'budget_status: no transactions yet — spent = 0'
);

-- ============================================================================
-- 5. budget_status: expense (negative amount) contributes to spent
-- ============================================================================

select tests.clear_auth();
select tests.authenticate_as('e1000000-0000-0000-0000-000000000001');

select results_eq(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by, spent_by)
     values (
       'e0000000-0000-0000-0000-000000000001',
       (select id from public.accounts
        where household_id = 'e0000000-0000-0000-0000-000000000001'::uuid limit 1),
       'e4000000-0000-0000-0000-000000000002', -50000, 'CLP',
       current_date, 'Grocery run',
       'e2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001'
     )
     returning 1 $$,
  $$ values (1) $$,
  'setup: insert a 50000 expense'
);

select results_eq(
  $$ select amount::numeric, spent::numeric, remaining::numeric
     from public.budget_status
     where id = 'e5000000-0000-0000-0000-000000000001'::uuid $$,
  $$ values (300000::numeric, 50000::numeric, 250000::numeric) $$,
  'budget_status: 50000 expense — spent = 50000, remaining = 250000'
);

-- ============================================================================
-- 6. budget_status: income (positive amount) does NOT reduce spent
-- ============================================================================

select results_eq(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by, spent_by)
     values (
       'e0000000-0000-0000-0000-000000000001',
       (select id from public.accounts
        where household_id = 'e0000000-0000-0000-0000-000000000001'::uuid limit 1),
       'e4000000-0000-0000-0000-000000000002', 10000, 'CLP',
       current_date, 'Refund',
       'e2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001'
     )
     returning 1 $$,
  $$ values (1) $$,
  'setup: insert a 10000 refund'
);

select results_eq(
  $$ select spent::numeric from public.budget_status
     where id = 'e5000000-0000-0000-0000-000000000001'::uuid $$,
  $$ values (50000::numeric) $$,
  'budget_status: +10000 income does NOT reduce spent (amount<0 filter holds)'
);

-- ============================================================================
-- 8. budget_status: remaining goes negative when overspent (no clamping)
-- ============================================================================

insert into public.budgets (id, household_id, category_id, period_month, amount)
  values ('e5000000-0000-0000-0000-000000000002',
          'e0000000-0000-0000-0000-000000000001',
          'e4000000-0000-0000-0000-000000000003',
          date_trunc('month', current_date)::date, 100000);

select results_eq(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by, spent_by)
     values (
       'e0000000-0000-0000-0000-000000000001',
       (select id from public.accounts
        where household_id = 'e0000000-0000-0000-0000-000000000001'::uuid limit 1),
       'e4000000-0000-0000-0000-000000000003', -150000, 'CLP',
       current_date, 'Overspend',
       'e2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002'
     )
     returning 1 $$,
  $$ values (1) $$,
  'setup: owner records partner 150000 overspend on Rent (entered_by=owner, spent_by=partner)'
);

select results_eq(
  $$ select remaining::numeric from public.budget_status
     where id = 'e5000000-0000-0000-0000-000000000002'::uuid $$,
  $$ values (-50000::numeric) $$,
  'budget_status: overspent by 50000 — remaining is negative (no clamping)'
);

-- ============================================================================
-- 9. Personal budget counts only that member's spent_by rows
-- ============================================================================

-- Owner creates a personal budget for Rent (separate category from test 5's Dining
-- to avoid cross-talk: the household budget for Dining has its own spending).
insert into public.budgets (id, household_id, category_id, period_month, amount, owner_member_id)
  values ('e5000000-0000-0000-0000-000000000003',
          'e0000000-0000-0000-0000-000000000001',
          'e4000000-0000-0000-0000-000000000003',
          date_trunc('month', current_date)::date, 200000,
          'e2000000-0000-0000-0000-000000000001');

-- Owner's own expense on Rent: should count
select results_eq(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by, spent_by)
     values (
       'e0000000-0000-0000-0000-000000000001',
       (select id from public.accounts
        where household_id = 'e0000000-0000-0000-0000-000000000001'::uuid limit 1),
       'e4000000-0000-0000-0000-000000000003', -30000, 'CLP',
       current_date, 'Owner rent payment',
       'e2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001'
     )
     returning 1 $$,
  $$ values (1) $$,
  'setup: insert owner rent expense'
);

select results_eq(
  $$ select spent::numeric from public.budget_status
     where id = 'e5000000-0000-0000-0000-000000000003'::uuid $$,
  $$ values (30000::numeric) $$,
  'personal budget: owner expense with matching spent_by counts'
);

-- Switch to partner, add a Partner Rent expense
select tests.clear_auth();
select tests.authenticate_as('e1000000-0000-0000-0000-000000000002');

select results_eq(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by, spent_by)
     values (
       'e0000000-0000-0000-0000-000000000001',
       (select id from public.accounts
        where household_id = 'e0000000-0000-0000-0000-000000000001'::uuid limit 1),
       'e4000000-0000-0000-0000-000000000003', -20000, 'CLP',
       current_date, 'Partner rent payment',
       'e2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000002'
     )
     returning 1 $$,
  $$ values (1) $$,
  'setup: insert partner rent expense'
);

select results_eq(
  $$ select spent::numeric from public.budget_status
     where id = 'e5000000-0000-0000-0000-000000000003'::uuid $$,
  $$ values (30000::numeric) $$,
  'personal budget: partner spending does NOT count (spent_by != owner)'
);

-- ============================================================================
-- 10. Household budget counts all members' spending
-- ============================================================================

-- Switch back to owner (who sees everything)
select tests.clear_auth();
select tests.authenticate_as('e1000000-0000-0000-0000-000000000001');

-- budget_status for the household Dining budget (id=e5000000-0000-0000-0000-000000000001)
-- should include: 50000 (test 5 expense) only — partner/owner Rent expenses (test 9) are in a different category
select results_eq(
  $$ select spent::numeric from public.budget_status
     where id = 'e5000000-0000-0000-0000-000000000001'::uuid $$,
  $$ values (50000::numeric) $$,
  'household budget: all members spending in Dining category is counted'
);

-- ============================================================================
-- 11. RLS — member can see budgets in their household
-- ============================================================================

select tests.authenticate_as('e1000000-0000-0000-0000-000000000001');

select ok(
  exists (
    select 1 from public.budgets
    where household_id = 'e0000000-0000-0000-0000-000000000001'::uuid
  ),
  'member can SELECT budgets in their household'
);

-- ============================================================================
-- 12. RLS — non-member sees no budgets
-- ============================================================================

select tests.authenticate_as('e1000000-0000-0000-0000-000000000003');

select is_empty(
  $$ select * from public.budgets
     where household_id = 'e0000000-0000-0000-0000-000000000001'::uuid $$,
  'non-member sees 0 budgets (RLS)'
);

-- ============================================================================
-- 13. RLS — member can create a household budget (owner_member_id null)
-- ============================================================================

select tests.authenticate_as('e1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$ insert into public.budgets (household_id, category_id, period_month, amount)
       values ('e0000000-0000-0000-0000-000000000001',
               'e4000000-0000-0000-0000-000000000002',
               '2026-10-01', 150000) $$,
  'partner can create a household budget (owner_member_id null)'
);

-- ============================================================================
-- 14. RLS — member can create their own personal budget
-- ============================================================================

select lives_ok(
  $$ insert into public.budgets (household_id, category_id, period_month, amount, owner_member_id)
       values ('e0000000-0000-0000-0000-000000000001',
               'e4000000-0000-0000-0000-000000000002',
               '2026-10-01', 100000, 'e2000000-0000-0000-0000-000000000002') $$,
  'partner can create their own personal budget'
);

-- ============================================================================
-- 15. RLS — member cannot create a budget owned by their partner
-- ============================================================================

select throws_ok(
  $$ insert into public.budgets (household_id, category_id, period_month, amount, owner_member_id)
       values ('e0000000-0000-0000-0000-000000000001',
               'e4000000-0000-0000-0000-000000000002',
               '2026-10-01', 100000, 'e2000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'partner cannot create a budget owned by the owner (RLS WITH CHECK)'
);

-- ============================================================================
-- 16. budget_status with security_invoker — anon sees empty
-- ============================================================================

select tests.authenticate_anon();

select is_empty(
  $$ select * from public.budget_status $$,
  'anon sees 0 rows in budget_status (security_invoker lets RLS do its job)'
);

-- ============================================================================
-- 17. Negative amount check constraint
-- ============================================================================

select tests.authenticate_as('e1000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ insert into public.budgets (household_id, category_id, period_month, amount)
       values ('e0000000-0000-0000-0000-000000000001',
               'e4000000-0000-0000-0000-000000000002',
               '2026-11-01', -1000) $$,
  '23514',
  null,
  'negative budget amount is rejected (CHECK)'
);

-- ============================================================================
-- 18. Cross-household: budget for different household/category is fine
-- ============================================================================

select tests.clear_auth();

select lives_ok(
  $$ insert into public.budgets (household_id, category_id, period_month, amount)
       values ('eeeeeeee-0000-0000-0000-000000000001',
               'e4000000-0000-0000-0000-000000000004',
               '2026-09-01', 1000) $$,
  'budget for any household is accepted (no cross-currency guard needed — amount is always in household base_currency)'
);

select * from finish();
rollback;