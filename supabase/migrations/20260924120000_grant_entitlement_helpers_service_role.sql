-- Issue #264: route handlers are the trusted server surface for plan
-- gating, and the first server-side gate is /api/export, which re-checks
-- the plan with the same has_feature() helper the RLS policies use so the
-- UI gate is never the boundary. Migration 20260923010241 granted execute
-- on the billing helpers to authenticated only; a route handler runs as
-- service_role, so calling the helper from one would fail with
-- "permission denied for function has_feature". Grant what server code
-- needs — service role is trusted with the definer helpers' answer, same
-- trust tier the webhook service code already holds.
--
-- feature_limit rides along in the same grant: it is the companion helper
-- for counted features (feature_limit trigger, #261) and server code will
-- need it for the same surfaces has_feature already answers. has_feature
-- resolves the plan through household_plan() internally, so household_plan
-- must be executable too — otherwise the first server-side has_feature
-- call dies with "permission denied for function household_plan". The
-- fx precedent grants per function as the need appears
-- (20260814060000); all three form one call chain here.
--
-- The helpers are SECURITY INVOKER (20260923031939 hardening), so the
-- service role also needs SELECT on the catalogue/subscription tables the
-- helpers read — tables it could otherwise not touch at all locally
-- (billing migrations grant SELECT to authenticated only). service_role
-- bypasses RLS by design and is the trusted tier; these reads are the
-- minimum the two helpers execute.

grant execute on function public.household_plan(uuid) to service_role;
grant execute on function public.has_feature(uuid, text) to service_role;
grant execute on function public.feature_limit(uuid, text) to service_role;

grant select on public.subscriptions to service_role;
grant select on public.plan_features to service_role;
