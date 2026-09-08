"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useCategories } from "@/hooks/useCategories";
import { todayInHousehold } from "@/lib/dates";

export const BUDGET_SUGGESTION_TRANSACTION_THRESHOLD = 10;
export const BUDGET_SUGGESTION_DISMISS_PREFIX = "duobalance:dismissedBudgetSuggestion:";
export const BUDGET_SUGGESTION_DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export type BudgetSuggestion = {
  categoryId: string;
  name: string;
  suggestedAmount: number;
  spent: number;
  count: number;
};

function requireSupabase() {
  const supabase = createSupabaseBrowser();
  if (!supabase) throw new Error("supabase not configured");
  return supabase;
}

function readDismissedAt(householdId: string | null): number | null {
  if (!householdId || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${BUDGET_SUGGESTION_DISMISS_PREFIX}${householdId}`);
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function getSinceStr(timezone: string | null | undefined): string {
  const tz = timezone ?? "UTC";
  try {
    const todayStr = todayInHousehold(tz);
    const d = new Date(`${todayStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
  } catch {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    return since.toISOString().slice(0, 10);
  }
}

export function useBudgetSuggestion(
  householdId: string | null,
  ownerMemberId: string | null,
  timezone?: string | null,
) {
  const { data: categories = [] } = useCategories(householdId);

  const { data: hasBudgets = false, isLoading: budgetsLoading } = useQuery({
    queryKey: ["budgets", householdId, "suggestion-hasBudgets", ownerMemberId],
    queryFn: async () => {
      const supabase = requireSupabase();
      if (!householdId) return false;
      let query = supabase
        .from("budgets")
        .select("id", { count: "exact", head: true })
        .eq("household_id", householdId);
      query =
        ownerMemberId === null
          ? query.is("owner_member_id", null)
          : query.eq("owner_member_id", ownerMemberId);
      const { count, error } = await query;
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: !!householdId,
  });

  const { data: txStats, isLoading: txLoading } = useQuery({
    queryKey: [
      "transactions",
      householdId,
      "budget-suggestion-stats",
      ownerMemberId,
      timezone ?? "UTC",
    ],
    queryFn: async () => {
      const supabase = requireSupabase();
      if (!householdId)
        return {
          count: 0,
          byCategory: {} as Record<string, { spent: number; count: number }>,
          isFallback: false,
        };
      let countQuery = supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("household_id", householdId)
        .lt("amount", 0)
        .is("transfer_group_id", null)
        .not("category_id", "is", null);
      if (ownerMemberId) countQuery = countQuery.eq("spent_by", ownerMemberId);
      const { count, error: countError } = await countQuery;
      if (countError) throw countError;

      const sinceStr = getSinceStr(timezone);
      let spendQuery = supabase
        .from("transactions")
        .select("category_id, base_amount, occurred_on")
        .eq("household_id", householdId)
        .lt("amount", 0)
        .is("transfer_group_id", null)
        .not("category_id", "is", null)
        .gte("occurred_on", sinceStr)
        .order("occurred_on", { ascending: false })
        .limit(1000);
      if (ownerMemberId) spendQuery = spendQuery.eq("spent_by", ownerMemberId);
      const { data, error } = await spendQuery;
      if (error) throw error;

      const byCategory: Record<string, { spent: number; count: number }> = {};
      for (const row of data ?? []) {
        if (!row.category_id) continue;
        const spent = Math.abs(row.base_amount ?? 0);
        const current = byCategory[row.category_id];
        if (current) {
          current.spent += spent;
          current.count += 1;
        } else {
          byCategory[row.category_id] = { spent, count: 1 };
        }
      }

      let isFallback = false;
      if (Object.keys(byCategory).length === 0 && (count ?? 0) > 0) {
        let fallbackQuery = supabase
          .from("transactions")
          .select("category_id, base_amount")
          .eq("household_id", householdId)
          .lt("amount", 0)
          .is("transfer_group_id", null)
          .not("category_id", "is", null)
          .order("occurred_on", { ascending: false })
          .limit(500);
        if (ownerMemberId) fallbackQuery = fallbackQuery.eq("spent_by", ownerMemberId);
        const { data: fallback, error: fallbackError } = await fallbackQuery;
        if (fallbackError) throw fallbackError;
        for (const row of fallback ?? []) {
          if (!row.category_id) continue;
          const spent = Math.abs(row.base_amount ?? 0);
          const current = byCategory[row.category_id];
          if (current) {
            current.spent += spent;
            current.count += 1;
          } else {
            byCategory[row.category_id] = { spent, count: 1 };
          }
        }
        if (Object.keys(byCategory).length > 0) isFallback = true;
      }

      return { count: count ?? 0, byCategory, isFallback };
    },
    enabled: !!householdId,
  });

  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!householdId) {
      setDismissedAt(null);
      setHydrated(true);
      return;
    }
    setDismissedAt(readDismissedAt(householdId));
    setHydrated(true);
  }, [householdId]);

  const dismiss = useCallback(() => {
    if (!householdId) return;
    const now = Date.now();
    try {
      localStorage.setItem(`${BUDGET_SUGGESTION_DISMISS_PREFIX}${householdId}`, String(now));
    } catch {
      // ignore storage-disabled
    }
    setDismissedAt(now);
  }, [householdId]);

  const dismissedRecently = useMemo(() => {
    if (!hydrated) return true;
    if (dismissedAt === null) return false;
    return Date.now() - dismissedAt < BUDGET_SUGGESTION_DISMISS_COOLDOWN_MS;
  }, [dismissedAt, hydrated]);

  const suggestions: BudgetSuggestion[] = useMemo(() => {
    if (!txStats) return [];
    const entries = Object.entries(txStats.byCategory);
    return entries
      .map(([categoryId, { spent, count }]) => {
        const name = categories.find((c) => c.id === categoryId)?.name ?? categoryId;
        return { categoryId, name, suggestedAmount: spent, spent, count };
      })
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 8);
  }, [txStats, categories]);

  const transactionCount = txStats?.count ?? 0;
  const meetsThreshold = transactionCount >= BUDGET_SUGGESTION_TRANSACTION_THRESHOLD;
  const eligible =
    !hasBudgets && meetsThreshold && suggestions.length > 0 && !dismissedRecently && hydrated;

  return {
    isLoading: budgetsLoading || txLoading || !hydrated,
    hasBudgets,
    transactionCount,
    suggestions,
    isFallback: txStats?.isFallback ?? false,
    eligible,
    dismissedRecently,
    dismiss,
    hydrated,
  };
}
