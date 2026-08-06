"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export type FxRefreshResult = {
  rateDate: string;
  inserted: number;
  updated: number;
  skipped: number;
};

// Newest fx_rates row, for the stale-rate warning (#17). fx_rates is
// SELECT-granted to authenticated under RLS (migration 11), so the client
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

// Manual refresh runs server-side (POST /api/fx/refresh) so CRON_SECRET never
// reaches the client. It shares the exact run path with the cron endpoint.
export function useFxRefresh() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<FxRefreshResult>("/api/fx/refresh", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fx", "status"] }),
  });
}
