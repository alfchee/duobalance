# ADR 0002 — PaymentProvider port and BillingEvent vocabulary

- Status: Accepted (2026-09-23)
- Decides: #258
- Parent epic: #255 (Phase A: SaaS layer, provider-independent)
- Follows: ADR 0001 (plan catalogue)

## Context

No payment provider is available yet — Nicaragua is blocked by every
international merchant of record, and local acquiring is still in discovery,
so whichever adapter eventually lands is genuinely unknown today. The
entitlements, dunning and grace logic of later issues must therefore never
learn who processes payments; otherwise switching provider later is a
rewrite instead of one file.

## Decision

- **Port location.** `src/lib/billing/provider.ts` holds `PaymentProvider`,
  `ProviderSubscription` and the `BillingEvent` union, verbatim from #258.
  `BillingEvent` is our vocabulary, not any provider's: every adapter
  translates into the same five events.
- **Money with explicit currency.** `src/lib/billing/money.ts` defines
  `Money` as `{ amount: number; currency: string }` (Zod-validated: integer
  amount, ISO 4217 uppercase code), where `amount` is in the currency's
  minor unit (`currencies.minor_unit`: NIO = 2, USD = 2; only CLP and PYG
  are 0 per the pgTAP contract in `01_reference_tables.sql`). It is deliberately
  not a number alias — a bare number cannot cross the port. Display
  formatting stays in `src/lib/money.ts` (major units) via `toMajorUnits()`.
- **Registry resolves the stub by default.**
  `src/lib/billing/registry.ts` resolves the active provider id from the
  server-only `BILLING_PROVIDER` env var (read from `process.env` directly —
  never via `lib/env.ts`, which ships to the browser; same precedent as
  `EXCHANGERATE_API_KEY` in `lib/fx/provider.ts`). Unset or blank means
  `"stub"`. Unknown ids throw `UnknownProviderError` listing the known ids.
- **`parseWebhook` owns signature verification.** On a missing or invalid
  signature the adapter MUST throw `InvalidWebhookSignatureError` — never
  return an empty array, which the caller would misread as "no events" and
  silently drop a (possibly forged) delivery. The contract is in the type
  signature's `@throws` documentation, demonstrated by the stub, and covered
  by `registry.test.ts`.
- **Boundary rule.** No provider-specific type may be imported outside
  `src/lib/billing/adapters/`. The stub's `StubVendorConfig` is the standing
  fixture for this rule: it simulates a vendor type and must never leak.
  The sole exemption is `registry.ts`, the composition root that wires
  adapters to the port.

## Enforcement

Cheap and two-layered, mirroring the service-role-key leak guard:

1. **Lint.** `eslint.config.mjs` has a `billing/adapters` boundary entry
   using `no-restricted-syntax` (not `no-restricted-imports`, which would
   clobber the `next/headers` ban for overlapping files — same rule keys
   overwrite in flat config, so the `use server` selectors are repeated
   there). It bans static imports, re-exports, `export *`, and dynamic
   `import()` of `billing/adapters` everywhere except the adapters dir and
   `registry.ts`. A deliberate vendor-type import from the domain layer
   fails `npx eslint` (verified during review of this change).
2. **Tests.** `src/lib/billing/boundary.test.ts` asserts the domain modules
   reference no adapter, the registry remains the only importer, the eslint
   selectors stay in place, and `Money` is not a number alias; the
   `@ts-expect-error` assignment in `provider.test.ts` makes a number alias
   fail type-check.

## Consequences

- The stub in `adapters/stub.ts` is a placeholder (all lifecycle methods
  throw until #259); the registry, port, and boundary are final.
- Real adapters land as new files under `adapters/` + one
  `registerProvider()` line in the registry — no domain changes.
- Resist adding provider-shaped fields "just in case" to `BillingEvent`.
  Every leaked vendor concept becomes translation burden on every adapter.
