# Cloudflare delivery verification — #157

> **AC gates production cutover.** A build that compiles is not evidence. Only a received
> email and a received notification count. See #157.

## What was proven

`web-push` pulls in `node:crypto` and both it and Resend were written for Node, not
workerd. `nodejs_compat` covers a lot but not everything, and the failure mode is quiet:
crons fail silently. This issue hardens delivery so failures surface in Workers logs and
provides the verification tooling for a human to prove end-to-end delivery before cutover.

## Hardening (code)

### `src/lib/web-push.ts` — Workers-native fetch path

- Uses `webpush.generateRequestDetails(...)` (crypto) + global `fetch` (Workers-native HTTP)
  as the primary delivery path on workerd. Avoids Node's `https.request` path while still
  using web-push's VAPID + aes128gcm encryption.
- Falls back to `webpush.sendNotification` (Node `https`) if `generateRequestDetails` is
  unavailable or throws — so `next dev` / Node / Vercel local dev still works.
- Every terminal failure logs `subscriptionId` / `memberId` / `endpointHost` with
  `console.error` (or `console.warn` for the fetch→fallback transition) so `wrangler tail`
  shows it. `404`/`410` are classified as `gone` and pruned; all other errors are `failed`.

### `src/lib/bill-reminder-email.ts` — Resend

- Missing `RESEND_API_KEY` and per-send `Resend` errors now `console.error` with
  `to` / `householdName` / `itemCount` before throwing `ReminderEmailError`.
- Success logs `console.info` so the happy path is also visible in `wrangler tail`.
- Unexpected throws are wrapped as `ReminderEmailError` with context.

### `src/lib/cron/send-bill-reminders.ts` — aggregation & surfacing

- `fetch reminders` and `mark reminded_at` failures `console.error` before throwing.
- Per-group delivery counts `pushGoneCount` / `pushFailedCount` / `totalFailedGroups`.
- Per-group `console.warn` on `allSucceeded === false`; top-level `console.info` with
  `totalSent / totalFailedGroups / pushGoneCount / pushFailedCount`; top-level
  `console.error` when `totalFailedGroups > 0` so a partial cron success cannot look like
  a full success in tail.
- `worker.ts:scheduled` already `console.info`s the dispatched result and
  `console.error`s every job failure with `job` + `event.cron`; non-retryable config
  errors (`RESEND_API_KEY`, Supabase) call `event.noRetry()`.

## Verification

### Automated (no secrets — runs in CI)

```bash
node scripts/verify-worker-delivery.mjs
```

Checks:

1. `wrangler.toml` has `compatibility_flags = ["nodejs_compat"]`
2. `src/lib/web-push.ts` has `generateRequestDetails + fetch` path, structured logging, 404/410 handling
3. `src/lib/bill-reminder-email.ts` logs Resend failures
4. `src/lib/cron/send-bill-reminders.ts` aggregates and surfaces failures
5. `web-push` and `resend` import correctly (crypto/fetch polyfills reachable)

CI runs this without `--live-*` flags — it proves the hardening is present.

### Live (requires secrets — run on staging before cutover)

The AC is only satisfied by a received email/notification, not by CI. Run against a
staging Worker with real secrets (`.dev.vars` or `wrangler secret put`):

```bash
# 1) Deploy staging with nodejs_compat
npx opennextjs-cloudflare build
npx wrangler deploy --env staging  # or wrangler dev for local workerd

# 2) Prove Resend from the Worker — check inbox, not just exit code
node scripts/verify-worker-delivery.mjs --live-email --to you@example.com
# Alternative: hit the deployed cron directly (same Resend path the cron uses)
curl -H "Authorization: Bearer $CRON_SECRET" https://staging.duobalanceapp.com/api/cron/send-bill-reminders

# 3) Prove web-push end to end — subscribe a real device first:
#    Open the app on a device, allow notifications, copy the subscription object
#    from the push_subscriptions table or from the verification endpoint.
node scripts/verify-worker-delivery.mjs --live-push --subscription '{"endpoint":"https://fcm...","keys":{"p256dh":"...","auth":"..."}}'

# Or exercise the full cron loop with a due bill instance:
# Insert a bill_instance with due_on = today and reminded_at = null, then:
curl -H "Authorization: Bearer $CRON_SECRET" https://staging.duobalanceapp.com/api/cron/send-bill-reminders
# → {"sent":1,"instances":1} and a push/email arrives. Failures appear in:
npx wrangler tail --env staging
```

**Sign-off checklist (before production cutover):**

- [ ] `node scripts/verify-worker-delivery.mjs` passes
- [ ] `node scripts/verify-worker-delivery.mjs --live-email --to <inbox>` → email received in real inbox, from the Worker
- [ ] Push notification arrives on a real subscribed device (via `--live-push` or cron)
- [ ] `wrangler tail` shows structured `send-bill-reminders: dispatch complete` and no hidden silent failures
- [ ] If `web-push` failed on workerd, the fallback + logs surfaced it (no quiet cron success); evaluated unenv / fetch-based VAPID per #157 task 4

## If web-push fails under nodejs_compat

The fetch path already mitigates the `https` incompatibility. If `generateRequestDetails` itself
throws under workerd (crypto gap), the code logs at `warn` and falls back to `sendNotification`.
If both paths fail consistently in staging, evaluate:

- `unenv` polyfill for `node:crypto` in `open-next.config.ts` (adds bundle cost), or
- A fetch-native VAPID implementation using `SubtleCrypto` (no `node:crypto` dep) — replaces
  `web-push` entirely. The current hardening keeps `web-push` but makes the gap visible so the
  evaluation triggers before cutover instead of after.

## References

- #157 — Verify web-push and resend under nodejs_compat
- #152 — Epic: Migrate hosting from Vercel to Cloudflare Workers
- `wrangler.toml` — `compatibility_flags = ["nodejs_compat"]`
- `worker.ts:scheduled` — cron dispatch + structured logging
- `scripts/verify-worker-delivery.mjs` — automated + live checks
