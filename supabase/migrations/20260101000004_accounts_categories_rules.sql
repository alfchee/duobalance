-- Account ledger, category tree, and auto-categorization rules.
-- All reference households; categories self-reference; rules reference accounts and categories.

create type public.account_type as enum ('checking', 'savings', 'credit', 'cash', 'other');

create table public.accounts (
  id               uuid            primary key default gen_random_uuid(),
  household_id     uuid            not null references public.households(id) on delete cascade,
  name             text            not null check (char_length(name) between 1 and 80),
  type             public.account_type not null,
  currency         text            not null references public.currencies(code) on delete restrict,
  opening_balance  numeric(20,4)   not null default 0,
  is_active        boolean         not null default true,
  created_at       timestamptz     not null default now(),
  updated_at       timestamptz     not null default now(),
  unique (household_id, name)
);

create index accounts_household_idx on public.accounts (household_id);

comment on column public.accounts.opening_balance is 'Signed in the account''s own currency. Computed balance = opening + sum(transactions).';

create table public.categories (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.households(id) on delete cascade,
  parent_id     uuid        references public.categories(id) on delete set null,
  name          text        not null check (char_length(name) between 1 and 60),
  color         text        check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon          text,
  is_archived   boolean     not null default false,
  created_at    timestamptz not null default now(),
  unique (household_id, parent_id, name)
);

create index categories_household_idx on public.categories (household_id);
create index categories_parent_idx    on public.categories (parent_id);

comment on table public.categories is 'Tree (parent_id). Max depth enforced in app, not DB — household scale is small.';

create table public.categorization_rules (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.households(id) on delete cascade,
  account_id    uuid        references public.accounts(id) on delete cascade,  -- null = all accounts
  pattern       text        not null check (char_length(pattern) between 1 and 200),
  category_id   uuid        not null references public.categories(id) on delete cascade,
  priority      smallint    not null default 100,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now()
);

create index categorization_rules_household_idx on public.categorization_rules (household_id, priority);
create index categorization_rules_account_idx   on public.categorization_rules (account_id) where account_id is not null;

comment on table public.categorization_rules is 'Substring match on description/merchant. Higher priority wins. Applies at import time.';
