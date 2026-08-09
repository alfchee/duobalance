-- Issue #22: categories, categorization_rules + seeded defaults.
-- Covers:
--   * Seeded defaults on household creation (es/en/pt-BR counts)
--   * RLS visibility (members see own household's rows, anon/non-member see nothing)
--   * Partner role CRUD (AC #7)
--   * Case-insensitive uniqueness per (household, parent, kind)
--   * Max nesting depth (one level only, grandchildren rejected)
--   * Containment guards (parent_id, category_id same household)
--   * Delete-in-use protection (reassign to fallback category)
--   * Rule priority deterministic ordering (lowest priority wins, tie-break id)

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(39);

-- ============================================================================
-- Fixtures: three households (es, en, pt-BR locales). Trigger seeds defaults.
-- Users: owner (member of all 3), partner (member of hh_es only), non-member.
-- ============================================================================

do $$
declare
  usr_owner   uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  usr_partner uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  usr_other   uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
begin
  insert into auth.users (id, email) values
    (usr_owner,   'owner@test.local'),
    (usr_partner, 'partner@test.local'),
    (usr_other,   'other@test.local');

  insert into public.households (id, name, country, base_currency, locale) values
    ('11111111-1111-1111-1111-111111111111', 'House ES',    'NI', 'NIO', 'es'),
    ('22222222-2222-2222-2222-222222222222', 'House EN',    'US', 'USD', 'en'),
    ('33333333-3333-3333-3333-333333333333', 'House PT-BR', 'BR', 'BRL', 'pt-BR');

  insert into public.household_members (household_id, user_id, role, display_name) values
    ('11111111-1111-1111-1111-111111111111', usr_owner,   'owner',   'Owner ES'),
    ('11111111-1111-1111-1111-111111111111', usr_partner, 'partner', 'Partner ES'),
    ('22222222-2222-2222-2222-222222222222', usr_owner,   'owner',   'Owner EN'),
    ('33333333-3333-3333-3333-333333333333', usr_owner,   'owner',   'Owner PT');

  -- One account per household so containment test for categorization_rules.account_id.
  insert into public.accounts (household_id, name, kind, currency) values
    ('11111111-1111-1111-1111-111111111111', 'ES Account', 'checking', 'NIO'),
    ('22222222-2222-2222-2222-222222222222', 'EN Account', 'checking', 'USD');
end
$$;

-- ============================================================================
-- 1. Seeded defaults count per locale (13 expense + 4 income = 17 each) + locale-specific names
-- ============================================================================

select results_eq(
  $$ select count(*)::int from public.categories
     where household_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values (17::int) $$,
  'es household: 17 default categories seeded (13 expense + 4 income)'
);

select results_eq(
  $$ select count(*)::int from public.categories
     where household_id = '22222222-2222-2222-2222-222222222222' $$,
  $$ values (17::int) $$,
  'en household: 17 default categories seeded'
);

select results_eq(
  $$ select count(*)::int from public.categories
     where household_id = '33333333-3333-3333-3333-333333333333' $$,
  $$ values (17::int) $$,
  'pt-BR household: 17 default categories seeded'
);

select results_eq(
  $$ select count(*)::int from public.categories
     where household_id = '11111111-1111-1111-1111-111111111111'
       and kind = 'expense' and is_default $$,
  $$ values (13::int) $$,
  'es household: 13 expense defaults marked is_default'
);

select results_eq(
  $$ select count(*)::int from public.categories
     where household_id = '11111111-1111-1111-1111-111111111111'
       and kind = 'income' and is_default $$,
  $$ values (4::int) $$,
  'es household: 4 income defaults marked is_default'
);

-- Locale-specific spot-check a few names so we didn't seed the wrong set.
select ok(
  exists (
    select 1 from public.categories
    where household_id = '11111111-1111-1111-1111-111111111111'
      and name = 'Comida y Bebida' and kind = 'expense'
  ),
  'es: Comida y Bebida expense category present'
);

select ok(
  exists (
    select 1 from public.categories
    where household_id = '22222222-2222-2222-2222-222222222222'
      and name = 'Food & Drink' and kind = 'expense'
  ),
  'en: Food & Drink expense category present'
);

select ok(
  exists (
    select 1 from public.categories
    where household_id = '33333333-3333-3333-3333-333333333333'
      and name = 'Alimentação' and kind = 'expense'
  ),
  'pt-BR: Alimentação expense category present'
);

select ok(
  exists (
    select 1 from public.categories
    where household_id = '11111111-1111-1111-1111-111111111111'
      and name = 'Salario' and kind = 'income'
  ),
  'es: Salario income category present'
);

select ok(
  exists (
    select 1 from public.categories
    where household_id = '22222222-2222-2222-2222-222222222222'
      and name = 'Salary' and kind = 'income'
  ),
  'en: Salary income category present'
);

select ok(
  exists (
    select 1 from public.categories
    where household_id = '33333333-3333-3333-3333-333333333333'
      and name = 'Salário' and kind = 'income'
  ),
  'pt-BR: Salário income category present'
);

-- ============================================================================
-- 2. RLS + partner role (AC #7: partner can create categories and rules)
--    Run this section FIRST so the count assertions don't collide with later fixtures.
-- ============================================================================

-- Partner in hh_es only: sees exactly their household.
select tests.authenticate_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'partner@test.local');

select results_eq(
  $$ select count(*)::int from public.categories $$,
  $$ values (17::int) $$,
  'RLS: partner in 1 household sees exactly 17 categories (their household only)'
);

select is_empty(
  $$ select * from public.categories
     where household_id = '22222222-2222-2222-2222-222222222222' $$,
  'RLS: partner in hh_es cannot see hh_en categories'
);

-- Partner INSERT category.
select lives_ok(
  $$ insert into public.categories
       (household_id, name, kind, display_order)
     values
       ('11111111-1111-1111-1111-111111111111', 'Partner Made This', 'expense', 99) $$,
  'RLS: partner role can INSERT categories'
);

select results_eq(
  $$ select count(*)::int from public.categories
     where household_id = '11111111-1111-1111-1111-111111111111'
       and name = 'Partner Made This' $$,
  $$ values (1::int) $$,
  'RLS: partner INSERT actually persisted the row'
);

-- Partner UPDATE category.
select lives_ok(
  $$ update public.categories set display_order = 88
     where household_id = '11111111-1111-1111-1111-111111111111'
       and name = 'Partner Made This' $$,
  'RLS: partner role can UPDATE categories'
);

-- Partner INSERT categorization_rule.
select lives_ok(
  $$ insert into public.categorization_rules
       (household_id, match_pattern, category_id, priority)
     values (
       '11111111-1111-1111-1111-111111111111',
       '%PARTNER_TEST%',
       (select id from public.categories
         where household_id = '11111111-1111-1111-1111-111111111111'
           and name = 'Partner Made This'),
       10
     ) $$,
  'RLS: partner role can INSERT categorization_rules'
);

-- Partner DELETE category (and the rule above cascade-drops with it).
select lives_ok(
  $$ delete from public.categories
     where household_id = '11111111-1111-1111-1111-111111111111'
       and name = 'Partner Made This' $$,
  'RLS: partner role can DELETE categories (rules cascade)'
);

-- Non-member (usr_other) sees zero.
select tests.authenticate_as('cccccccc-cccc-cccc-cccc-cccccccccccc', 'other@test.local');

select results_eq(
  $$ select count(*)::int from public.categories $$,
  $$ values (0::int) $$,
  'RLS: non-member of any household sees 0 categories'
);

select is_empty(
  $$ select * from public.categorization_rules $$,
  'RLS: non-member sees 0 categorization_rules'
);

-- Unauthenticated (anon) also sees zero.
select tests.authenticate_anon();

select results_eq(
  $$ select count(*)::int from public.categories $$,
  $$ values (0::int) $$,
  'RLS: anon role sees 0 categories'
);

-- ============================================================================
-- 3. Uniqueness, containment, nesting: run as clear_auth so RLS doesn't interfere
-- ============================================================================

select tests.clear_auth();

-- Case-insensitive duplicate + same kind + same parent = 23505 unique_violation.
select lives_ok(
  $$ insert into public.categories
       (household_id, name, kind)
     values
       ('11111111-1111-1111-1111-111111111111', 'Custom Groceries', 'expense') $$,
  'custom expense insert: OK'
);

select throws_ok(
  $$ insert into public.categories
       (household_id, name, kind)
     values
       ('11111111-1111-1111-1111-111111111111', 'custom groceries', 'expense') $$,
  '23505',
  null,
  'case-insensitive same-name same-kind same-parent duplicate: rejected (23505 unique_violation)'
);

-- Same name DIFFERENT kind = allowed.
select lives_ok(
  $$ insert into public.categories
       (household_id, name, kind)
     values
       ('11111111-1111-1111-1111-111111111111', 'Regalos', 'income') $$,
  'same name different kind: allowed (income Regalos distinct from expense)'
);

-- color_hex: valid hex passes, invalid hex = 23514.
select lives_ok(
  $$ insert into public.categories
       (household_id, name, kind, color_hex)
     values
       ('11111111-1111-1111-1111-111111111111', 'Valid Color Check', 'expense', '#3B82F6') $$,
  'color_hex: valid 7-char hex passes check constraint'
);

select throws_ok(
  $$ insert into public.categories
       (household_id, name, kind, color_hex)
     values
       ('11111111-1111-1111-1111-111111111111', 'Invalid Color', 'expense', 'not-a-hex') $$,
  '23514',
  null,
  'color_hex: invalid value rejected (23514 check_violation)'
);

-- kind: invalid kind text = 23514.
select throws_ok(
  $$ insert into public.categories
       (household_id, name, kind)
     values
       ('11111111-1111-1111-1111-111111111111', 'Bad Kind', 'savings') $$,
  '23514',
  null,
  'kind: invalid enum-like text rejected by check (23514)'
);

-- is_default: custom rows = false, seeded rows = true.
select results_eq(
  $$ select is_default from public.categories
     where household_id = '11111111-1111-1111-1111-111111111111'
       and name = 'Custom Groceries' $$,
  $$ values (false) $$,
  'is_default: custom-inserted category is_default = false'
);

-- ============================================================================
-- 4. Max nesting depth: level 0 -> level 1 works; level 2 = 23514 check_violation
-- ============================================================================

-- Build a parent and child directly via SQL.
insert into public.categories (id, household_id, name, kind)
  values ('aaaa0001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Level Zero', 'expense');

insert into public.categories (id, household_id, parent_id, name, kind)
  values ('aaaa0002-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaa0001-0000-0000-0000-000000000001', 'Level One', 'expense');

select pass('nesting: parent->child (one level) allowed');

select throws_ok(
  $$ insert into public.categories
       (household_id, parent_id, name, kind)
     values (
       '11111111-1111-1111-1111-111111111111',
       'aaaa0002-0000-0000-0000-000000000002',
       'Level Two',
       'expense'
     ) $$,
  '23514',
  null,
  'nesting: grandchild rejected (23514 check_violation)'
);

select throws_ok(
  $$ update public.categories
       set parent_id = 'aaaa0002-0000-0000-0000-000000000002'
       where id = 'aaaa0001-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'nesting: parent-with-children cannot itself become child (23514)'
);

-- ============================================================================
-- 5. Containment guards: cross-household attach = 23514
-- ============================================================================

select throws_ok(
  $$ insert into public.categories
       (household_id, parent_id, name, kind)
     values (
       '11111111-1111-1111-1111-111111111111',
       (select id from public.categories
         where household_id = '22222222-2222-2222-2222-222222222222' limit 1),
       'Attached to EN parent',
       'expense'
     ) $$,
  '23514',
  null,
  'containment: parent_id from different household rejected (23514)'
);

select throws_ok(
  $$ insert into public.categorization_rules
       (household_id, match_pattern, category_id)
     values (
       '22222222-2222-2222-2222-222222222222',
       '%UBER%',
       (select id from public.categories
         where household_id = '11111111-1111-1111-1111-111111111111' limit 1)
     ) $$,
  '23514',
  null,
  'containment: categorization_rules.category_id cross-household rejected (23514)'
);

-- categorization_rules.account_id cross-household also rejected.
select throws_ok(
  $$ with hh_es_acc as (
       select id from public.accounts
       where household_id = '11111111-1111-1111-1111-111111111111' limit 1
     ),
     hh_en_cat as (
       select id from public.categories
       where household_id = '22222222-2222-2222-2222-222222222222' limit 1
     )
     insert into public.categorization_rules
       (household_id, match_pattern, category_id, account_id)
     values (
       '22222222-2222-2222-2222-222222222222',
       '%BLA',
       (select id from hh_en_cat),
       (select id from hh_es_acc)
     ) $$,
  '23514',
  null,
  'containment: categorization_rules.account_id cross-household rejected (23514)'
);

-- categorization_rules.match_pattern empty string (or NUL-byte pattern sane-check rejects).
select throws_ok(
  $$ insert into public.categorization_rules
       (household_id, match_pattern, category_id)
     values (
       '11111111-1111-1111-1111-111111111111',
       '',
       (select id from public.categories
         where household_id = '11111111-1111-1111-1111-111111111111' limit 1)
     ) $$,
  '23514',
  null,
  'match_pattern: empty string rejected by categorization_rules_match_pattern_sane (23514)'
);

-- ============================================================================
-- 6. Delete-in-use: transactions reassigned to fallback, or 2BP01 raised when no fallback
-- ============================================================================

do $$
declare
  hh     uuid := '11111111-1111-1111-1111-111111111111';
  acc    uuid;
  memb   uuid;
  comida uuid;
  otros  uuid;
begin
  insert into public.accounts (household_id, name, kind, currency)
    values (hh, 'Delete-In-Use Test Acc', 'checking', 'NIO') returning id into acc;

  memb := (select id from public.household_members where household_id = hh limit 1);

  select id into comida from public.categories
    where household_id = hh and name = 'Comida y Bebida';
  select id into otros  from public.categories
    where household_id = hh and name = 'Otros';

  insert into public.transactions
    (id, household_id, account_id, category_id, amount,
     currency, occurred_on, description, entered_by)
  values
    ('a9f6d5a5-4e6e-4d78-b2b1-7d2f9c4e6a9b',
     hh, acc, comida, -500, 'NIO', current_date, 'lunch', memb);
end $$;

select pass('delete-in-use fixture: transaction referencing Comida y Bebida created');

-- Now delete. Trigger reassigns to Otros.
delete from public.categories
  where household_id = '11111111-1111-1111-1111-111111111111'
    and name = 'Comida y Bebida';

select results_eq(
  $$ select c.name
     from public.transactions t
     join public.categories c on c.id = t.category_id
     where t.id = 'a9f6d5a5-4e6e-4d78-b2b1-7d2f9c4e6a9b' $$,
  $$ values ('Otros'::text) $$,
  'delete-in-use: transaction reassigned to Otros fallback category'
);

-- Delete-in-use WITHOUT any fallback in a fresh household that has had fallbacks renamed:
-- raises dependent_objects_still_exist = 2BP01.
do $$
declare
  hh     uuid := '44444444-4444-4444-4444-444444444444';
  usr    uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  memb   uuid;
  acc    uuid;
  comida uuid;
begin
  insert into auth.users (id, email) values
    (usr, 'no-fallback@test.local');

  insert into public.households (id, name, country, base_currency, locale)
    values (hh, 'House NoFB', 'MX', 'MXN', 'es');

  insert into public.household_members (household_id, user_id, role, display_name)
    values (hh, usr, 'owner', 'NoFB Owner') returning id into memb;

  -- Insert an account and a transaction referencing Comida y Bebida so the
  -- delete trigger has something to protect.
  insert into public.accounts (household_id, name, kind, currency)
    values (hh, 'NoFB Test Acc', 'checking', 'MXN') returning id into acc;

  select id into comida from public.categories
    where household_id = hh and name = 'Comida y Bebida';

  insert into public.transactions
    (id, household_id, account_id, category_id, amount,
     currency, occurred_on, description, entered_by)
  values
    ('e1f6d5a5-4e6e-4d78-b2b1-7d2f9c4e6a9b',
     hh, acc, comida, -200, 'MXN', current_date, 'no-fallback tx', memb);
end $$;

update public.categories set name = 'Renamed Otros No Longer Matches'
  where household_id = '44444444-4444-4444-4444-444444444444'
    and lower(name) in ('otros','others','outros');

select throws_ok(
  $$ delete from public.categories
     where household_id = '44444444-4444-4444-4444-444444444444'
       and name = 'Comida y Bebida' $$,
  '2BP01',
  null,
  'delete-in-use: no fallback category raises 2BP01 dependent_objects_still_exist'
);

-- ============================================================================
-- 7. Rule priority deterministic ordering (lowest first, tie-break id)
-- ============================================================================

insert into public.categorization_rules
  (id, household_id, match_pattern, category_id, priority)
values
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '%RULE_ORDER%',
    (select id from public.categories where household_id = '11111111-1111-1111-1111-111111111111' and kind = 'expense' order by id limit 1), 50),
  ('b2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '%RULE_ORDER%',
    (select id from public.categories where household_id = '11111111-1111-1111-1111-111111111111' and kind = 'expense' order by id offset 1 limit 1), 50),
  ('c3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '%RULE_ORDER%',
    (select id from public.categories where household_id = '11111111-1111-1111-1111-111111111111' and kind = 'expense' order by id offset 2 limit 1), 10);

select results_eq(
  $$ select id::text from public.categorization_rules
     where household_id = '11111111-1111-1111-1111-111111111111'
       and match_pattern = '%RULE_ORDER%' and is_active
     order by priority asc, id asc $$,
  $$ values
       ('c3333333-3333-3333-3333-333333333333'),
       ('a1111111-1111-1111-1111-111111111111'),
       ('b2222222-2222-2222-2222-222222222222') $$,
  'rule ordering: lowest priority first, tie-break by lowest id'
);

select * from finish();
rollback;
