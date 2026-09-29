# Admin boundary

The admin app holds billing state across every household. It is a **separate
deployment with its own access boundary**, not a route inside the user app.
This note is the map a future contributor needs so they do not accidentally
add the one feature that must never exist.

## Deployment separation

- **Separate origin.** Production admin lives at
  `https://admin.duobalanceapp.com` (staging: `https://admin-staging.`
  `duobalanceapp.com`). It deploys from this same repo as a second target:
  a Cloudflare custom domain on a second Worker (or a second Vercel project
  with `ADMIN_APP_URL` set to the admin origin). The user app never links to
  the admin origin and the admin origin never deep-links back with
  credentials.
- **Separate session.** Both deployments use the same Supabase Auth backend,
  but cookies are domain-scoped: signing in at `admin.` creates a session
  that the user app never sends, and vice versa. An admin session grants no
  household session; a household session grants no admin session. There is
  no shared storage, no token forwarding, and no "switch context" endpoint.
- **Separate gating.** `BILLING_ENABLED` (server) + `NEXT_PUBLIC_BILLING_`
  `ENABLED` (client mirror) gate every admin screen and route exactly like
  checkout and webhooks (#262). While the flag is off the admin surface
  404s everywhere — the single accessor `isBillingEnabled()` in
  `src/lib/billing/enabled.ts` is the only reader; the CI guard enforces it.

Set `ADMIN_APP_URL` (canonical admin origin) in `.env.example`, `wrangler.`
`toml [vars]`, and the admin deployment's dashboard vars. The service-role
key (`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`) stays server-side:
`app/api/**` and `lib/supabase/server.ts` only — the existing leak guard
(source grep + bundle JWT-payload grep in CI) covers the admin routes too.

## Data boundary

Admin access goes through **purpose-built functions that cannot return
transaction rows**, never through general-purpose queries trusted to behave:

| Function                         | Returns                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `admin_list_households`          | household id/name/country/created + plan, status, period ends, comped flag + member/account/transaction **counts** |
| `admin_get_household`            | same, for one household                                                                                            |
| `admin_get_subscription_history` | every subscription row (plan/provider/status/timestamps) — the "why did access change" log                         |
| `admin_get_billing_events`       | billing-event metadata (provider, event id, type, timestamps) — **never the payload**                              |
| `admin_log_action`               | appends the audit row                                                                                              |

All are `SECURITY DEFINER` with `set search_path = ''`, revoked from
`public`, granted to `authenticated`, and check `public.is_admin()` first
(42501 otherwise). Tables (`admin_users`, `admin_audit_log`) have RLS with
**no authenticated policies** — service-role + DEFINER only. The only
contact with `transactions` anywhere in the migration is `count(*)`; there
is no description/amount/merchant/notes/category/account-name column in any
signature or body. Proven by `supabase/tests/36_admin_access_model.sql`,
which attempts the forbidden reads directly against the data layer.

Route handlers (`src/app/api/admin/**`) run on the service role scoped to
the caller: verify JWT → roster lookup in `admin_users` (never
`is_member()`) → allowlisted reads (`src/lib/admin/scope.ts` mirrors the
SQL allowlist) → audit write. The client calls them via `apiFetch`
(same-origin; `NEXT_PUBLIC_API_BASE_URL` routing for Tauri holds).

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
the same `{ error: "not found" }` 404 as flag-off, unauthenticated, and
unknown-id. No 401/403 distinction, no "admins only" copy — a probe learns
nothing about whether the resource exists. The UI mirrors it with the
framework not-found boundary (`AdminGate`).

Every admin response carries `Cache-Control: private, no-store`, `Pragma:`
`no-cache`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
`Referrer-Policy: no-referrer` (see `ADMIN_NO_STORE_HEADERS`). CDN layers
add framing upstream: Vercel `headers` in `vercel.json` for `/admin/*` and
`/api/admin/*`; Cloudflare Transform Rules for the admin Worker domain.

## Adding to the admin app (#272+)

1. New field → new migration after `20260929000000` + RLS/pgTAP update.
   Counts and billing metadata only; transaction contents need an ADR, not
   a PR.
2. New env var → `.env.example` with the right scope; server secrets stay
   out of `NEXT_PUBLIC_*`.
3. New route → `requireAdmin()` + allowlisted projection + audit call. Copy
   `src/app/api/admin/households/route.ts`, not a user route.
4. Run `npm run check`, `npm run db:test`, and the Tauri export smoke test
   before pushing.
