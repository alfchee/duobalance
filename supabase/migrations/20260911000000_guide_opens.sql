-- Issue #200 — Track guide opens as funnel step for #167.
-- In-app help links fire a client event so metrics can count guide viewed as
-- optional milestone between first transaction and budget. Stored per open
-- (not unique) to allow rate/distribution analysis.

create table public.guide_opens (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete set null,
  user_id uuid not null,
  member_id uuid references public.household_members(id) on delete set null,
  slug text not null check (char_length(slug) between 1 and 200),
  anchor text check (anchor is null or char_length(anchor) between 1 and 200),
  source text check (source is null or char_length(source) between 1 and 80),
  created_at timestamptz not null default now()
);

comment on table public.guide_opens is
  'Analytics: each row is one guide open from inside the app. Used as optional funnel milestone for #167. Sources are empty-state, first-run, help-center, etc.';
comment on column public.guide_opens.slug is 'Help article slug, e.g. recording-transaction-fast';
comment on column public.guide_opens.anchor is 'Optional fragment id within article, e.g. quick-entry-workflow';
comment on column public.guide_opens.source is 'Where the link was tapped: balances-empty, budget-empty, bills-empty, first-run, help-center, persistent-help, etc.';

create index guide_opens_household_created_idx on public.guide_opens (household_id, created_at desc);
create index guide_opens_user_created_idx on public.guide_opens (user_id, created_at desc);
create index guide_opens_slug_idx on public.guide_opens (slug);
create index guide_opens_created_idx on public.guide_opens (created_at desc);

alter table public.guide_opens enable row level security;

-- Authenticated users can insert for themselves; household must be one they belong to if provided.
create policy guide_opens_insert_authenticated
  on public.guide_opens for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      household_id is null
      or public.is_member(household_id)
    )
  );

-- Authenticated users can read opens for households they belong to, or their own when household is null.
create policy guide_opens_select_authenticated
  on public.guide_opens for select to authenticated
  using (
    (household_id is not null and public.is_member(household_id))
    or (household_id is null and user_id = auth.uid())
  );

grant select, insert on public.guide_opens to authenticated;
-- No anon grant: RLS requires auth.uid()=user_id, so anon would always be blocked;
-- granting to anon is misleading and widens surface (see PR 221 review).
