-- The transaction ledger. Most-queried table; FK-heavy by design.
-- import_batch_id is added in migration 9 (forward-only discipline).

create type public.transaction_direction as enum ('debit', 'credit');

create table public.transactions (
  id                   uuid                          primary key default gen_random_uuid(),
  household_id         uuid                          not null references public.households(id) on delete cascade,
  account_id           uuid                          not null references public.accounts(id) on delete restrict,
  category_id          uuid                          references public.categories(id) on delete set null,
  direction            public.transaction_direction  not null,
  -- Positive amount in the account's own currency. Direction indicates sign.
  amount               numeric(20,4)                 not null check (amount > 0),
  currency             text                          not null references public.currencies(code) on delete restrict,
  -- Exchange rate applied when transaction was entered in a different currency.
  -- Null means the transaction is in the account's native currency.
  fx_rate              numeric(20,10)                check (fx_rate is null or fx_rate > 0),
  occurred_at          date                          not null,
  description          text                          not null check (char_length(description) between 1 and 500),
  merchant             text,
  notes                text,
  -- A transfer pairs two transactions. Set by the transfer-creation RPC (Phase 1).
  transfer_pair_id     uuid                          references public.transactions(id) on delete set null,
  is_cleared           boolean                       not null default true,
  is_pending_review    boolean                       not null default false,
  created_by           uuid                          not null references public.household_members(id) on delete restrict,
  created_at           timestamptz                   not null default now(),
  updated_at           timestamptz                   not null default now()
);

create index transactions_household_date_idx on public.transactions (household_id, occurred_at desc);
create index transactions_account_date_idx   on public.transactions (account_id, occurred_at desc);
create index transactions_category_idx      on public.transactions (category_id) where category_id is not null;
create index transactions_pending_review_idx on public.transactions (household_id) where is_pending_review;
create index transactions_transfer_pair_idx on public.transactions (transfer_pair_id) where transfer_pair_id is not null;

comment on column public.transactions.amount is 'Positive; direction indicates sign. Display layer negates debits.';
comment on column public.transactions.fx_rate is 'base/quote rate at occurred_at. Quote is account.currency, base is the entered currency.';
