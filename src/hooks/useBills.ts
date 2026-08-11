"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type Bill = Database["public"]["Tables"]["bills"]["Row"];
type BillInstance = Database["public"]["Views"]["bill_instances_view"]["Row"];
type BillInsert = Omit<Database["public"]["Tables"]["bills"]["Insert"], "household_id">;
type BillUpdate = Database["public"]["Tables"]["bills"]["Update"];

export type BillWithInstances = Bill & {
  instances: BillInstance[];
};

export type PayBillInput = {
  amount: number;
  createTransaction: boolean;
  paidByMemberId: string;
  paidOn: string;
};

function billsKey(householdId: string) {
  return ["bills", householdId] as const;
}

function requireSupabase() {
  const supabase = createSupabaseBrowser();
  if (!supabase) throw new Error("supabase not configured");
  return supabase;
}

export function useBills(householdId: string | null) {
  return useQuery({
    queryKey: ["bills", householdId],
    queryFn: async (): Promise<BillWithInstances[]> => {
      const supabase = requireSupabase();
      const [{ data: bills, error: billsError }, { data: instances, error: instancesError }] =
        await Promise.all([
          supabase.from("bills").select("*").eq("household_id", householdId!).order("name"),
          supabase
            .from("bill_instances_view")
            .select("*")
            .eq("household_id", householdId!)
            .order("due_on"),
        ]);
      if (billsError) throw billsError;
      if (instancesError) throw instancesError;

      return bills.map((bill) => ({
        ...bill,
        instances: (instances ?? []).filter((instance) => instance.bill_id === bill.id),
      }));
    },
    enabled: householdId !== null,
  });
}

export function useBillMutations(householdId: string | null, memberId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    if (householdId) {
      void queryClient.invalidateQueries({ queryKey: billsKey(householdId) });
      void queryClient.invalidateQueries({ queryKey: ["transactions", householdId] });
      void queryClient.invalidateQueries({ queryKey: ["accounts", householdId] });
    }
  };

  const create = useMutation({
    mutationFn: async (input: BillInsert) => {
      if (!householdId) throw new Error("no household");
      const { data, error } = await requireSupabase()
        .from("bills")
        .insert({ ...input, household_id: householdId })
        .select()
        .single();
      if (error) throw error;
      await apiFetch(`/api/bills/${data.id}/generate`, { method: "POST" });
      return data;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: BillUpdate }) => {
      const { data, error } = await requireSupabase()
        .from("bills")
        .update(input)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      await apiFetch(`/api/bills/${id}/generate`, { method: "POST" });
      return data;
    },
    onSuccess: invalidate,
  });

  const pay = useMutation({
    mutationFn: async ({
      instance,
      bill,
      input,
    }: {
      instance: BillInstance;
      bill: Bill;
      input: PayBillInput;
    }) => {
      if (!householdId || !memberId || !instance.id) throw new Error("missing bill instance");
      const supabase = requireSupabase();
      let transactionId: string | null = null;

      if (input.createTransaction) {
        if (!bill.account_id) throw new Error("bill needs an account to create a transaction");
        const { data, error } = await supabase
          .from("transactions")
          .insert({
            account_id: bill.account_id,
            amount: -input.amount,
            category_id: bill.category_id,
            currency: bill.currency,
            description: bill.name,
            entered_by: memberId,
            household_id: householdId,
            occurred_on: input.paidOn,
            spent_by: input.paidByMemberId,
          })
          .select("id")
          .single();
        if (error) throw error;
        transactionId = data.id;
      }

      const { error } = await supabase
        .from("bill_instances")
        .update({
          amount: input.amount,
          paid_by_member_id: input.paidByMemberId,
          paid_on: input.paidOn,
          paid_transaction_id: transactionId,
          status: "paid",
        })
        .eq("id", instance.id);
      if (error) {
        if (transactionId) await supabase.from("transactions").delete().eq("id", transactionId);
        throw error;
      }
    },
    onSuccess: invalidate,
  });

  const skip = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string | null }) => {
      const { error } = await requireSupabase()
        .from("bill_instances")
        .update({ skip_reason: reason, status: "skipped" } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateInstanceAmount = useMutation({
    mutationFn: async ({ amount, id }: { amount: number; id: string }) => {
      const { error } = await requireSupabase()
        .from("bill_instances")
        .update({ amount })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const unmarkPaid = useMutation({
    mutationFn: async ({ id, transactionId }: { id: string; transactionId: string | null }) => {
      const supabase = requireSupabase();
      if (transactionId) {
        const { error: transactionError } = await supabase
          .from("transactions")
          .delete()
          .eq("id", transactionId);
        if (transactionError) throw transactionError;
      }
      const { error } = await supabase
        .from("bill_instances")
        .update({
          paid_by_member_id: null,
          paid_on: null,
          paid_transaction_id: null,
          status: "due",
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, pay, skip, unmarkPaid, update, updateInstanceAmount };
}
