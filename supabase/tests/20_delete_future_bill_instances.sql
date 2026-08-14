\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(11);

do $$
declare
  household_id uuid := 'a0000000-0000-0000-0000-000000000001';
  owner_user_id uuid := 'a1000000-0000-0000-0000-000000000001';
  partner_user_id uuid := 'a1000000-0000-0000-0000-000000000002';
  owner_member_id uuid := 'a2000000-0000-0000-0000-000000000001';
  partner_member_id uuid := 'a2000000-0000-0000-0000-000000000002';
  bill_id uuid := 'a5000000-0000-0000-0000-000000000001';
begin
  insert into auth.users (id, email) values
    (owner_user_id, 'owner35@test.local'),
    (partner_user_id, 'partner35@test.local');
  insert into public.households (id, name, country, base_currency, timezone) values
    (household_id, 'Deletion test', 'NI', 'USD', 'America/Managua');
  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_member_id, household_id, owner_user_id, 'owner', 'Owner'),
    (partner_member_id, household_id, partner_user_id, 'partner', 'Partner');
  insert into public.bills (id, household_id, name, currency, rrule, starts_on) values
    (bill_id, household_id, 'Internet', 'USD', 'FREQ=MONTHLY', current_date);
  insert into public.bill_instances (id, household_id, bill_id, due_on, amount, status) values
    ('a6000000-0000-0000-0000-000000000001', household_id, bill_id, current_date + 1, 45, 'due'),
    ('a6000000-0000-0000-0000-000000000002', household_id, bill_id, current_date - 1, 45, 'due'),
    ('a6000000-0000-0000-0000-000000000003', household_id, bill_id, current_date + 2, 45, 'paid');
end
$$;

select has_table('public', 'bill_instance_deletions', 'deleted bill instances are retained as tombstones');
select has_function('public', 'delete_future_bill_instance', 'future instance deletion RPC exists');

select tests.authenticate_as('a1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$ select public.delete_future_bill_instance('a6000000-0000-0000-0000-000000000001') $$,
  'a household member can delete a future due instance'
);

select is_empty(
  $$ select * from public.bill_instances where id = 'a6000000-0000-0000-0000-000000000001' $$,
  'the future instance is permanently removed'
);

select tests.clear_auth();

select results_eq(
  $$ select bill_id, due_on from public.bill_instance_deletions $$,
  $$ values ('a5000000-0000-0000-0000-000000000001'::uuid, current_date + 1) $$,
  'the deleted due date is retained to prevent recurrence regeneration'
);

select tests.authenticate_as('a1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$ select public.delete_future_bill_instance('a6000000-0000-0000-0000-000000000002') $$,
  '23514', 'only future bill instances can be deleted',
  'a past-due instance cannot be permanently deleted'
);

select throws_ok(
  $$ select public.delete_future_bill_instance('a6000000-0000-0000-0000-000000000003') $$,
  '23514', 'only due bill instances can be deleted',
  'a paid instance cannot be permanently deleted'
);

select tests.authenticate_anon();

select throws_ok(
  $$ select * from public.bill_instance_deletions $$,
  '42501', null,
  'anonymous users cannot read deleted instance tombstones'
);

select throws_ok(
  $$ select public.delete_future_bill_instance('a6000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'anonymous users cannot call the deletion RPC'
);

select tests.clear_auth();

do $$
declare
  other_household_id uuid := 'b0000000-0000-0000-0000-000000000001';
  other_user_id uuid := 'b1000000-0000-0000-0000-000000000001';
  other_member_id uuid := 'b2000000-0000-0000-0000-000000000001';
begin
  insert into auth.users (id, email) values (other_user_id, 'other35@test.local');
  insert into public.households (id, name, country, base_currency, timezone) values
    (other_household_id, 'Other household', 'NI', 'USD', 'America/Managua');
  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (other_member_id, other_household_id, other_user_id, 'owner', 'Other owner');
end
$$;

select tests.authenticate_as('b1000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ select public.delete_future_bill_instance('a6000000-0000-0000-0000-000000000002') $$,
  'P0002', 'bill instance not found',
  'a member of another household cannot delete an instance'
);

select tests.authenticate_as('a1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$ insert into public.bill_instance_deletions (bill_id, household_id, due_on)
     values ('a5000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', current_date + 3) $$,
  '42501', null,
  'members cannot create tombstones outside the guarded RPC'
);

select * from finish();
rollback;
