-- Feedback submissions are persisted alongside email delivery and are
-- household-scoped. RLS must prevent cross-household reads while allowing
-- the submitting household to read and service_role to read all.

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
  fb_a uuid := 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  fb_b uuid := 'fbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
begin
  insert into auth.users (id, email) values
    (usr_a, 'alice@test.local'),
    (usr_b, 'bob@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'House A', 'CL', 'CLP', 'America/Santiago'),
    (hh_b, 'House B', 'BR', 'BRL', 'America/Sao_Paulo');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_a, usr_a, 'owner', 'Alice')
  returning id into mem_a;
  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_b, usr_b, 'owner', 'Bob')
  returning id into mem_b;

  -- Pre-insert feedback as Alice for House A and Bob for House B via service_role (bypass RLS) to set up read checks
  insert into public.feedback_submissions (id, household_id, user_id, member_id, category, message, diagnostics) values
    (fb_a, hh_a, usr_a, mem_a, 'problem_report', 'Alice feedback: button broke', '{"householdId":"11111111-1111-1111-1111-111111111111"}'::jsonb),
    (fb_b, hh_b, usr_b, mem_b, 'general', 'Bob feedback: great app', '{"householdId":"22222222-2222-2222-2222-222222222222"}'::jsonb);
end
$$;

select plan(13);

-- As Alice, can read her own household's feedback, cannot read Bob's
select tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@test.local');

select results_eq(
  $$ select count(*)::int from public.feedback_submissions $$,
  $$ values (1::int) $$,
  'Alice sees exactly one feedback (her household)'
);

select results_eq(
  $$ select message from public.feedback_submissions $$,
  $$ values ('Alice feedback: button broke'::text) $$,
  'Alice sees her own message'
);

select is_empty(
  $$ select * from public.feedback_submissions where household_id = '22222222-2222-2222-2222-222222222222'::uuid $$,
  'Alice cannot see Bob household feedback'
);

-- Alice can insert for her own household
select lives_ok(
  $$ insert into public.feedback_submissions (household_id, user_id, member_id, category, message, diagnostics)
     values (
       '11111111-1111-1111-1111-111111111111'::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       (select id from public.household_members where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' limit 1),
       'satisfaction_prompt', 'Another Alice feedback', '{}'::jsonb
     ) $$,
  'Alice can INSERT feedback for her own household'
);

-- Alice cannot insert for Bob's household (is_member check fails)
select throws_ok(
  $$ insert into public.feedback_submissions (household_id, user_id, category, message, diagnostics)
     values (
       '22222222-2222-2222-2222-222222222222'::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       'general', 'Sneak into Bob', '{}'::jsonb
     ) $$,
  '42501',
  null,
  'Alice cannot INSERT feedback for Bob household (WITH CHECK fails)'
);

-- As Bob, symmetric
select tests.authenticate_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@test.local');

select results_eq(
  $$ select count(*)::int from public.feedback_submissions $$,
  $$ values (1::int) $$,
  'Bob sees exactly one feedback (his household)'
);

select is_empty(
  $$ select * from public.feedback_submissions where message = 'Alice feedback: button broke' $$,
  'Bob cannot see Alice feedback'
);

-- Bob with household_id null (no household) can insert and read own
select tests.authenticate_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@test.local');
select lives_ok(
  $$ insert into public.feedback_submissions (household_id, user_id, category, message, diagnostics)
     values (null, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'general', 'Bob no-household feedback', '{}'::jsonb) $$,
  'Bob can INSERT feedback with null household_id'
);

select results_eq(
  $$ select count(*)::int from public.feedback_submissions where household_id is null and user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid $$,
  $$ values (1::int) $$,
  'Bob sees his null-household feedback'
);

select tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@test.local');
select is_empty(
  $$ select * from public.feedback_submissions where household_id is null and user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid $$,
  'Alice cannot see Bob null-household feedback'
);

-- Update/delete are denied for authenticated (history, only service_role can modify)
select tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@test.local');
select throws_ok(
  $$ update public.feedback_submissions set message = 'pwned' where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  '42501',
  null,
  'Alice cannot UPDATE feedback (no policy)'
);
select throws_ok(
  $$ delete from public.feedback_submissions where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  '42501',
  null,
  'Alice cannot DELETE feedback (no policy)'
);

-- Anon cannot read
select tests.authenticate_anon();

select is_empty(
  $$ select * from public.feedback_submissions $$,
  'Anon sees no feedback'
);

select * from finish();
rollback;
