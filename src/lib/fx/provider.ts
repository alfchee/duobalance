// Server-only FX provider isolation (#17). fetchDailyRates() is the single
// seam between duobalance and ExchangeRate-API: switching providers is a
// one-file change, and the provider's JSON shape must never leak past this
// module.
//
// EXCHANGERATE_API_KEY is read here (not via lib/env.ts, which is browser-
// reachable) so the identifier never ships to the client.

import { z } from "zod";

const EXCHANGERATE_API_URL = "https://v6.exchangerate-api.com/v6";

// One USD-base request returns every currency as "1 USD = usd_rate units".
const dailyRatesSchema = z.object({
  result: z.literal("success"),
  conversion_rates: z.record(z.string(), z.number().positive()),
});

export class FxProviderError extends Error {
  // True when the failure might resolve on a retry (network blip, upstream
  // 5xx). A bad key or a malformed payload would fail identically on retry,
  // so those are never retried.
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = "FxProviderError";
    this.retryable = retryable;
  }
}

export function parseDailyRates(body: unknown): Record<string, number> {
  const parsed = dailyRatesSchema.safeParse(body);
  if (!parsed.success) {
    throw new FxProviderError("provider returned an unexpected payload");
  }
  return parsed.data.conversion_rates;
}

export async function fetchDailyRates(): Promise<Record<string, number>> {
  const apiKey = process.env.EXCHANGERATE_API_KEY;
  if (!apiKey) {
    throw new FxProviderError("EXCHANGERATE_API_KEY is not set");
  }

  let res: Response;
  try {
    res = await fetch(`${EXCHANGERATE_API_URL}/${apiKey}/latest/USD`);
  } catch (err) {
    throw new FxProviderError(`provider unreachable: ${(err as Error).message}`, true);
  }

  if (!res.ok) {
    // 4xx (bad key, quota) won't fix itself; 5xx is a transient upstream blip.
    throw new FxProviderError(`provider returned HTTP ${res.status}`, res.status >= 500);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new FxProviderError("provider returned a non-JSON body", true);
  }

  return parseDailyRates(body);
}
