\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_a uuid := 'e0000000-0000-0000-0000-00000000000a';
  hh_b uuid := 'f0000000-0000-0000-0000-00000000000b';
  alice_user uuid := 'e1000000-0000-0000-0000-000000000001';
  bob_user uuid := 'e1000000-0000-0000-0000-000000000002';
  carol_user uuid := 'f1000000-0000-0000-0000-000000000001';
  alice_member uuid := 'e2000000-0000-0000-0000-000000000001';
  bob_member uuid := 'e2000000-0000-0000-0000-000000000002';
  carol_member uuid := 'f2000000-0000-0000-0000-000000000001';
begin
  insert into auth.users (id, email) values
    (alice_user, 'alice26@test.local'),
    (bob_user, 'bob26@test.local'),
    (carol_user, 'carol26@test.local');
  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'Transfers A', 'NI', 'USD', 'America/Managua'),
    (hh_b, 'Transfers B', 'CL', 'CLP', 'America/Santiago');
  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (alice_member, hh_a, alice_user, 'owner', 'Alice'),
    (bob_member, hh_a, bob_user, 'partner', 'Bob'),
    (carol_member, hh_b, carol_user, 'owner', 'Carol');
  insert into public.accounts
    (id, household_id, name, kind, currency, opening_balance, balance_mode, manual_balance, is_shared, owner_member_id)
  values
    ('e3000000-0000-0000-0000-000000000001', hh_a, 'USD ledger', 'checking', 'USD', 100, 'ledger', null, true, null),
    ('e3000000-0000-0000-0000-000000000002', hh_a, 'NIO ledger', 'savings', 'NIO', 200, 'ledger', null, true, null),
    ('e3000000-0000-0000-0000-000000000003', hh_a, 'Manual', 'cash', 'USD', 0, 'manual', 77, true, null),
    ('e3000000-0000-0000-0000-000000000004', hh_a, 'Alice private', 'cash', 'USD', 0, 'ledger', null, false, alice_member),
    ('f3000000-0000-0000-0000-000000000001', hh_b, 'Other household', 'checking', 'CLP', 0, 'ledger', null, true, null);
end
$$;

select plan(12);

select tests.authenticate_as('e1000000-0000-0000-0000-000000000001');

select ok(
  public.create_transfer(
    'e0000000-0000-0000-0000-00000000000a',
    'e3000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000002',
    10, 360, 1, 0.0277777778, current_date, 'USD to NIO'
  ) is not null,
  'create_transfer returns a group id'
);

select results_eq(
  $$ select account_id, amount, fx_rate, currency from public.transactions
     where transfer_group_id is not null order by amount $$,
  $$ values
       ('e3000000-0000-0000-0000-000000000001'::uuid, -10::numeric, 1::numeric, 'USD'::text),
       ('e3000000-0000-0000-0000-000000000002'::uuid, 360::numeric, 0.0277777778::numeric, 'NIO'::text) $$,
  'cross-currency transfer records independent amounts and rates'
);

select results_eq(
  $$ select account_id, balance from public.account_balances
     where household_id = 'e0000000-0000-0000-0000-00000000000a'::uuid order by account_id $$,
  $$ values
       ('e3000000-0000-0000-0000-000000000001'::uuid, 90::numeric),
       ('e3000000-0000-0000-0000-000000000002'::uuid, 560::numeric),
       ('e3000000-0000-0000-0000-000000000003'::uuid, 77::numeric),
       ('e3000000-0000-0000-0000-000000000004'::uuid, 0::numeric) $$,
  'ledger includes transfers and manual balance ignores transactions'
);

select results_eq(
  $$ select count(*) from public.transactions where transfer_group_id is not null $$,
  $$ values (2::bigint) $$,
  'both transfer legs exist'
);

select throws_ok(
  $$ update public.transactions set description = 'edited'
     where transfer_group_id is not null $$,
  '23514',
  'transfers must be deleted and recreated',
  'transfer legs cannot be edited independently'
);

delete from public.transactions
where account_id = 'e3000000-0000-0000-0000-000000000001'::uuid
  and transfer_group_id is not null;

select is_empty(
  $$ select * from public.transactions where transfer_group_id is not null $$,
  'deleting either transfer leg deletes the group'
);

select throws_ok(
  $$ select public.create_transfer(
       'e0000000-0000-0000-0000-00000000000a',
       'e3000000-0000-0000-0000-000000000001',
       'f3000000-0000-0000-0000-000000000001',
       1, 1, 1, 1, current_date, 'invalid') $$,
  null,
  null,
  'a failing second leg leaves no partial transfer'
);

select is_empty(
  $$ select * from public.transactions where description = 'invalid' $$,
  'failed transfer has no persisted first leg'
);

select ok(
  public.create_transfer(
    'e0000000-0000-0000-0000-00000000000a',
    'e3000000-0000-0000-0000-000000000004',
    'e3000000-0000-0000-0000-000000000001',
    5, 5, 1, 1, current_date, 'private to shared'
  ) is not null,
  'owner can create a private-to-shared transfer'
);

select tests.authenticate_as('e1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$ delete from public.transactions
     where account_id = 'e3000000-0000-0000-0000-000000000001'::uuid
       and description = 'private to shared' $$,
  '42501',
  'cannot delete a transfer with an inaccessible account',
  'partner cannot delete a shared transfer leg when its counterpart is private'
);

select tests.clear_auth();

select results_eq(
  $$ select count(*) from public.transactions where description = 'private to shared' $$,
  $$ values (2::bigint) $$,
  'denied deletion preserves both transfer legs'
);

select tests.authenticate_as('f1000000-0000-0000-0000-000000000001');

select is_empty(
  $$ select * from public.account_balances
     where household_id = 'e0000000-0000-0000-0000-00000000000a'::uuid $$,
  'security invoker view exposes no cross-household balances'
);

select * from finish();
rollback;
