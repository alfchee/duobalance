"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export function useCurrencies(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["reference", "currencies"],
    queryFn: async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("currencies")
        .select("code, name_en, symbol, minor_unit")
        .eq("is_enabled", true)
        .order("code");
      if (error) throw error;
      return data;
    },
    // Same auth gating as useCountries — currencies is authenticated-only under RLS.
    enabled: options?.enabled ?? true,
    staleTime: Infinity,
  });
}
