"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import type { Transaction, TransactionInsert, TransactionUpdate } from "@/lib/transactions";

export type TransactionInput = Omit<TransactionInsert, "household_id" | "entered_by">;
export type TransferInput = {
  description: string;
  fromAccountId: string;
  fromAmount: number;
  fromFxRate: number;
  occurredOn: string;
  toAccountId: string;
  toAmount: number;
  toFxRate: number;
};

function transactionsKey(householdId: string) {
  return ["transactions", householdId] as const;
}

function requireSupabase() {
  const supabase = createSupabaseBrowser();
  if (!supabase) throw new Error("supabase not configured");
  return supabase;
}

export type TransactionFilters = {
  accountIds: readonly string[];
  categoryIds: readonly string[];
  endDate: string | null;
  memberId: string | null;
  query: string;
  startDate: string | null;
  type: "all" | "expense" | "income" | "transfer";
};

type Cursor = Pick<Transaction, "occurred_on" | "id">;

export function useTransactions(householdId: string | null, filters: TransactionFilters) {
  return useInfiniteQuery({
    queryKey: ["transactions", householdId, filters],
    queryFn: async ({ pageParam }) => {
      let query = requireSupabase()
        .from("transactions")
        .select(
          "id, account_id, amount, base_amount, category_id, currency, description, entered_by, fx_rate, household_id, notes, occurred_on, spent_by, transfer_group_id, created_at, updated_at, import_batch_id, import_hash, is_cleared, is_pending_review, merchant, receipt_url",
        )
        .eq("household_id", householdId!);
      if (filters.startDate) query = query.gte("occurred_on", filters.startDate);
      if (filters.endDate) query = query.lte("occurred_on", filters.endDate);
      if (filters.accountIds.length) query = query.in("account_id", filters.accountIds);
      if (filters.categoryIds.length) query = query.in("category_id", filters.categoryIds);
      if (filters.memberId) query = query.eq("spent_by", filters.memberId);
      if (filters.type === "expense") {
        query = query.lt("amount", 0).is("transfer_group_id", null);
      }
      if (filters.type === "income") {
        query = query.gt("amount", 0).is("transfer_group_id", null);
      }
      if (filters.type === "transfer") query = query.not("transfer_group_id", "is", null);
      const search = filters.query.trim().replace(/[(),]/g, " ");
      if (search) query = query.or(`description.ilike.%${search}%,notes.ilike.%${search}%`);
      const cursor = pageParam as Cursor | null;
      if (cursor)
        query = query.or(
          `occurred_on.lt.${cursor.occurred_on},and(occurred_on.eq.${cursor.occurred_on},id.lt.${cursor.id})`,
        );
      const { data, error } = await query
        .order("occurred_on", { ascending: false })
        .order("id", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    initialPageParam: null as Cursor | null,
    getNextPageParam: (lastPage) =>
      lastPage.length === 50 ? (lastPage.at(-1) ?? null) : undefined,
    enabled: householdId !== null,
  });
}

export function useTransactionSummary(householdId: string | null, filters: TransactionFilters) {
  return useQuery({
    queryKey: ["transactions", householdId, "summary", filters],
    queryFn: async () => {
      let query = requireSupabase()
        .from("transactions")
        .select("amount, base_amount, transfer_group_id")
        .eq("household_id", householdId!);
      if (filters.startDate) query = query.gte("occurred_on", filters.startDate);
      if (filters.endDate) query = query.lte("occurred_on", filters.endDate);
      if (filters.accountIds.length) query = query.in("account_id", filters.accountIds);
      if (filters.categoryIds.length) query = query.in("category_id", filters.categoryIds);
      if (filters.memberId) query = query.eq("spent_by", filters.memberId);
      if (filters.type === "expense") {
        query = query.lt("amount", 0).is("transfer_group_id", null);
      }
      if (filters.type === "income") {
        query = query.gt("amount", 0).is("transfer_group_id", null);
      }
      if (filters.type === "transfer") query = query.not("transfer_group_id", "is", null);
      const search = filters.query.trim().replace(/[(),]/g, " ");
      if (search) query = query.or(`description.ilike.%${search}%,notes.ilike.%${search}%`);
      const { data, error } = await query;
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
    onSettled: invalidate,
  });

  const createTransfer = useMutation({
    mutationFn: async (input: TransferInput) => {
      if (!householdId) throw new Error("no household");
      const { data, error } = await requireSupabase().rpc("create_transfer", {
        p_description: input.description,
        p_from_account: input.fromAccountId,
        p_from_amount: input.fromAmount,
        p_from_fx_rate: input.fromFxRate,
        p_household: householdId,
        p_occurred_on: input.occurredOn,
        p_to_account: input.toAccountId,
        p_to_amount: input.toAmount,
        p_to_fx_rate: input.toFxRate,
      });
      if (error) throw error;
      return data;
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
      const { error } = await requireSupabase().rpc("delete_transfer", { p_transaction_id: id });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, createTransfer, update, remove };
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
