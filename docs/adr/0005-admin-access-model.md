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

- **Separate deployment, separate session, enforced per target.** The admin
  app deploys to `admin.duobalanceapp.com` (`wrangler deploy --env admin`,
  same repo) with `ADMIN_APP_URL` as its canonical origin. Cookies are
  domain-scoped, so an admin login never creates a household session and a
  user login never creates an admin session. The user app never links to the
  admin origin; the admin origin never links back with credentials. Beyond
  the shared `BILLING_ENABLED` gate, `APP_MODE` denies per target:
  `APP_MODE=user` (production + staging user Workers) never serves admin,
  `APP_MODE=admin` serves admin only when the request host matches
  `ADMIN_APP_URL`; unset is the local-dev default where the flag still
  gates.
- **Roster, not membership — mutually exclusive per identity.**
  `public.admin_users` lists admin user ids with a role (`support` /
  `billing` / `super`). `public.is_admin()` is the only check; it never
  consults `household_members`, and `is_member()` never consults the roster.
  Disjoint checks alone are not enough (the same id could hold rows in both
  tables and read transactions through household RLS), so triggers enforce
  mutual exclusion in both insertion directions — an overlapping principal
  cannot be created. Admins needing personal access use a separate
  non-admin identity.
- **Purpose-built readers, counts only, called — not bypassed.** `admin_`
  `list_households`, `admin_get_household`, `admin_get_subscription_history`
  and `admin_get_billing_events` (all `SECURITY DEFINER`, `search_path =
''`, revoked from `public`, granted to `authenticated`) check `is_admin()`
  first and return billing state + aggregate counts. The only contact with
  `transactions` is `count(*)`; description, amount, merchant, notes,
  category and account names never appear in a signature or a body, and
  billing events expose metadata without the payload. Routes call these
  functions through the caller-scoped client (public key + caller JWT), so
  the database — not TypeScript — enforces authorization and shape; the
  route-level allowlist (`src/lib/admin/scope.ts`) is defense in depth.
- **Audit everything, fail closed.** `admin_log_action()` appends actor,
  action, target household, reason, before/after state and timestamp; every
  admin route calls it on the caller-scoped client (actor = caller,
  enforced by the function). It throws on failure so the action 500s
  instead of succeeding unaudited. Audit columns are plain-UUID evidence
  with no foreign-key action: household deletion preserves (never nulls)
  the target, and offboarding is never blocked. Tables have RLS with no
  authenticated policies — DEFINER functions only.
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
  server only) and admin routes never use it — data and audit run on the
  caller-scoped client; the admin UI calls `apiFetch` against same-origin
  routes.
- While `BILLING_ENABLED` is off the admin surface 404s everywhere and
  entitlements evaluate as entitled — the admin app cannot leak what does
  not yet exist.
