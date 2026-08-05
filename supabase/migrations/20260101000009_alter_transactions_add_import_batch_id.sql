-- Forward-only: add import_batch_id to transactions. Created in a separate
-- migration because the original table is already in production-shaped
-- schemas (per #1's "never edit applied migrations" rule).

alter table public.transactions
  add column import_batch_id uuid
    references public.import_batches(id) on delete set null;

create index transactions_import_batch_idx
  on public.transactions (import_batch_id) where import_batch_id is not null;

comment on column public.transactions.import_batch_id is 'Set when the row was created by an import batch. Null = manually entered.';
