"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";

function requireSupabase() {
  const supabase = createSupabaseBrowser();
  if (!supabase) throw new Error("supabase not configured");
  return supabase;
}

export type ReportCategoryKind = "expense" | "income";

export type ReportCategoryTotal = {
  category_id: string | null;
  category_name: string | null;
  color_hex: string;
  total: number;
  txn_count: number;
};

export type ReportMonthlyTotal = {
  period_month: string;
  income: number;
  expense: number;
  net: number;
};

export function useReportCategoryTotals(
  householdId: string | null,
  from: string,
  to: string,
  kind: ReportCategoryKind,
  memberId: string | null = null,
) {
  return useQuery({
    queryKey: ["report-category-totals", householdId, from, to, kind, memberId],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc("report_category_totals", {
        p_household: householdId!,
        p_from: from,
        p_to: to,
        p_kind: kind,
        p_member: memberId ?? undefined,
      });
      if (error) throw error;
      return (data as ReportCategoryTotal[]) ?? [];
    },
    enabled: Boolean(householdId && from && to),
  });
}

export function useReportMonthlyTotals(
  householdId: string | null,
  from: string,
  to: string,
  memberId: string | null = null,
) {
  return useQuery({
    queryKey: ["report-monthly-totals", householdId, from, to, memberId],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc("report_monthly_totals", {
        p_household: householdId!,
        p_from: from,
        p_to: to,
        p_member: memberId ?? undefined,
      });
      if (error) throw error;
      return (data as ReportMonthlyTotal[]) ?? [];
    },
    enabled: Boolean(householdId && from && to),
  });
}
