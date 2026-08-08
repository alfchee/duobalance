-- Issue #22: categories, categorization_rules + country-seeded defaults.
-- Tables and RLS already exist in migrations 04 and 11; this migration
-- refines the schema to match the #22 spec, adds containment guards,
-- validation triggers, and locale-aware seeded defaults on household creation.

-- ============================================================================
-- 1. categories: align columns with #22 spec
-- ============================================================================

-- Rename color -> color_hex (issue spec uses color_hex, not color).
alter table public.categories
  rename column color to color_hex;

-- kind: expense vs income — every category is explicitly typed.
-- Existing rows are all implicitly expense; default them so the not-null
-- constraint applies cleanly. Default is RETAINED so existing callers and
-- older test fixtures that omit `kind` continue to work without cascading edits.
alter table public.categories
  add column kind text not null default 'expense'
    check (kind in ('expense', 'income'));

-- is_default: marks rows seeded on household creation so the UI knows
-- which rows are safe to auto-hide when empty.
alter table public.categories
  add column is_default boolean not null default false;

-- display_order: smallint keeps the sort order deterministic per household.
alter table public.categories
  add column display_order smallint not null default 0;

-- updated_at: mirror every other household-scoped table.
alter table public.categories
  add column updated_at timestamptz not null default now();

-- Drop the old unique constraint that did not include `kind` or case-insensitivity.
-- The constraint name in Postgres is generated as <table>_<cols>_key, so
-- categories_household_id_parent_id_name_key. If the name differs in an
-- edge case, we catch it by CASCADE and rebuild below.
do $$
begin
  alter table public.categories
    drop constraint if exists categories_household_id_parent_id_name_key cascade;
end $$;

-- The old constraint was case-SENSITIVE, so two rows differing only by case
-- (e.g. 'Otros' and 'otros') were legal siblings before this migration. The
-- new case-insensitive index below would fail to create outright on any
-- database carrying such a pair. Merge each duplicate group onto the
-- earliest-created row first, repointing every FK reference (and any
-- children's parent_id) before dropping the extras.
--
-- Dedupe groups by NULL parent_id first: "is not distinct from NULL" is the
-- same behavior the final UNIQUE NULLS NOT DISTINCT index will enforce — we
-- build the same grouping here so the merge resolves every collision before
-- the CREATE UNIQUE INDEX runs.
do $$
declare
  grp     record;
  keep_id uuid;
  dup_id  uuid;
begin
  for grp in
    select household_id,
           parent_id,
           kind,
           lower(name) as lname
    from public.categories
    group by household_id, parent_id, kind, lname
    having count(*) > 1
  loop
    select id into keep_id
      from public.categories
      where household_id = grp.household_id
        and (parent_id is not distinct from grp.parent_id)
        and kind = grp.kind
        and lower(name) = grp.lname
      order by created_at asc, id asc
      limit 1;

    for dup_id in
      select id from public.categories
      where household_id = grp.household_id
        and (parent_id is not distinct from grp.parent_id)
        and kind = grp.kind
        and lower(name) = grp.lname
        and id <> keep_id
    loop
      update public.categorization_rules set category_id = keep_id where category_id = dup_id;
      update public.transactions       set category_id = keep_id where category_id = dup_id;
      update public.budgets            set category_id = keep_id where category_id = dup_id;
      update public.bills              set category_id = keep_id where category_id = dup_id;
      update public.categories         set parent_id   = keep_id where parent_id   = dup_id;
      delete from public.categories where id = dup_id;
    end loop;
  end loop;
end $$;

-- Case-insensitive + kind-aware uniqueness. NULL parent_id treats root-level
-- rows as siblings (Postgres 15+ UNIQUE ... NULLS NOT DISTINCT) so there's no
-- need for a sentinel coalesce() value that could collide with legitimate
-- category UUIDs. `lower(name)` makes the 'Comida' vs 'comida' check explicit.
create unique index categories_uniq_household_parent_kind_name
  on public.categories (
    household_id,
    parent_id,
    kind,
    lower(name)
  )
  nulls not distinct;

-- ============================================================================
-- 2. categorization_rules: align columns with #22 spec
-- ============================================================================

-- pattern -> match_pattern (issue spec uses match_pattern, clarifies ILIKE).
alter table public.categorization_rules
  rename column pattern to match_pattern;

-- match_pattern sanity: must be non-empty and a "sane" ILIKE pattern.
-- Wildcard-only patterns (any combination of the ILIKE metacharacters % and _
-- with nothing else, e.g. '%', '%%', '_%_') are explicitly banned — a
-- match-everything rule is almost always a misclick, and when genuinely
-- wanted should be requested via a sentinel/flag rather than silently
-- inserted through the pattern field. ASCII NUL is banned because
-- match_pattern is text.
alter table public.categorization_rules
  add constraint categorization_rules_match_pattern_sane
  check (
    char_length(match_pattern) between 1 and 200
    and match_pattern !~ '\x00'
    and char_length(btrim(match_pattern, '%_')) > 0
  );

-- updated_at.
alter table public.categorization_rules
  add column updated_at timestamptz not null default now();

-- Replace the old non-partial index with a partial index that only covers
-- active rules — that's the hot path for auto-categorization, and the
-- planner will skip the partial index entirely when is_active is false.
-- Include `id` as a tie-breaker so ordering is deterministic when two
-- rules share the same priority (lowest priority wins, then lowest id).
drop index if exists public.categorization_rules_household_idx;
create index categorization_rules_household_priority_idx
  on public.categorization_rules (household_id, priority, id)
  where is_active;

-- ============================================================================
-- 3. updated_at triggers (migrations 11's tg_set_updated_at is reused)
-- ============================================================================

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.tg_set_updated_at();

create trigger categorization_rules_set_updated_at
  before update on public.categorization_rules
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- 4. Containment guards
--    categories.parent_id and categorization_rules.category_id must both
--    point at rows of the SAME household as the referencing row.
-- ============================================================================

-- Shared "same household" assertion. The lookups that produce
-- p_actual_household_id must run SECURITY DEFINER (see below) — under the
-- caller's own RLS, a lookup of a row in ANOTHER household returns no rows
-- (NULL) rather than a mismatched household_id, which would make the plain
-- `<>` comparison silently pass instead of raising.
create or replace function public.assert_same_household(
  p_actual_household_id uuid, p_expected_household_id uuid, p_error_msg text
) returns void
language plpgsql
as $$
begin
  if p_actual_household_id is null or p_actual_household_id <> p_expected_household_id then
    raise exception '%', p_error_msg using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.tg_categories_containment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_id is not null then
    perform public.assert_same_household(
      (select household_id from public.categories where id = new.parent_id),
      new.household_id,
      'categories.parent_id must belong to the same household'
    );
  end if;
  return new;
end;
$$;

create trigger categories_containment
  before insert or update of parent_id, household_id on public.categories
  for each row execute function public.tg_categories_containment();

create or replace function public.tg_categorization_rules_containment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_same_household(
    (select household_id from public.categories where id = new.category_id),
    new.household_id,
    'categorization_rules.category_id must belong to the same household'
  );

  -- account_id, if set, must also be same-household.
  if new.account_id is not null then
    perform public.assert_same_household(
      (select household_id from public.accounts where id = new.account_id),
      new.household_id,
      'categorization_rules.account_id must belong to the same household'
    );
  end if;

  return new;
end;
$$;

create trigger categorization_rules_containment
  before insert or update of category_id, account_id, household_id
  on public.categorization_rules
  for each row execute function public.tg_categorization_rules_containment();

-- ============================================================================
-- 5. One level of nesting only. A category whose parent_id is set cannot
--    itself be referenced by another category's parent_id. Enforcement via
--    trigger is cheaper than a recursive CTE in a check constraint, and
--    we can fail early with a clear message.
-- ============================================================================

create or replace function public.tg_categories_max_depth()
returns trigger
language plpgsql
as $$
begin
  -- A category cannot be its own parent (would defeat the max-depth check
  -- below, since a self-referencing leaf has no parent_id/children yet).
  if new.parent_id is not null and new.parent_id = new.id then
    raise exception 'a category cannot be its own parent'
      using errcode = 'check_violation';
  end if;

  -- Setting parent_id to a row that already has a parent_id -> reject.
  if new.parent_id is not null then
    if exists (
      select 1 from public.categories
      where id = new.parent_id and parent_id is not null
    ) then
      raise exception 'categories support at most one level of nesting (grandchildren rejected)'
        using errcode = 'check_violation';
    end if;
  end if;

  -- If this row already has children, setting its own parent_id -> reject.
  if tg_op = 'UPDATE' and new.parent_id is not null then
    if exists (
      select 1 from public.categories
      where parent_id = new.id
    ) then
      raise exception 'categories support at most one level of nesting (a parent cannot become a child)'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger categories_max_depth
  before insert or update of parent_id on public.categories
  for each row execute function public.tg_categories_max_depth();

-- ============================================================================
-- 6. Deleting a category in use: do NOT cascade-delete or silently NULL
--    dependents. Budgets/bills block the delete outright (no sensible
--    fallback). Transactions get reassigned to the household's fallback
--    category of the matching kind ("Otros"/"Others"/"Outros"/"Other" for
--    expense, "Otros Ingresos"/"Other Income"/"Outras Receitas" for income),
--    and a clear error is raised if no such fallback exists.
--
--    Categorization rules that point at the deleted category are dropped
--    (on delete cascade already covers this), but we surface a NOTICE so
--    the caller can follow up.
-- ============================================================================

create or replace function public.tg_categories_delete_in_use()
returns trigger
language plpgsql
as $$
declare
  fallback_id uuid;
  rules_dropped int;
  tx_reassigned int;
begin
  -- Count rules that will be dropped by the FK cascade so we can report.
  select count(*) into rules_dropped
    from public.categorization_rules r
    where r.category_id = old.id;

  if rules_dropped > 0 then
    raise notice 'deleting category % will also remove % categorization rule(s)',
      old.name, rules_dropped;
  end if;

  -- Budgets and bills don't have a sensible "reassign to fallback" story (a
  -- budget/bill IS FOR its category, unlike a transaction which merely
  -- happens to be tagged with it) — block the delete instead of letting the
  -- pre-existing FK actions (CASCADE on budgets, SET NULL on bills) fire
  -- silently.
  if exists (select 1 from public.budgets b where b.category_id = old.id) then
    raise exception
      'cannot delete category "%" — it is referenced by one or more budgets; delete or reassign those budgets first',
      old.name
      using errcode = 'dependent_objects_still_exist';
  end if;

  if exists (select 1 from public.bills bl where bl.category_id = old.id) then
    raise exception
      'cannot delete category "%" — it is referenced by one or more bills; delete or reassign those bills first',
      old.name
      using errcode = 'dependent_objects_still_exist';
  end if;

  -- Transactions referencing this category: reassign to "Otros" (or locale
  -- equivalent) of the same kind. If no fallback exists, raise.
  if exists (
    select 1 from public.transactions t where t.category_id = old.id
  ) then
    -- Excludes old.id itself: without this, deleting the fallback category
    -- while IT still has transactions would resolve fallback_id to old.id,
    -- making the reassignment UPDATE below a no-op and letting the FK's own
    -- ON DELETE SET NULL silently null the transactions out instead.
    select c.id into fallback_id
      from public.categories c
      where c.household_id = old.household_id
        and c.kind = old.kind
        and c.id <> old.id
        and lower(c.name) in (
          'otros', 'others', 'outros', 'other',
          'otros ingresos', 'other income', 'outras receitas'
        )
      order by c.is_default desc, c.display_order asc, c.id asc
      limit 1;

    if fallback_id is null then
      raise exception
        'cannot delete category "%" — it is referenced by one or more transactions and no % fallback category exists (name one of: Otros / Others / Outros)',
        old.name, old.kind
        using errcode = 'dependent_objects_still_exist';
    end if;

    update public.transactions t
      set category_id = fallback_id
      where t.category_id = old.id;

    get diagnostics tx_reassigned = row_count;
    raise notice 'reassigned % transaction(s) from "%" to fallback category',
      tx_reassigned, old.name;
  end if;

  return old;
end;
$$;

create trigger categories_delete_in_use
  before delete on public.categories
  for each row execute function public.tg_categories_delete_in_use();

-- ============================================================================
-- 7. Seed default categories per locale on household creation.
--    The trigger runs AFTER insert so the households.id is already visible.
--    Locales supported today: es, en, pt-BR (same set as households.locale check).
-- ============================================================================

-- Split into expense/income halves (instead of one seed-everything function)
-- so the backfill below can top up income defaults alone for households
-- that pre-date this migration and already have expense-only categories.
create or replace function public.seed_expense_categories(p_household_id uuid, p_locale text)
returns void
language plpgsql
set search_path = public
as $$
declare
  expense_names_es    text[] := array['Comida y Bebida','Supermercado','Hogar y Servicios','Transporte','Salud','Educación','Ropa','Entretenimiento','Restaurantes','Cuidado Personal','Regalos','Mascotas','Otros'];
  expense_names_en    text[] := array['Food & Drink','Groceries','Home & Utilities','Transportation','Healthcare','Education','Clothing','Entertainment','Restaurants','Personal Care','Gifts','Pets','Other'];
  expense_names_ptbr  text[] := array['Alimentação','Supermercado','Casa e Serviços','Transporte','Saúde','Educação','Roupas','Entretenimento','Restaurantes','Cuidados Pessoais','Presentes','Animais de Estimação','Outros'];

  names               text[];
  i                   int;
  nm                  text;
  dflt_colors         text[] := array[
    '#F59E0B','#10B981','#3B82F6','#8B5CF6','#EF4444','#F97316','#EC4899',
    '#14B8A6','#6366F1','#84CC16','#06B6D4','#D946EF','#64748B'
  ];
begin
  case p_locale
    when 'pt-BR' then names := expense_names_ptbr;
    when 'en'    then names := expense_names_en;
    else                names := expense_names_es;
  end case;

  for i in 1 .. array_upper(names, 1) loop
    nm := names[i];
    insert into public.categories
      (household_id, name, kind, is_default, display_order, color_hex)
    values
      (p_household_id, nm, 'expense', true, (i - 1)::smallint, dflt_colors[(i - 1) % array_upper(dflt_colors, 1) + 1]);
  end loop;
end;
$$;

create or replace function public.seed_income_categories(p_household_id uuid, p_locale text)
returns void
language plpgsql
set search_path = public
as $$
declare
  income_names_es     text[] := array['Salario','Freelance','Regalos Recibidos','Otros Ingresos'];
  income_names_en     text[] := array['Salary','Freelance','Gifts Received','Other Income'];
  income_names_ptbr   text[] := array['Salário','Freelance','Presentes Recebidos','Outras Receitas'];

  names               text[];
  i                   int;
  nm                  text;
  dflt_colors         text[] := array[
    '#F59E0B','#10B981','#3B82F6','#8B5CF6','#EF4444','#F97316','#EC4899',
    '#14B8A6','#6366F1','#84CC16','#06B6D4','#D946EF','#64748B'
  ];
begin
  case p_locale
    when 'pt-BR' then names := income_names_ptbr;
    when 'en'    then names := income_names_en;
    else                names := income_names_es;
  end case;

  for i in 1 .. array_upper(names, 1) loop
    nm := names[i];
    insert into public.categories
      (household_id, name, kind, is_default, display_order, color_hex)
    values
      (p_household_id, nm, 'income', true, (i - 1)::smallint, dflt_colors[(i - 1) % array_upper(dflt_colors, 1) + 1]);
  end loop;
end;
$$;

create or replace function public.seed_default_categories(p_household_id uuid, p_locale text)
returns void
language plpgsql
set search_path = public
as $$
begin
  perform public.seed_expense_categories(p_household_id, p_locale);
  perform public.seed_income_categories(p_household_id, p_locale);
end;
$$;

create or replace function public.tg_household_seed_categories()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.seed_default_categories(new.id, new.locale);
  return new;
end;
$$;

create trigger household_seed_categories
  after insert on public.households
  for each row execute function public.tg_household_seed_categories();

-- Backfill: households created before this migration get their default
-- categories seeded now.
--   * Households with ZERO categories get the full expense + income set.
--   * Households that already have (expense-only, pre-#22) categories keep
--     those rows as-is, but still get the income half of the seed set —
--     otherwise they'd have nowhere for income transactions to land and
--     would never surface in any income-vs-expense split.
do $$
declare
  h record;
begin
  for h in select hh.id, hh.locale from public.households hh loop
    if not exists (select 1 from public.categories c where c.household_id = h.id) then
      perform public.seed_default_categories(h.id, h.locale);
    elsif not exists (
      select 1 from public.categories c where c.household_id = h.id and c.kind = 'income'
    ) then
      perform public.seed_income_categories(h.id, h.locale);
    end if;
  end loop;
end $$;
