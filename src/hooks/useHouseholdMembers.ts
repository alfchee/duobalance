"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export type HouseholdMember = {
  id: string;
  user_id: string;
  display_name: string;
  role: "owner" | "partner";
  joined_at: string;
  color_hex: string | null;
};

// Member roster for the active household (Settings → Members, Balances owner
// badges). RLS allows any member to SELECT household_members; joined_at is the
// "join date" shown next to each name. color_hex is the per-person color used
// to tint the owner badge on each account row (#21).
export function useHouseholdMembers(householdId: string | null) {
  return useQuery({
    queryKey: ["household-members", householdId],
    queryFn: async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase) throw new Error("supabase not configured");
      const { data, error } = await supabase
        .from("household_members")
        .select("id, user_id, display_name, role, joined_at, color_hex")
        .eq("household_id", householdId!)
        .is("removed_at", null)
        .order("joined_at");
      if (error) throw error;
      return data;
    },
    enabled: !!householdId,
  });
}
