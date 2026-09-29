# ADR 0005 — Admin access model

- Status: Accepted (2026-09-29)
- Decides: #271
- Parent epic: #255 (Phase A: SaaS layer, provider-independent)
- Follows: ADR 0001 (plan catalogue)

## Context

Support needs to answer "what plan is this household on, why did access
change, when does it renew" without ever seeing what the household spent.
An admin session that could reach transaction rows — or step into a
household session — would collapse the tenancy boundary RLS enforces, so
the admin surface is a separate deployment with its own session and a
data layer that cannot return transaction rows at all.

## Decision

- **Separate deployment, separate session.** The admin app deploys to
  `admin.duobalanceapp.com` (Cloudflare custom domain on a second Worker /
  second Vercel project, same repo) with `ADMIN_APP_URL` as its canonical
  origin. Cookies are domain-scoped, so an admin login never creates a
  household session and a user login never creates an admin session. The
  user app never links to the admin origin; the admin origin never links
  back with credentials.
- **Roster, not membership.** `public.admin_users` lists admin user ids with
  a role (`support` / `billing` / `super`). `public.is_admin()` is the only
  check; it never consults `household_members`, and `is_member()` never
  consults the roster. Owner-but-not-admin is not admin; admin-but-not-
  member is admin yet reads zero household rows through RLS.
- **Purpose-built readers, counts only.** `admin_list_households`,
  `admin_get_household`, `admin_get_subscription_history` and
  `admin_get_billing_events` (all `SECURITY DEFINER`, `search_path = ''`,
  revoked from `public`, granted to `authenticated`) check `is_admin()`
  first and return billing state + aggregate counts. The only contact with
  `transactions` is `count(*)`; description, amount, merchant, notes,
  category and account names never appear in a signature or a body, and
  billing events expose metadata without the payload. Route handlers mirror
  the same allowlist (`src/lib/admin/scope.ts`) on the service role.
- **Audit everything.** `admin_log_action()` appends actor, action, target
  household, reason, before/after state and timestamp; every admin route
  calls it (via the service role scoped to the caller) on success. Tables
  have RLS with no authenticated policies — service-role + DEFINER only.
- **No impersonation, ever.** There is no "act as member" function, helper,
  endpoint or button, and none may be added: a support question that feels
  like it needs contents is answered with a better event log instead (#272
  builds that log on this foundation). A source scan
  (`src/lib/admin/boundary.test.ts`) fails the build on the string
  `impersonat` outside this ADR and the boundary doc.
- **Neutral denial + hardening headers.** Flag-off, unauthenticated,
  non-admin and unknown-id all return the same `{ error: "not found" }`
  404 with `no-store`; security headers (`nosniff`, `DENY`, `no-referrer`)
  ship on every admin response, with CDN-level framing headers documented
  in `docs/admin-boundary.md`.

## Consequences

- #272–#275 build list/detail/override/coupon/metrics screens on these
  readers without touching the boundary; any new field needs a migration
  - allowlist + pgTAP update, never an inline select.
- The service-role key stays server-side (`app/api/**` + `lib/supabase/`
  server only); the admin UI calls `apiFetch` against same-origin routes.
- While `BILLING_ENABLED` is off the admin surface 404s everywhere and
  entitlements evaluate as entitled — the admin app cannot leak what does
  not yet exist.
