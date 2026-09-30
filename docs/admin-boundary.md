# Admin boundary

The admin app holds billing state across every household. It is a **separate
deployment with its own access boundary**, not a route inside the user app.
This note is the map a future contributor needs so they do not accidentally
add the one feature that must never exist.

## Deployment separation

- **Separate origin.** Production admin lives at
  `https://admin.duobalanceapp.com`. It deploys from this same repo as a
  second target: `wrangler deploy --env admin` (the `duobalance-admin`
  Worker, custom domain added via the Dashboard) or a second Vercel project
  with `ADMIN_APP_URL` set to the admin origin. The user app never links to
  the admin origin and the admin origin never deep-links back with
  credentials.
- **Separate session.** Both deployments use the same Supabase Auth backend,
  but cookies are domain-scoped: signing in at `admin.` creates a session
  that the user app never sends, and vice versa. An admin session grants no
  household session; a household session grants no admin session. There is
  no shared storage, no token forwarding, and no "switch context" endpoint.
- **Separate gating, enforced per target.** `BILLING_ENABLED` (server) +
  `NEXT_PUBLIC_BILLING_` `ENABLED` (client mirror) gate every admin screen
  and route exactly like checkout and webhooks (#262). While the flag is off
  the admin surface 404s everywhere — the single accessor
  `isBillingEnabled()` in `src/lib/billing/enabled.ts` is the only reader;
  the CI guard enforces it. On top of the flag, `APP_MODE` (server-only,
  read in `src/app/api/admin/_shared.ts`) denies per deployment target:
  `APP_MODE=user` never serves admin (production and staging user Workers),
  `APP_MODE=admin` serves admin **only** when the request host matches
  `ADMIN_APP_URL`. Unset means "serve" and is the local-dev default. The
  second Vercel project is Dashboard-side; set `APP_MODE=user` there too.
- **Production checklist.** The production user Worker needs
  `APP_MODE=user` in Dashboard → Variables (the file cannot pin it: top-level
  `[vars]` doubles as local-dev defaults, where unset must stay allowed).
  Without it the user domain would serve admin routes once billing goes live
  (still roster-gated + neutral 404s, but no longer denied by target).

Set `ADMIN_APP_URL` (canonical admin origin) in `.env.example`, `wrangler.`
`toml [vars]`, and the admin deployment's dashboard vars. The service-role
key (`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`) stays server-side:
`app/api/**` and `lib/supabase/server.ts` only — the existing leak guard
(source grep + bundle JWT-payload grep in CI) covers the admin routes too.
Admin routes themselves never use the service role (see below).

## Data boundary

Admin access goes through **purpose-built functions that cannot return
transaction rows**, never through general-purpose queries trusted to behave:

| Function                         | Returns                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `admin_list_households`          | household id/name/country/created + plan, status, period ends, comped flag + member/account/transaction **counts** |
| `admin_get_household`            | same, for one household                                                                                            |
| `admin_get_subscription_history` | every subscription row (plan/provider/status/timestamps) — the "why did access change" log                         |
| `admin_get_billing_events`       | billing-event metadata (provider, event id, type, timestamps) — **never the payload**                              |
| `admin_log_action`               | appends the audit row (throws on failure — the action then fails instead of succeeding unaudited)                  |

All are `SECURITY DEFINER` with `set search_path = ''`, revoked from
`public`, granted to `authenticated`, and check `public.is_admin()` first
(42501 otherwise). Tables (`admin_users`, `admin_audit_log`) have RLS with
**no authenticated policies** — DEFINER functions only. The only contact
with `transactions` anywhere in the migration is `count(*)`; there is no
description/amount/merchant/notes/category/account-name column in any
signature or body. Proven by `supabase/tests/36_admin_access_model.sql`,
which attempts the forbidden reads directly against the data layer.

Route handlers (`src/app/api/admin/**`) call those functions through the
caller-scoped client (`createSupabaseUserClient()`: public key + caller
JWT, so RLS + `is_admin()` enforce at the database boundary): verify JWT →
`is_admin()` RPC → data RPCs → `admin_log_action()` RPC. Rows are
additionally projected through the allowlist in `src/lib/admin/scope.ts` as
defense in depth — a future widened function output still cannot leak
through the route (pinned by a test that smuggles an extra column). The
client calls the routes via `apiFetch` (same-origin;
`NEXT_PUBLIC_API_BASE_URL` routing for Tauri holds).

## One identity, one side

`is_admin()` and `is_member()` are disjoint checks, but disjoint checks
alone do not stop the same auth user from holding rows in **both**
`admin_users` and `household_members` — and a principal who is both reads
transaction contents through ordinary household RLS. So the two tables are
mutually exclusive per identity, enforced by triggers in **both** insertion
directions (`20260930000000_admin_role_exclusion.sql`): granting an admin
role to a member fails, and adding an admin as a member fails (INSERT and
UPDATE paths). Proven by `supabase/tests/37_admin_role_exclusion.sql`,
which attempts the overlapping principal. Admins who need personal access
use a separate non-admin identity.

## Audit evidence

`admin_audit_log` is append-only **evidence**, not a relational child:
`target_household` and `actor` are plain UUIDs with no foreign-key action,
so deleting a household preserves which household an action targeted
instead of nulling it, household deletion is never blocked by history, and
offboarding an admin is never blocked by `RESTRICT`. Every successful admin
action appends exactly one row; a failed audit write fails the action
(fail closed — a silent gap is worse than a failed support read).

## Why there is no impersonation

This is a **product decision, not an oversight**. Stepping into a
household session — even read-only, even with consent logging — would give
the admin deployment the exact capability the data layer was built to deny:
access to financial records users entered in confidence. Every support
scenario so far resolves with billing state + counts + a good event log;
when contents feel necessary, the fix is a better log (#272), not a bypass.
So: no "act as", no "view as member", no session minting, no token
exchange — in SQL, in routes, and in UI. The vitest boundary scan fails on
the string `impersonat` anywhere in `src/` outside this paragraph's
allowlist, so a helpful future PR cannot land one quietly.

## Denial and headers

An authenticated non-admin reaching an admin URL gets the **neutral denial**:
the same `{ error: "not found" }` 404 as flag-off, wrong-target,
unauthenticated, and unknown-id. No 401/403 distinction, no "admins only"
copy — a probe learns nothing about whether the resource exists. The UI
mirrors it with the framework not-found boundary (`AdminGate`, and the
login page 404s while billing is off).

Every admin response carries `Cache-Control: private, no-store`, `Pragma:`
`no-cache`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
`Referrer-Policy: no-referrer` (see `ADMIN_NO_STORE_HEADERS`). CDN layers
add framing upstream: Vercel `headers` in `vercel.json` for `/admin/*` and
`/api/admin/*`; Cloudflare Transform Rules for the admin Worker domain.

## Adding to the admin app (#272+)

1. New field → new migration after `20260930000001` + RLS/pgTAP update.
   Counts and billing metadata only; transaction contents need an ADR, not
   a PR.
2. New env var → `.env.example` with the right scope; server secrets stay
   out of `NEXT_PUBLIC_*`.
3. New route → `requireAdmin(request)` + data/audit RPCs on the
   caller-scoped client + allowlisted projection. Copy
   `src/app/api/admin/households/route.ts`, not a user route. Never
   `.from()` a table in an admin route — if no reader covers the need,
   add a migration, not a query.
4. Run `npm run check`, `npm run db:test`, and the Tauri export smoke test
   before pushing.
