"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type BudgetInsert = Database["public"]["Tables"]["budgets"]["Insert"];

function budgetStatusKey(householdId: string, periodMonth: string, ownerMemberId: string | null) {
  return ["budget-status", householdId, periodMonth, ownerMemberId] as const;
}

function budgetsKey(householdId: string, periodMonth: string, ownerMemberId: string | null) {
  return ["budgets", householdId, periodMonth, ownerMemberId] as const;
}

function requireSupabase() {
  const supabase = createSupabaseBrowser();
  if (!supabase) throw new Error("supabase not configured");
  return supabase;
}

export function useBudgetStatus(
  householdId: string | null,
  periodMonth: string,
  ownerMemberId: string | null,
) {
  return useQuery({
    queryKey: ["budget-status", householdId, periodMonth, ownerMemberId],
    queryFn: async () => {
      let query = requireSupabase()
        .from("budget_status")
        .select("*")
        .eq("household_id", householdId!)
        .eq("period_month", periodMonth);
      query =
        ownerMemberId === null
          ? query.is("owner_member_id", null)
          : query.eq("owner_member_id", ownerMemberId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: householdId !== null,
  });
}

export function useBudgetSpending(
  householdId: string | null,
  periodMonth: string,
  ownerMemberId: string | null,
) {
  return useQuery({
    queryKey: ["budget-spending", householdId, periodMonth, ownerMemberId],
    queryFn: async () => {
      const nextMonth = new Date(`${periodMonth}T00:00:00Z`);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      let query = requireSupabase()
        .from("transactions")
        .select("category_id, base_amount, description, occurred_on")
        .eq("household_id", householdId!)
        .gte("occurred_on", periodMonth)
        .lt("occurred_on", nextMonth.toISOString().slice(0, 10))
        .lt("amount", 0)
        .is("transfer_group_id", null)
        .not("category_id", "is", null)
        .order("occurred_on", { ascending: false });
      if (ownerMemberId) query = query.eq("spent_by", ownerMemberId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: householdId !== null,
  });
}

export function useBudgetMutations(householdId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    if (!householdId) return;
    void queryClient.invalidateQueries({ queryKey: ["budgets", householdId] });
    void queryClient.invalidateQueries({ queryKey: ["budget-status", householdId] });
    void queryClient.invalidateQueries({ queryKey: ["budget-spending", householdId] });
  };

  const copy = useMutation({
    mutationFn: async (budgets: readonly Omit<BudgetInsert, "household_id">[]) => {
      if (!householdId) throw new Error("no household");
      if (budgets.length === 0) return [];
      const { data, error } = await requireSupabase()
        .from("budgets")
        .insert(budgets.map((budget) => ({ ...budget, household_id: householdId })))
        .select();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  return { copy };
}

export { budgetsKey, budgetStatusKey };
