// Server-only (#17): fetches today's rates, applies them to fx_rates, and
// records every run in fx_fetch_log. Both the cron handler and the manual
// Settings refresh go through runFxRefresh(), so a missing day of rates is
// visible instead of silently falling back to an older rate.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { FxProviderError, fetchDailyRates } from "./provider";

export type FxRefreshResult = {
  rateDate: string;
  inserted: number;
  updated: number;
  skipped: number;
};

type LogRow = {
  outcome: "success" | "failed";
  rate_date: string;
  inserted?: number;
  updated?: number;
  skipped?: number;
  error?: string;
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

// Upserts one row per code into fx_rates for `rateDate`, skipping codes the
// currencies table doesn't know. Counts come from a pre-check of which
// (rate_date, code) pairs already exist — accurate for a daily run; a
// simultaneous manual refresh could skew the counts but never the data.
export async function applyDailyRates(
  supabase: SupabaseClient<Database>,
  rates: Record<string, number>,
  rateDate: string,
): Promise<Omit<FxRefreshResult, "rateDate">> {
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

  const { data: existing, error: existingError } = await supabase
    .from("fx_rates")
    .select("code")
    .eq("rate_date", rateDate);
  if (existingError) throw existingError;
  const existingCodes = new Set((existing ?? []).map((row) => row.code.trim()));

  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    if (existingCodes.has(row.code)) updated += 1;
    else inserted += 1;
  }

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from("fx_rates")
      .upsert(rows, { onConflict: "rate_date,code" });
    if (upsertError) throw upsertError;
  }

  return { inserted, updated, skipped };
}

async function logRun(supabase: SupabaseClient<Database>, row: LogRow): Promise<void> {
  try {
    const { error } = await supabase.from("fx_fetch_log").insert(row);
    if (error) console.error("fx_fetch_log insert failed:", error.message);
  } catch (err) {
    // A failed log write must not mask the run's own outcome.
    console.error("fx_fetch_log insert failed:", err);
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
  try {
    const rates = await fetchWithRetry();
    const counts = await applyDailyRates(supabase, rates, rateDate);
    await logRun(supabase, { outcome: "success", rate_date: rateDate, ...counts });
    return { rateDate, ...counts };
  } catch (err) {
    await logRun(supabase, { outcome: "failed", rate_date: rateDate, error: messageOf(err) });
    throw err;
  }
}
