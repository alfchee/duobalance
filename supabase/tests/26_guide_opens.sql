-- Guide opens are analytics events per #200, used as optional funnel milestone for #167.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_a uuid := '11111111-1111-1111-1111-111111111111';
  hh_b uuid := '22222222-2222-2222-2222-222222222222';
  usr_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  usr_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  mem_a uuid;
  mem_b uuid;
  go_a uuid := 'aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  go_b uuid := 'bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
begin
  insert into auth.users (id, email) values
    (usr_a, 'alice@test.local'),
    (usr_b, 'bob@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'House A', 'NI', 'NIO', 'America/Managua'),
    (hh_b, 'House B', 'BR', 'BRL', 'America/Sao_Paulo');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_a, usr_a, 'owner', 'Alice')
  returning id into mem_a;
  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_b, usr_b, 'owner', 'Bob')
  returning id into mem_b;

  insert into public.guide_opens (id, household_id, user_id, member_id, slug, anchor, source) values
    (go_a, hh_a, usr_a, mem_a, 'recording-transaction-fast', 'quick-entry-workflow', 'balances-empty'),
    (go_b, hh_b, usr_b, mem_b, 'household-vs-personal-budgets', 'household-budgets', 'budget-empty');
end
$$;

select plan(13);

-- As Alice, can read her household guide opens, not Bob's
select tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@test.local');

select results_eq(
  $$ select count(*)::int from public.guide_opens $$,
  $$ values (1::int) $$,
  'Alice sees exactly one guide open (her household)'
);

select results_eq(
  $$ select slug from public.guide_opens $$,
  $$ values ('recording-transaction-fast'::text) $$,
  'Alice sees her own slug'
);

select is_empty(
  $$ select * from public.guide_opens where household_id = '22222222-2222-2222-2222-222222222222'::uuid $$,
  'Alice cannot see Bob household guide opens'
);

-- Alice can insert for her own household
select lives_ok(
  $$ insert into public.guide_opens (household_id, user_id, member_id, slug, anchor, source)
     values (
       '11111111-1111-1111-1111-111111111111'::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       (select id from public.household_members where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' limit 1),
       'getting-started-creating-household', 'initial-setup', 'first-run'
     ) $$,
  'Alice can INSERT guide open for her own household'
);

-- Alice cannot insert for Bob's household
select throws_ok(
  $$ insert into public.guide_opens (household_id, user_id, slug)
     values (
       '22222222-2222-2222-2222-222222222222'::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       'recording-transaction-fast'
     ) $$,
  '42501',
  null,
  'Alice cannot INSERT guide open for Bob household'
);

-- As Bob
select tests.authenticate_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@test.local');

select results_eq(
  $$ select count(*)::int from public.guide_opens $$,
  $$ values (1::int) $$,
  'Bob sees exactly one guide open'
);

select is_empty(
  $$ select * from public.guide_opens where slug = 'recording-transaction-fast' $$,
  'Bob cannot see Alice guide open'
);

-- Bob with null household can insert/read own
select lives_ok(
  $$ insert into public.guide_opens (household_id, user_id, slug)
     values (null, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'recording-transaction-fast') $$,
  'Bob can INSERT guide open with null household_id'
);

select results_eq(
  $$ select count(*)::int from public.guide_opens where household_id is null and user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid $$,
  $$ values (1::int) $$,
  'Bob sees his null-household guide open'
);

select tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@test.local');
select is_empty(
  $$ select * from public.guide_opens where household_id is null and user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid $$,
  'Alice cannot see Bob null-household guide open'
);

-- Update/delete denied
select throws_ok(
  $$ update public.guide_opens set slug = 'pwned' where id = 'aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  '42501',
  null,
  'Alice cannot UPDATE guide opens'
);
select throws_ok(
  $$ delete from public.guide_opens where id = 'aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  '42501',
  null,
  'Alice cannot DELETE guide opens'
);

-- Anon cannot read
select tests.authenticate_anon();
select is_empty(
  $$ select * from public.guide_opens $$,
  'Anon sees no guide opens'
);

select * from finish();
rollback;
