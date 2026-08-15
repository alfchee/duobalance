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

const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .default("#9ca3af");

export const reportCategoryTotalSchema = z.object({
  category_id: z.string().nullable(),
  category_name: z.string().nullable(),
  color_hex: hexColorSchema,
  total: z.coerce.number().nonnegative(),
  txn_count: z.coerce.number(),
});

export const reportMonthlyTotalSchema = z
  .object({
    period_month: z.string(),
    income: z.coerce.number(),
    expense: z.coerce.number(),
    net: z.coerce.number(),
  })
  .refine((row) => Math.abs(row.net - (row.income - row.expense)) < 0.01, {
    message: "net must equal income minus expense",
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
