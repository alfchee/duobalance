import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowser: vi.fn() }));

import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useBudgetMutations, useBudgetSpending, useBudgetStatus } from "./useBudgets";
import { createQueryClient, QueryWrapper } from "./test-utils";

type QueryResult = { data: unknown; error: Error | null };

function mockSupabase(result: QueryResult) {
  const builder = {
    eq: vi.fn(),
    delete: vi.fn(),
    gte: vi.fn(),
    insert: vi.fn(),
    is: vi.fn(),
    lt: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    update: vi.fn(),
    then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of [
    builder.eq,
    builder.delete,
    builder.gte,
    builder.insert,
    builder.is,
    builder.lt,
    builder.not,
    builder.order,
    builder.select,
    builder.single,
    builder.update,
  ])
    method.mockReturnValue(builder);
  const from = vi.fn().mockReturnValue(builder);
  vi.mocked(createSupabaseBrowser).mockReturnValue({ from } as unknown as ReturnType<
    typeof createSupabaseBrowser
  >);
  return { builder, from };
}

function wrapper(client = createQueryClient()) {
  function BudgetQueryWrapper({ children }: { children: React.ReactNode }) {
    return <QueryWrapper client={client}>{children}</QueryWrapper>;
  }
  return BudgetQueryWrapper;
}

describe("budget hooks", () => {
  it("filters household budget status to rows without an owner", async () => {
    const { builder, from } = mockSupabase({ data: [], error: null });
    const { result } = renderHook(() => useBudgetStatus("household-1", "2026-08-01", null), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith("budget_status");
    expect(builder.eq).toHaveBeenCalledWith("household_id", "household-1");
    expect(builder.eq).toHaveBeenCalledWith("period_month", "2026-08-01");
    expect(builder.is).toHaveBeenCalledWith("owner_member_id", null);
  });

  it("filters personal budget status and spending to the selected member", async () => {
    const { builder } = mockSupabase({ data: [], error: null });
    const { result } = renderHook(() => useBudgetStatus("household-1", "2026-08-01", "member-1"), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(builder.eq).toHaveBeenCalledWith("owner_member_id", "member-1");
  });

  it("limits unbudgeted spending to expenses in the selected month", async () => {
    const { builder, from } = mockSupabase({ data: [], error: null });
    const { result } = renderHook(
      () => useBudgetSpending("household-1", "2026-02-01", "member-1"),
      {
        wrapper: wrapper(),
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith("transactions");
    expect(builder.gte).toHaveBeenCalledWith("occurred_on", "2026-02-01");
    expect(builder.lt).toHaveBeenCalledWith("occurred_on", "2026-03-01");
    expect(builder.lt).toHaveBeenCalledWith("amount", 0);
    expect(builder.is).toHaveBeenCalledWith("transfer_group_id", null);
    expect(builder.not).toHaveBeenCalledWith("category_id", "is", null);
    expect(builder.eq).toHaveBeenCalledWith("spent_by", "member-1");
  });

  it("copies budgets into the active household and invalidates budget queries", async () => {
    const { builder } = mockSupabase({ data: [], error: null });
    const client = createQueryClient();
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useBudgetMutations("household-1"), {
      wrapper: wrapper(client),
    });
    const budget = {
      amount: 250,
      category_id: "category-1",
      owner_member_id: null,
      period_month: "2026-08-01",
      rollover: false,
    };

    await result.current.copy.mutateAsync([budget]);

    expect(builder.insert).toHaveBeenCalledWith([{ ...budget, household_id: "household-1" }]);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["budgets", "household-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["budget-status", "household-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["budget-spending", "household-1"],
    });
  });

  it("creates, updates, and deletes budgets through RLS-protected client mutations", async () => {
    const { builder } = mockSupabase({ data: [], error: null });
    const { result } = renderHook(() => useBudgetMutations("household-1"), {
      wrapper: wrapper(),
    });

    await result.current.create.mutateAsync({
      amount: 250,
      category_id: "category-1",
      owner_member_id: null,
      period_month: "2026-08-01",
      rollover: false,
    });
    await result.current.update.mutateAsync({ amount: 350, id: "budget-1", rollover: true });
    await result.current.remove.mutateAsync("budget-1");

    expect(builder.insert).toHaveBeenCalledWith({
      amount: 250,
      category_id: "category-1",
      household_id: "household-1",
      owner_member_id: null,
      period_month: "2026-08-01",
      rollover: false,
    });
    expect(builder.update).toHaveBeenCalledWith({ amount: 350, rollover: true });
    expect(builder.delete).toHaveBeenCalledOnce();
    expect(builder.eq).toHaveBeenCalledWith("id", "budget-1");
  });

  it("surfaces a rejected RLS mutation instead of closing over an unauthorized result", async () => {
    mockSupabase({ data: null, error: new Error("new row violates row-level security policy") });
    const { result } = renderHook(() => useBudgetMutations("household-1"), {
      wrapper: wrapper(),
    });

    await expect(
      result.current.create.mutateAsync({
        amount: 250,
        category_id: "category-1",
        owner_member_id: null,
        period_month: "2026-08-01",
        rollover: false,
      }),
    ).rejects.toThrow("row-level security policy");
  });
});
