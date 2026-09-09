# Hardening checklist before Dev.to amplification — status 2026-09-09

> Companion to the publicity checklist (secrets, real user data, repo posture, README caution).
> This document records what was verified and what remains manual in GitHub settings.

## Secrets

- [x] Scan **entire git history** — `git log --all -p | grep -E` for `SUPABASE_SERVICE_ROLE_KEY`, `sb_secret_`, `RESEND_API_KEY`, `EXCHANGERATE_API_KEY`, `CRON_SECRET`, `VAPID_PRIVATE_KEY`, JWT prefix `eyJhbGci`. No real secret values committed except one `CRON_SECRET` literal in `docs/production-cutover.md:21` (`G0^nKsXI4tP0ICTRv9Nd7O2!`), now redacted to `$CRON_SECRET` (commit `fix: redact committed CRON_SECRET placeholder`). **Rotation still required** — removal from HEAD does not undo exposure (secret remains in history). See `docs/cron-idempotency.md#security-cron_secret-rotation-before-public-traffic` for rotation runbook (`openssl rand -hex 32` → Vercel + `wrangler secret put` staging/production + `.env.local`/`.dev.vars`).
- [x] `.env.local` and `.dev.vars` are gitignored (`.gitignore:38` `".env*"`, `:51` `".dev.vars"`), not tracked (`git ls-files` shows only `.env.example`/`.dev.vars.example` with empty placeholders). `.open-next/` and `.wrangler/` are gitignored; ` .open-next/cloudflare/next-env.mjs` is a local build artifact that embeds runtime env (including service role) and must never be committed.
- [x] CI guard #20 restored — `.github/workflows/ci.yml` now has **service-role leak guard (source)** (`grep -rEn SUPABASE_SERVICE_ROLE_KEY src/ | grep -vE lib/supabase/server.ts|lib/supabase/cron.ts|app/api/`) and **bundle guard** (`grep -rF eyJhbGci .next/static/`), plus `scripts/verify-cloudflare-env.mjs --build` (checks `wrangler.toml [vars]` / `[env.staging.vars]` contain no secret and no secret identifier in ` .open-next/assets` / `.next/static` client chunks). Historically removed; now re-added with `lib/supabase/cron.ts` allowlist.
- [x] `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` isolated to `src/lib/supabase/server.ts` and `src/lib/supabase/cron.ts` + `src/app/api/**` only (verified `grep -rEn` allowlist). `src/lib/env.ts` is client-safe (no service-role schema).
- [ ] **GitHub: enable secret scanning + push protection** — manual. Dashboard → Settings → Code security → Secret scanning → Enable **Secret scanning** and **Push protection** (alerts for `SUPABASE_SERVICE_ROLE_KEY`, `sb_secret_`, `RESEND_API_KEY`, etc.). Verify `GH_TOKEN` scope includes `security_events:write` if using API. Current repo is public — bots scan history in minutes.
- [x] `wrangler.toml` public vars are safe (`NEXT_PUBLIC_*`, `APP_URL`, `RESEND_FROM`, `VAPID_PUBLIC_KEY`) — committed publishable key `sb_publishable_Skbn9yZ8iBEOVD0Cz8JtjA_sH4NtLjJ` is browser-safe by design. Secrets are **not** in `[vars]` (verified by `verify-cloudflare-env`).
- [x] `.env.example` documents all 5 secret families with empty placeholders; `.dev.vars.example` mirrors for `wrangler dev`.

**If you run a self-hosted scan before posting:**

```bash
# gitleaks (history, not just HEAD)
gitleaks detect --source . --verbose
# or trufflehog
trufflehog git file://. --only-verified
```

A secret deleted in a later commit is still in history — rotate, don't just `git rm`.

## Real user data — human consequences

- [x] Seed + fixtures synthetic only — `supabase/seed.sql` inserts only reference data (`country_defaults`, `currencies`); `supabase/tests/*.sql` use `*@test.local` and `00000000-…` fixtures, no real emails/transactions. No `HH3` real household leaked to seed.
- [x] Screenshots — `README.md` has no screenshots; `public/landing/hero.jpg` and `public/install/*.png|svg` are illustrations, not household data; `public/icons` are app icons. No synthetic vs real ambiguity.
- [x] Metrics reports — `reports/metrics/` is gitignored (`/reports/metrics/` in `.gitignore:24`). `reports/metrics/2026-09-07.md` exists locally but is **not tracked** (`git check-ignore` confirms) and is aggregate-only (`Household 1…17`, counts, no emails/names/transactions). Household counts are fine; user-identifying rows would not be.
- [x] No production dumps — `git ls-files` shows no `*.sql` dump, no issue attachment dump. `supabase/migrations` are schema only.

## Repo posture

- [ ] **Branch protection on `main`** — manual. Dashboard → Settings → Branches → Add rule → Branch name `main` → Require status checks (`ci`), Require pull request reviews, Dismiss stale approvals, Do not allow bypass. Verify: `gh api repos/alfchee/duobalance/branches/main/protection --jq .required_status_checks`.
- [x] `SECURITY.md` added — contact `hola@duobalanceapp.com`, private disclosure, coordinated disclosure, scope, secrets rotation note, branch protection reference.
- [x] Dependabot enabled — `.github/dependabot.yml` (npm + github-actions, weekly Monday 09:00 America/Santiago).
- [x] Issue templates — `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml`, `config.yml` (blank issues disabled, security contact link, privacy checkbox requiring no real data/secrets).
- [x] CI required — `.github/workflows/ci.yml` is the gate (typecheck + lint + format + `verify-cloudflare-env` + leak guards + `db:test` + build + `tauri` smoke + Playwright).

## README caution

- [x] `README.md` states _that_ RLS enforces household isolation (`RLS is the primary authorization boundary`) without publishing rate-limit thresholds, caps, or endpoint maps. No per-endpoint `limit/interval` table. `SECURITY.md` is the only security contact surface. Per checklist: explaining RLS is good engineering writing; publishing a test plan is handing someone a test plan.

## One-time manual actions before Dev.to publish

1. **Rotate `CRON_SECRET`** (and consider `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SECRET_KEY` if ever pasted in logs/issues) per `docs/cron-idempotency.md:107` — `openssl rand -hex 32` → Vercel env + `wrangler secret put` (+ `--env staging`) + `.env.local`/`.dev.vars`. Verify old 401, new 200, `User-Agent: vercel-cron/1.0` 401 in prod.
2. Enable **secret scanning + push protection** in GitHub settings.
3. Add **branch protection** on `main` (CI required).
4. Verify **Dependabot** PRs appear (first run Monday).
5. Optional: `git` history rewrite for the redacted `CRON_SECRET` literal is _not_ sufficient — rotation is the fix; history rewrite (`git filter-repo` + force push) is separate, harder, and does not undo exposure of a still-valid secret.

## References

- Checklist source: hardening checklist before amplifying (secrets, real user data, repo posture, extremes)
- #20 — service-role leak guard (source + bundle)
- #156 — `wrangler.toml` vars vs `wrangler secret put` (`docs/cloudflare-env-mapping.md`)
- `scripts/verify-cloudflare-env.mjs` — vars + bundle guard
- `docs/cron-idempotency.md` — idempotency + `CRON_SECRET` rotation
