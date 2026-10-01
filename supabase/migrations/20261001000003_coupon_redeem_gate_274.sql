-- Issue #274 review follow-up (PR #303): lock member redemption behind
-- the billing flag boundary. Forward-only.
--
-- redeem_coupon() was granted to `authenticated`, making it directly
-- callable via PostgREST by any household member with no BILLING_ENABLED
-- check anywhere in the path. The database has no flag concept by design
-- (gating lives at the route layer via isBillingEnabled()), and no
-- consumer exists yet — redemption changes no entitlements until #268
-- wires the gated checkout, so the grant was all exposure and no function.
-- It is revoked here; #268 re-grants it if and only if redemption ships
-- through a billing-gated route, exactly like the webhook and cron
-- surfaces. Service-role/admin paths are unaffected (service role
-- bypasses grants; the admin RPCs never called it).
--
-- pgTAP file 41 pins the absence (has_function_privilege) and grants
-- test-locally for behavioral coverage — the file rolls back, production
-- stays locked.

revoke execute on function public.redeem_coupon(text, uuid) from authenticated;

comment on function public.redeem_coupon(text, uuid) is
  'Issue #268 substrate, gated by #274: member redeems a known code. EXECUTE revoked from authenticated until redemption ships through a billing-gated route (#268) — direct RPC would bypass BILLING_ENABLED. Distinct reasons per failure mode; counts under a coupon row lock.';
