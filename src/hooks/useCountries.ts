"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";

// country_defaults (migration 13) is the same list the create_household RPC
// uses to default timezone/locale — sourcing the signup picker from it keeps
// the two in sync instead of hand-maintaining a duplicate country list.
export function useCountries(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["reference", "countries"],
    queryFn: async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("country_defaults")
        .select("country")
        .order("country");
      if (error) throw error;
      return data.map((row) => row.country);
    },
    // country_defaults is authenticated-only under RLS, so the query must be
    // gated on a session (the signup household step) — otherwise it runs anon
    // on first paint and caches an empty list forever.
    enabled: options?.enabled ?? true,
    staleTime: Infinity,
  });
}
