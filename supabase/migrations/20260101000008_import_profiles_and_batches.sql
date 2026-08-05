-- Import pipeline metadata. A profile remembers how to parse a bank's CSV/OFX;
-- a batch is one uploaded file's result. Transactions created from a batch
-- reference it via import_batch_id (added in migration 9).

create type public.import_file_format as enum ('csv', 'ofx', 'qif');
create type public.import_batch_status as enum ('pending', 'imported', 'failed', 'cancelled');

create table public.import_profiles (
  id              uuid                  primary key default gen_random_uuid(),
  household_id    uuid                  not null references public.households(id) on delete cascade,
  account_id      uuid                  not null references public.accounts(id) on delete cascade,
  name            text                  not null check (char_length(name) between 1 and 80),
  file_format     public.import_file_format not null,
  -- Column→field mapping stored as JSON. Schema validated in app code.
  -- Example: {"date": 0, "description": 1, "amount": 2, "currency": 3}
  column_mapping  jsonb                 not null,
  date_format     text                  not null default 'YYYY-MM-DD',
  has_header_row  boolean               not null default true,
  amount_sign     text                  not null default 'negative_is_debit'
                                       check (amount_sign in ('negative_is_debit', 'positive_is_debit')),
  created_at      timestamptz           not null default now(),
  updated_at      timestamptz           not null default now(),
  unique (household_id, account_id, name)
);

create index import_profiles_household_idx on public.import_profiles (household_id);

create table public.import_batches (
  id                  uuid                      primary key default gen_random_uuid(),
  household_id        uuid                      not null references public.households(id) on delete cascade,
  import_profile_id   uuid                      not null references public.import_profiles(id) on delete restrict,
  file_name           text                      not null,
  file_hash           text                      not null,             -- SHA-256 of the uploaded file
  imported_at         timestamptz,
  transaction_count   integer                   not null default 0,
  total_amount        numeric(20,4)             not null default 0,
  currency            text                      not null references public.currencies(code) on delete restrict,
  status              public.import_batch_status not null default 'pending',
  error_message       text,
  uploaded_by         uuid                      not null references public.household_members(id) on delete restrict,
  created_at          timestamptz               not null default now(),
  unique (file_hash, import_profile_id)  -- prevent double-uploads of the same file
);

create index import_batches_household_idx   on public.import_batches (household_id, created_at desc);
create index import_batches_profile_idx     on public.import_batches (import_profile_id);

comment on column public.import_batches.file_hash is 'SHA-256. Combined with import_profile_id, prevents accidental re-import of the same file.';
