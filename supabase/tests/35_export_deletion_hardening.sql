-- #269 hardening (PR review): server-side TTL clamp, token shape, deletion
-- state-machine trigger, RLS purged bar, atomic purge RPC (incl.
-- already-removed rows), expired-link sweep surface.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_a            uuid := 'c9000000-0000-0000-0000-000000000001';
  hh_b            uuid := 'c9000000-0000-0000-0000-000000000002';
  owner_user      uuid := 'c9000000-0000-0000-0000-000000000003';
  owner_member    uuid := 'c9000000-0000-0000-0000-000000000004';
  leaver_user     uuid := 'c9000000-0000-0000-0000-000000000005';
  leaver_mem_a    uuid := 'c9000000-0000-0000-0000-000000000006';
  leaver_mem_b    uuid := 'c9000000-0000-0000-0000-000000000007';
  owner_b_member  uuid := 'c9000000-0000-0000-0000-000000000010';
  acct_a          uuid := 'c9000000-0000-0000-0000-000000000008';
  tx_a            uuid := 'c9000000-0000-0000-0000-000000000009';
begin
  insert into auth.users (id, email) values
    (owner_user, 'owner35@test.local'),
    (leaver_user, 'leaver35@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'House A', 'CL', 'CLP', 'America/Santiago'),
    (hh_b, 'House B', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_member, hh_a, owner_user, 'owner', 'Owner'),
    (leaver_mem_a, hh_a, leaver_user, 'partner', 'Leaver Realname'),
    (owner_b_member, hh_b, owner_user, 'owner', 'Owner B'),
    (leaver_mem_b, hh_b, leaver_user, 'partner', 'Leaver Oldname');

  perform tests.entitle_household(hh_a);
  perform tests.entitle_household(hh_b);

  -- leaver already left household B long ago (removed row, name intact).
  update public.household_members
    set removed_at = now() - interval '60 days', removed_by = leaver_mem_b, removal_reason = 'left'
    where id = leaver_mem_b;

  insert into public.accounts (id, household_id, name, kind, currency) values
    (acct_a, hh_a, 'Shared checking', 'checking', 'CLP');

  insert into public.transactions
    (id, household_id, account_id, amount, currency, occurred_on, description, entered_by, spent_by)
  values
    (tx_a, hh_a, acct_a, -2500, 'CLP', current_date, 'Leaver groceries', leaver_mem_a, leaver_mem_a);

  insert into public.account_deletion_requests (user_id) values (leaver_user);
end
$$;

select plan(15);

-- ============================================================================
-- 1. Export link TTL is stamped server-side, token shape enforced
-- ============================================================================

select tests.clear_auth();

-- A direct write asking for a 10-year link gets clamped to ~24h.
select lives_ok(
  $$ insert into public.data_export_links (household_id, format, expires_at)
     values ('c9000000-0000-0000-0000-000000000001', 'json', now() + interval '10 years') $$,
  'long-lived link insert accepted (clamped by trigger)'
);

select ok(
  (select expires_at <= created_at + interval '25 hours'
   from public.data_export_links
   where household_id = 'c9000000-0000-0000-0000-000000000001' limit 1),
  'link expiry clamped to the 24h window despite the 10-year request'
);

-- A chosen (non-hex) token is rejected.
select throws_ok(
  $$ insert into public.data_export_links (household_id, format, token)
     values ('c9000000-0000-0000-0000-000000000001', 'json', 'predictable') $$,
  '23514',
  null,
  'non-hex export token rejected'
);

-- ============================================================================
-- 2. Deletion state machine: trigger + RLS purged bar
-- ============================================================================

-- Requests cannot open pre-confirmed.
select throws_ok(
  $$ insert into public.account_deletion_requests (user_id, status, confirmed_at, scheduled_purge_at)
     values ('c9000000-0000-0000-0000-000000000005', 'confirmed', now(), now() + interval '30 days') $$,
  'P0001',
  'deletion requests must open as pending with no timestamps',
  'pre-confirmed request insert rejected'
);

-- Backdated confirmation is rejected (would shrink the grace period).
select tests.clear_auth();
select throws_ok(
  $$ update public.account_deletion_requests
     set status = 'confirmed', confirmed_at = now() - interval '40 days',
         scheduled_purge_at = now() - interval '10 days'
     where user_id = 'c9000000-0000-0000-0000-000000000005' $$,
  'P0001',
  'confirmed_at must be approximately now',
  'backdated confirmation rejected'
);

-- A direct jump to purged is rejected by the trigger...
select throws_ok(
  $$ update public.account_deletion_requests
     set status = 'purged', purged_at = now()
     where user_id = 'c9000000-0000-0000-0000-000000000005' $$,
  'P0001',
  null,
  'pending -> purged jump rejected by the trigger'
);

-- ...and, once confirmed, by RLS for the owning user (service-role RPC only).
update public.account_deletion_requests
  set status = 'confirmed', confirmed_at = now(), scheduled_purge_at = now() + interval '30 days'
  where user_id = 'c9000000-0000-0000-0000-000000000005';

select tests.authenticate_as('c9000000-0000-0000-0000-000000000005', 'leaver35@test.local');
select throws_ok(
  $$ update public.account_deletion_requests
     set status = 'purged', purged_at = now()
     where user_id = 'c9000000-0000-0000-0000-000000000005' $$,
  '42501',
  null,
  'client cannot mark their own request purged (RLS)'
);

-- ============================================================================
-- 3. Atomic purge RPC
-- ============================================================================

select tests.clear_auth();

-- Not-due requests are refused.
select throws_ok(
  $$ select public.purge_account_deletion(
       (select id from public.account_deletion_requests
        where user_id = 'c9000000-0000-0000-0000-000000000005')) $$,
  'P0001',
  'grace period has not elapsed',
  'purge before grace expiry refused'
);

-- Age the request past grace (trigger disabled in-test only; rolled back).
alter table public.account_deletion_requests disable trigger tg_enforce_deletion_transition;
update public.account_deletion_requests
  set scheduled_purge_at = now() - interval '1 day'
  where user_id = 'c9000000-0000-0000-0000-000000000005';
alter table public.account_deletion_requests enable trigger tg_enforce_deletion_transition;

select lives_ok(
  $$ select public.purge_account_deletion(
       (select id from public.account_deletion_requests
        where user_id = 'c9000000-0000-0000-0000-000000000005')) $$,
  'due request purges atomically'
);

-- Active membership anonymized AND soft-removed...
select results_eq(
  $$ select display_name, removal_reason from public.household_members
     where id = 'c9000000-0000-0000-0000-000000000006' $$,
  $$ values ('Deleted member'::text, 'left'::text) $$,
  'active membership anonymized and soft-removed'
);

-- ...already-removed membership anonymized but its history untouched...
select results_eq(
  $$ select display_name from public.household_members
     where id = 'c9000000-0000-0000-0000-000000000007' $$,
  $$ values ('Deleted member'::text) $$,
  'already-removed membership anonymized too (no PII left behind)'
);

select ok(
  (select removed_at < now() - interval '59 days' from public.household_members
   where id = 'c9000000-0000-0000-0000-000000000007'),
  'already-removed row keeps its original removed_at'
);

-- ...ledger untouched, audit per household with ids only, request marked.
select results_eq(
  $$ select description, spent_by from public.transactions
     where id = 'c9000000-0000-0000-0000-000000000009' $$,
  $$ values ('Leaver groceries'::text, 'c9000000-0000-0000-0000-000000000006'::uuid) $$,
  'transaction survives purge with attribution intact'
);

select results_eq(
  $$ select count(*)::int from public.deletion_audit_log
     where event_type = 'account_deletion_purged'
       and household_id in ('c9000000-0000-0000-0000-000000000001',
                            'c9000000-0000-0000-0000-000000000002') $$,
  array[2::int],
  'one purge audit row per affected household'
);

select results_eq(
  $$ select status from public.account_deletion_requests
     where user_id = 'c9000000-0000-0000-0000-000000000005' $$,
  array['purged'::text],
  'request marked purged'
);

select tests.clear_auth();
select * from finish();

rollback;
