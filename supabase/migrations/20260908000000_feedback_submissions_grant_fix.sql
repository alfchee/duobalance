-- Fix grant divergence for feedback_submissions (PR 216 CI: 25_feedback_submissions.sql 11-12).
-- Baseline in 20260101000011_helpers_triggers_rls.sql grants select,insert,update,delete
-- to anon,authenticated and lets RLS decide. For feedback_submissions we intentionally
-- diverge: anon needs select (so is_empty returns 0 rows via RLS, not 42501 permission
-- denied before RLS), but only authenticated may insert, and update/delete are
-- intentionally not granted to anyone except service_role (history is immutable;
-- RLS has no update/delete policies). The previous migration granted
-- select,insert,update,delete to anon,authenticated, which made
--   update/delete as authenticated succeed at the grant level and then hit RLS
--   with no policy → 0 rows affected, not 42501, breaking the pgTAP
--   throws_ok('42501') expectation. Revoke the extra privileges and re-grant
--   the intended minimal set.

revoke all on public.feedback_submissions from anon, authenticated;

grant select on public.feedback_submissions to anon, authenticated;
grant insert on public.feedback_submissions to authenticated;
-- no update/delete grant — only service_role (bypasses RLS) may modify history
-- service_role bypasses RLS, no extra grant needed for admin tooling
