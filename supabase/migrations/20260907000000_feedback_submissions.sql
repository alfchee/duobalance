-- Persist qualitative feedback alongside email delivery so the metrics report can
-- count submissions and list answers. Stores household and user, submission time,
-- and the answers. Keeps email path unchanged; RLS restricts reads to any
-- member of the submitting household (is_member) for household-scoped rows,
-- or to the submitting user for null-household rows; service_role bypasses RLS for admin tooling.

create table public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete set null,
  user_id uuid not null,
  member_id uuid references public.household_members(id) on delete set null,
  category text not null check (category in ('problem_report', 'satisfaction_prompt', 'general')),
  message text not null default '' check (char_length(message) <= 4000),
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.feedback_submissions is
  'User-written free text, may contain personal detail. Keep out of diagnostic exports. Household-scoped via household_id; service_role bypasses RLS for admin tooling.';
comment on column public.feedback_submissions.household_id is
  'Null when the user has no household (diagnostics.householdId = none). RLS then restricts reads to the submitting user.';
comment on column public.feedback_submissions.diagnostics is
  'DiagnosticContext snapshot as JSON; callers must not put financial data in it (assertNoFinancialData).';

create index feedback_submissions_household_created_idx
  on public.feedback_submissions (household_id, created_at desc);
create index feedback_submissions_user_created_idx
  on public.feedback_submissions (user_id, created_at desc);
create index feedback_submissions_category_idx
  on public.feedback_submissions (category);
create index feedback_submissions_created_idx
  on public.feedback_submissions (created_at desc);

alter table public.feedback_submissions enable row level security;

-- Authenticated users can insert for their own household (or no household). Enforce user_id = auth.uid() to prevent spoofing.
create policy feedback_submissions_insert_authenticated
  on public.feedback_submissions for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      household_id is null
      or public.is_member(household_id)
    )
  );

-- Authenticated users can read feedback for households they belong to (any member can see
-- all household feedback), or their own when household is null.
create policy feedback_submissions_select_authenticated
  on public.feedback_submissions for select to authenticated
  using (
    (household_id is not null and public.is_member(household_id))
    or (household_id is null and user_id = auth.uid())
  );

-- No update/delete via RLS; only service_role (admin) can modify if needed. Authenticated users cannot update/delete their own submissions to keep history.
-- Intentionally no update/delete policies for authenticated.

grant select, insert, update, delete on public.feedback_submissions to anon, authenticated;
-- service_role bypasses RLS, no extra grant needed for admin tooling; anon grant lets RLS decide (baseline in 20260101000011_helpers_triggers_rls.sql)
