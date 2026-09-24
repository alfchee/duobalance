# Billing go-live checklist

Gate: `BILLING_ENABLED` / `NEXT_PUBLIC_BILLING_ENABLED` (issue #262, epic #255).

The flag is OFF in every environment. Flipping it exposes checkout, the
webhook route, UI plan gating and admin billing screens to real users for
the first time. Everything below must be true before the flip — no partial
go-lives. Check each box with a link to the verifying issue, PR or run.

## 1. Payment provider connected (Phase B)

- [ ] A real `PaymentProvider` adapter is registered (not the stub) and
      `BILLING_PROVIDER` names it in production.
- [ ] Real signature verification is implemented and tested — forged
      webhooks return 401, never 202.
- [ ] Duplicate and out-of-order webhook deliveries are handled (dedupe on
      the provider event id, #267).
- [ ] Checkout handoff works end to end against the provider sandbox, then
      against production credentials for a C$1 test charge that is refunded.

## 2. Money, pricing and compliance

- [ ] NIO pricing and tax presentation are reviewed (prices in córdobas,
      tax treatment confirmed with local counsel).
- [ ] Fiscal invoicing path is defined (Nicaragua DGI requirements) or an
      explicit deferral is recorded with a follow-up issue.
- [ ] Refund and cancellation policy is published on the public site (#270)
      and honoured by the cancel/reactivate flow.

## 3. Data and entitlements

- [ ] The comped founder plan backfill (#263) is applied to production and
      verified: all 18 existing households hold a plan that survives the
      flag being switched on.
- [ ] Subscription lifecycle is exercised end to end in CI against the
      stub with the flag ON (trial → active → past_due → grace → expired,
      plus cancel/reactivate, #266).
- [ ] With the flag ON in staging, a free household hitting a plan limit
      is gated (not silently unlimited) and an entitled household is not
      blocked — fail-closed behaviour confirmed, not assumed.

## 4. Operations

- [ ] Dunning and grace-period emails send correctly (#265) — a failed
      payment produces the expected sequence, not silence and not spam.
- [ ] The admin app is deployed and restricted (#271–#275): no
      impersonation, no transaction-content reads; plan overrides and comp
      grants are audited.
- [ ] Data export and account deletion work for a paying household (#269).
- [ ] Reconciliation against provider state is scheduled and alerting
      (who gets paged when the provider and our ledger disagree).

## 5. Rehearsal and flip

- [ ] Staging runs with the flag ON for at least one full billing cycle
      rehearsal (injectable clock may compress it) with no unexplained
      errors in logs.
- [ ] Rollback is a flag flip back to OFF plus a redeploy — confirmed that
      flag-off restores the fail-open entitled state without data loss.
- [ ] Support macros exist for the first month: failed payment, cancel,
      refund, "I was charged twice".

## Flip procedure

1. Set `BILLING_ENABLED=1` and `NEXT_PUBLIC_BILLING_ENABLED=1` in the
   production Worker vars (dashboard or `wrangler deploy` with updated
   `wrangler.toml`), then redeploy — the client mirror is inlined at build
   time, so a redeploy is required, not just a var change.
2. Smoke-test production: webhook 401 on forged delivery, checkout opens
   for a test household, plan gate renders for an expired trial.
3. Announce in the release notes; watch reconciliation alerts for 48h.

## Rollback procedure

1. Set both vars back to `""` and redeploy.
2. With the flag off, entitlements evaluate as entitled — no paying user
   loses access during the incident.
3. Investigate against provider dashboard + `billing_events` table before
   re-flipping.
