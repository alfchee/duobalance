"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import type {
  CategoryInsert,
  CategoryUpdate,
  CategorizationRule,
  CategorizationRuleInsert,
  CategorizationRuleUpdate,
} from "@/lib/categories";
import { matchingRule } from "@/lib/categories";

function categoriesKey(householdId: string) {
  return ["categories", householdId] as const;
}

function rulesKey(householdId: string) {
  return ["categorization-rules", householdId] as const;
}

function requireSupabase() {
  const supabase = createSupabaseBrowser();
  if (!supabase) throw new Error("supabase not configured");
  return supabase;
}

export function useCategories(householdId: string | null) {
  return useQuery({
    queryKey: ["categories", householdId],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from("categories")
        .select("*")
        .eq("household_id", householdId!)
        .order("display_order")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: householdId !== null,
  });
}

export function useCategorizationRules(householdId: string | null) {
  return useQuery({
    queryKey: ["categorization-rules", householdId],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from("categorization_rules")
        .select("*")
        .eq("household_id", householdId!)
        .order("priority")
        .order("id");
      if (error) throw error;
      return data;
    },
    enabled: householdId !== null,
  });
}

export function useCategoryMutations(householdId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    if (householdId) {
      void queryClient.invalidateQueries({ queryKey: categoriesKey(householdId) });
      void queryClient.invalidateQueries({ queryKey: rulesKey(householdId) });
    }
  };

  const create = useMutation({
    mutationFn: async (input: Omit<CategoryInsert, "household_id">) => {
      if (!householdId) throw new Error("no household");
      const { data, error } = await requireSupabase()
        .from("categories")
        .insert({ ...input, household_id: householdId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...input }: CategoryUpdate & { id: string }) => {
      const { data, error } = await requireSupabase()
        .from("categories")
        .update(input)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await requireSupabase().from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export function useCategorizationRuleMutations(householdId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    householdId && queryClient.invalidateQueries({ queryKey: rulesKey(householdId) });
  const create = useMutation({
    mutationFn: async (input: Omit<CategorizationRuleInsert, "household_id">) => {
      if (!householdId) throw new Error("no household");
      const { data, error } = await requireSupabase()
        .from("categorization_rules")
        .insert({ ...input, household_id: householdId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...input }: CategorizationRuleUpdate & { id: string }) => {
      const { data, error } = await requireSupabase()
        .from("categorization_rules")
        .update(input)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await requireSupabase().from("categorization_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export type RuleApplicationPreview = {
  categoryId: string;
  transactionIds: string[];
};

export function useRuleApplicationPreview(
  householdId: string | null,
  rules: readonly CategorizationRule[],
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["categorization-rules", "preview", householdId, rules],
    queryFn: async (): Promise<RuleApplicationPreview[]> => {
      const { data, error } = await requireSupabase()
        .from("transactions")
        .select("id, description, category_id")
        .eq("household_id", householdId!);
      if (error) throw error;
      const grouped = new Map<string, string[]>();
      for (const transaction of data) {
        const rule = matchingRule(transaction.description, rules);
        if (!rule || rule.category_id === transaction.category_id) continue;
        grouped.set(rule.category_id, [...(grouped.get(rule.category_id) ?? []), transaction.id]);
      }
      return [...grouped.entries()].map(([categoryId, transactionIds]) => ({
        categoryId,
        transactionIds,
      }));
    },
    enabled: enabled && householdId !== null,
  });
}

export function useApplyCategorizationRules(householdId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (preview: readonly RuleApplicationPreview[]) => {
      const supabase = requireSupabase();
      const results = await Promise.all(
        preview.map(({ categoryId, transactionIds }) =>
          supabase
            .from("transactions")
            .update({ category_id: categoryId })
            .in("id", transactionIds),
        ),
      );
      const firstError = results.find((result) => result.error)?.error;
      if (firstError) throw firstError;
    },
    onSuccess: () => {
      if (householdId)
        void queryClient.invalidateQueries({ queryKey: ["transactions", householdId] });
    },
  });
}
