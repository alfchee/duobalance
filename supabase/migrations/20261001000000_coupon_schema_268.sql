-- Coupons domain schema: substrate for #268 (Coupons and discount codes),
-- built now because #274 (admin coupon management) is blocked on it.
--
-- What this migration covers of #268: the coupons table (code, discount
-- type and value, validity window, maximum redemptions, per-household
-- limit, active flag), the redemption table linking coupon to household,
-- validation with distinct error reasons (unknown / deactivated /
-- not-yet-valid / expired / exhausted / household-limit / already-redeemed),
-- and RLS so households cannot enumerate codes. What stays open in #268:
-- the discount calculation against plan prices (no prices exist yet in
-- Phase A), the concurrent-redemption proof, and any provider handoff.
--
-- Design decisions:
--
-- 1. `duration` encodes #268's open question as a column, not a convention:
--    'first_period' (the discount applies once, on the first paid period)
--    vs 'lifetime' (it rides the subscription). No behavior reads it yet;
--    the provider adapter (#268) will.
-- 2. Codes are canonicalized to upper(trim()) on write (admin RPC) and on
--    redeem, so 'save10' and 'SAVE10' are the same coupon. The DB keeps a
--    loose length check; the strict shape lives in the admin RPC, which is
--    the only writer.
-- 3. percent is 1-100, amount is >0 in minor units with a mandatory
--    currency (percent carries none — there is nothing to denominate).
-- 4. Double redemption is guarded twice: unique(coupon_code, household_id)
--    at the storage level (race-proof even outside the function) plus an
--    explicit pre-check in redeem_coupon() so the caller gets 'already
--    redeemed' instead of a raw 23505. Note the interplay with
--    per_household_limit: the unique pair caps a household at one
--    redemption row per coupon, so limits >1 cannot produce extra rows —
--    the limit check fires first with its own reason and the pair index is
--    the backstop. Effectively every campaign is limit-1 per household,
--    which matches the one-live-subscription model (one household holds
--    one subscription to discount).
-- 5. redeem_coupon() is the member path: households cannot SELECT coupons
--    (no policies, no grants — enumeration is impossible) but a member who
--    was GIVEN a code can redeem it. The capability is the code itself.
--    Counts are checked under a FOR UPDATE lock on the coupon row, so two
--    concurrent redeems serialize instead of both passing an exhaustion
--    check (the #268 concurrency concern, by construction).
-- 6. History is append-only by shape: redemptions reference coupons
--    ON DELETE RESTRICT (a redeemed coupon cannot be deleted out from
--    under its history) and households ON DELETE CASCADE (household
--    deletion under #269 purges its data, redemptions included).

create table public.coupons (
  code               text primary key check (char_length(code) between 4 and 32),
  discount_type      text not null check (discount_type in ('percent', 'amount')),
  discount_value     int not null,
  currency           text references public.currencies(code) on delete restrict,
  valid_from         timestamptz not null,
  valid_until        timestamptz not null,
  max_redemptions    int not null check (max_redemptions > 0),
  per_household_limit int not null check (per_household_limit > 0),
  duration           text not null check (duration in ('first_period', 'lifetime')),
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint coupons_discount_value_check check (
    (discount_type = 'percent' and discount_value between 1 and 100)
    or (discount_type = 'amount' and discount_value > 0)
  ),
  constraint coupons_currency_scope_check check (
    (discount_type = 'percent' and currency is null)
    or (discount_type = 'amount' and currency is not null)
  ),
  constraint coupons_window_check check (valid_from < valid_until),
  constraint coupons_limit_within_cap_check check (per_household_limit <= max_redemptions)
);

create table public.coupon_redemptions (
  id            uuid primary key default gen_random_uuid(),
  coupon_code   text not null references public.coupons(code) on delete restrict,
  household_id  uuid not null references public.households(id) on delete cascade,
  redeemed_at   timestamptz not null default now(),
  unique (coupon_code, household_id)
);

create index coupon_redemptions_household_idx
  on public.coupon_redemptions (household_id);

create trigger coupons_set_updated_at
  before update on public.coupons
  for each row execute function public.tg_set_updated_at();

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

-- Intentionally NO policies for anon/authenticated on either table and no
-- grants: households cannot enumerate or read coupons. The only member
-- path is redeem_coupon() below (code as capability); the only admin path
-- is the DEFINER readers/writers in the #274 migration.

comment on table public.coupons is
  'Issue #268 substrate: discount codes with explicit constraints (type/value, window, caps, duration). No authenticated access; redeem by code via redeem_coupon(), manage via the #274 admin RPCs.';
comment on table public.coupon_redemptions is
  'Issue #268 substrate: one row per household per coupon (unique pair = double-redeem guard). Coupon RESTRICT preserves history; household CASCADE honors #269 deletion.';

-- Redeem one coupon for one household. Distinct 23514 reasons per failure
-- mode (the #268 AC); the #274 admin surface distinguishes them the same
-- way when explaining why a code did not work.
create or replace function public.redeem_coupon(p_code text, p_household uuid)
returns table (
  redemption_id uuid,
  coupon_code   text,
  household_id  uuid,
  redeemed_at   timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_coupon public.coupons%rowtype;
  v_total int;
  v_household_count int;
  v_redemption public.coupon_redemptions%rowtype;
begin
  if not public.is_member(p_household) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;

  -- Lock first: concurrent redeems of the last slot serialize here, so the
  -- exhaustion count below cannot pass twice for one remaining slot.
  select c.* into v_coupon
    from public.coupons c
   where c.code = v_code
   limit 1
   for update;
  if v_coupon.code is null then
    raise exception 'unknown coupon' using errcode = '23514';
  end if;
  if not v_coupon.active then
    raise exception 'coupon is deactivated' using errcode = '23514';
  end if;
  if now() < v_coupon.valid_from then
    raise exception 'coupon is not yet valid' using errcode = '23514';
  end if;
  if now() > v_coupon.valid_until then
    raise exception 'coupon has expired' using errcode = '23514';
  end if;

  select count(*)::int into v_total
    from public.coupon_redemptions r
   where r.coupon_code = v_coupon.code;
  if v_total >= v_coupon.max_redemptions then
    raise exception 'coupon is exhausted' using errcode = '23514';
  end if;

  select count(*)::int into v_household_count
    from public.coupon_redemptions r
   where r.coupon_code = v_coupon.code
     and r.household_id = p_household;
  if v_household_count >= v_coupon.per_household_limit then
    raise exception 'household redemption limit reached' using errcode = '23514';
  end if;
  if v_household_count > 0 then
    -- Defensive: with the unique pair below this is unreachable through
    -- this function, but the message stays distinct if the shape changes.
    raise exception 'coupon already redeemed by this household' using errcode = '23514';
  end if;

  insert into public.coupon_redemptions (coupon_code, household_id)
  values (v_coupon.code, p_household)
  on conflict (coupon_code, household_id) do nothing
  returning * into v_redemption;
  if v_redemption.id is null then
    -- Lost a race outside the lock (or a direct write): the pair is taken.
    raise exception 'coupon already redeemed by this household' using errcode = '23514';
  end if;

  return query
  select v_redemption.id, v_redemption.coupon_code, v_redemption.household_id, v_redemption.redeemed_at;
end;
$$;

revoke execute on function public.redeem_coupon(text, uuid) from public;
grant execute on function public.redeem_coupon(text, uuid) to authenticated;

comment on function public.redeem_coupon(text, uuid) is
  'Issue #268 substrate: member redeems a known code. Distinct reasons per failure mode; counts under a coupon row lock. Households cannot list coupons (no policies by design).';
