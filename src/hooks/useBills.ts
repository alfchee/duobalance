"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import type { BillWithInstances, BillWindow } from "@/lib/bills/model";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type BillInstance = Database["public"]["Views"]["bill_instances_view"]["Row"];
type BillInsert = Omit<Database["public"]["Tables"]["bills"]["Insert"], "household_id">;
type BillUpdate = Database["public"]["Tables"]["bills"]["Update"];

export type { BillWithInstances } from "@/lib/bills/model";

export type PayBillInput = {
  amount: number;
  createTransaction: boolean;
  paidByMemberId: string;
  paidOn: string;
};

export function billsKey(householdId: string) {
  return ["bills", householdId] as const;
}

function requireSupabase() {
  const supabase = createSupabaseBrowser();
  if (!supabase) throw new Error("supabase not configured");
  return supabase;
}

export function useBills(householdId: string | null, window: BillWindow) {
  return useQuery({
    queryKey: ["bills", householdId, window.start, window.end],
    queryFn: async (): Promise<BillWithInstances[]> => {
      const supabase = requireSupabase();
      const [{ data: bills, error: billsError }, { data: instances, error: instancesError }] =
        await Promise.all([
          supabase.from("bills").select("*").eq("household_id", householdId!).order("name"),
          supabase
            .from("bill_instances_view")
            .select("*")
            .eq("household_id", householdId!)
            .gte("due_on", window.start)
            .lte("due_on", window.end)
            .order("due_on"),
        ]);
      if (billsError) throw billsError;
      if (instancesError) throw instancesError;

      const instancesByBillId = new Map<string, BillInstance[]>();
      for (const instance of instances ?? []) {
        if (!instance.bill_id) continue;
        instancesByBillId.set(instance.bill_id, [
          ...(instancesByBillId.get(instance.bill_id) ?? []),
          instance,
        ]);
      }
      return bills.map((bill) => ({ ...bill, instances: instancesByBillId.get(bill.id) ?? [] }));
    },
    enabled: householdId !== null,
  });
}

export function useBillMutations(householdId: string | null, memberId: string | null) {
  const queryClient = useQueryClient();

  async function generateInstances(billId: string) {
    const {
      data: { session },
    } = await requireSupabase().auth.getSession();
    if (!session) throw new Error("authentication required");
    await apiFetch(`/api/bills/${billId}/generate`, {
      method: "POST",
      body: { accessToken: session.access_token },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  }

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
      await generateInstances(data.id);
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
      await generateInstances(id);
      return data;
    },
    onSuccess: invalidate,
  });

  const pay = useMutation({
    mutationFn: async ({ instance, input }: { instance: BillInstance; input: PayBillInput }) => {
      if (!householdId || !memberId || !instance.id) throw new Error("missing bill instance");
      const { error } = await requireSupabase().rpc("pay_bill_instance", {
        p_amount: input.amount,
        p_create_transaction: input.createTransaction,
        p_instance_id: instance.id,
        p_paid_by_member_id: input.paidByMemberId,
        p_paid_on: input.paidOn,
      });
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: invalidate,
  });

  const skip = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string | null }) => {
      const { error } = await requireSupabase()
        .from("bill_instances")
        .update({ skip_reason: reason, status: "skipped" })
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
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await requireSupabase().rpc("unmark_bill_instance_paid", {
        p_instance_id: id,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const deleteFutureInstance = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await requireSupabase().rpc("delete_future_bill_instance", {
        p_instance_id: id,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  return {
    create,
    deleteFutureInstance,
    pay,
    skip,
    unmarkPaid,
    update,
    updateInstanceAmount,
  };
}
