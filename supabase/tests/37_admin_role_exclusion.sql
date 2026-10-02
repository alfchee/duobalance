-- Issue #271 review (PR #300): the roster and the membership table are
-- mutually exclusive per identity, in both insertion directions, and audit
-- evidence outlives the audited rows.
--
-- - Granting an admin role to a household member raises 23514.
-- - Adding an admin as a household member raises 23514 (including via
--   UPDATE of user_id, the second write path).
-- - Deleting a household preserves the audit row's target_household UUID
--   instead of nulling it (append-only evidence).

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_a          uuid := 'd1000000-0000-0000-0000-000000000001';
  owner_user    uuid := 'd1000000-0000-0000-0000-000000000002';
  owner_member  uuid := 'd1000000-0000-0000-0000-000000000003';
  admin_user    uuid := 'd1000000-0000-0000-0000-000000000004';
  plain_user    uuid := 'd1000000-0000-0000-0000-000000000005';
  other_user    uuid := 'd1000000-0000-0000-0000-000000000006';
begin
  insert into auth.users (id, email) values
    (owner_user, 'owner37@test.local'),
    (admin_user, 'admin37@test.local'),
    (plain_user, 'plain37@test.local'),
    (other_user, 'other37@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'House A37', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_member, hh_a, owner_user, 'owner', 'Owner A37');

  perform tests.entitle_household(hh_a);

  -- Disjoint starting roster: the admin holds no membership.
  insert into public.admin_users (user_id, role, note) values
    (admin_user, 'support', 'test admin');
end
$$;

select plan(11);

-- 1-2. Granting an admin role to a household member fails closed.
select throws_ok(
  $$ insert into public.admin_users (user_id, role) values
     ('d1000000-0000-0000-0000-000000000002', 'support') $$,
  '23514', 'admin identity d1000000-0000-0000-0000-000000000002 already holds household membership (roles are mutually exclusive, #271)',
  'admin grant to a household member: 23514 (first insertion direction)'
);

-- A disjoint grant still works: the exclusion is per-identity, not global.
select lives_ok(
  $$ insert into public.admin_users (user_id, role) values
     ('d1000000-0000-0000-0000-000000000005', 'billing') $$,
  'admin grant to a non-member succeeds (exclusion is per-identity)'
);

-- 3-4. Adding an admin as a household member fails closed, via INSERT and
-- via UPDATE of user_id (the second write path).
select throws_ok(
  $$ insert into public.household_members (household_id, user_id, role, display_name) values
     ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000004', 'partner', 'Sneaky') $$,
  '23514', 'household member d1000000-0000-0000-0000-000000000004 holds an admin role (roles are mutually exclusive, #271)',
  'member insert for an admin: 23514 (second insertion direction)'
);
select throws_ok(
  $$ update public.household_members
     set user_id = 'd1000000-0000-0000-0000-000000000004'
     where id = 'd1000000-0000-0000-0000-000000000003' $$,
  '23514', 'household member d1000000-0000-0000-0000-000000000004 holds an admin role (roles are mutually exclusive, #271)',
  'member update-to-admin: 23514 (update path closed too)'
);

-- 5. Ordinary membership writes for non-admins are unaffected.
select lives_ok(
  $$ insert into public.household_members (household_id, user_id, role, display_name) values
     ('d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000006', 'partner', 'Other') $$,
  'member insert for a non-admin still succeeds (no collateral block)'
);

-- 6-8. Audit evidence outlives the household: log, delete, re-read.
select tests.authenticate_as('d1000000-0000-0000-0000-000000000004');
select lives_ok(
  $$ select public.admin_log_action(
       'households.view',
       'd1000000-0000-0000-0000-000000000001',
       'evidence probe',
       null, null
     ) $$,
  'admin_log_action executes for the disjoint admin'
);
select tests.clear_auth();
-- Household hard-delete cascades to members (RLS/tests run privileged
-- here); the audit row must keep its target UUID, not null it.
select lives_ok(
  $$ delete from public.households where id = 'd1000000-0000-0000-0000-000000000001' $$,
  'household hard-delete succeeds (audit FK no longer blocks it)'
);
select results_eq(
  $$ select target_household::text from public.admin_audit_log where reason = 'evidence probe' $$,
  $$ values ('d1000000-0000-0000-0000-000000000001'::text) $$,
  'audit row preserves the deleted household id as evidence'
);

-- 9. admin_list_households returns the real grace_ends_at (follow-up
-- migration 20260930000001): a household in grace must not project null.
select tests.clear_auth();
do $$
declare
  hh_g       uuid := 'd1000000-0000-0000-0000-000000000010';
  member_g   uuid := 'd1000000-0000-0000-0000-000000000011';
  user_g     uuid := 'd1000000-0000-0000-0000-000000000012';
begin
  insert into auth.users (id, email) values (user_g, 'grace37@test.local');
  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_g, 'House G37', 'CL', 'CLP', 'America/Santiago');
  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (member_g, hh_g, user_g, 'owner', 'Owner G37');
  insert into public.subscriptions (household_id, plan_code, provider, status, grace_ends_at) values
    (hh_g, 'plus', 'stub', 'grace', now() + interval '7 days');
end
$$;
select tests.authenticate_as('d1000000-0000-0000-0000-000000000004');
select results_eq(
  $$ select grace_ends_at is not null from public.admin_list_households()
     where household_id = 'd1000000-0000-0000-0000-000000000010' $$,
  $$ values (true) $$,
  'admin_list_households returns grace_ends_at for a household in grace'
);

select tests.clear_auth();
-- Trigger grant posture (follow-up migration 20260930000001): the overlap
-- trigger must stay executable by authenticated (it fires on their member
-- writes — a bare REVOKE would break those with "permission denied for
-- function"), while anon holds no direct execute grant.
select ok(
  has_function_privilege('authenticated', 'public.tg_reject_admin_membership_overlap()', 'execute'),
  'overlap trigger executable by authenticated (member writes keep working)'
);
select ok(
  not has_function_privilege('anon', 'public.tg_reject_admin_membership_overlap()', 'execute'),
  'overlap trigger not directly executable by anon'
);
select * from finish();
