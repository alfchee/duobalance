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
    queryKey: ["onboarding-transactions-check", householdId],
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

  const { data: hasBudgets = false, isLoading: budgetsLoading } = useQuery({
    queryKey: ["onboarding-budgets-check", householdId],
    queryFn: async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase || !householdId) return false;
      const { count, error } = await supabase
        .from("budgets")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: !!householdId,
  });

  const { data: members, isLoading: membersLoading } = useHouseholdMembers(householdId);
  const { data: invites, isLoading: invitesLoading } = usePendingInvites(householdId);
  const hasPartner = (members?.length ?? 0) > 1 || (invites?.length ?? 0) > 0;

  const isLoading =
    accountsLoading || txLoading || budgetsLoading || membersLoading || invitesLoading;
  const isComplete = hasAccounts && hasTransactions && hasBudgets && hasPartner;

  return {
    isLoading,
    hasAccounts,
    hasTransactions,
    hasBudgets,
    hasPartner,
    isComplete,
  };
}
