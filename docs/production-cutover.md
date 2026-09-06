# Production cutover and rollback runbook — #162

> Part of #152. Staging (`staging.duobalanceapp.com` → `duobalance-staging` Worker) was the gate (#161). This is the ordered checklist that makes production cutover and rollback deterministic — especially the cron ordering: Vercel's crons must be disabled **before** Cloudflare's are trusted, or users get duplicate `send-bill-reminders` emails.

**Current state before this runbook** (2026-09-06):

- Vercel still serves `duobalanceapp.com` (A 64.29.17.65 / 216.198.79.65) with `vercel.json` crons `0 6, 0 7, 0 12, 0 3 * * *`.
- Cloudflare `duobalance-staging` is live on `https://staging.duobalanceapp.com` + `https://duobalance-staging.alfchee.workers.dev` with `keep_vars=true`, 4 staging vars, and `0` cron triggers (free plan limit 5, see §4).
- Cloudflare `duobalance` (production) is **now deployed** to `https://duobalance.alfchee.workers.dev` with 4 cron triggers, vars from `wrangler.toml:30` (`keep_vars=true`) and 7 secrets via `wrangler secret bulk` (production). `*.workers.dev` is live, custom domain `duobalanceapp.com` not yet attached (apex still has Vercel A records).

---

## 1) Pre-flight — verify staging and Cloudflare crons are declared

```bash
npm run check                # typecheck + lint + verify-* + 545 tests
npm run db:test              # pgTAP on 55322

# Staging gate — must be green before touching prod:
STAGING_URL=https://staging.duobalanceapp.com \
  CRON_SECRET="G0^nKsXI4tP0ICTRv9Nd7O2!" \
  node scripts/verify-staging.mjs --live --url https://staging.duobalanceapp.com --e2e
# → 48 passed, 13 handlers 200/401, 4 crons 200 (send-bill-reminders may 502, still 200)

# Cloudflare crons are declared in wrangler.toml
grep -A2 "\[triggers\]" wrangler.toml
# → crons = ["0 6 * * *", "0 7 * * *", "0 12 * * *", "0 3 * * *"]
npx wrangler deploy --dry-run --env="" 2>&1 | grep -E "schedule|crons"
# → should list 4 schedules for duobalance (production)
npx wrangler deploy --dry-run --env staging 2>&1 | grep -E "schedule|crons"
# → 0 for staging (free limit, see §4), or 4 if you re-enable after cutover

# Idempotency audit is in docs/cron-idempotency.md — generate + purge are safe to double-fire
```

## 2) Disable Vercel crons — **required before enabling Cloudflare**

If both fire, `send-bill-reminders` double-sends. `CRON_DISABLED` makes every Vercel cron route a no-op `200 { disabled: true }` (`src/lib/cron/guard.ts:7`, `src/app/api/cron/*/route.ts:35`, `worker.ts:106`).

**Vercel Dashboard (no CLI login required):**

1. https://vercel.com → project `duobalance` → **Settings → Environment Variables**
2. **Add** `CRON_DISABLED` = `true` — check **Production**, **Preview**, **Development** → Save
3. **Deployments → Redeploy** latest Production deployment (with `CRON_DISABLED` baked in)
4. Verify guard is live (Vercel, not Cloudflare):

```bash
for p in fx-refresh generate-bill-instances purge-households send-bill-reminders; do
  curl -i -H "Authorization: Bearer $CRON_SECRET" https://duobalanceapp.com/api/cron/$p | head -n 5
done
# → each 200 { "disabled": true, "job": "..." } and Vercel logs: [cron] … skipped — CRON_DISABLED is set
# Also negative: old secret or UA spoof must still 401 in production
curl -i -H "Authorization: Bearer wrong" https://duobalanceapp.com/api/cron/purge-households # → 401
curl -i -H "User-Agent: vercel-cron/1.0" https://duobalanceapp.com/api/cron/purge-households # → 401 (purge never allows UA, even in dev)
```

**CLI alternative (if `vercel` is logged in):**

```bash
npx vercel env add CRON_DISABLED production # paste true, repeat for preview/development
npx vercel --prod --yes
```

Do not delete `vercel.json` — rollback is flipping the var back.

## 3) Deploy production to Cloudflare (already done 2026-09-06, keep for replay)

```bash
# Vars are public and committed (wrangler.toml:30, keep_vars=true), secrets are not.
# First production deploy was:
npm run deploy  # → opennextjs-cloudflare build + wrangler deploy --keep-vars --env=""
# → https://duobalance.alfchee.workers.dev + 4 schedules

# Secrets were bulk-set from .env.local (7 keys):
# wrangler secret bulk /tmp/prod-secrets.env  (SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY,
# EXCHANGERATE_API_KEY, RESEND_API_KEY, CRON_SECRET, VAPID_PRIVATE_KEY, VAPID_SUBJECT)
# For staging: wrangler secret bulk /tmp/prod-secrets.env --env staging (same values, re-put after staging 0-cron deploy)

# Verify production Worker is live on workers.dev before DNS:
curl -s https://duobalance.alfchee.workers.dev/api/health | jq .
# → {"status":"ok","buildTarget":"web"}
curl -s -H "Authorization: Bearer $CRON_SECRET" https://duobalance.alfchee.workers.dev/api/cron/fx-refresh | jq .
# → {"rateDate":"...","status":"success","currenciesUpdated":19}

# Free plan note (§4): staging was set to 0 crons to stay within 5/account.
# Production has 4, staging 0, plus 0 for other sua-* workers = 4 total.
```

## 4) DNS cutover — `duobalanceapp.com` → Cloudflare Worker

**Why manual:** The apex `duobalanceapp.com` still has externally-managed A records `64.29.17.65`/`216.198.79.65` (Vercel). `wrangler deploy` with `[[routes]] custom_domain = true` fails with `100117` until they are removed. Cloudflare Free also allows 5 cron triggers/account — with 4 in staging + 4 in prod we would exceed it. Staging was trimmed to `0` (`[env.staging.triggers] crons = []`) so prod can have `4`.

**Dashboard steps:**

1. Cloudflare → **duobalanceapp.com** → **DNS → Records** → delete the two `A` `duobalanceapp.com` → `64.29.17.65` / `216.198.79.65` (Vercel). Keep `staging` CNAME if present.
2. **Workers & Pages → duobalance → Settings → Domains & Routes → Add Custom Domain** → `duobalanceapp.com` → Add (proxied, TLS auto). Or `npx wrangler deploy --env="" --keep-vars --domain duobalanceapp.com` after DNS is clean.
3. Add `[[routes]]` back to `wrangler.toml` for production (currently removed to allow first deploy) and redeploy:

```toml
[[routes]]
pattern = "duobalanceapp.com"
zone_name = "duobalanceapp.com"
custom_domain = true
```

```bash
npx wrangler deploy --dry-run --env="" # should now list the domain, no 100117
npm run deploy
```

4. Verify DNS:

```bash
dig duobalanceapp.com +short # → Cloudflare anycast (e.g. 104.21.x.x), not 64.29.17.65
curl -s https://duobalanceapp.com/api/health | jq .
for p in fx-refresh generate-bill-instances purge-households send-bill-reminders; do
  curl -i -H "Authorization: Bearer $CRON_SECRET" https://duobalanceapp.com/api/cron/$p | head -n 1
done
# → 200, and same via custom domain vs workers.dev
```

Keep `*.workers.dev` enabled (`workers_dev` not disabled) as fallback.

## 5) Monitor first full cron cycle (4 jobs)

```bash
npx wrangler tail              # production, filter "[scheduled]"
npx wrangler tail --env staging # staging (currently 0, enable after cutover if needed)

# After each UTC schedule (0 6, 0 7, 0 12, 0 3), confirm:
# - Cloudflare: [scheduled] dispatching "fx-refresh" → result, no CRON_DISABLED skip
# - Vercel: no cron invocations in Vercel → Logs → Cron (or Vercel logs show no [cron] at all, since CRON_DISABLED makes them 200 without Supabase)
# - DB: fx_rates has today's row, bill_instances has new due dates, purge did 0 or <50, send-bill-reminders sent 0 or >0
```

**Confirm zero Vercel firings** — not just env var, read logs:

- Vercel → Logs → filter `cron` → should be empty or only `200 {disabled:true}` if you manually curl.
- Cloudflare → `wrangler tail` → 4× `dispatching` per day.

## 6) Keep Vercel for 7 days, then decommission

- Do not delete Vercel project or `vercel.json` for 7 days. Monitor one full cycle of all 4 crons.
- If rollback is needed, see §7.

## 7) Rollback — ordered, reverse of cutover

If Cloudflare misbehaves:

```bash
# 1) Re-enable Vercel crons first (so at least one platform fires, no gap):
# Vercel Dashboard → Environment Variables → delete CRON_DISABLED (or set false) → Redeploy
# Verify Vercel resumes:
curl -i -H "Authorization: Bearer $CRON_SECRET" https://duobalanceapp.com/api/cron/fx-refresh # → 200 {status:"success"} (not disabled)

# 2) Optionally disable Cloudflare crons without deleting the Worker:
# Cloudflare Dashboard → duobalance → Settings → Variables → CRON_DISABLED=true (or wrangler secret put CRON_DISABLED -- not needed, var is enough)
# Or: wrangler deploy with [triggers] crons = [] temporarily

# 3) DNS: if custom domain was added, keep it or remove via Workers → Domains & Routes → Remove, then re-add Vercel A records via Vercel Dashboard → Domains → duobalanceapp.com → will recreate A records

# 4) Keep both deployed until next cycle confirms Vercel 4× success and Cloudflare 0 (if disabled)
```

Idempotency (`docs/cron-idempotency.md`) guarantees a transient double-fire during the flip cannot duplicate `bill_instances` (unique `bill_id,due_on`) or re-purge (`purgedCount 0` second run).

## 8) Post-cutover checklist (copy to PR)

- [ ] §2 Vercel `CRON_DISABLED=true` → redeploy → curl 4× `200 {disabled:true}` on `https://duobalanceapp.com/api/cron/*` (verify via Vercel, not Cloudflare)
- [ ] §3 Cloudflare prod `https://duobalance.alfchee.workers.dev/api/health` 200, 4 crons `200` with `CRON_SECRET` (workers.dev)
- [ ] §4 DNS `duobalanceapp.com` → Cloudflare (dig not Vercel 64.29.17.65), `https://duobalanceapp.com/api/health` 200, custom domain listed in `wrangler deployments list`
- [ ] §5 `wrangler tail` shows 4× `[scheduled] dispatching` per day, Vercel cron logs show 0 (read logs, not env)
- [ ] Vercel project kept 7 days, `vercel.json` not deleted
- [ ] `BUILD_TARGET=tauri npm run build` still produces `out/` (`docs/staging-deployment.md` §1)

## References

- #160 / PR #180 — `CRON_DISABLED` guard + idempotency
- #161 / PR #178 — staging `duobalanceapp.com` + `keep_vars`
- `src/lib/cron/guard.ts:7`, `worker.ts:106`, `vercel.json:3`
- `wrangler.toml:20` `[triggers]` + `[[routes]]` + `keep_vars`
- `npx wrangler secret bulk` / `wrangler tail --env staging`
