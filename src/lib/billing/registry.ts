import { StubPaymentProvider } from "./adapters/stub";
import { ManualClock } from "./clock";
import type { PaymentProvider } from "./provider";

// Provider registry (issue #258, ADR 0002).
//
// COMPOSITION ROOT: this is the ONLY module outside `adapters/` allowed to
// import an adapter — it wires implementations to the PaymentProvider port.
// Every other consumer resolves through `getActiveProvider()` /
// `getProvider()` and programs against the port types. The `billing/adapters`
// boundary in `eslint.config.mjs` exempts exactly this file.
//
// The active provider id comes from server-only configuration. `BILLING_PROVIDER`
// is read from `process.env` directly (never via `lib/env.ts`, which ships to
// the browser — same precedent as EXCHANGERATE_API_KEY in `lib/fx/provider.ts`).
// Unset means "stub", so the full billing test path in #266 runs with no
// provider connected. See `.env.example`.

export const DEFAULT_PROVIDER_ID = "stub";

export class UnknownProviderError extends Error {
  constructor(id: string, known: readonly string[]) {
    super(`unknown billing provider "${id}" (known: ${known.join(", ") || "none"})`);
    this.name = "UnknownProviderError";
  }
}

const providers = new Map<string, PaymentProvider>();

export function registerProvider(provider: PaymentProvider): void {
  if (providers.has(provider.id)) {
    throw new Error(`billing provider "${provider.id}" is already registered`);
  }
  providers.set(provider.id, provider);
}

registerProvider(new StubPaymentProvider());

/** Active provider id from configuration; defaults to the stub. */
export function resolveProviderId(): string {
  const raw = process.env.BILLING_PROVIDER?.trim();
  return raw ? raw : DEFAULT_PROVIDER_ID;
}

export function getProvider(id: string): PaymentProvider {
  const provider = providers.get(id);
  if (!provider) {
    throw new UnknownProviderError(id, [...providers.keys()]);
  }
  return provider;
}

/** Resolve the configured provider (the stub unless BILLING_PROVIDER names another). */
export function getActiveProvider(id: string = resolveProviderId()): PaymentProvider {
  return getProvider(id);
}

/**
 * Test support: drop all registrations and re-seed the default stub.
 * Never call this outside tests — it wipes every registered provider.
 */
export function resetBillingRegistry(): void {
  providers.clear();
  registerProvider(new StubPaymentProvider());
  debugStub = null;
}

let debugStub: StubPaymentProvider | null = null;

/**
 * Manual-driving sandbox for the dev debug surface
 * (`app/api/billing/debug`). Lives here — rather than the route importing
 * the adapter directly — so the `billing/adapters` boundary keeps exactly
 * one exemption (this composition root). Manual clock pinned to a fixed
 * start so the sandbox is deterministic; the route 404s in production, so
 * this instance is unreachable outside development.
 */
export function getStubForDebug(): StubPaymentProvider {
  if (!debugStub) {
    debugStub = new StubPaymentProvider(
      undefined,
      new ManualClock(new Date("2026-09-23T00:00:00.000Z")),
    );
  }
  return debugStub;
}
