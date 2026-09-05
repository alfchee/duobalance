# Cron idempotency audit — #160

> Part of #152 and required by #160: with Vercel kept deployed for 7 days as
> rollback, both platforms would double-fire. `CRON_DISABLED` makes Vercel a
> no-op, but `generate-bill-instances` and `purge-households` must still be
> genuinely idempotent so a transient double-fire (retry, manual trigger, or
> forgetting the flag) cannot corrupt data.

## Summary — finding: both audited jobs are idempotent

| Job                       | Mechanism                                                                                                | Double-fire result                                | Proof                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `generate-bill-instances` | `bill_instances` upsert `ON CONFLICT (bill_id, due_on) DO NOTHING` (`lib/bill-instances.ts:129`)         | Second run inserts 0 rows, no duplicates          | Unit test `bill-instances.test.ts: idempotency` + DB constraint `bill_instances_bill_id_due_on_key`   |
| `purge-households`        | Select-then-delete `households` where `deleted_at < now() - 30 days` (`lib/cron/purge-households.ts:32`) | Second run selects 0, deletes 0 → `purgedCount 0` | Select is idempotent, `delete.in(id[])` with empty set is a no-op; existing route test asserts 0-case |

The other two crons are **not** idempotent by design and were the motivation
for `CRON_DISABLED`:

- `send-bill-reminders` sends an email per `bill_instance` and marks
  `reminded_at`. Without the guard a double-fire would send every reminder
  twice — user-visible.
- `fx-refresh` is data-idempotent via `claim_fx_refresh` advisory lock and
  `fx_fetch_log` partial unique index (`lib/fx/refresh.ts:108`), but a double
  run would burn double the free-tier `exchangerate-api.com` quota the cron
  exists to conserve.

## Detail — `generate-bill-instances` (`src/lib/bill-instances.ts`)

- `generateInstancesForBill` computes `dueDates` from the bill's `RRULE` and the
  per-bill bounds (`bill_instance_generation_bounds` RPC), then
  `upsert(rows, { onConflict: "bill_id, due_on", ignoreDuplicates: true })` and
  `.select("id")` to count only newly inserted rows.

  ```ts
  // lib/bill-instances.ts:126
  const { data, error } = await supabase
    .from("bill_instances")
    .upsert(rows, { onConflict: "bill_id, due_on", ignoreDuplicates: true })
    .select("id");
  return data?.length ?? 0; // 0 when all rows already existed
  ```

- The underlying table has a unique constraint / index on `(bill_id, due_on)`
  (migration `20260810170000_bills_templates_and_instances.sql` + helper
  `bill_instances_bill_id_due_on_key`). A concurrent double-fire therefore
  cannot create duplicates even without the application-level `ignoreDuplicates`.

- `generateAllInstances` loops active bills, fetches bounds, calls the helper,
  and aggregates `inserted`/`failed`. The second overall run recomputes the same
  horizon (now unchanged) and each bill's upsert again hits the conflict path.

**Double-invocation proof:** `src/lib/bill-instances.test.ts` now contains an
explicit idempotency test that calls `generateInstancesForBill` twice with the
same bounds and a fake Supabase that returns `1` row first, `0` rows second
(`ignoreDuplicates` path). `generateAllInstances` has the same test at the
`generateAllInstances` level.

## Detail — `purge-households` (`src/lib/cron/purge-households.ts`)

- `runPurgeHouseholds` (`lib/cron/purge-households.ts:30`) selects:

  ```ts
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("households")
    .select("id, name, deleted_at")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .limit(PURGE_SANITY_CAP + 1);
  ```

  then `delete().in("id", idsToPurge)` (`:60`). If `idsToPurge` is empty it
  early-returns `purgedCount 0`.

- After the first successful purge the rows are gone, so the second run's
  `select` returns `[]`, the `limit`/`SANITY_CAP` check does not trigger, and
  the `delete` is never issued. The operation is a pure read followed by a
  conditional delete — both idempotent. `DELETE FROM households WHERE id IN
(…)` with an empty set is defined as a no-op in the handler, and PostgreSQL
  `DELETE` with `id IN ()` would also match nothing.

- The `PURGE_SANITY_CAP = 50` guard (`:9`) prevents a runaway purge from
  deleting an unbounded number of households if `deleted_at` were ever
  mis-set, but does not affect idempotency: a double-fire would still select
  the same capped set first, delete it, then select `0` next.

**Why this matters for rollback:** even with `CRON_DISABLED` correctly set on
Vercel, a double-fire can still happen (manual `curl` with `CRON_SECRET`,
Cloudflare retry on `throw`, or human error). The audit confirms no data
corruption in that case.

## Other crons — for context

- `fx-refresh` (`lib/fx/refresh.ts:108`): `claim_fx_refresh(refresh_date)` takes
  an advisory lock / `fx_fetch_log` row. The second caller gets `claimed = false`
  and returns `{ status: "skipped" }` without calling the provider, so data is
  safe but quota would still be burned if `fetchDailyRates` ran before the
  claim — current code claims first, so quota is conserved.

- `send-bill-reminders` (`lib/cron/send-bill-reminders.ts`): fetches
  `bill_instances` where `reminded_at IS NULL`, sends email + push, then
  `update reminded_at = now()`. A double-fire without `CRON_DISABLED` would
  resend every reminder. `CRON_DISABLED` is the intended guard; the job
  itself is not made idempotent because email delivery cannot be deduplicated
  solely in SQL.

## Security — `CRON_SECRET` rotation before public traffic (# Dev.to check)

The cron handlers authenticate on `Authorization: Bearer <CRON_SECRET>` with a
historical fallback `User-Agent: vercel-cron/1.0` (now gated to `NODE_ENV !==
"production"` in `src/app/api/cron/fx-refresh/route.ts`). If the fallback
were reachable in production it is an auth bypass — `purge-households` is
destructive. The repo is public, so the secret's blast radius matters.

- **Fallback gated:** `fx-refresh` now `if (process.env.NODE_ENV === "production") return false`
  before checking `vercel-cron/1.0`. `purge-households` (and the other two)
  require the bearer unconditionally (`if (!secret) return false`). Verified
  by `src/app/api/cron/cron-auth-bypass.test.ts` — unauthenticated, spoofed-UA,
  and wrong-bearer requests are `401` in production, and the `vercel-cron` UA
  is rejected for the destructive job even in development.
- **Rotate regardless:** `CRON_SECRET` has appeared in staging logs and issue
  comments (e.g. `<redacted>` in staging `verify-staging` logs) and was in the
  public repo's blast radius. Even if already rotated, treat the old value as
  compromised — replace with a placeholder in docs. Rotate before any
  Dev.to/LinkedIn announcement:

  ```bash
  # 1) Generate a new high-entropy secret (32 bytes hex or base64)
  openssl rand -hex 32        # or: openssl rand -base64 32
  # 2) Vercel — production + preview + development
  #    Dashboard → duobalance → Settings → Environment Variables → CRON_SECRET = <new>
  #    → Redeploy (or `vercel --prod`)
  #    Verify old 401s, new 200s:
  curl -i -H "Authorization: Bearer <old>" https://duobalanceapp.com/api/cron/purge-households # → 401
  curl -i -H "Authorization: Bearer <new>" https://duobalanceapp.com/api/cron/purge-households # → 200
  curl -i -H "User-Agent: vercel-cron/1.0" https://duobalanceapp.com/api/cron/purge-households # → 401 in prod
  # 3) Cloudflare — staging + production Workers
  printf "<new>" | wrangler secret put CRON_SECRET --env staging
  printf "<new>" | wrangler secret put CRON_SECRET          # production (top-level)
  # or: wrangler secret put CRON_SECRET # then paste, then --env staging separately
  wrangler secret list --env staging; wrangler secret list
  # 4) Local
  #    .env.local / .dev.vars → CRON_SECRET=<new>
  ```

  Do not commit the new value; `.env.example` documents the var as empty.
  `scripts/verify-staging.mjs --live` expects `CRON_SECRET` in the shell, not in git.

## References

- #160 — Add CRON_DISABLED guard so Vercel crons do not double-fire during rollback
- #152 — Epic: Migrate hosting from Vercel to Cloudflare Workers
- `src/lib/cron/guard.ts` — `isCronDisabled()` / `cronDisabledResponse()`
- `src/app/api/cron/*/route.ts` — each cron now returns `{ disabled: true }` 200 when `CRON_DISABLED=true|1`
- `worker.ts:scheduled` — same guard for Cloudflare triggers
- `supabase/migrations/20260810170000_bills_templates_and_instances.sql` — `bill_instances` unique `(bill_id, due_on)`
- `src/app/api/cron/cron-auth-bypass.test.ts` — unauthenticated / spoofed UA rejected in production
