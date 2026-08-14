import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowser: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));

import { createSupabaseBrowser } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api-fetch";
import { useBillMutations } from "./useBills";
import { createQueryClient, QueryWrapper } from "./test-utils";

const apiFetchMock = vi.mocked(apiFetch);

function wrapper(client = createQueryClient()) {
  return function BillsQueryWrapper({ children }: { children: React.ReactNode }) {
    return <QueryWrapper client={client}>{children}</QueryWrapper>;
  };
}

// A single fake builder covers every chain shape useBillMutations uses:
//   .insert(...).select().single()
//   .update(...).eq(...).select().single()
//   .update(...).eq(...)                      (awaited directly, no .select())
//   .rpc(name, args)
function mockSupabase(opts: {
  insertResult?: { data?: unknown; error?: unknown };
  updateResult?: { data?: unknown; error?: unknown };
  rpcResult?: { error?: unknown };
}) {
  const single = vi
    .fn()
    .mockResolvedValue(opts.insertResult ?? { data: { id: "bill-1" }, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });

  const updateResult = opts.updateResult ?? { data: null, error: null };
  const eq = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue(updateResult) }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(updateResult).then(resolve, reject),
  });
  const update = vi.fn().mockReturnValue({ eq });

  const from = vi.fn().mockReturnValue({ insert, update });
  const rpc = vi.fn().mockResolvedValue(opts.rpcResult ?? { error: null });

  vi.mocked(createSupabaseBrowser).mockReturnValue({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "token-1" } } }),
    },
    from,
    rpc,
  } as unknown as ReturnType<typeof createSupabaseBrowser>);

  return { from, insert, select, single, update, eq, rpc };
}

describe("useBillMutations", () => {
  it("creates a bill, triggers instance generation, and invalidates queries", async () => {
    const { insert, from } = mockSupabase({});
    apiFetchMock.mockResolvedValue(undefined);
    const client = createQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useBillMutations("household-1", "member-1"), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.create.mutateAsync({
        currency: "USD",
        name: "Rent",
        rrule: "FREQ=MONTHLY",
        starts_on: "2026-08-01",
      } as never);
    });

    expect(from).toHaveBeenCalledWith("bills");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ household_id: "household-1", name: "Rent" }),
    );
    expect(apiFetchMock).toHaveBeenCalledWith("/api/bills/bill-1/generate", {
      method: "POST",
      body: { accessToken: "token-1" },
      headers: { Authorization: "Bearer token-1" },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["bills", "household-1"] });
  });

  it("rejects create without throwing to apiFetch when the insert itself fails", async () => {
    mockSupabase({ insertResult: { data: null, error: { message: "insert failed" } } });
    const { result } = renderHook(() => useBillMutations("household-1", "member-1"), {
      wrapper: wrapper(),
    });

    await expect(
      result.current.create.mutateAsync({
        currency: "USD",
        name: "Rent",
        rrule: "FREQ=MONTHLY",
        starts_on: "2026-08-01",
      } as never),
    ).rejects.toMatchObject({ message: "insert failed" });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("pays a bill instance via pay_bill_instance with correctly mapped RPC args", async () => {
    const { rpc } = mockSupabase({});
    const { result } = renderHook(() => useBillMutations("household-1", "member-1"), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.pay.mutateAsync({
        instance: { id: "instance-1" } as never,
        input: {
          amount: 45,
          createTransaction: true,
          paidByMemberId: "member-2",
          paidOn: "2026-08-15",
        },
      });
    });

    expect(rpc).toHaveBeenCalledWith("pay_bill_instance", {
      p_amount: 45,
      p_create_transaction: true,
      p_instance_id: "instance-1",
      p_paid_by_member_id: "member-2",
      p_paid_on: "2026-08-15",
    });
  });

  it("surfaces the RPC error message when pay_bill_instance rejects", async () => {
    mockSupabase({ rpcResult: { error: { message: "only due bill instances can be paid" } } });
    const { result } = renderHook(() => useBillMutations("household-1", "member-1"), {
      wrapper: wrapper(),
    });

    await expect(
      result.current.pay.mutateAsync({
        instance: { id: "instance-1" } as never,
        input: {
          amount: 45,
          createTransaction: false,
          paidByMemberId: "member-2",
          paidOn: "2026-08-15",
        },
      }),
    ).rejects.toThrow("only due bill instances can be paid");
  });

  it("skips a bill instance with a reason", async () => {
    const { update, eq } = mockSupabase({});
    const { result } = renderHook(() => useBillMutations("household-1", "member-1"), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.skip.mutateAsync({ id: "instance-1", reason: "on vacation" });
    });

    expect(update).toHaveBeenCalledWith({ skip_reason: "on vacation", status: "skipped" });
    expect(eq).toHaveBeenCalledWith("id", "instance-1");
  });

  it("unmarks a paid instance via unmark_bill_instance_paid", async () => {
    const { rpc } = mockSupabase({});
    const { result } = renderHook(() => useBillMutations("household-1", "member-1"), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.unmarkPaid.mutateAsync({ id: "instance-1" });
    });

    expect(rpc).toHaveBeenCalledWith("unmark_bill_instance_paid", { p_instance_id: "instance-1" });
  });

  it("permanently deletes a future instance via delete_future_bill_instance", async () => {
    const { rpc } = mockSupabase({});
    const { result } = renderHook(() => useBillMutations("household-1", "member-1"), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.deleteFutureInstance.mutateAsync({ id: "instance-1" });
    });

    expect(rpc).toHaveBeenCalledWith("delete_future_bill_instance", {
      p_instance_id: "instance-1",
    });
  });

  it("surfaces the RPC error message when unmark_bill_instance_paid rejects", async () => {
    mockSupabase({ rpcResult: { error: { message: "only paid bill instances can be unmarked" } } });
    const { result } = renderHook(() => useBillMutations("household-1", "member-1"), {
      wrapper: wrapper(),
    });

    await expect(result.current.unmarkPaid.mutateAsync({ id: "instance-1" })).rejects.toThrow(
      "only paid bill instances can be unmarked",
    );
  });

  it("updates a single instance's amount", async () => {
    const { update, eq } = mockSupabase({});
    const { result } = renderHook(() => useBillMutations("household-1", "member-1"), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.updateInstanceAmount.mutateAsync({ amount: 5000, id: "instance-1" });
    });

    expect(update).toHaveBeenCalledWith({ amount: 5000 });
    expect(eq).toHaveBeenCalledWith("id", "instance-1");
  });
});
