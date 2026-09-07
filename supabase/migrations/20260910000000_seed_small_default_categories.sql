-- Issue #194: small default category set on household creation.
-- Beginners stall when faced with 17 defaults; the guide recommends 5-8.
-- New households now get 7 expense categories only:
--   es: Comida, Transporte, Casa, Salud, Personal, Diversión, Otros
--   en: Food, Transport, Home, Health, Personal, Fun, Other
--   pt-BR: Alimentação, Transporte, Casa, Saúde, Pessoal, Diversão, Outros
-- Existing households are untouched (no backfill). All defaults remain
-- editable/deletable via the existing RLS policy `categories_all` and the
-- `categories_delete_in_use` trigger (fallback is Otros/Other/Outros, still
-- present). Transactions already allow `category_id = null`, so no category is
-- required before a transaction can be saved.

create or replace function public.seed_expense_categories(p_household_id uuid, p_locale text)
returns void
language plpgsql
set search_path = public
as $$
declare
  names_es    text[] := array['Comida','Transporte','Casa','Salud','Personal','Diversión','Otros'];
  names_en    text[] := array['Food','Transport','Home','Health','Personal','Fun','Other'];
  names_ptbr  text[] := array['Alimentação','Transporte','Casa','Saúde','Pessoal','Diversão','Outros'];
  names       text[];
  i           int;
  nm          text;
  dflt_colors text[] := array['#F59E0B','#10B981','#3B82F6','#8B5CF6','#EF4444','#F97316','#64748B'];
begin
  case p_locale
    when 'pt-BR' then names := names_ptbr;
    when 'en'    then names := names_en;
    else                names := names_es;
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

-- Issue #194 leaves income categories to be created on demand by the user.
-- Keep the function for backwards-compat (callers may still invoke it) but make
-- it a no-op for new households so the total stays at 7.
create or replace function public.seed_income_categories(p_household_id uuid, p_locale text)
returns void
language plpgsql
set search_path = public
as $$
begin
  -- Intentionally empty: new households start with expense defaults only.
  -- Users add income categories via /settings/categories without ceremony.
  return;
end;
$$;

create or replace function public.seed_default_categories(p_household_id uuid, p_locale text)
returns void
language plpgsql
set search_path = public
as $$
begin
  perform public.seed_expense_categories(p_household_id, p_locale);
  -- seed_income_categories is a no-op (see above) — kept for call-site compat.
  perform public.seed_income_categories(p_household_id, p_locale);
end;
$$;

-- Trigger `household_seed_categories` (after insert on households) already
-- calls seed_default_categories and requires no change. No backfill: existing
-- households keep their current categories untouched.

comment on function public.seed_expense_categories(uuid, text) is 'Issue #194: seeds 7 expense defaults (Comida/Transporte/Casa/Salud/Personal/Diversión/Otros localized).';
comment on function public.seed_income_categories(uuid, text) is 'Issue #194: no-op — new households start with no income defaults; users add their own.';
comment on function public.seed_default_categories(uuid, text) is 'Issue #194: seeds 7 expense defaults only; no retroactive backfill.';
