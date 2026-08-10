\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(24);

do $$
declare
  household_a uuid := 'f0000000-0000-0000-0000-000000000001';
  household_b uuid := 'f0000000-0000-0000-0000-000000000002';
  owner_user uuid := 'f1000000-0000-0000-0000-000000000001';
  partner_user uuid := 'f1000000-0000-0000-0000-000000000002';
  other_user uuid := 'f1000000-0000-0000-0000-000000000003';
  owner_member uuid := 'f2000000-0000-0000-0000-000000000001';
  partner_member uuid := 'f2000000-0000-0000-0000-000000000002';
  other_member uuid := 'f2000000-0000-0000-0000-000000000003';
begin
  insert into auth.users (id, email) values
    (owner_user, 'owner32@test.local'),
    (partner_user, 'partner32@test.local'),
    (other_user, 'other32@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (household_a, 'Managua household', 'NI', 'USD', 'America/Managua'),
    (household_b, 'Other household', 'US', 'USD', 'America/New_York');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_member, household_a, owner_user, 'owner', 'Owner'),
    (partner_member, household_a, partner_user, 'partner', 'Partner'),
    (other_member, household_b, other_user, 'owner', 'Other');

  insert into public.accounts (id, household_id, name, kind, currency) values
    ('f3000000-0000-0000-0000-000000000001', household_a, 'Account A', 'checking', 'USD'),
    ('f3000000-0000-0000-0000-000000000002', household_b, 'Account B', 'checking', 'USD');

  insert into public.categories (id, household_id, name) values
    ('f4000000-0000-0000-0000-000000000001', household_a, 'Category A'),
    ('f4000000-0000-0000-0000-000000000002', household_b, 'Category B');
end
$$;

select tests.authenticate_as('f1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ insert into public.bills (id, household_id, name, category_id, account_id, default_amount, currency, rrule, starts_on)
     values ('f5000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Rent',
             'f4000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 1000,
             'USD', 'FREQ=MONTHLY;BYMONTHDAY=6', '2026-01-06') $$,
  'valid bill template is accepted'
);

select lives_ok(
  $$ insert into public.bills (household_id, name, currency, rrule, starts_on)
     values ('f0000000-0000-0000-0000-000000000001', 'Variable bill', 'USD', 'FREQ=MONTHLY', '2026-01-01') $$,
  'bill allows nullable default amount and account'
);

select throws_ok(
  $$ insert into public.bills (household_id, name, currency, rrule, starts_on, reminder_days_before)
     values ('f0000000-0000-0000-0000-000000000001', 'Invalid reminder', 'USD', 'FREQ=MONTHLY', '2026-01-01', 31) $$,
  '23514', null, 'reminder days above 30 is rejected'
);

select throws_ok(
  $$ insert into public.bills (household_id, name, currency, rrule, starts_on, ends_on)
     values ('f0000000-0000-0000-0000-000000000001', 'Invalid dates', 'USD', 'FREQ=MONTHLY', '2026-02-01', '2026-01-01') $$,
  '23514', null, 'bill end date before start date is rejected'
);

select lives_ok(
  $$ insert into public.bill_instances (id, household_id, bill_id, due_on, amount)
     values ('f6000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
             'f5000000-0000-0000-0000-000000000001', current_date - 2, 1000) $$,
  'valid due instance is accepted'
);

select throws_ok(
  $$ insert into public.bill_instances (household_id, bill_id, due_on, amount)
     values ('f0000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', current_date - 2, 1000) $$,
  '23505', null, 'duplicate bill instance due date is rejected'
);

select throws_ok(
  $$ insert into public.bill_instances (household_id, bill_id, due_on, amount)
     values ('f0000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', current_date + 1, 0) $$,
  '23514', null, 'non-positive bill instance amount is rejected'
);

select throws_ok(
  $$ insert into public.bill_instances (household_id, bill_id, due_on, amount, paid_on)
     values ('f0000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', current_date + 2, 1000, current_date) $$,
  '23514', null, 'paid date is rejected unless status is paid'
);

select throws_ok(
  $$ insert into public.bill_instances (household_id, bill_id, due_on, amount, paid_by_member_id)
     values ('f0000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', current_date + 3, 1000,
             'f2000000-0000-0000-0000-000000000001') $$,
  '23514', null, 'paid by member is rejected unless status is paid'
);

select results_eq(
  $$ select effective_status from public.bill_instances_view
     where id = 'f6000000-0000-0000-0000-000000000001' $$,
  $$ values ('overdue'::text) $$,
  'past-due instance in Managua is derived as overdue'
);

select lives_ok(
  $$ insert into public.bill_instances (id, household_id, bill_id, due_on, amount, status, paid_on, paid_by_member_id)
     values ('f6000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001',
             'f5000000-0000-0000-0000-000000000001', current_date - 3, 1000, 'paid', current_date,
             'f2000000-0000-0000-0000-000000000001') $$,
  'paid instance is accepted'
);

select lives_ok(
  $$ insert into public.bill_instances (household_id, bill_id, due_on, amount, status)
     values ('f0000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', current_date - 4, 1000, 'paid') $$,
  'legacy-compatible paid instance without payment attribution is accepted'
);

select results_eq(
  $$ select effective_status from public.bill_instances_view
     where id = 'f6000000-0000-0000-0000-000000000002' $$,
  $$ values ('paid'::text) $$,
  'paid instance is never derived as overdue'
);

select tests.clear_auth();

insert into public.transactions
  (id, household_id, account_id, amount, currency, occurred_on, description, entered_by)
values
  ('f7000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
   'f3000000-0000-0000-0000-000000000001', -1, 'USD', current_date, 'Transaction A',
   'f2000000-0000-0000-0000-000000000001'),
  ('f7000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002',
   'f3000000-0000-0000-0000-000000000002', -1, 'USD', current_date, 'Transaction B',
   'f2000000-0000-0000-0000-000000000003');

select throws_ok(
  $$ insert into public.bills (household_id, name, currency, rrule, starts_on, responsible_member_id)
     values ('f0000000-0000-0000-0000-000000000001', 'Bad member', 'USD', 'FREQ=MONTHLY', current_date,
             'f2000000-0000-0000-0000-000000000003') $$,
  null, null, 'bill responsible member must belong to the household'
);

select throws_ok(
  $$ insert into public.bills (household_id, name, currency, rrule, starts_on, category_id)
     values ('f0000000-0000-0000-0000-000000000001', 'Bad category', 'USD', 'FREQ=MONTHLY', current_date,
             'f4000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'bill category must belong to the household'
);

select throws_ok(
  $$ insert into public.bills (household_id, name, currency, rrule, starts_on, account_id)
     values ('f0000000-0000-0000-0000-000000000001', 'Bad account', 'USD', 'FREQ=MONTHLY', current_date,
             'f3000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'bill account must belong to the household'
);

select throws_ok(
  $$ insert into public.bill_instances (household_id, bill_id, due_on, amount)
     values ('f0000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000001', current_date, 1) $$,
  '23514', null, 'bill instance bill must belong to the household'
);

select throws_ok(
  $$ insert into public.bill_instances (household_id, bill_id, due_on, amount, status, paid_on, paid_by_member_id)
     values ('f0000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', current_date + 4, 1,
             'paid', current_date, 'f2000000-0000-0000-0000-000000000003') $$,
  null, null, 'bill instance paid by member must belong to the household'
);

select throws_ok(
  $$ insert into public.bill_instances (household_id, bill_id, due_on, amount, paid_transaction_id)
     values ('f0000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', current_date + 5, 1,
             'f7000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'bill instance payment transaction must belong to the household'
);

select tests.authenticate_as('f1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$ insert into public.bills (id, household_id, name, currency, rrule, starts_on)
     values ('f5000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'Partner bill', 'USD', 'FREQ=MONTHLY', current_date) $$,
  'partner can insert a bill'
);

select lives_ok(
  $$ update public.bill_instances
     set status = 'paid', paid_on = current_date, paid_by_member_id = 'f2000000-0000-0000-0000-000000000002'
     where id = 'f6000000-0000-0000-0000-000000000001' $$,
  'partner can mark a bill instance paid and receive credit'
);

select tests.authenticate_as('f1000000-0000-0000-0000-000000000003');

select is_empty(
  $$ select * from public.bills where household_id = 'f0000000-0000-0000-0000-000000000001' $$,
  'non-member sees no bills'
);

select is_empty(
  $$ select * from public.bill_instances where household_id = 'f0000000-0000-0000-0000-000000000001' $$,
  'non-member sees no bill instances'
);

select is_empty(
  $$ select * from public.bill_instances_view where household_id = 'f0000000-0000-0000-0000-000000000001' $$,
  'security invoker view returns no cross-household rows'
);

select * from finish();
rollback;
