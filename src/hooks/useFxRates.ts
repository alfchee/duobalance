"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";

// Newest fx_rates row, for the stale-rate warning (#17). fx_rates is
// SELECT-granted to authenticated under RLS (migration 12), so the client
// reads it directly.
export function useFxRatesStatus() {
  return useQuery({
    queryKey: ["fx", "status"],
    queryFn: async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase) throw new Error("supabase not configured");
      const { data, error } = await supabase
        .from("fx_rates")
        .select("rate_date")
        .order("rate_date", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}
