-- Dunning delivery ledger (#265): the UNIQUE (subscription_id, stage) guard
-- that makes the billing-dunning cron idempotent, the stage check
-- constraint, and RLS tenant isolation (own-household reads for
-- authenticated, nothing for anon, no authenticated writes).
--
-- Households under test (33* namespace, unique to this file):
-- - hh_dun   (plus/past_due member — the dunning household)
-- - hh_peer  (plus/active member — the other tenant for isolation proofs)

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  u_dun  uuid := '33111111-1111-1111-1111-111111111111';
  u_peer uuid := '33222222-2222-2222-2222-222222222222';
  hh_dun  uuid := '33000000-0000-0000-0000-000000000001';
  hh_peer uuid := '33000000-0000-0000-0000-000000000002';
  sub_dun uuid := '33000000-0000-0000-0000-000000000011';
begin
  insert into auth.users (id, email) values
    (u_dun,  'dun33@test.local'),
    (u_peer, 'peer33@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_dun,  'T33 Dunning', 'CL', 'CLP', 'America/Santiago'),
    (hh_peer, 'T33 Peer',    'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_dun,  u_dun,  'owner', 'Dun'),
    (hh_peer, u_peer, 'owner', 'Peer');

  insert into public.subscriptions
    (id, household_id, plan_code, provider, status, grace_ends_at) values
    (sub_dun, hh_dun, 'plus', 'stub', 'past_due', now() + interval '7 days');
  insert into public.subscriptions
    (household_id, plan_code, provider, status, current_period_end) values
    (hh_peer, 'plus', 'stub', 'active', now() + interval '30 days');
end
$$;

select plan(9);

-- ============================================================================
-- A. Send ledger: one row per stage, duplicates rejected by the unique guard.
-- ============================================================================

select lives_ok(
  $$ insert into public.dunning_deliveries (subscription_id, household_id, stage)
     values ('33000000-0000-0000-0000-000000000011'::uuid,
             '33000000-0000-0000-0000-000000000001'::uuid,
             'first_reminder') $$,
  'ledger: first_reminder records'
);

select throws_ok(
  $$ insert into public.dunning_deliveries (subscription_id, household_id, stage)
     values ('33000000-0000-0000-0000-000000000011'::uuid,
             '33000000-0000-0000-0000-000000000001'::uuid,
             'first_reminder') $$,
  '23505',
  null,
  'ledger: same (subscription, stage) twice is rejected — the retried job cannot double-send'
);

select lives_ok(
  $$ insert into public.dunning_deliveries (subscription_id, household_id, stage)
     values ('33000000-0000-0000-0000-000000000011'::uuid,
             '33000000-0000-0000-0000-000000000001'::uuid,
             'second_reminder') $$,
  'ledger: a new stage for the same subscription records'
);

select throws_ok(
  $$ insert into public.dunning_deliveries (subscription_id, household_id, stage)
     values ('33000000-0000-0000-0000-000000000011'::uuid,
             '33000000-0000-0000-0000-000000000001'::uuid,
             'bogus_stage') $$,
  '23514',
  null,
  'ledger: unknown stages are rejected by the check constraint'
);

-- ============================================================================
-- B. RLS: own-household reads for members, nothing for anyone else.
-- ============================================================================

select tests.authenticate_as('33111111-1111-1111-1111-111111111111', 'dun33@test.local');

select results_eq(
  $$ select stage from public.dunning_deliveries
     order by stage $$,
  $$ values ('first_reminder'::text), ('second_reminder'::text) $$,
  'member reads their own household delivery rows'
);

select tests.authenticate_as('33222222-2222-2222-2222-222222222222', 'peer33@test.local');

select is_empty(
  $$ select stage from public.dunning_deliveries $$,
  'peer household sees none of the dunning rows'
);

select throws_ok(
  $$ insert into public.dunning_deliveries (subscription_id, household_id, stage)
     values ('33000000-0000-0000-0000-000000000011'::uuid,
             '33000000-0000-0000-0000-000000000002'::uuid,
             'final_notice') $$,
  '42501',
  null,
  'authenticated members cannot write the ledger (service-role cron only)'
);

select tests.authenticate_anon();

select throws_ok(
  $$ select stage from public.dunning_deliveries $$,
  '42501',
  null,
  'anon cannot read the ledger at all (no grants)'
);

select throws_ok(
  $$ insert into public.dunning_deliveries (subscription_id, household_id, stage)
     values ('33000000-0000-0000-0000-000000000011'::uuid,
             '33000000-0000-0000-0000-000000000001'::uuid,
             'final_notice') $$,
  '42501',
  null,
  'anon cannot write the ledger'
);

select tests.clear_auth();
select * from finish();
