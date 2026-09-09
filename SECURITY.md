# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

**Do not open a public issue.**

Email **hola@duobalanceapp.com** with:

- Description of the vulnerability
- Steps to reproduce (PoC if applicable)
- Impact assessment (what data / households are affected)
- Your contact for follow-up

You will receive an acknowledgement within 72 hours. We will keep you informed of the fix timeline and credit you if desired.

For household data concerns (leaked seed, screenshot, metrics, dump), include whether the data is synthetic or real and the commit/URL where it appears.

## Disclosure

We follow coordinated disclosure. Please give us reasonable time to remediate before public disclosure. We will publish a fix and an advisory; you may publish after the fix is released.

## Scope

- `src/app/api/**` route handlers (service-role, CRON_SECRET, Resend, VAPID)
- Supabase RLS policies (`supabase/migrations/**`, `supabase/tests/**`)
- Client bundle secret leakage (verify-cloudflare-env, service-role leak guard in CI)

Out of scope: rate-limit thresholds, brute-force testing against production, social engineering.

## Secrets

If you find a committed secret (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `RESEND_API_KEY`, `EXCHANGERATE_API_KEY`, `CRON_SECRET`) in git history, still report it privately — rotation is required even after removal from HEAD. See `docs/cron-idempotency.md` for rotation runbook.

## Branch Protection

`main` is protected: CI must pass, no direct pushes. See `.github/workflows/ci.yml`.
