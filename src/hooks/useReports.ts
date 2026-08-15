"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { createSupabaseBrowser } from "@/lib/supabase/client";

function requireSupabase() {
  const supabase = createSupabaseBrowser();
  if (!supabase) throw new Error("supabase not configured");
  return supabase;
}

export type ReportCategoryKind = "expense" | "income";

export const reportCategoryTotalSchema = z.object({
  category_id: z.string().nullable(),
  category_name: z.string().nullable(),
  color_hex: z.string().default("#9ca3af"),
  total: z.coerce.number().nonnegative().default(0),
  txn_count: z.coerce.number().default(0),
});

export const reportMonthlyTotalSchema = z.object({
  period_month: z.string(),
  income: z.coerce.number().default(0),
  expense: z.coerce.number().default(0),
  net: z.coerce.number().default(0),
});

export type ReportCategoryTotal = z.infer<typeof reportCategoryTotalSchema>;
export type ReportMonthlyTotal = z.infer<typeof reportMonthlyTotalSchema>;

export function useReportCategoryTotals(
  householdId: string | null,
  from: string,
  to: string,
  kind: ReportCategoryKind,
  memberId: string | null = null,
) {
  return useQuery({
    queryKey: ["reports", householdId, "category-totals", from, to, kind, memberId],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc("report_category_totals", {
        p_household: householdId!,
        p_from: from,
        p_to: to,
        p_kind: kind,
        p_member: memberId ?? undefined,
      });
      if (error) throw error;
      return z.array(reportCategoryTotalSchema).parse(data ?? []);
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
    queryKey: ["reports", householdId, "monthly-totals", from, to, memberId],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc("report_monthly_totals", {
        p_household: householdId!,
        p_from: from,
        p_to: to,
        p_member: memberId ?? undefined,
      });
      if (error) throw error;
      return z.array(reportMonthlyTotalSchema).parse(data ?? []);
    },
    enabled: Boolean(householdId && from && to),
  });
}
