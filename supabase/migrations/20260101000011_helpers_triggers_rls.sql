-- Helper functions, updated_at triggers, and RLS policies.
-- Final migration. Anything that depends on the full schema (e.g. RLS
-- that joins across multiple tables) lives here.

-- ============================================================================
-- Helper functions
-- ============================================================================

-- Returns the household_members row for the current user in the given household,
-- or NULL if they are not a member. Used by every RLS policy.
create or replace function public.current_member(household uuid)
returns public.household_members
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.household_members
  where household_id = household
    and user_id = auth.uid()
  limit 1;
$$;

-- Returns true if the current user is a member of the given household.
create or replace function public.is_member(household uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = household
      and user_id = auth.uid()
  );
$$;

-- ============================================================================
-- Generic updated_at trigger
-- ============================================================================

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger households_set_updated_at
  before update on public.households
  for each row execute function public.tg_set_updated_at();

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.tg_set_updated_at();

create trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.tg_set_updated_at();

create trigger bills_set_updated_at
  before update on public.bills
  for each row execute function public.tg_set_updated_at();

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.tg_set_updated_at();

create trigger import_profiles_set_updated_at
  before update on public.import_profiles
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- Grants for the data API roles.
-- Supabase's data API (PostgREST) gives anon and authenticated CRUD on every
-- public table and lets RLS do the actual authorization. Direct psql
-- connections (used by pgTAP) need the same — otherwise queries return
-- "permission denied" *before* the RLS policy ever runs, which makes it
-- impossible to assert that RLS correctly returned an empty result.
--
-- Mirror the Supabase default-grant posture for both roles on every table
-- we own. service_role already has superuser-equivalent access.
-- ============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- The standard Supabase baseline: full DML for anon + authenticated, RLS gates.
grant select, insert, update, delete on
  public.currencies,
  public.fx_rates,
  public.households,
  public.household_members,
  public.household_invites,
  public.accounts,
  public.categories,
  public.categorization_rules,
  public.transactions,
  public.budgets,
  public.bills,
  public.bill_instances,
  public.import_profiles,
  public.import_batches,
  public.fx_overrides
to anon, authenticated;

-- Sequence ownership (uuid generators use gen_random_uuid, but some
-- future columns may use bigserial; lock the grant in now).
grant usage, select on all sequences in schema public to anon, authenticated;

-- The `tests` schema and its helper functions are created at test time
-- (see supabase/tests/_lib/helpers.sql). The grants on that schema are
-- also set up by the helpers file, since the schema doesn't exist here.

-- ============================================================================
-- RLS — enable on every table
-- ============================================================================

alter table public.currencies             enable row level security;
alter table public.fx_rates                enable row level security;
alter table public.households              enable row level security;
alter table public.household_members       enable row level security;
alter table public.household_invites       enable row level security;
alter table public.accounts                enable row level security;
alter table public.categories              enable row level security;
alter table public.categorization_rules    enable row level security;
alter table public.transactions            enable row level security;
alter table public.budgets                 enable row level security;
alter table public.bills                   enable row level security;
alter table public.bill_instances          enable row level security;
alter table public.import_profiles         enable row level security;
alter table public.import_batches          enable row level security;
alter table public.fx_overrides            enable row level security;

-- ============================================================================
-- RLS policies
-- ============================================================================

-- Reference tables: currencies, fx_rates — readable by anyone authenticated,
-- writable only by the service role (no policy = only service_role bypasses RLS).
create policy currencies_read on public.currencies
  for select to authenticated using (true);

create policy fx_rates_read on public.fx_rates
  for select to authenticated using (true);

-- households: visible to members; mutating requires owner role (insert is
-- handled by create_household RPC in #12).
create policy households_select on public.households
  for select to authenticated using (public.is_member(id));

create policy households_update on public.households
  for update to authenticated
  using (public.is_member(id) and exists (
    select 1 from public.household_members
    where household_id = households.id
      and user_id = auth.uid()
      and role = 'owner'
  ))
  with check (public.is_member(id));

-- household_members: visible to fellow members; self-insert via accept_invite
-- RPC; deletion restricted to owners.
create policy household_members_select on public.household_members
  for select to authenticated using (public.is_member(household_id));

create policy household_members_delete on public.household_members
  for delete to authenticated
  using (exists (
    select 1 from public.household_members self
    where self.household_id = household_members.household_id
      and self.user_id = auth.uid()
      and self.role = 'owner'
  ));

-- household_invites: visible to members of the household. Creation/deletion
-- is owned by the invite flow (Resend → RPC) in #15.
create policy household_invites_select on public.household_invites
  for select to authenticated using (public.is_member(household_id));

-- Household-scoped tables: one policy each, parameterized by household_id.
-- Convention: any member can SELECT and INSERT; UPDATE/DELETE is open to
-- any member too (the audit log is the source of truth for "who changed
-- what"; for stricter rules, scope by role below).

create policy accounts_all on public.accounts
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy categories_all on public.categories
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy categorization_rules_all on public.categorization_rules
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy transactions_all on public.transactions
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy budgets_all on public.budgets
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy bills_all on public.bills
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy bill_instances_all on public.bill_instances
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy import_profiles_all on public.import_profiles
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy import_batches_all on public.import_batches
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy fx_overrides_all on public.fx_overrides
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));
