"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { todayInHousehold } from "@/lib/dates";
import { useHousehold } from "@/hooks/useHousehold";

export type EffectiveRate = {
  code: string;
  usdRate: number;
  source: "override" | "feed";
  rateDate: string;
  note: string | null;
};

// Effective USD rate per currency, mirroring the DB resolution (fx_usd_rate):
// the newest household override on-or-before today wins outright; otherwise the
// global feed rate at its newest date. Source + date are surfaced so a stale
// override is visible rather than silent (#18). fx_overrides is member-scoped
// under RLS; fx_rates is readable by any authenticated user.
export function useFxOverrides() {
  const { householdId, timezone } = useHousehold();

  return useQuery({
    queryKey: ["fx", "overrides", householdId],
    queryFn: async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase) throw new Error("supabase not configured");
      if (!householdId) throw new Error("no household");
      const today = timezone ? todayInHousehold(timezone) : new Date().toISOString().slice(0, 10);

      const [overridesRes, newestDateRes] = await Promise.all([
        supabase
          .from("fx_overrides")
          .select("code, rate_date, usd_rate, note")
          .eq("household_id", householdId)
          .lte("rate_date", today)
          .order("rate_date", { ascending: false }),
        supabase
          .from("fx_rates")
          .select("rate_date")
          .order("rate_date", { ascending: false })
          .limit(1),
      ]);
      if (overridesRes.error) throw overridesRes.error;
      if (newestDateRes.error) throw newestDateRes.error;

      // Every daily refresh writes all enabled currencies for the same date, so
      // the newest feed date carries the whole set; no per-code max needed.
      const newestDate = newestDateRes.data?.[0]?.rate_date ?? null;
      const feedRes = newestDate
        ? await supabase
            .from("fx_rates")
            .select("code, rate_date, usd_rate, source")
            .eq("rate_date", newestDate)
        : { data: null, error: null };
      if (feedRes.error) throw feedRes.error;

      // Newest override per code. Rows are already ordered rate_date desc, so
      // the first row seen per code is its effective override.
      const overrideByCode = new Map<string, EffectiveRate>();
      for (const row of overridesRes.data ?? []) {
        const code = row.code.trim();
        if (overrideByCode.has(code)) continue;
        overrideByCode.set(code, {
          code,
          usdRate: row.usd_rate,
          source: "override",
          rateDate: row.rate_date,
          note: row.note,
        });
      }

      const ratesByCode = new Map<string, EffectiveRate>();
      for (const row of feedRes.data ?? []) {
        const code = row.code.trim();
        ratesByCode.set(code, {
          code,
          usdRate: row.usd_rate,
          source: "feed",
          rateDate: row.rate_date,
          note: null,
        });
      }

      // Override wins outright; a code only present in the feed falls back to it.
      const codes = new Set([...overrideByCode.keys(), ...ratesByCode.keys()]);
      return [...codes]
        .map((code) => overrideByCode.get(code) ?? ratesByCode.get(code))
        .filter((r): r is EffectiveRate => r !== undefined)
        .sort((a, b) => a.code.localeCompare(b.code));
    },
    enabled: !!householdId,
    staleTime: 60_000,
  });
}
