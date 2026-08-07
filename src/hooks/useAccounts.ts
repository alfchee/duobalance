"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { nextDisplayOrder, type Account, type AccountKind } from "@/lib/accounts";

export type AccountInput = {
  name: string;
  kind: AccountKind;
  currency: string;
  balance_mode: "ledger" | "manual";
  opening_balance: number;
  manual_balance: number | null;
  credit_limit: number | null;
  is_shared: boolean;
  owner_member_id: string | null;
};

function accountsKey(householdId: string) {
  return ["accounts", householdId] as const;
}

// Accounts are read straight through RLS (issue #19 policies): any member can
// see shared accounts plus their own private ones. display_order is the drag
// handle's persistence; created_at breaks ties.
export function useAccounts(householdId: string | null) {
  return useQuery({
    queryKey: ["accounts", householdId],
    queryFn: async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase) throw new Error("supabase not configured");
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .eq("household_id", householdId!)
        .order("display_order", { ascending: true, nullsFirst: true })
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!householdId,
  });
}

function requireSupabase() {
  const supabase = createSupabaseBrowser();
  if (!supabase) throw new Error("supabase not configured");
  return supabase;
}

// All writes go client→Supabase directly: migration #19 defines per-command RLS
// policies (accounts_insert/update/delete), so no route handler is involved.
export function useAccountMutations(householdId: string | null) {
  const queryClient = useQueryClient();
  const key = householdId ? accountsKey(householdId) : null;
  const invalidate = () => key && queryClient.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: async (input: AccountInput) => {
      if (!householdId || !key) throw new Error("no household");
      const supabase = requireSupabase();
      // Append new accounts at the end: display_order is queried nullsFirst, so
      // without this a fresh account (null order) would sort to the top.
      const existing = queryClient.getQueryData<Account[]>(key) ?? [];
      const { data, error } = await supabase
        .from("accounts")
        .insert({ ...input, household_id: householdId, display_order: nextDisplayOrder(existing) })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...input }: AccountInput & { id: string }) => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("accounts")
        .update(input)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const archive = useMutation({
    mutationFn: async ({ id, isArchived }: { id: string; isArchived: boolean }) => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("accounts")
        .update({ is_archived: isArchived })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const updateManualBalance = useMutation({
    mutationFn: async ({ id, manualBalance }: { id: string; manualBalance: number }) => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("accounts")
        .update({ manual_balance: manualBalance, balance_updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    // RLS (accounts_update, #19) lets me edit joint accounts and my own — a
    // partner-owned shared account can't be touched even for display_order, so
    // skip those rows rather than fail the whole batch.
    mutationFn: async ({ accounts, memberId }: { accounts: Account[]; memberId: string }) => {
      const supabase = requireSupabase();
      const results = await Promise.all(
        accounts.map((account) => {
          if (account.owner_member_id !== null && account.owner_member_id !== memberId) {
            return Promise.resolve({ error: null });
          }
          // display_order was pre-computed by reorderAccounts so locked rows
          // keep their stored value and editable rows slot around them.
          return supabase
            .from("accounts")
            .update({ display_order: account.display_order })
            .eq("id", account.id);
        }),
      );
      const firstError = results.find((r) => r.error)?.error;
      if (firstError) throw firstError;
    },
    onMutate: async ({ accounts }: { accounts: Account[]; memberId: string }) => {
      if (!key) return undefined;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Account[]>(key);
      queryClient.setQueryData(key, accounts);
      return { previous };
    },
    onError: (_error, _accounts, ctx) => {
      if (ctx?.previous && key) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled: invalidate,
  });

  return { create, update, archive, updateManualBalance, reorder };
}
