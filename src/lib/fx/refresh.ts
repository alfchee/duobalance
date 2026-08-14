// Server-only (#17): the cron handler fetches today's rates, applies them to
// fx_rates, and records every run in fx_fetch_log so a missing day of rates is
// visible instead of silently falling back to an older rate.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { FxProviderError, fetchDailyRates } from "./provider";

export type FxRefreshResult = {
  rateDate: string;
  status: "success" | "skipped";
  currenciesUpdated: number;
  skipped: number;
};

// One retry on transient provider failures (network blip, upstream 5xx). A
// bad key or malformed response is not retried — it would fail identically.
async function fetchWithRetry(): Promise<Record<string, number>> {
  try {
    return await fetchDailyRates();
  } catch (err) {
    if (err instanceof FxProviderError && err.retryable) {
      return await fetchDailyRates();
    }
    throw err;
  }
}

// Upserts one row per known currency code into fx_rates for `rateDate` and
// returns the written-row count and the number of skipped provider codes.
export async function applyDailyRates(
  supabase: SupabaseClient<Database>,
  rates: Record<string, number>,
  rateDate: string,
): Promise<{ currenciesUpdated: number; skipped: number }> {
  const { data: currencies, error: currenciesError } = await supabase
    .from("currencies")
    .select("code");
  if (currenciesError) throw currenciesError;
  // char(3) values may come back padded ("USD "); trim so membership checks
  // match the provider's unpadded codes.
  const validCodes = new Set((currencies ?? []).map((c) => c.code.trim()));

  const payload = Object.entries(rates);
  const rows = payload
    .filter(([code]) => validCodes.has(code))
    .map(([code, usdRate]) => ({ rate_date: rateDate, code, usd_rate: usdRate }));
  const skipped = payload.length - rows.length;

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from("fx_rates")
      .upsert(rows, { onConflict: "rate_date,code" });
    if (upsertError) throw upsertError;
  }

  return { currenciesUpdated: rows.length, skipped };
}

async function logFailure(
  supabase: SupabaseClient<Database>,
  rateDate: string,
  error: string,
): Promise<void> {
  try {
    const { error: logError } = await supabase.rpc("record_fx_refresh_failure", {
      refresh_date: rateDate,
      failure_error: error,
    });
    if (logError) console.error("record_fx_refresh_failure RPC failed:", logError.message);
  } catch (err) {
    // A failed log write must not mask the run's own outcome.
    console.error("record_fx_refresh_failure RPC failed:", err);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Fetches + applies today's rates, records the outcome in fx_fetch_log, and
// returns counts. Throws the provider/db error on failure so the caller can
// shape the HTTP response.
export async function runFxRefresh(supabase: SupabaseClient<Database>): Promise<FxRefreshResult> {
  const rateDate = new Date().toISOString().slice(0, 10);
  const { data: claimed, error: claimError } = await supabase.rpc("claim_fx_refresh", {
    refresh_date: rateDate,
  });
  if (claimError) throw claimError;
  if (!claimed) {
    return { rateDate, status: "skipped", currenciesUpdated: 0, skipped: 0 };
  }

  try {
    const rates = await fetchWithRetry();
    const counts = await applyDailyRates(supabase, rates, rateDate);
    const { error: logError } = await supabase.rpc("record_fx_refresh_success", {
      refresh_date: rateDate,
      updated_currencies: counts.currenciesUpdated,
    });
    if (logError) throw logError;
    return { rateDate, status: "success", ...counts };
  } catch (err) {
    await logFailure(supabase, rateDate, messageOf(err));
    throw err;
  }
}
