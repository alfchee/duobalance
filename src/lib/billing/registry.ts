import { StubPaymentProvider } from "./adapters/stub";
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
 * Also handy if provider configuration ever changes at runtime.
 */
export function resetBillingRegistry(): void {
  providers.clear();
  registerProvider(new StubPaymentProvider());
}
