# Metrics refresh cadence

How often the numbers move, which artifact is canonical, and when to pay
for more freshness. Required reading alongside issue #275 (the dashboard
must not run expensive live queries on every page load).

## The two artifacts

| Artifact                                | Produced                          | Cadence                       | Canonical for    |
| --------------------------------------- | --------------------------------- | ----------------------------- | ---------------- |
| `reports/metrics/<date>.md` (generated) | `npm run metrics:report` (manual) | On demand (daily in practice) | The daily record |
| `/admin/metrics` (dashboard)            | Live `admin_metrics_*()` reads    | On mount + explicit Refresh   | Right-now checks |

Both read the same SQL definitions (pinned by
`src/lib/metrics-admin-agreement.test.ts`) over the same live tables, so
numbers generated for the same date agree. Same-day drift between two
loads is real activity, not disagreement — the report freezes its day,
the dashboard does not.

## Dashboard behavior

- Fetches once on mount plus an explicit **Refresh** button. No polling,
  no per-keystroke refetch. Each load writes one `metrics.view` audit row.
- The six readers are indexed aggregate counts (`count(*)`, `exists`,
  small-group `group by`) over timestamp columns. At current scale (tens
  of households) each completes in milliseconds; there is deliberately no
  caching layer, because caching an authenticated admin response would
  need per-principal keys to preserve the neutral-404 discipline —
  complexity with no payoff yet.

## When to revisit

If any reader exceeds ~1s in production (watch the `metrics.view`
handler latency), the path is a snapshot table refreshed on a schedule,
not a cache:

1. `metrics_snapshot` table (one row per section, JSONB payload,
   `captured_at`).
2. A Cloudflare Cron Trigger dispatching through `worker.ts` `scheduled()`
   (add the schedule to `wrangler.toml [triggers]` plus a `CRON_MAP`
   entry, sharing the existing trigger set — the free plan caps triggers
   per account, and Vercel crons are hard-disabled via `CRON_DISABLED`,
   so a `vercel.json` entry alone would never fire; see
   `docs/production-cutover.md`).
3. The dashboard route reads the snapshot; staleness is explicit in the
   UI (`captured_at`).

Do not add polling, longer ISR windows, or client-side timers
before that — all three either break the neutral denial or cost more
than the queries they avoid. (The shared `export const revalidate = 1`
one-liner on every admin route stays: responses still carry
`private, no-store`, so nothing is cached beyond the segment default.)
