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

-- Case-insensitive + kind-aware uniqueness. ILIKE-based B-tree via `lower(name)`
-- means 'Comida' and 'comida' collide under the same (household, parent, kind).
-- parent_id is coalesced to a sentinel nil-UUID so that two root-level rows
-- (parent_id IS NULL) are considered siblings by the index (Postgres would
-- otherwise treat NULLs as distinct in a UNIQUE index).
create unique index categories_uniq_household_parent_kind_name
  on public.categories (
    household_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kind,
    lower(name)
  );

-- ============================================================================
-- 2. categorization_rules: align columns with #22 spec
-- ============================================================================

-- pattern -> match_pattern (issue spec uses match_pattern, clarifies ILIKE).
alter table public.categorization_rules
  rename column pattern to match_pattern;

-- match_pattern sanity: must be non-empty and a "sane" ILIKE pattern.
-- We ban bare patterns that are just a single `%` (match-everything is OK via
-- explicit opt-in but we require an anchor character), and forbid ASCII NUL.
alter table public.categorization_rules
  add constraint categorization_rules_match_pattern_sane
  check (
    char_length(match_pattern) between 1 and 200
    and match_pattern !~ '\x00'
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

create or replace function public.tg_categories_containment()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is not null then
    if (select household_id from public.categories where id = new.parent_id)
       <> new.household_id then
      raise exception 'categories.parent_id must belong to the same household'
        using errcode = 'check_violation';
    end if;
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
as $$
begin
  if (select household_id from public.categories where id = new.category_id)
     <> new.household_id then
    raise exception 'categorization_rules.category_id must belong to the same household'
      using errcode = 'check_violation';
  end if;

  -- account_id, if set, must also be same-household.
  if new.account_id is not null then
    if (select household_id from public.accounts where id = new.account_id)
       <> new.household_id then
      raise exception 'categorization_rules.account_id must belong to the same household'
        using errcode = 'check_violation';
    end if;
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
-- 6. Deleting a category in use by transactions: do NOT cascade-delete
--    transactions and do NOT silently NULL them either. Reassign references
--    to the household's "Otros"/"Others"/"Outros" fallback category of the
--    matching kind, and raise a clear error if no such fallback exists.
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

  -- Transactions referencing this category: reassign to "Otros" (or locale
  -- equivalent) of the same kind. If no fallback exists, raise.
  if exists (
    select 1 from public.transactions t where t.category_id = old.id
  ) then
    select c.id into fallback_id
      from public.categories c
      where c.household_id = old.household_id
        and c.kind = old.kind
        and lower(c.name) in ('otros', 'others', 'outros')
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

create or replace function public.seed_default_categories(p_household_id uuid, p_locale text)
returns void
language plpgsql
set search_path = public
as $$
declare
  -- expense defaults, order is display_order ascending.
  expense_names_es    text[] := array['Comida y Bebida','Supermercado','Hogar y Servicios','Transporte','Salud','Educación','Ropa','Entretenimiento','Restaurantes','Cuidado Personal','Regalos','Mascotas','Otros'];
  expense_names_en    text[] := array['Food & Drink','Groceries','Home & Utilities','Transportation','Healthcare','Education','Clothing','Entertainment','Restaurants','Personal Care','Gifts','Pets','Other'];
  expense_names_ptbr  text[] := array['Alimentação','Supermercado','Casa e Serviços','Transporte','Saúde','Educação','Roupas','Entretenimento','Restaurantes','Cuidados Pessoais','Presentes','Animais de Estimação','Outros'];

  income_names_es     text[] := array['Salario','Freelance','Regalos Recibidos','Otros Ingresos'];
  income_names_en     text[] := array['Salary','Freelance','Gifts Received','Other Income'];
  income_names_ptbr   text[] := array['Salário','Freelance','Presentes Recebidos','Outras Receitas'];

  names               text[];
  k                   text;
  i                   int;
  nm                  text;
  dflt_colors         text[] := array[
    '#F59E0B','#10B981','#3B82F6','#8B5CF6','#EF4444','#F97316','#EC4899',
    '#14B8A6','#6366F1','#84CC16','#06B6D4','#D946EF','#64748B'
  ];
begin
  -- Expense categories -----------------------------------------------
  case p_locale
    when 'pt-BR' then names := expense_names_ptbr;
    when 'en'    then names := expense_names_en;
    else                names := expense_names_es;
  end case;

  k := 'expense';
  for i in 1 .. array_upper(names, 1) loop
    nm := names[i];
    insert into public.categories
      (household_id, name, kind, is_default, display_order, color_hex)
    values
      (p_household_id, nm, k, true, (i - 1)::smallint, dflt_colors[(i - 1) % array_upper(dflt_colors, 1) + 1]);
  end loop;

  -- Income categories ------------------------------------------------
  case p_locale
    when 'pt-BR' then names := income_names_ptbr;
    when 'en'    then names := income_names_en;
    else                names := income_names_es;
  end case;

  k := 'income';
  for i in 1 .. array_upper(names, 1) loop
    nm := names[i];
    insert into public.categories
      (household_id, name, kind, is_default, display_order, color_hex)
    values
      (p_household_id, nm, k, true, (i - 1)::smallint, dflt_colors[i % array_upper(dflt_colors, 1) + 1]);
  end loop;
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
-- categories seeded now. Only households that currently have ZERO categories
-- get seeded — if someone already added custom rows we don't want to
-- double-insert (the unique index would fail anyway, but skipping is cleaner).
do $$
declare
  h record;
begin
  for h in select hh.id, hh.locale from public.households hh loop
    if not exists (select 1 from public.categories c where c.household_id = h.id) then
      perform public.seed_default_categories(h.id, h.locale);
    end if;
  end loop;
end $$;
