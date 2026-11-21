-- #269: data export links, account deletion requests, deletion audit log.
--
-- Transaction-retention rule (see docs/data-export-deletion.md): transactions
-- are never mutated by a departure or deletion. Membership rows are
-- anonymized + soft-removed, never hard-deleted while the ledger references
-- them (entered_by/spent_by are ON DELETE RESTRICT, so a cascade fails
-- loudly instead of orphaning). These three tables implement the self-service
-- surface on top of that rule:
--   data_export_links         time-limited unguessable export tokens (24h)
--   account_deletion_requests two-step deletion with 30-day grace
--   deletion_audit_log        append-only, ids + timestamps only, no PII

-- ============================================================================
-- 1. data_export_links
-- ============================================================================

create table public.data_export_links (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.households(id) on delete cascade,
  created_by    uuid        references public.household_members(id) on delete set null,
  token         text        not null unique default encode(gen_random_bytes(32), 'hex'),
  format        text        not null default 'json' check (format in ('json', 'csv')),
  expires_at    timestamptz not null default (now() + interval '24 hours'),
  created_at    timestamptz not null default now(),
  check (expires_at > created_at)
);

create index data_export_links_household_idx on public.data_export_links (household_id);
create index data_export_links_expires_idx on public.data_export_links (expires_at);

comment on table public.data_export_links is
  'Time-limited unguessable export tokens (#269). 256-bit hex token, 24h expiry. Bearer secret but never a substitute for membership — redemption re-checks active membership.';
comment on column public.data_export_links.token is
  'Unguessable bearer token (gen_random_bytes(32) hex). Unique; redemption checks expires_at.';

alter table public.data_export_links enable row level security;

grant select, insert on public.data_export_links to anon, authenticated;

-- Members can read links for households they belong to (to list own links).
create policy data_export_links_select_member
  on public.data_export_links for select to authenticated
  using (public.is_member(household_id));

-- Members can mint links for their own household; the token default fills in.
create policy data_export_links_insert_member
  on public.data_export_links for insert to authenticated
  with check (public.is_member(household_id));

-- No update/delete policies for clients: links expire on their own and are
-- cleaned by household cascade. Service role manages the rest.

-- ============================================================================
-- 2. account_deletion_requests
-- ============================================================================

create table public.account_deletion_requests (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users(id) on delete cascade,
  status             text        not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'purged')),
  requested_at       timestamptz not null default now(),
  confirmed_at       timestamptz,
  scheduled_purge_at timestamptz,
  purged_at          timestamptz,
  created_at         timestamptz not null default now(),
  check (
    (status = 'pending')
    or (status in ('confirmed', 'purged') and confirmed_at is not null and scheduled_purge_at is not null)
    or (status = 'cancelled')
  )
);

-- One open grace window per user: a second request while one is pending or
-- confirmed would fork the purge schedule.
create unique index account_deletion_requests_open_uniq
  on public.account_deletion_requests (user_id)
  where status in ('pending', 'confirmed');

create index account_deletion_requests_purge_idx
  on public.account_deletion_requests (scheduled_purge_at)
  where status = 'confirmed';

comment on table public.account_deletion_requests is
  'Two-step account deletion with 30-day grace (#269). Request → confirm (typed email) → purge. Purge anonymizes memberships, never hard-deletes ledger-referenced rows.';

alter table public.account_deletion_requests enable row level security;

grant select, insert, update on public.account_deletion_requests to anon, authenticated;

-- Users manage only their own requests. Tenancy is the user id itself, so
-- there is no cross-household trigger path by construction.
create policy account_deletion_requests_select_own
  on public.account_deletion_requests for select to authenticated
  using (auth.uid() = user_id);

create policy account_deletion_requests_insert_own
  on public.account_deletion_requests for insert to authenticated
  with check (auth.uid() = user_id);

create policy account_deletion_requests_update_own
  on public.account_deletion_requests for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No delete policy for clients; terminal states are rows, not absences.

-- ============================================================================
-- 3. deletion_audit_log (append-only, no PII by construction)
-- ============================================================================

create table public.deletion_audit_log (
  id               uuid        primary key default gen_random_uuid(),
  occurred_at      timestamptz not null default now(),
  household_id     uuid        references public.households(id) on delete set null,
  event_type       text        not null check (event_type in (
    'export_link_created',
    'member_removed',
    'member_left',
    'household_deleted',
    'household_purged',
    'account_deletion_requested',
    'account_deletion_confirmed',
    'account_deletion_cancelled',
    'account_deletion_purged'
  )),
  actor_member_id  uuid        references public.household_members(id) on delete set null,
  target_member_id uuid        references public.household_members(id) on delete set null
);

create index deletion_audit_log_household_idx on public.deletion_audit_log (household_id, occurred_at desc);

comment on table public.deletion_audit_log is
  'Append-only deletion/export audit (#269). Ids + timestamps + event type only — deliberately no email, name, amount, or free-text column, so an audit row can never retain deleted personal data.';
comment on column public.deletion_audit_log.actor_member_id is
  'Membership id that acted, if household-scoped. Id only, never PII.';
comment on column public.deletion_audit_log.target_member_id is
  'Membership id affected, if any. Id only, never PII.';

alter table public.deletion_audit_log enable row level security;

grant select on public.deletion_audit_log to anon, authenticated;

-- Members can read their own household's audit trail.
create policy deletion_audit_log_select_member
  on public.deletion_audit_log for select to authenticated
  using (household_id is not null and public.is_member(household_id));

-- No insert/update/delete policies for clients: only the service role
-- (route handlers, cron) appends. Default-deny keeps it append-only.
