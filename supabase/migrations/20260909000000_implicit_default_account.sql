-- Issue #192: implicit default cash account so first transaction is never blocked.
-- New households get a joint Cash account in their base currency on creation.
-- Existing households that still have zero accounts are backfilled.

drop function if exists public.create_household(text, text, text, text, text, text, text);

create or replace function public.create_household(
  p_name text,
  p_country text,
  p_base_currency text,
  p_display_name text,
  p_timezone text default null,
  p_locale text default null,
  p_signup_source text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  h_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform 1
  from auth.users
  where id = auth.uid()
  for update;

  if (
    select count(*)
    from public.active_membership
    where user_id = auth.uid()
  ) >= 5 then
    raise exception 'household limit reached';
  end if;

  insert into public.households (name, country, base_currency, timezone, locale, signup_source)
  values (p_name, p_country, p_base_currency, p_timezone, p_locale, p_signup_source)
  returning id into h_id;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (h_id, auth.uid(), 'owner', p_display_name);

  -- Implicit default: a joint cash account in the household base currency.
  -- This removes the "which account?" blocker before the first transaction.
  -- The account is visible and renameable via the normal account edit flow.
  -- Name is localized from p_locale so Spanish/PT households don't get an
  -- English-only "Cash" row that immediately looks untranslated.
  insert into public.accounts (household_id, name, kind, currency, opening_balance, balance_mode, is_shared, owner_member_id, display_order, is_archived)
  values (
    h_id,
    case p_locale when 'es' then 'Efectivo' when 'pt-BR' then 'Dinheiro' else 'Cash' end,
    'cash', p_base_currency, 0, 'ledger', true, null, 0, false
  );

  return h_id;
end;
$$;

revoke all on function public.create_household(text, text, text, text, text, text, text) from public;
grant execute on function public.create_household(text, text, text, text, text, text, text) to authenticated;

-- Backfill: households that were created before this migration (or via a path
-- that bypassed the RPC) and still have zero accounts get the same default.
-- Name is localized from households.locale.
insert into public.accounts (household_id, name, kind, currency, opening_balance, balance_mode, is_shared, owner_member_id, display_order, is_archived)
select
  h.id,
  case h.locale when 'es' then 'Efectivo' when 'pt-BR' then 'Dinheiro' else 'Cash' end,
  'cash', h.base_currency, 0, 'ledger', true, null, 0, false
from public.households h
where not exists (
  select 1 from public.accounts a where a.household_id = h.id
);

-- Idempotency guard for the client race: two parallel inserts of the default
-- Cash account must not leave duplicate rows (DB no longer has
-- unique(household_id,name) after 20260807000001). A partial unique index
-- on the three localized default names makes the second insert fail with a
-- unique violation that the client can catch and reuse.
create unique index if not exists accounts_one_default_cash_per_household
  on public.accounts (household_id)
  where name in ('Cash', 'Efectivo', 'Dinheiro')
    and kind = 'cash'
    and is_shared = true
    and is_archived = false;
comment on index public.accounts_one_default_cash_per_household is
  'Issue #192: ensures at most one implicit Cash/Efectivo/Dinheiro per household; client dedup via shared in-memory lock + catch/reuse.';
