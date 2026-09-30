-- Admin boundary hardening from PR #300 review (issue #271, epic #255).
--
-- 1. The roster and the membership table are mutually exclusive PER
--    IDENTITY. is_admin() and is_member() are disjoint checks, but nothing
--    stopped the same auth user id from holding rows in BOTH tables — and a
--    principal who is both admin and member reads transaction contents
--    through ordinary household RLS, collapsing the boundary the previous
--    migration built. The two triggers below close both insertion
--    directions, so an overlapping principal cannot be created: granting an
--    admin role to a household member fails, and adding an admin as a
--    household member fails. Admins who need personal access use a separate
--    non-admin identity (see docs/admin-boundary.md).
--
-- 2. Audit evidence outlives the audited rows. admin_audit_log.
--    target_household carried ON DELETE SET NULL, so deleting a household
--    rewrote history to erase which household an action targeted — the table
--    was not append-only. The column is now a plain UUID (no foreign-key
--    action): the id survives as evidence while household deletion stays
--    unblocked. Same for actor: OFFBOARDING an admin must not be blocked by
--    RESTRICT, and the id is the evidence. Proven by
--    supabase/tests/37_admin_role_exclusion.sql.

-- ============================================================================
-- 1. Mutual exclusion: one identity, one side of the boundary
-- ============================================================================

create or replace function public.tg_reject_admin_membership_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_TABLE_NAME = 'admin_users' then
    if exists (select 1 from public.household_members where user_id = NEW.user_id) then
      raise exception 'admin identity % already holds household membership (roles are mutually exclusive, #271)', NEW.user_id
        using errcode = '23514';
    end if;
  elsif TG_TABLE_NAME = 'household_members' then
    if exists (select 1 from public.admin_users where user_id = NEW.user_id) then
      raise exception 'household member % holds an admin role (roles are mutually exclusive, #271)', NEW.user_id
        using errcode = '23514';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists admin_users_reject_membership_overlap on public.admin_users;
create trigger admin_users_reject_membership_overlap
  before insert or update of user_id on public.admin_users
  for each row execute function public.tg_reject_admin_membership_overlap();

drop trigger if exists household_members_reject_admin_overlap on public.household_members;
create trigger household_members_reject_admin_overlap
  before insert or update of user_id on public.household_members
  for each row execute function public.tg_reject_admin_membership_overlap();

comment on function public.tg_reject_admin_membership_overlap() is
  'Issue #271 (review): admin_users and household_members are mutually exclusive per identity in both directions. A principal who is both would read transaction contents through household RLS.';

-- ============================================================================
-- 2. Audit columns are evidence, not references: drop the FK actions
-- ============================================================================

alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_target_household_fkey;

alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_actor_fkey;

comment on column public.admin_audit_log.target_household is
  'Evidence of which household an action targeted. Plain UUID with no foreign-key action by design (#271 review): household deletion must neither be blocked nor rewrite history to NULL.';
comment on column public.admin_audit_log.actor is
  'Evidence of which identity acted. Plain UUID with no foreign-key action by design (#271 review): offboarding an admin must not be blocked, and the id is the evidence.';
