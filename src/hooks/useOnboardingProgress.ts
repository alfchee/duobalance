"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useAccounts } from "@/hooks/useAccounts";
import { useHouseholdMembers } from "@/hooks/useHouseholdMembers";
import { usePendingInvites } from "@/hooks/useInvites";

export function useOnboardingProgress(householdId: string | null) {
  const { data: accounts, isLoading: accountsLoading } = useAccounts(householdId);
  const hasAccounts = (accounts?.length ?? 0) > 0;

  const { data: hasTransactions = false, isLoading: txLoading } = useQuery({
    queryKey: ["transactions", householdId, "onboarding-check"],
    queryFn: async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase || !householdId) return false;
      const { count, error } = await supabase
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: !!householdId,
  });

  // hasBudgets is no longer needed here — the budget suggestion flow owns its own
  // hasBudgets check (useBudgetSuggestion). Keeping the field for API compatibility
  // but disabling the query to avoid an extra head-count per render.
  const hasBudgets = false;
  const budgetsLoading = false;

  const { data: members, isLoading: membersLoading } = useHouseholdMembers(householdId);
  const { data: invites, isLoading: invitesLoading } = usePendingInvites(householdId);
  const hasPartner = (members?.length ?? 0) > 1 || (invites?.length ?? 0) > 0;

  const isLoading = accountsLoading || txLoading || membersLoading || invitesLoading;
  // #198: budgets are no longer part of the required checklist, so isComplete
  // and isLoading do not require hasBudgets.
  void budgetsLoading; // keep for lint parity; value is false
  const isComplete = hasAccounts && hasTransactions && hasPartner;

  return {
    isLoading,
    hasAccounts,
    hasTransactions,
    hasBudgets,
    hasPartner,
    isComplete,
  };
}
