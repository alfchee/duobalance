-- Entitlement enforcement (#261): can_write() per-command RLS narrowing, the
-- accounts count trigger against feature_limit(), and the no-widening guard.
--
-- Households under test (all UUIDs in the 28* namespace, unique to this file):
-- - hh_full    (plan t28_full:    write_access + unlimited accounts) — control
-- - hh_peer    (plan t28_full) — the other tenant for read-isolation proofs
-- - hh_nowrite (plan t28_nowrite: unlimited accounts, NO write_access row) —
--   the "plan without write entitlement" from AC1
-- - hh_nolimit (plan t28_nolimit: write_access, NO accounts row) — the
--   "missing row means zero" plan from AC4
-- - hh_free    (real seeded free plan: write_access, accounts limit 4) — the
--   over-the-limit trigger path from AC3
-- - hh_nosub   (no subscription at all) — fail-closed control
--
-- A note on failure signatures: RLS denials raise 42501 (throws_ok), while
-- UPDATE/DELETE blocked by RLS affect 0 rows silently (results_eq on a
-- RETURNING CTE, the 02_tenant_isolation pattern). Trigger rejections raise
-- P0001 with 'account limit reached'. The three are asserted distinctly so
-- a test can only pass for the intended enforcement layer.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  u_full    uuid := '28111111-1111-1111-1111-111111111111';
  u_peer    uuid := '28222222-2222-2222-2222-222222222222';
  u_nowrite uuid := '28333333-3333-3333-3333-333333333333';
  u_nolimit uuid := '28444444-4444-4444-4444-444444444444';
  u_free    uuid := '28555555-5555-5555-5555-555555555555';
  u_nosub   uuid := '28666666-6666-6666-6666-666666666666';
  hh_full    uuid := '28000000-0000-0000-0000-000000000001';
  hh_peer    uuid := '28000000-0000-0000-0000-000000000002';
  hh_nowrite uuid := '28000000-0000-0000-0000-000000000003';
  hh_nolimit uuid := '28000000-0000-0000-0000-000000000004';
  hh_free    uuid := '28000000-0000-0000-0000-000000000005';
  hh_nosub   uuid := '28000000-0000-0000-0000-000000000006';
begin
  -- Test-only plans. is_public = false so they never leak into plan listings.
  insert into public.plans (code, name, is_public, sort_order) values
    ('t28_full',    'T28 Full',    false, 100),
    ('t28_nowrite', 'T28 NoWrite', false, 101),
    ('t28_nolimit', 'T28 NoLimit', false, 102);

  insert into public.plan_features (plan_code, feature_key, enabled, limit_value) values
    ('t28_full',    'write_access', true, null),
    ('t28_full',    'accounts',     true, null),
    -- t28_nowrite deliberately has NO write_access row (AC1 target)
    ('t28_nowrite', 'accounts',     true, null),
    -- t28_nolimit deliberately has NO accounts row (AC4 target)
    ('t28_nolimit', 'write_access', true, null);

  insert into auth.users (id, email) values
    (u_full,    'full28@test.local'),
    (u_peer,    'peer28@test.local'),
    (u_nowrite, 'nowrite28@test.local'),
    (u_nolimit, 'nolimit28@test.local'),
    (u_free,    'free28@test.local'),
    (u_nosub,   'nosub28@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_full,    'T28 Full',    'CL', 'CLP', 'America/Santiago'),
    (hh_peer,    'T28 Peer',    'CL', 'CLP', 'America/Santiago'),
    (hh_nowrite, 'T28 NoWrite', 'CL', 'CLP', 'America/Santiago'),
    (hh_nolimit, 'T28 NoLimit', 'CL', 'CLP', 'America/Santiago'),
    (hh_free,    'T28 Free',    'CL', 'CLP', 'America/Santiago'),
    (hh_nosub,   'T28 NoSub',   'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_full,    u_full,    'owner', 'Full'),
    (hh_peer,    u_peer,    'owner', 'Peer'),
    (hh_nowrite, u_nowrite, 'owner', 'NoWrite'),
    (hh_nolimit, u_nolimit, 'owner', 'NoLimit'),
    (hh_free,    u_free,    'owner', 'Free'),
    (hh_nosub,   u_nosub,   'owner', 'NoSub');

  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end) values
    (hh_full,    't28_full',    'stub', 'active', now() + interval '30 days'),
    (hh_peer,    't28_full',    'stub', 'active', now() + interval '30 days'),
    (hh_nowrite, 't28_nowrite', 'stub', 'active', now() + interval '30 days'),
    (hh_nolimit, 't28_nolimit', 'stub', 'active', now() + interval '30 days'),
    (hh_free,    'free',        'stub', 'active', now() + interval '30 days');
  -- hh_nosub deliberately has no subscription row (fail-closed control).

  -- Control household: one of each gated resource.
  insert into public.accounts (id, household_id, name, kind, currency) values
    ('28300000-0000-0000-0000-000000000001', hh_full, 'Full checking', 'checking', 'CLP');
  insert into public.categories (id, household_id, name) values
    ('28400000-0000-0000-0000-000000000001', hh_full, 'Groceries');
  insert into public.transactions
    (id, household_id, account_id, category_id, amount, currency, occurred_on, description, entered_by)
  values
    ('28500000-0000-0000-0000-000000000001', hh_full,
     '28300000-0000-0000-0000-000000000001', '28400000-0000-0000-0000-000000000001',
     -1000, 'CLP', current_date, 'Full groceries',
     (select id from public.household_members where user_id = u_full));
  insert into public.budgets (id, household_id, category_id, period_month, amount) values
    ('28600000-0000-0000-0000-000000000001', hh_full,
     '28400000-0000-0000-0000-000000000001', date_trunc('month', now())::date, 200000);
  insert into public.bills (id, household_id, name, currency, rrule, starts_on) values
    ('28700000-0000-0000-0000-000000000001', hh_full, 'Full rent', 'CLP',
     'FREQ=MONTHLY;BYMONTHDAY=6', current_date);

  -- Peer household: a PRIVATE account (owner-only) plus a transaction on it.
  -- These are the rows Full must still be denied (AC2: no widening).
  insert into public.accounts (id, household_id, name, kind, currency, is_shared, owner_member_id) values
    ('28300000-0000-0000-0000-000000000002', hh_peer, 'Peer private', 'checking', 'CLP', false,
     (select id from public.household_members where user_id = u_peer));
  insert into public.transactions
    (id, household_id, account_id, amount, currency, occurred_on, description, entered_by)
  values
    ('28500000-0000-0000-0000-000000000002', hh_peer,
     '28300000-0000-0000-0000-000000000002',
     -500, 'CLP', current_date, 'Peer private spend',
     (select id from public.household_members where user_id = u_peer));

  -- No-write household: one of each gated resource as UPDATE/DELETE targets.
  -- (INSERT denials need no pre-existing row.)
  insert into public.accounts (id, household_id, name, kind, currency) values
    ('28300000-0000-0000-0000-000000000003', hh_nowrite, 'NoWrite checking', 'checking', 'CLP');
  insert into public.categories (id, household_id, name) values
    ('28400000-0000-0000-0000-000000000003', hh_nowrite, 'Groceries');
  insert into public.transactions
    (id, household_id, account_id, category_id, amount, currency, occurred_on, description, entered_by)
  values
    ('28500000-0000-0000-0000-000000000003', hh_nowrite,
     '28300000-0000-0000-0000-000000000003', '28400000-0000-0000-0000-000000000003',
     -1000, 'CLP', current_date, 'NoWrite groceries',
     (select id from public.household_members where user_id = u_nowrite));
  insert into public.budgets (id, household_id, category_id, period_month, amount) values
    ('28600000-0000-0000-0000-000000000003', hh_nowrite,
     '28400000-0000-0000-0000-000000000003', date_trunc('month', now())::date, 200000);
  insert into public.bills (id, household_id, name, currency, rrule, starts_on) values
    ('28700000-0000-0000-0000-000000000003', hh_nowrite, 'NoWrite rent', 'CLP',
     'FREQ=MONTHLY;BYMONTHDAY=6', current_date);

  -- Free household: 3 of the 4 allowed accounts; the 4th and 5th are the test.
  insert into public.accounts (id, household_id, name, kind, currency) values
    ('28300000-0000-0000-0000-000000000011', hh_free, 'Free one',   'checking', 'CLP'),
    ('28300000-0000-0000-0000-000000000012', hh_free, 'Free two',   'checking', 'CLP'),
    ('28300000-0000-0000-0000-000000000013', hh_free, 'Free three', 'checking', 'CLP');
end
$$;

select plan(35);

-- ============================================================================
-- A. can_write() direct assertions (fail-closed helper contract)
-- ============================================================================

select tests.authenticate_as('28111111-1111-1111-1111-111111111111', 'full28@test.local');

select is(
  public.can_write('28000000-0000-0000-0000-000000000001'::uuid),
  true,
  'can_write: entitled household returns true'
);

select tests.authenticate_as('28333333-3333-3333-3333-333333333333', 'nowrite28@test.local');

select is(
  public.can_write('28000000-0000-0000-0000-000000000003'::uuid),
  false,
  'can_write: plan without a write_access row returns false'
);

select tests.authenticate_as('28666666-6666-6666-6666-666666666666', 'nosub28@test.local');

select is(
  public.can_write('28000000-0000-0000-0000-000000000006'::uuid),
  false,
  'can_write: household with no subscription returns false'
);

select tests.authenticate_anon();

select throws_ok(
  $$ select public.can_write('28000000-0000-0000-0000-000000000001'::uuid) $$,
  '42501',
  null,
  'anon cannot execute can_write'
);

-- ============================================================================
-- B–D. AC1: plan without write entitlement cannot INSERT / UPDATE / DELETE
-- each gated resource. INSERT raises 42501; UPDATE/DELETE affect 0 rows.
-- ============================================================================

select tests.authenticate_as('28333333-3333-3333-3333-333333333333', 'nowrite28@test.local');

select throws_ok(
  $$ insert into public.accounts (household_id, name, kind, currency)
     values ('28000000-0000-0000-0000-000000000003', 'Sneak', 'checking', 'CLP') $$,
  '42501',
  null,
  'no-write plan: INSERT into accounts denied'
);

select throws_ok(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency, occurred_on, description, entered_by)
     values ('28000000-0000-0000-0000-000000000003',
             '28300000-0000-0000-0000-000000000003', '28400000-0000-0000-0000-000000000003',
             -500, 'CLP', current_date, 'sneak',
             (select id from public.household_members
               where user_id = '28333333-3333-3333-3333-333333333333')) $$,
  '42501',
  null,
  'no-write plan: INSERT into transactions denied'
);

select throws_ok(
  $$ insert into public.budgets (household_id, category_id, period_month, amount)
     values ('28000000-0000-0000-0000-000000000003',
             '28400000-0000-0000-0000-000000000003',
             date_trunc('month', now())::date, 50000) $$,
  '42501',
  null,
  'no-write plan: INSERT into budgets denied'
);

select throws_ok(
  $$ insert into public.bills (household_id, name, currency, rrule, starts_on)
     values ('28000000-0000-0000-0000-000000000003', 'Sneak bill', 'CLP',
             'FREQ=MONTHLY', current_date) $$,
  '42501',
  null,
  'no-write plan: INSERT into bills denied'
);

select results_eq(
  $$ with updated as (
       update public.accounts set name = 'pwned'
        where id = '28300000-0000-0000-0000-000000000003'::uuid
        returning 1
     )
     select count(*)::int from updated $$,
  $$ values (0::int) $$,
  'no-write plan: UPDATE on accounts affects 0 rows (USING blocks)'
);

select results_eq(
  $$ with updated as (
       update public.transactions set description = 'pwned'
        where id = '28500000-0000-0000-0000-000000000003'::uuid
        returning 1
     )
     select count(*)::int from updated $$,
  $$ values (0::int) $$,
  'no-write plan: UPDATE on transactions affects 0 rows (USING blocks)'
);

select results_eq(
  $$ with updated as (
       update public.budgets set amount = 1
        where id = '28600000-0000-0000-0000-000000000003'::uuid
        returning 1
     )
     select count(*)::int from updated $$,
  $$ values (0::int) $$,
  'no-write plan: UPDATE on budgets affects 0 rows (USING blocks)'
);

select results_eq(
  $$ with updated as (
       update public.bills set name = 'pwned'
        where id = '28700000-0000-0000-0000-000000000003'::uuid
        returning 1
     )
     select count(*)::int from updated $$,
  $$ values (0::int) $$,
  'no-write plan: UPDATE on bills affects 0 rows (USING blocks)'
);

select results_eq(
  $$ with deleted as (
       delete from public.accounts
        where id = '28300000-0000-0000-0000-000000000003'::uuid
        returning 1
     )
     select count(*)::int from deleted $$,
  $$ values (0::int) $$,
  'no-write plan: DELETE on accounts affects 0 rows (no WITH CHECK escape)'
);

select results_eq(
  $$ with deleted as (
       delete from public.transactions
        where id = '28500000-0000-0000-0000-000000000003'::uuid
        returning 1
     )
     select count(*)::int from deleted $$,
  $$ values (0::int) $$,
  'no-write plan: DELETE on transactions affects 0 rows (no WITH CHECK escape)'
);

select results_eq(
  $$ with deleted as (
       delete from public.budgets
        where id = '28600000-0000-0000-0000-000000000003'::uuid
        returning 1
     )
     select count(*)::int from deleted $$,
  $$ values (0::int) $$,
  'no-write plan: DELETE on budgets affects 0 rows (no WITH CHECK escape)'
);

select results_eq(
  $$ with deleted as (
       delete from public.bills
        where id = '28700000-0000-0000-0000-000000000003'::uuid
        returning 1
     )
     select count(*)::int from deleted $$,
  $$ values (0::int) $$,
  'no-write plan: DELETE on bills affects 0 rows (no WITH CHECK escape)'
);

-- ============================================================================
-- E. Control: the entitled household writes normally (narrowing added no
-- false denials for entitled callers).
-- ============================================================================

select tests.authenticate_as('28111111-1111-1111-1111-111111111111', 'full28@test.local');

select lives_ok(
  $$ insert into public.accounts (id, household_id, name, kind, currency)
     values ('28300000-0000-0000-0000-000000000021',
             '28000000-0000-0000-0000-000000000001', 'Control savings', 'savings', 'CLP') $$,
  'entitled plan: INSERT into accounts succeeds'
);

select results_eq(
  $$ with updated as (
       update public.transactions set description = 'Full groceries (edited)'
        where id = '28500000-0000-0000-0000-000000000001'::uuid
        returning 1
     )
     select count(*)::int from updated $$,
  $$ values (1::int) $$,
  'entitled plan: UPDATE on transactions affects 1 row'
);

select results_eq(
  $$ with deleted as (
       delete from public.accounts
        where id = '28300000-0000-0000-0000-000000000021'::uuid
        returning 1
     )
     select count(*)::int from deleted $$,
  $$ values (1::int) $$,
  'entitled plan: DELETE on accounts affects 1 row'
);

-- ============================================================================
-- F. AC2: no widening — previously-denied reads are still denied — and no
-- narrowing of reads either: the unentitled household still reads its own
-- data (downgrade is read-only, never data loss, per ADR 0001).
-- ============================================================================

select is_empty(
  $$ select * from public.accounts
      where id = '28300000-0000-0000-0000-000000000002'::uuid $$,
  'no widening: entitled member cannot see another household private account'
);

select is_empty(
  $$ select * from public.transactions
      where household_id = '28000000-0000-0000-0000-000000000002'::uuid $$,
  'no widening: entitled member cannot see another household transactions'
);

select tests.authenticate_as('28333333-3333-3333-3333-333333333333', 'nowrite28@test.local');

select results_eq(
  $$ select count(*)::int from public.accounts
      where household_id = '28000000-0000-0000-0000-000000000003'::uuid $$,
  $$ values (1::int) $$,
  'no read narrowing: unentitled member still reads own accounts'
);

-- ============================================================================
-- G. AC3: the accounts count trigger rejects the insert that would exceed
-- the free limit (4), and archiving re-opens room (ADR 0001 remediation).
-- ============================================================================

select tests.authenticate_as('28555555-5555-5555-5555-555555555555', 'free28@test.local');

select lives_ok(
  $$ insert into public.accounts (household_id, name, kind, currency)
     values ('28000000-0000-0000-0000-000000000005', 'Free four', 'checking', 'CLP') $$,
  'trigger: 4th account on free plan succeeds'
);

select throws_ok(
  $$ insert into public.accounts (household_id, name, kind, currency)
     values ('28000000-0000-0000-0000-000000000005', 'Free five', 'checking', 'CLP') $$,
  'P0001',
  null,
  'trigger: 5th account on free plan rejected (limit 4)'
);

select lives_ok(
  $$ update public.accounts set is_archived = true
     where id = '28300000-0000-0000-0000-000000000011'::uuid $$,
  'trigger: archiving an account while at the limit succeeds'
);

select lives_ok(
  $$ insert into public.accounts (household_id, name, kind, currency)
     values ('28000000-0000-0000-0000-000000000005', 'Free replacement', 'checking', 'CLP') $$,
  'trigger: insert after archiving succeeds (archived rows do not count)'
);

-- ============================================================================
-- H. AC4: a plan with no row for the counted feature is limited to zero —
-- the denial comes from the trigger (P0001), not the write gate, proven by
-- can_write() returning true for the same household.
-- ============================================================================

select tests.authenticate_as('28444444-4444-4444-4444-444444444444', 'nolimit28@test.local');

select is(
  public.feature_limit('28000000-0000-0000-0000-000000000004'::uuid, 'accounts'),
  0,
  'missing feature row: feature_limit returns 0, never unlimited'
);

select is(
  public.can_write('28000000-0000-0000-0000-000000000004'::uuid),
  true,
  'missing accounts row: can_write is still true (write gate passes)'
);

select throws_ok(
  $$ insert into public.accounts (household_id, name, kind, currency)
     values ('28000000-0000-0000-0000-000000000004', 'First', 'checking', 'CLP') $$,
  'P0001',
  null,
  'missing accounts row: even the first account insert is rejected (limit 0)'
);

-- ============================================================================
-- H2. No cross-household plan oracle: the count trigger fires BEFORE the RLS
-- WITH CHECK, so without an is_member() early return a non-member INSERT
-- would raise P0001 (limit 0 / at-capacity) vs 42501 (unlimited) and
-- fingerprint the victim household's tier. Both must deny with 42501.
-- ============================================================================

select tests.authenticate_as('28111111-1111-1111-1111-111111111111', 'full28@test.local');

select throws_ok(
  $$ insert into public.accounts (household_id, name, kind, currency)
     values ('28000000-0000-0000-0000-000000000004', 'Probe', 'checking', 'CLP') $$,
  '42501',
  null,
  'no oracle: non-member INSERT into limit-0 household denied with 42501, not P0001'
);

select throws_ok(
  $$ insert into public.accounts (household_id, name, kind, currency)
     values ('28000000-0000-0000-0000-000000000002', 'Probe', 'checking', 'CLP') $$,
  '42501',
  null,
  'no oracle: non-member INSERT into unlimited household denied with 42501'
);

-- ============================================================================
-- I. AC5: no FOR ALL policy coexists with a narrower SELECT policy on the
-- same table (the accounts-precedent rule, now true for bills as well).
-- ============================================================================

select tests.clear_auth();

select is_empty(
  $$ select tablename from pg_policies
      where schemaname = 'public' and cmd = 'ALL'
     intersect
     select tablename from pg_policies
      where schemaname = 'public' and cmd = 'SELECT' $$,
  'no table has both a FOR ALL policy and a narrower SELECT policy'
);

-- ============================================================================
-- J. Signup stays entitled: create_household() grants a live comped
-- subscription (#263 pre-billing default) before the default-account
-- insert trips the trigger.
-- ============================================================================

select tests.authenticate_as('28555555-5555-5555-5555-555555555555', 'free28@test.local');

select lives_ok(
  $$ select public.create_household('T28 Signup', 'CL', 'CLP', 'Free Owner') $$,
  'signup: create_household succeeds with enforcement live'
);

select tests.clear_auth();

select results_eq(
  $$ select s.plan_code || '/' || s.status from public.subscriptions s
     join public.households h on h.id = s.household_id
     where h.name = 'T28 Signup' $$,
  $$ values ('comped/active'::text) $$,
  'signup: new household holds a live comped subscription (#263 pre-billing default)'
);

select tests.authenticate_as('28555555-5555-5555-5555-555555555555', 'free28@test.local');

select is(
  public.can_write((select id from public.households where name = 'T28 Signup')),
  true,
  'signup: new household can write immediately'
);

select tests.clear_auth();
select * from finish();
