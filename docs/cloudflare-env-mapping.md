# Cloudflare environment mapping

Source of truth for Vercel → Wrangler migration (#156). Every `process.env` access in
`src/` must resolve correctly on Cloudflare Workers via `wrangler.toml` `[vars]` (public)
or `wrangler secret put` (secrets). `process.env` is kept in handlers to minimise the
migration diff — OpenNext's `populateProcessEnv` (`open-next/cloudflare/init.js:60`)
copies the Worker's `env` into `process.env` at request time, so existing handler code
resolves without a `getCloudflareContext().env` refactor. The custom `worker.ts:scheduled`
does the same via `populateProcessEnv(env)` for cron dispatch.

## Public vars — `wrangler.toml` `[vars]`

Safe to commit and to ship in the client bundle (`NEXT_PUBLIC_*`). Deployed via
`wrangler deploy`. Override per-environment in the Cloudflare dashboard when needed
(Workers & Pages → duobalance → Settings → Variables). Local dev: `.dev.vars`
(gitignored) or `.env.local`.

| Env var                                | Vercel                        | Cloudflare | Type   | Notes                                                                                                                         |
| -------------------------------------- | ----------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Environment Variable          | `[vars]`   | public | Supabase project URL — same value runtime and build-time                                                                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Environment Variable          | `[vars]`   | public | Browser-safe key (`sb_publishable_…`). Preferred over anon JWT.                                                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | Environment Variable (legacy) | `[vars]`   | public | Compat alias — `src/lib/env.ts:25` falls back to it                                                                           |
| `NEXT_PUBLIC_API_BASE_URL`             | Environment Variable          | `[vars]`   | public | `""` on web (same-origin). Absolute URL only for `tauri://localhost`                                                          |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`         | Environment Variable          | `[vars]`   | public | Client VAPID key for push subscription                                                                                        |
| `VAPID_PUBLIC_KEY`                     | Environment Variable          | `[vars]`   | public | Server alias for `web-push` (`src/lib/web-push.ts:15`). Same material as above; kept separate to avoid handler churn per #156 |
| `APP_URL`                              | Environment Variable          | `[vars]`   | public | Deployed origin (`https://duobalance.app`) — builds invite accept links                                                       |
| `FEEDBACK_RECIPIENT_EMAIL`             | Environment Variable          | `[vars]`   | public | Recipient for `feedback` route (`src/lib/feedback-email.ts:26`)                                                               |
| `RESEND_FROM`                          | Environment Variable          | `[vars]`   | public | `From` header (`DuoBalance <hola@duobalance.app>`)                                                                            |
| `RESEND_REPLY_TO`                      | Environment Variable          | `[vars]`   | public | Optional reply-to for Resend — public email address                                                                           |

## Secrets — `wrangler secret put` / dashboard secrets

Never in `[vars]`, never in git, never in a client bundle. Bypasses RLS or enables
paid services. Set via `wrangler secret put <NAME>` or dashboard → Variables → Secrets.
Local dev: `.dev.vars` (gitignored) — `wrangler dev` loads it automatically; do not
commit `.dev.vars`.

| Env var                     | Vercel                                       | Cloudflare            | Type   | Notes                                                                                                                           |
| --------------------------- | -------------------------------------------- | --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY` | Environment Variable (secret)                | `wrangler secret put` | secret | Service-role JWT — **bypasses RLS**. Guarded by `src/lib/supabase/server.ts:19` and CI grep                                     |
| `SUPABASE_SECRET_KEY`       | Environment Variable (secret, `sb_secret_…`) | `wrangler secret put` | secret | New Supabase secret format alias for the same role                                                                              |
| `EXCHANGERATE_API_KEY`      | Environment Variable (secret)                | `wrangler secret put` | secret | `src/lib/fx/provider.ts:42` — fx-refresh cron                                                                                   |
| `RESEND_API_KEY`            | Environment Variable (secret)                | `wrangler secret put` | secret | `src/lib/invite-email.ts:8`, `feedback-email.ts:23`, `bill-reminder-email.ts:10`                                                |
| `CRON_SECRET`               | Environment Variable (secret)                | `wrangler secret put` | secret | Manual `/api/cron/*` Bearer auth (`src/app/api/cron/*/route.ts:51`). True Cloudflare cron uses `scheduled()` dispatch, not HTTP |
| `VAPID_PRIVATE_KEY`         | Environment Variable (secret)                | `wrangler secret put` | secret | `src/lib/web-push.ts:16` — push signing                                                                                         |
| `VAPID_SUBJECT`             | Environment Variable (secret)                | `wrangler secret put` | secret | `src/lib/web-push.ts:14` — `mailto:` subject                                                                                    |

Additional secret **not in Worker runtime** (scripts only): `SUPABASE_DB_URL` — used by
`scripts/generate-metrics-report.mjs:8` via Session Pooler, not bound to the Worker.

## Invariants

- No secret is renamed to a `NEXT_PUBLIC_*` name. `SUPABASE_SERVICE_ROLE_KEY`,
  `EXCHANGERATE_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT` remain server-only.
- No secret appears in `wrangler.toml` `[vars]` or in a built client bundle.
  Verified by CI: `npm run check` includes a bundle grep (see `scripts/verify-cloudflare-env.mjs`)
  and a `wrangler.toml` guard against `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
  `EXCHANGERATE_API_KEY`, `CRON_SECRET`, `VAPID_PRIVATE_KEY` in `[vars]`.
- Every handler resolves its configuration on Cloudflare via `process.env` populated
  from the Worker `env` (OpenNext `populateProcessEnv` for `fetch`, `worker.ts:45`
  for `scheduled`). No handler was migrated to `getCloudflareContext()` in this issue.

## Local development

```bash
# 1. Copy the example vars — fill real secrets locally, never commit.
cp .dev.vars.example .dev.vars   # if present, else create from .env.local
# .dev.vars is gitignored; wrangler dev loads it. .env.local also works for `next dev`.

# 2. Set secrets for deployed preview/production:
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put EXCHANGERATE_API_KEY
wrangler secret put RESEND_API_KEY
wrangler secret put CRON_SECRET
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_SUBJECT
# Optional if using the new format:
wrangler secret put SUPABASE_SECRET_KEY

# 3. Public vars are already in wrangler.toml [vars]; to override per-env:
# Dashboard → Workers & Pages → duobalance → Settings → Variables
```

## Verification

```bash
# After `npm run build && npx opennextjs-cloudflare build`:
# - wrangler.toml contains no secret in [vars]
# - client bundle (.open-next/assets) contains no secret
npm run check  # includes verify-cloudflare-env guard
node scripts/verify-cloudflare-env.mjs --build  # explicit bundle grep after a build
```
