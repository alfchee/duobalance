"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export type HouseholdMember = {
  id: string;
  user_id: string;
  display_name: string;
  role: "owner" | "partner";
  joined_at: string;
};

// Member roster for the active household (Settings → Members). RLS allows any
// member to SELECT household_members; joined_at is the "join date" shown next
// to each name.
export function useHouseholdMembers(householdId: string | null) {
  return useQuery({
    queryKey: ["household-members", householdId],
    queryFn: async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase) throw new Error("supabase not configured");
      const { data, error } = await supabase
        .from("household_members")
        .select("id, user_id, display_name, role, joined_at")
        .eq("household_id", householdId!)
        .order("joined_at");
      if (error) throw error;
      return data;
    },
    enabled: !!householdId,
  });
}
