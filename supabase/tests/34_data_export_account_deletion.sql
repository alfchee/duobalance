-- #269: export links, account deletion requests, deletion audit log.
-- Pins the transaction-retention rule (docs/data-export-deletion.md):
-- departures/deletions never mutate transactions; membership rows are
-- anonymized + soft-removed, never hard-deleted while referenced
-- (entered_by/spent_by ON DELETE RESTRICT); exports and deletions are
-- household-scoped; audit rows carry ids only, never PII.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_a            uuid := 'a9000000-0000-0000-0000-000000000001';
  owner_a_user    uuid := 'a9000000-0000-0000-0000-000000000002';
  owner_a_member  uuid := 'a9000000-0000-0000-0000-000000000003';
  partner_a_user  uuid := 'a9000000-0000-0000-0000-000000000004';
  partner_a_mem   uuid := 'a9000000-0000-0000-0000-000000000005';
  hh_b            uuid := 'b9000000-0000-0000-0000-000000000001';
  owner_b_user    uuid := 'b9000000-0000-0000-0000-000000000002';
  owner_b_member  uuid := 'b9000000-0000-0000-0000-000000000003';
  acct_a          uuid := 'a9000000-0000-0000-0000-000000000006';
  tx_a            uuid := 'a9000000-0000-0000-0000-000000000007';
begin
  insert into auth.users (id, email) values
    (owner_a_user, 'ownerA34@test.local'),
    (partner_a_user, 'partnerA34@test.local'),
    (owner_b_user, 'ownerB34@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'House A', 'CL', 'CLP', 'America/Santiago'),
    (hh_b, 'House B', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_a_member, hh_a, owner_a_user, 'owner', 'Owner A'),
    (partner_a_mem, hh_a, partner_a_user, 'partner', 'Partner A'),
    (owner_b_member, hh_b, owner_b_user, 'owner', 'Owner B');

  perform tests.entitle_household(hh_a);
  perform tests.entitle_household(hh_b);

  insert into public.accounts (id, household_id, name, kind, currency) values
    (acct_a, hh_a, 'Shared checking', 'checking', 'CLP');

  insert into public.transactions
    (id, household_id, account_id, amount, currency, occurred_on, description, entered_by, spent_by)
  values
    (tx_a, hh_a, acct_a, -2500, 'CLP', current_date, 'Partner groceries', partner_a_mem, partner_a_mem);
end
$$;

select plan(20);

-- ============================================================================
-- 1. data_export_links: tenancy + token defaults
-- ============================================================================

-- Member can mint a link for their own household; token + expiry default in.
select tests.authenticate_as('a9000000-0000-0000-0000-000000000002', 'ownerA34@test.local');
select lives_ok(
  $$ insert into public.data_export_links (household_id, created_by, format)
     values ('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003', 'json') $$,
  'member can mint an export link for their own household'
);

select ok(
  (select token ~ '^[0-9a-f]{64}$' from public.data_export_links
    where household_id = 'a9000000-0000-0000-0000-000000000001' limit 1),
  'export token defaults to 64 hex chars (256-bit, unguessable)'
);

select ok(
  (select expires_at > created_at from public.data_export_links
    where household_id = 'a9000000-0000-0000-0000-000000000001' limit 1),
  'export link expiry is after creation (24h window)'
);

-- Member of A cannot mint a link for household B.
select throws_ok(
  $$ insert into public.data_export_links (household_id, format)
     values ('b9000000-0000-0000-0000-000000000001', 'json') $$,
  '42501',
  null,
  'member cannot mint an export link for another household'
);

-- Member of B cannot read A's links.
select tests.authenticate_as('b9000000-0000-0000-0000-000000000002', 'ownerB34@test.local');
select is_empty(
  $$ select id from public.data_export_links where household_id = 'a9000000-0000-0000-0000-000000000001' $$,
  'member cannot read another household''s export links'
);

-- Anon cannot read export links.
select tests.authenticate_anon();
select is_empty(
  $$ select id from public.data_export_links $$,
  'anon cannot read export links'
);

-- ============================================================================
-- 2. account_deletion_requests: own-row only + single open window
-- ============================================================================

select tests.authenticate_as('a9000000-0000-0000-0000-000000000004', 'partnerA34@test.local');
select lives_ok(
  $$ insert into public.account_deletion_requests (user_id)
     values ('a9000000-0000-0000-0000-000000000004') $$,
  'user can open their own deletion request'
);

-- Second open request for the same user is rejected (one grace window).
select throws_ok(
  $$ insert into public.account_deletion_requests (user_id)
     values ('a9000000-0000-0000-0000-000000000004') $$,
  '23505',
  null,
  'second open deletion request for the same user is rejected'
);

-- User cannot see another user's request.
select tests.authenticate_as('b9000000-0000-0000-0000-000000000002', 'ownerB34@test.local');
select is_empty(
  $$ select id from public.account_deletion_requests where user_id = 'a9000000-0000-0000-0000-000000000004' $$,
  'user cannot read another user''s deletion request'
);

-- User cannot open a request for someone else.
select throws_ok(
  $$ insert into public.account_deletion_requests (user_id)
     values ('a9000000-0000-0000-0000-000000000004') $$,
  '42501',
  null,
  'user cannot open a deletion request for another user'
);

select tests.authenticate_anon();
select is_empty(
  $$ select id from public.account_deletion_requests $$,
  'anon cannot read deletion requests'
);

-- ============================================================================
-- 3. deletion_audit_log: household-scoped reads, append-only, no PII columns
-- ============================================================================

select tests.clear_auth();
insert into public.deletion_audit_log (household_id, event_type, actor_member_id, target_member_id)
values ('a9000000-0000-0000-0000-000000000001', 'member_removed',
        'a9000000-0000-0000-0000-000000000003', 'a9000000-0000-0000-0000-000000000005');

select tests.authenticate_as('a9000000-0000-0000-0000-000000000002', 'ownerA34@test.local');
select results_eq(
  $$ select event_type from public.deletion_audit_log
     where household_id = 'a9000000-0000-0000-0000-000000000001' $$,
  array['member_removed'::text],
  'member can read their own household''s audit trail'
);

select tests.authenticate_as('b9000000-0000-0000-0000-000000000002', 'ownerB34@test.local');
select is_empty(
  $$ select id from public.deletion_audit_log where household_id = 'a9000000-0000-0000-0000-000000000001' $$,
  'member cannot read another household''s audit trail'
);

-- Clients cannot append: no insert policy, default-deny.
select tests.authenticate_as('a9000000-0000-0000-0000-000000000002', 'ownerA34@test.local');
select throws_ok(
  $$ insert into public.deletion_audit_log (household_id, event_type)
     values ('a9000000-0000-0000-0000-000000000001', 'member_left') $$,
  '42501',
  null,
  'clients cannot append to the audit log (service role only)'
);

-- The audit table carries no PII-shaped columns by construction.
select tests.clear_auth();
select is_empty(
  $$ select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'deletion_audit_log'
       and column_name in ('email', 'display_name', 'amount', 'description', 'notes', 'metadata', 'content') $$,
  'audit log has no PII/content columns'
);

-- ============================================================================
-- 4. Ledger preservation: removal keeps rows; hard delete is blocked
-- ============================================================================

-- Owner removes the partner; the partner's transaction survives untouched.
select tests.authenticate_as('a9000000-0000-0000-0000-000000000002', 'ownerA34@test.local');
select lives_ok(
  $$ select public.remove_member('a9000000-0000-0000-0000-000000000001'::uuid,
                                 'a9000000-0000-0000-0000-000000000005'::uuid, '{}'::jsonb) $$,
  'owner removes partner'
);

select tests.clear_auth();
select results_eq(
  $$ select description from public.transactions where id = 'a9000000-0000-0000-0000-000000000007' $$,
  array['Partner groceries'::text],
  'departing member''s transaction survives removal'
);

select results_eq(
  $$ select spent_by from public.transactions where id = 'a9000000-0000-0000-0000-000000000007' $$,
  array['a9000000-0000-0000-0000-000000000005'::uuid],
  'transaction attribution still points at the removed membership (no orphan)'
);

-- Hard-deleting a membership still referenced by the ledger fails loudly.
select throws_ok(
  $$ delete from public.household_members where id = 'a9000000-0000-0000-0000-000000000005' $$,
  '23503',
  null,
  'hard delete of a ledger-referenced membership is blocked (restrict)'
);

-- Cross-household removal is rejected: owner of B cannot remove A's member.
select tests.authenticate_as('b9000000-0000-0000-0000-000000000002', 'ownerB34@test.local');
select throws_ok(
  $$ select public.remove_member('a9000000-0000-0000-0000-000000000001'::uuid,
                                 'a9000000-0000-0000-0000-000000000003'::uuid, '{}'::jsonb) $$,
  'P0001',
  'only active owners can remove members',
  'removal cannot be triggered against another household'
);

select tests.clear_auth();
select * from finish();

rollback;
