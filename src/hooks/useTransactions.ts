"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import type { Transaction, TransactionInsert, TransactionUpdate } from "@/lib/transactions";

export type TransactionInput = Omit<TransactionInsert, "household_id" | "entered_by">;

function transactionsKey(householdId: string) {
  return ["transactions", householdId] as const;
}

function requireSupabase() {
  const supabase = createSupabaseBrowser();
  if (!supabase) throw new Error("supabase not configured");
  return supabase;
}

export function useTransactions(householdId: string | null) {
  return useQuery({
    queryKey: ["transactions", householdId],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from("transactions")
        .select("*")
        .eq("household_id", householdId!)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: householdId !== null,
  });
}

export function useTransactionDescriptions(householdId: string | null) {
  return useQuery({
    queryKey: ["transactions", householdId, "descriptions"],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from("transactions")
        .select("description")
        .eq("household_id", householdId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return [...new Set(data.map((transaction) => transaction.description))];
    },
    enabled: householdId !== null,
    staleTime: 60_000,
  });
}

export function useTransactionMutations(householdId: string | null, memberId: string | null) {
  const queryClient = useQueryClient();
  const key = householdId ? transactionsKey(householdId) : null;
  const invalidate = () => {
    if (!key) return;
    void queryClient.invalidateQueries({ queryKey: key });
  };

  const create = useMutation({
    mutationFn: async (input: TransactionInput) => {
      if (!householdId || !memberId) throw new Error("no household member");
      const { data, error } = await requireSupabase()
        .from("transactions")
        .insert({ ...input, household_id: householdId, entered_by: memberId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async (input) => {
      if (!key || !householdId || !memberId) return undefined;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Transaction[]>(key);
      const optimistic: Transaction = {
        ...input,
        category_id: input.category_id ?? null,
        id: `optimistic-${crypto.randomUUID()}`,
        household_id: householdId,
        entered_by: memberId,
        fx_rate: input.fx_rate ?? 1,
        base_amount: input.amount * (input.fx_rate ?? 1),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        import_batch_id: null,
        import_hash: null,
        is_cleared: input.is_cleared ?? false,
        is_pending_review: input.is_pending_review ?? false,
        merchant: input.merchant ?? null,
        notes: input.notes ?? null,
        receipt_url: input.receipt_url ?? null,
        spent_by: input.spent_by ?? null,
        transfer_group_id: input.transfer_group_id ?? null,
      };
      queryClient.setQueryData<Transaction[]>(key, (current = []) => [optimistic, ...current]);
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (key && context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...input }: TransactionUpdate & { id: string }) => {
      const { data, error } = await requireSupabase()
        .from("transactions")
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
      const { error } = await requireSupabase().from("transactions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

export function useFxRateOn(
  householdId: string | null,
  occurredOn: string,
  currency: string | null,
  baseCurrency: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["fx", "transaction-rate", householdId, occurredOn, currency, baseCurrency],
    queryFn: async () => {
      if (!householdId || !currency || !baseCurrency) throw new Error("incomplete rate request");
      const { data, error } = await requireSupabase().rpc("fx_rate_on", {
        p_household: householdId,
        p_date: occurredOn,
        p_from: currency,
        p_to: baseCurrency,
      });
      if (error) throw error;
      return data;
    },
    enabled: enabled && !!householdId && !!currency && !!baseCurrency,
  });
}
