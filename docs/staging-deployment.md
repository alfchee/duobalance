# Staging deployment — #161

> **Gate before production.** Everything above it verifies one concern in isolation —
> the build, the crons, the secrets, the libs, the cookies, the service worker.
> This issue checks them together, on a real deployed Worker, against the existing
> test suite. If a test has to be modified for the new host, that is a signal
> about the host, not the test.

Scope: `staging.duobalanceapp.com` → Cloudflare Workers (assets binding) → its own
Supabase project. Production must not be touched until every checkbox below is
green. Keep Vercel deployed for one full cron cycle as rollback (epic #152 DoD).

> **First deployment?** The project has **never been deployed to Cloudflare**
> before — no `duobalance` Worker exists in your account. This runbook covers
> the full binding from scratch: creating the Cloudflare account + zone,
> authenticating `wrangler`, creating the Worker on first `deploy`, then
> provisioning staging. If the Worker already existed, skip §0–§1.

---

## 0) Prerequisites (manual — one-time, before any `wrangler deploy`)

### 0.1 Cloudflare account + zone

1. Create / log in at <https://dash.cloudflare.com> (Free plan is fine — its
   free tier permits commercial use, unlike Vercel Hobby; see epic #152).
2. If `duobalanceapp.com` is **not yet on Cloudflare**:
   1. **Add site** → enter `duobalanceapp.com` → Free → Cloudflare shows two
      nameservers (e.g. `*.ns.cloudflare.com`).
   2. At your registrar (Namecheap / Porkbun / Route53 …): replace the domain's
      nameservers with the two Cloudflare nameservers, save.
   3. Back in the dashboard wait for **Status: Active** (can take minutes to
      24 h). Until active, custom domains for Workers will still validate via
      `*.workers.dev` but `staging.duobalanceapp.com` won't resolve externally.
   4. **SSL/TLS → Overview → Full (strict)** — Supabase and Resend both require
      strict TLS.
3. Note your **Account ID**: dashboard right sidebar → Account ID (or
   `https://dash.cloudflare.com/<account-id>`). Not needed for login but useful
   for `CLOUDFLARE_API_TOKEN` scoping.

### 0.2 Authenticate `wrangler` to your account

`wrangler` is already in `devDependencies` (`package.json:95`). No global install
needed.

**Option A — interactive (recommended for first deploy):**

```bash
npx wrangler login
# Opens a browser → Authorize → back to terminal:
# "Successfully logged in."
npx wrangler whoami
# → shows your email + Account ID — proves the binding.
```

Credentials are saved to `~/.config/.wrangler/config.toml` (or OS keychain).
`npx wrangler logout` revokes them.

**Option B — headless / CI (`CLOUDFLARE_API_TOKEN`):**

1. Dashboard → My Profile → API Tokens → **Create Token** → **Edit Cloudflare
   Workers** template (or custom with `Account.Workers Scripts:Edit`,
   `Account.Workers Routes:Edit`, `Zone.Workers Routes:Edit`).
2. Export before every `deploy`/`secret put`:

   ```bash
   export CLOUDFLARE_API_TOKEN="<paste>"
   export CLOUDFLARE_ACCOUNT_ID="<account-id>"   # optional but speeds up lookup
   ```

Either auth covers `wrangler deploy`, `secret put/list`, `tail`, and
`opennextjs-cloudflare deploy`.

### 0.3 Staging Supabase project (isolated dataset)

The purge + bill-generation crons **write real rows** (#161 Notes) — staging must
never point at prod.

1. Supabase dashboard → **New project** `duobalance-staging` (same region as prod
   if possible, same `auth.jwt_expiry = 3600`).
2. Save:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` (public).
   - **Publishable key** `sb_publishable_…` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   - **Service role** key (or `sb_secret_…`) → `SUPABASE_SERVICE_ROLE_KEY`.
3. Apply migrations at the same revision as the repo (and prod):

   ```bash
   # Recommended — keeps storage/auth/migrations in sync:
   npx supabase link --project-ref <staging-ref>
   npx supabase db push
   # Or raw psql:
   # psql "$STAGING_DB_URL" -f supabase/migrations/*.sql
   ```

   Seed two staging-only users (`owner+staging@`, `partner+staging@`) in a
   staging-only household to exercise invites/exports without touching prod.

---

## 1) Bind the repo to Cloudflare — create the Worker (first deploy)

Until this runs, **no `duobalance` Worker exists** — the dashboard → Workers &
Pages will be empty and the `wrangler.toml` below is just a local
declaration.

```toml
# wrangler.toml (already committed — the binding source of truth)
name = "duobalance"
main = "./worker.ts"          # custom Worker that wraps .open-next/worker.js
compatibility_date = "2025-09-01"
compatibility_flags = ["nodejs_compat"]
keep_vars = true              # do not wipe Dashboard vars on deploy (see §2.3)
[assets]                      # Workers Assets binding — keeps static files out of the Worker script
directory = ".open-next/assets"
binding = "ASSETS"
[observability] enabled = true
[triggers] crons = ["0 6 * * *", "0 7 * * *", "0 12 * * *", "0 3 * * *"]
[vars]                        # public — safe to embed in client bundle
# ... NEXT_PUBLIC_* , APP_URL , RESEND_FROM ...
[env.staging.vars]            # staging overlay — APP_URL = https://staging.duobalanceapp.com
# NEXT_PUBLIC_SUPABASE_URL / VAPID keys are real staging values (see below)
[[env.staging.routes]]        # keep custom domain after deploys
pattern = "staging.duobalanceapp.com"
zone_name = "duobalanceapp.com"
custom_domain = true
```

custom_domain = true

````

**First build + deploy (creates the Worker in your account):**

```bash
# From repo root, on the branch that should ride staging (usually `dev`):
npm run check                # must be green before any deploy

# OpenNext emits the Worker script + asset directory that `wrangler` uploads.
# The PWA precache must be regenerated *from* that asset directory.
npm run build                # next build → writes public/sw-assets.js from .next
npx opennextjs-cloudflare build
node scripts/generate-service-worker.mjs --opennext

# Validate without publishing (useful before the real binding):
npx wrangler deploy --dry-run           # → lists bindings, asset count, no publish
npx wrangler deploy --dry-run --env staging
node scripts/verify-cloudflare-env.mjs --build
node scripts/verify-pwa-assets.mjs

# Publish — choose one. Either creates `duobalance-staging` if it doesn't exist:
npm run deploy:staging        # → opennext build + sw --opennext + wrangler deploy --env staging --keep-vars
# or explicitly (same, with keep):
npx wrangler deploy --env staging --keep-vars
# or production (after staging is green):
npm run deploy                # → wrangler deploy --keep-vars (top-level [vars])

# Confirm:
npx wrangler deployments list --env staging   # shows active deployment
npx wrangler tail --env staging               # live logs; "could not resolve fetch handler" must NOT appear
````

After the first successful `deploy --env staging` the dashboard will show
**Workers & Pages → `duobalance` → Deployments** and the `*.workers.dev`
preview URL (e.g. `duobalance.<subdomain>.workers.dev`). That preview URL is
already usable; custom domains are next.

> **Naming:** `name = "duobalance"` is shared across envs; `[env.staging]`
> does _not_ rename the Worker, it overlays `vars`/secrets. If you want an
> isolated staging Worker, add `name = "duobalance-staging"` under
> `[env.staging]` in `wrangler.toml` before the first deploy and map DNS to it.
> Current plan keeps a single Worker name — production is top-level `[vars]`,
> staging is `--env staging`.

---

## 2) Configure the staging environment (vars + secrets)

Top-level `[vars]` (production) and `[env.staging.vars]` (staging) hold **public**
values — committed placeholders like `https://example.supabase.co`. **Secrets**
never go in `wrangler.toml`; they bypass RLS or enable paid services and must
not reach a client bundle (guarded by `scripts/verify-cloudflare-env.mjs` +
bundle grep in CI). `wrangler.toml` now has `keep_vars = true` (and
`[env.staging] keep_vars = true`) — see §2.3 — so a deploy keeps Dashboard-only
vars instead of deleting them.

### 2.1 Public vars — staging overlay

`wrangler.toml` already declares `[env.staging.vars]` with:

```
NEXT_PUBLIC_SUPABASE_URL = "https://example-staging.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_example_staging"
NEXT_PUBLIC_SUPABASE_ANON_KEY = "example-anon-key-compat-staging"
NEXT_PUBLIC_API_BASE_URL = ""
NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PUBLIC_KEY
APP_URL = "https://staging.duobalanceapp.com"
FEEDBACK_RECIPIENT_EMAIL / RESEND_FROM / RESEND_REPLY_TO
```

Those placeholders are for `wrangler dev` / CI. The **real staging values**
(§0.3) must live in the Dashboard → **Variables** (not Secrets) — otherwise the
log you saw (`Uploaded duobalance-staging` → `Your Worker has access to … example-staging`)
will overwrite the Dashboard's `https://xfjhzkgaxbycubcsurdn.supabase.co` with
the placeholder on every `npm run deploy:staging`.

For a real deploy, set the real values **once** in the Dashboard:

**A) Dashboard (persistent, recommended for staging):**

Dashboard → Workers & Pages → `duobalance-staging` → **Settings → Variables
→ Staging** (env toggle top-right) → **Edit Variables** → set:

- `NEXT_PUBLIC_SUPABASE_URL` = `https://xfjhzkgaxbycubcsurdn.supabase.co` (your
  staging project, not `example-staging`)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = the staging publishable key (starts
  `sb_publishable_…`, not `example`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = same anon compat if you keep it
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PUBLIC_KEY` = staging VAPID public
- `APP_URL` = `https://staging.duobalanceapp.com`

Those are **Variables**, not Secrets. If you previously added
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` as
**Secrets** (the log's `conflict with existing remote secrets` warning), delete
those two Secrets first, then recreate as Variables.

With `keep_vars = true` (committed in `wrangler.toml` and in
`package.json:30` `deploy:staging --keep-vars`), the next deploy **keeps**
those Dashboard vars and only adds the local `[env.staging.vars]` on top —
placeholders that collide (same key) still overwrite, so the Dashboard value
wins only if the key is **not** in `wrangler.toml`. The placeholders above are
now kept for local `wrangler dev` but the deploy flag prevents deletion of
Dashboard-only vars.

**B) CLI / `.dev.vars` (local workerd / `preview:staging`):**

```bash
# .dev.vars is gitignored; wrangler dev / opennextjs-cloudflare dev load it.
# For --env staging, wrangler dev also loads .dev.vars.<env> if present.
cp .dev.vars.example .dev.vars
# Edit: put real staging values in .dev.vars
npx wrangler dev --env staging          # or:
npm run preview:staging                  # build + sw --opennext + workerd on :8787
```

Check:

```bash
node scripts/verify-cloudflare-env.mjs
# OK: wrangler.toml [vars] contains no secrets
# OK: wrangler.toml [env.staging.vars] contains no secrets
npx wrangler deploy --dry-run --env staging   # lists bindings — compare remote vs local
# Your Worker has access to … should show the Dashboard's real Supabase URL, not example-staging
```

### 2.2 Secrets — staging-scoped `wrangler secret put`

Secrets are env-scoped — `--env staging` isolates them from production. **Do not
add secrets as Variables** — the log showed `EXCHANGERATE_API_KEY`,
`RESEND_API_KEY`, `VAPID_SUBJECT` under `vars` because they had been created as
Variables in the Dashboard. Move them to Secrets:

```bash
# If you see the Warning "conflict with existing remote secrets" for
# NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY,
# or the vars diff lists EXCHANGERATE/RESEND as vars, fix the Dashboard first:
# Dashboard → duobalance-staging → Settings → Variables → delete the var
# EXCHANGERATE_API_KEY, RESEND_API_KEY, VAPID_SUBJECT (and the two
# NEXT_PUBLIC_* secrets) → then recreate the first three as Secrets below
# and the NEXT_PUBLIC_* pair as Variables (§2.1 A).

# One-time per staging Worker — values must match the staging project from §0.3:
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging  # paste, enter
wrangler secret put SUPABASE_SECRET_KEY --env staging        # if using sb_secret_…
wrangler secret put EXCHANGERATE_API_KEY --env staging
wrangler secret put RESEND_API_KEY --env staging
wrangler secret put CRON_SECRET --env staging
wrangler secret put VAPID_PRIVATE_KEY --env staging
wrangler secret put VAPID_SUBJECT --env staging
# VAPID_SUBJECT is `mailto:ops@duobalanceapp.com` — secret per #156.

wrangler secret list --env staging
# → each name above, no value shown. Confirm no secret appears in [vars]:
node scripts/verify-cloudflare-env.mjs
node scripts/verify-cloudflare-env.mjs --build   # after npx opennextjs-cloudflare build
```

Production secrets are set the **same way without `--env staging`** — do not reuse
staging keys for prod.

### 2.3 Why the last `npm run deploy:staging` wiped the Dashboard

The log you pasted ended with:

```
Your Worker has access to … ("https://example-staging.supabase.co") …
▲ [WARNING] … local configuration differs from remote …
  vars: { - EXCHANGERATE… + NEXT_PUBLIC… }   — delete + placeholder overwrite
  "will replace these remote secrets with your environment variables"
```

Because `wrangler deploy` by default **deletes all remote vars** before setting
those from `wrangler.toml`. The Dashboard's `https://xfjhzkg…` and real
`EXCHANGERATE_API_KEY` were removed and replaced by the file's placeholders.
Fix committed:

- `wrangler.toml:6` `keep_vars = true` (and `[env.staging] keep_vars = true`)
  — keeps Dashboard-only vars.
- `package.json:30` `deploy` / `deploy:staging` now run
  `wrangler deploy --keep-vars` (not just `opennextjs-cloudflare deploy`), so a
  Dashboard var not in the file is preserved.
- `[[env.staging.routes]]` now declares `staging.duobalanceapp.com`
  (`custom_domain = true`) so the custom domain is not deleted either.

Still, a var that **is** in `wrangler.toml` (same key) will overwrite the
Dashboard even with `keep_vars`. If you keep the placeholders in
`[env.staging.vars]`, the Dashboard's real Supabase URL will be overwritten
again. Choose one:

- **Keep placeholders for local dev only** and accept that staging deploys will
  overwrite — then set the real values **in** `wrangler.toml` before each
  deploy (commit is okay for `NEXT_PUBLIC_*`), or pass `--var KEY:VALUE` at
  deploy time.
- Or, **delete the `NEXT_PUBLIC_SUPABASE_*` lines from `[env.staging.vars]`**
  and manage them solely in the Dashboard (recommended for the staging Supabase
  URL, which you already set correctly as `https://xfjhzkg…`). `wrangler dev`
  will then read them from `.dev.vars`.

Recovery for the current staging (already overwritten):

```bash
# 1) Fix the Dashboard types (delete wrong vars/secrets):
#    Variables → delete EXCHANGERATE_API_KEY, RESEND_API_KEY, VAPID_SUBJECT
#    Secrets → delete NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY
# 2) Re-create correctly:
#    Variables (staging) → NEXT_PUBLIC_SUPABASE_URL = https://xfjhzkgaxbycubcsurdn.supabase.co
#    Variables (staging) → NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / ANON, VAPID_PUBLIC_KEY, VAPID_PUBLIC_KEY, APP_URL
#    Secrets (staging) → EXCHANGERATE_API_KEY, RESEND_API_KEY, VAPID_SUBJECT (plus the 4 other secrets)
# 3) Verify without publishing:
npx wrangler deploy --dry-run --env staging
# → bindings should now list the real https://xfjhzkg… and real VAPID key, not example-staging
# 4) Redeploy:
npm run deploy:staging
```

---

## 3) Custom domains + DNS (make `staging.duobalanceapp.com` resolve to the Worker)

After §1 the `*.workers.dev` preview is live; a custom domain is optional but
required for the AC `staging.duobalanceapp.com`.

1. Dashboard → Workers & Pages → `duobalance` → **Settings →
   Domains & Routes → Add Custom Domain** → enter `staging.duobalanceapp.com`
   → **Add Domain**. Cloudflare auto-provisions TLS and validates the zone.
   - No `wrangler.toml` `routes` entry is needed for custom domains; dashboard
     routing is authoritative (see comment in `wrangler.toml`).
   - Keep the `*.workers.dev` route — `verify-pwa-assets --live` and fallback
     preview both use it.
2. For production, repeat with `duobalanceapp.com` (only after staging is green).
3. DNS: `staging.duobalanceapp.com` is proxied automatically — no manual `CNAME`
   needed. If adding a zone-routed Worker with `routes` you'd add a proxied
   DNS record, but custom domains need none.
4. Verify:

   ```bash
   dig staging.duobalanceapp.com +short
   curl -i https://staging.duobalanceapp.com/api/health
   # → 200 {status:"ok", buildTarget:"web"}  (and 200 at duobalance.<…>.workers.dev/api/health)
   ```

If your registrar is not yet on Cloudflare (§0.1), the custom domain step will
show **Pending** until nameservers propagate — the `*.workers.dev` URL still
proves the Worker is bound.

---

## 4) Redeploy after wiring (repeatable from here)

```bash
# From repo root, on `dev`:
npm run check
npm run build && npx opennextjs-cloudflare build && node scripts/generate-service-worker.mjs --opennext
node scripts/verify-pwa-assets.mjs
node scripts/verify-cloudflare-env.mjs --build

# Ship staging again (now with real vars/secrets + domain attached):
# --keep-vars is set in wrangler.toml and in package.json:30, so `npx wrangler deploy
# --dry-run --env staging` first should list the real https://xfjhzkg… bindings before you ship.
npm run deploy:staging
# or: npx wrangler deploy --env staging --keep-vars

npx wrangler tail --env staging   # watch for boot errors
```

Local workerd (no Cloudflare publish):

```bash
npm run preview:staging   # or: npx wrangler dev --env staging
# Visit http://localhost:8787
# Cron schedule simulation:
npx wrangler dev --env staging --test-scheduled
# or: curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled" -H "X-Cron: 0 6 * * *"
```

---

## Verification — the actual tasks / AC (follow in order)

### A) `npm run check` + `npm run db:test` unchanged

```bash
# At the repo root, no STAGING_URL — same commands CI runs:
npm run check
# runs: content:build, typecheck, lint, format:check,
#       verify-cloudflare-env, verify-worker-delivery,
#       verify-supabase-cookies, verify-pwa-assets, verify-staging, test, locales:check

npm run db:test
# runs: pg_prove against supabase/tests/*.sql on 127.0.0.1:55322
# For staging, the same migrations run against the staging Supabase project
# via `npx supabase db push` (§0.3). The AC is "pass unchanged".
```

If either fails, fix the code, not the test.

### B) Playwright e2e suite against staging (the “no test modified” proof)

`playwright.config.ts` honours `STAGING_URL` / `PLAYWRIGHT_BASE_URL` /
`E2E_BASE_URL` and disables `webServer` for remote, so every `page.goto('/login')`
stays relative — only `baseURL` changes.

```bash
# No build of 127.0.0.1:3101 — hits the live Worker:
STAGING_URL=https://staging.duobalanceapp.com npm run test:e2e
# Or, the verify harness (also streams the result):
CRON_SECRET=… node scripts/verify-staging.mjs --live --url https://staging.duobalanceapp.com --e2e

# Expected (see e2e/ui-validation.spec.ts):
#  - /login /signup /forgot-password /reset-password → 200 + <main>
#  - /balances /transactions /budget /bills /settings … → redirect to /login when anon
#  - axe @a11y + @visual suites pass without a host-specific branch
```

AC: _the suite passes with no test modified for the host_. If it does not, treat
that as a host defect (next.config rewrites, asset prefix, CSRF, CSP, CORS).

### C) All 13 route handlers — automatically + manually via curl

The `verify-staging` script probes every handler twice (anon gating + authed
cron). For a reproducible manual record, also run the curls:

```bash
export STAGING=https://staging.duobalanceapp.com
export CRON_SECRET="<from wrangler secret list --env staging>"

# 1  Health — no auth, force-static
curl -i $STAGING/api/health
# → 200 {status:"ok", buildTarget:"web"}

# 2  Bills generate — cookie auth (anon → 401)
curl -i -X POST $STAGING/api/bills/00000000-0000-0000-0000-000000000000/generate \
  -H "Content-Type: application/json" -d '{}'
# → 401

# 3-6 Crons — CRON_SECRET gated, no CRON_SECRET → 401
for p in fx-refresh generate-bill-instances purge-households send-bill-reminders; do
  echo "== $p (anon) =="; curl -i $STAGING/api/cron/$p; echo
  echo "== $p (authed) =="; curl -i -H "Authorization: Bearer $CRON_SECRET" $STAGING/api/cron/$p; echo
done
# Authed → {updated:…} / {sent:…} / {purged:…} / {inserted:…} (200).
curl -i -X POST -H "Authorization: Bearer $CRON_SECRET" $STAGING/api/cron/send-bill-reminders

# 7  Export — cookie auth (anon → 401; with session → CSV/zip)
curl -i $STAGING/api/export
# → 401

# 8  Feedback — cookie auth, rate-limited
#    Validation runs before auth (feedbackSchema → 400 for empty body). Send a
#    schema-valid payload to see the auth gate.
curl -i -X POST $STAGING/api/feedback -H "Content-Type: application/json" -d '{}'
# → 400 (validation before auth — endpoint reachable)
curl -i -X POST $STAGING/api/feedback -H "Content-Type: application/json" \
  -d '{"category":"general","message":"probe","diagnostics":{"appVersion":"1.1.0","householdId":"none","memberId":"none","role":"owner","locale":"en","numberFormat":"locale","baseCurrency":"USD","timezone":"UTC","accountCount":0,"transactionCount":0,"isStandalone":false,"isOnline":true,"queuedWrites":0,"userAgent":"probe","lastError":null,"currentRoute":"/"}}'
# → 401 (anon, schema-valid → auth gated)

# 9  POST /api/invites — cookie auth
curl -i -X POST $STAGING/api/invites -H "Content-Type: application/json" -d '{"household_id":"…","email":"…"}'
# → 401 anon

# 10 DELETE /api/invites/[id] — cookie auth
curl -i -X DELETE $STAGING/api/invites/00000000-0000-0000-0000-000000000000
# → 401 anon

# 11 POST /api/invites/[id]/resend — cookie auth
curl -i -X POST $STAGING/api/invites/00000000-0000-0000-0000-000000000000/resend
# → 401 anon

# 12 POST /api/members/remove — cookie auth
curl -i -X POST $STAGING/api/members/remove -H "Content-Type: application/json" -d '{}'
# → 401 anon

# 13 POST /api/push-subscriptions (+ DELETE) — cookie auth, then service-role upsert
#    Like feedback, the handler validates before auth (subscriptionSchema → 400 for {}).
curl -i -X POST $STAGING/api/push-subscriptions -H "Content-Type: application/json" -d '{}'
# → 400 (validation before auth)
curl -i -X POST $STAGING/api/push-subscriptions -H "Content-Type: application/json" \
  -d '{"householdId":"00000000-0000-0000-0000-000000000001","memberId":"00000000-0000-0000-0000-000000000002","endpoint":"https://example.com/push/probe","p256dh":"x","auth":"y","userAgent":null}'
# → 401 anon (schema-valid → auth gated)
```

Scripted equivalent:

```bash
node scripts/verify-staging.mjs --live --url https://staging.duobalanceapp.com
CRON_SECRET=… node scripts/verify-staging.mjs --live --url https://staging.duobalanceapp.com
```

### D) Exports, feedback, push subscription, member-removal email

These require a real authenticated session:

```bash
export STAGING_URL=https://staging.duobalanceapp.com
export NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
export TEST_EMAIL=owner+staging@example.com
export TEST_PASSWORD='<staging-only password>'
export TEST_INVITE_EMAIL=partner+staging@example.com
```

1. **Export** — prove the removed-member fallback
   (`src/app/api/export/route.ts`):

   ```bash
   node scripts/verify-supabase-cookies.mjs --live --url https://staging.duobalanceapp.com
   CRON_SECRET=… TEST_EMAIL=… TEST_PASSWORD=… \
     node scripts/verify-staging.mjs --live --url https://staging.duobalanceapp.com
   ```

2. **Feedback** — rate-limited, triggers Resend:

   ```bash
   curl -b <cookie-jar> -X POST https://staging.duobalanceapp.com/api/feedback \
     -H "Content-Type: application/json" \
     -d '{"category":"general","message":"[staging] verify-staging — ignore","diagnostics":{}}'
   # 200/204 → check FEEDBACK_RECIPIENT_EMAIL inbox + `npx wrangler tail --env staging`
   ```

3. **Push subscription** — handler uses service role only for `endpoint` upsert
   after `requireOwnMember`:

   ```bash
   node scripts/verify-worker-delivery.mjs                       # static
   node scripts/verify-worker-delivery.mjs --live-push --subscription '{"endpoint":"…","keys":{"p256dh":"…","auth":"…"}}'
   ```

4. **Member-removal email** — `POST /api/members/remove` sends via Resend to the
   removed address (`src/lib/members/remove/member-removed-email.ts`). As owner,
   remove the staging partner, then check the partner's staging inbox.

### E) All four crons — manually + via `scheduled()`

```bash
# HTTP (manual + debug) — still guarded by CRON_SECRET:
for p in fx-refresh generate-bill-instances send-bill-reminders purge-households; do
  curl -i -H "Authorization: Bearer $CRON_SECRET" https://staging.duobalanceapp.com/api/cron/$p
done
CRON_SECRET=… node scripts/verify-staging.mjs --live --url https://staging.duobalanceapp.com

# scheduled() — true Cloudflare Cron Trigger via worker.ts:
npx wrangler dev --env staging --test-scheduled
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled" -H "X-Cron: 0 6 * * *"
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled" -H "X-Cron: 0 7 * * *"
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled" -H "X-Cron: 0 12 * * *"
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled" -H "X-Cron: 0 3 * * *"
```

Confirm via logs that `scheduled` does **not** `fetch` itself (per #155):

```bash
npx wrangler tail --env staging
# [scheduled] dispatching "fx-refresh" for cron "0 6 * * *" — no HTTP fetch to /api/cron/*
```

### F) Cross-cutting gates

```bash
node scripts/verify-supabase-cookies.mjs --live --url https://staging.duobalanceapp.com
node scripts/verify-worker-delivery.mjs --live-email --to you@example.com
node scripts/verify-pwa-assets.mjs --live --url https://staging.duobalanceapp.com
# Then on staging: DevTools → Application → Offline → reload.
```

---

## Sign-off checklist (copy to the PR / issue comment)

- [ ] §0 Cloudflare account active, `duobalanceapp.com` zone active, `npx wrangler whoami` shows correct account
- [ ] §0 Staging Supabase project created and migrations pushed (`supabase db push`)
- [ ] §1 First `wrangler deploy --env staging` succeeded — dashboard shows `duobalance` Worker + `*.workers.dev` preview → `/api/health` 200
- [ ] §2 Staging vars overridden (dashboard or `.dev.vars`) and all secrets `wrangler secret put --env staging`; `verify-cloudflare-env` green
- [ ] §3 `staging.duobalanceapp.com` custom domain attached and resolves (`dig` + `curl /api/health` 200)
- [ ] `npm run check` passes (typecheck + lint + format + verify-cloudflare-env + verify-worker-delivery + verify-supabase-cookies + verify-pwa-assets + verify-staging + test + locales:check)
- [ ] `npm run db:test` (pgTAP) passes against local stack
- [ ] Playwright e2e passes against `STAGING_URL=https://staging.duobalanceapp.com` — no test modified
- [ ] `node scripts/verify-staging.mjs --live --url https://staging.duobalanceapp.com` (13 handlers) passes
- [ ] `CRON_SECRET` live run — 4 crons 200 (or 502 that proves wiring + `wrangler tail` shows `[scheduled]`)
- [ ] `TEST_EMAIL` live run — exports, feedback, push, member-removal email confirm inbox delivery
- [ ] `wrangler tail --env staging` shows no leaked `SUPABASE_SERVICE_ROLE_KEY`, no `[supabase] setAll failed`, no silent scheduled success
- [ ] Offline proof on Cloudflare deployment (not just `wrangler dev`) — hashed `/_next/static` are the deployed ones
- [ ] `BUILD_TARGET=tauri npm run build` still produces `out/` / `out/sw-assets.js`

Attach transcripts:

```bash
npm run check                          | tee .check.log
npm run db:test                        | tee .db.log
STAGING_URL=https://staging.duobalanceapp.com CRON_SECRET=… TEST_EMAIL=… \
  npx playwright test --project=chromium | tee .e2e-staging.log
```

---

## Rollback / DoD note

Keep Vercel deployed for one full cron cycle after cutover (epic #152 DoD). If
staging reveals a host defect that requires a test change, fix the host and
re-deploy — do not relax the test. `CRON_DISABLED` (#160) is the only overlap
between hosts.

---

## References

- #161 — Deploy to staging and run the full e2e suite (this doc)
- #154 — OpenNext Cloudflare adapter + `wrangler.toml`
- #155 — `scheduled()` cron dispatcher (`worker.ts`)
- #156 — `wrangler.toml` vars vs `wrangler secret put` (`docs/cloudflare-env-mapping.md`)
- #157 — `web-push` + Resend under `nodejs_compat` (`docs/cloudflare-delivery-verification.md`)
- #158 — Supabase SSR cookies at the edge (`docs/supabase-cookie-verification.md`)
- #159 — Service worker asset manifest (`docs/pwa-offline-verification.md`)
- `scripts/verify-staging.mjs` — machine-checkable version of §C/D/E above
- `playwright.config.ts:isRemote` — e2e host switch without test modifications
