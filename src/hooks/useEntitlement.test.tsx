import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowser: vi.fn() }));

import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useEntitlement, useHouseholdPlan, usePlanCatalogue } from "./useEntitlement";
import { createQueryClient, QueryWrapper } from "./test-utils";

const HOUSEHOLD = "10000000-0000-4000-8000-000000000001";

type RpcResult = { data: unknown; error: { message: string } | null };

function mockRpc(hasFeature: RpcResult, featureLimit: RpcResult) {
  const rpc = vi.fn((fn: string) => {
    if (fn === "has_feature") return Promise.resolve(hasFeature);
    return Promise.resolve(featureLimit);
  });
  vi.mocked(createSupabaseBrowser).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof createSupabaseBrowser
  >);
  return rpc;
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.BILLING_ENABLED;
  delete process.env.NEXT_PUBLIC_BILLING_ENABLED;
  vi.clearAllMocks();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>;
}

describe("useEntitlement", () => {
  it("passes the raw DB values through while billing is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "1");
    mockRpc({ data: true, error: null }, { data: 4, error: null });

    const { result } = renderHook(() => useEntitlement(HOUSEHOLD, "accounts"), { wrapper });

    await waitFor(() =>
      expect(result.current).toEqual({
        entitled: true,
        limit: 4,
        unlimited: false,
        pending: false,
      }),
    );
  });

  it("marks Int32 max as unlimited", async () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "1");
    mockRpc({ data: true, error: null }, { data: 2147483647, error: null });

    const { result } = renderHook(() => useEntitlement(HOUSEHOLD, "accounts"), { wrapper });

    await waitFor(() =>
      expect(result.current).toMatchObject({ entitled: true, unlimited: true, limit: 2147483647 }),
    );
  });

  it("resolves a missing feature as not entitled with limit 0", async () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "1");
    mockRpc({ data: false, error: null }, { data: 0, error: null });

    const { result } = renderHook(() => useEntitlement(HOUSEHOLD, "export"), { wrapper });

    await waitFor(() =>
      expect(result.current).toEqual({
        entitled: false,
        limit: 0,
        unlimited: false,
        pending: false,
      }),
    );
  });

  it("is a no-op while billing is disabled: entitled and unlimited, no queries", async () => {
    const rpc = mockRpc({ data: false, error: null }, { data: 0, error: null });

    const { result } = renderHook(() => useEntitlement(HOUSEHOLD, "export"), { wrapper });

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current).toEqual({
      entitled: true,
      limit: 2147483647,
      unlimited: true,
      pending: false,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not query without a household", async () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "1");
    const rpc = mockRpc({ data: true, error: null }, { data: 4, error: null });

    renderHook(() => useEntitlement(null, "accounts"), { wrapper });

    await waitFor(() => expect(createSupabaseBrowser).not.toHaveBeenCalled());
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails open on a query error so a paying user is never locked out", async () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "1");
    mockRpc(
      { data: null, error: { message: "db down" } },
      { data: null, error: { message: "db down" } },
    );

    const { result } = renderHook(() => useEntitlement(HOUSEHOLD, "accounts"), { wrapper });

    await waitFor(() =>
      expect(result.current).toEqual({
        entitled: true,
        limit: 2147483647,
        unlimited: true,
        pending: false,
      }),
    );
  });
});

describe("usePlanCatalogue", () => {
  it("groups plan_features under each public plan in sort order", async () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "1");
    const from = vi.fn((table: string) => {
      if (table === "plans") {
        const order = vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              { code: "free", name: "Duo", sort_order: 0 },
              { code: "plus", name: "Plus", sort_order: 1 },
            ],
            error: null,
          }),
        });
        const eq = vi.fn().mockReturnValue({ order });
        const select = vi.fn().mockReturnValue({ eq });
        return { select };
      }
      const select = vi.fn().mockResolvedValue({
        data: [
          { plan_code: "free", feature_key: "accounts", enabled: true, limit_value: 4 },
          { plan_code: "plus", feature_key: "accounts", enabled: true, limit_value: null },
        ],
        error: null,
      });
      return { select };
    });
    vi.mocked(createSupabaseBrowser).mockReturnValue({ from } as unknown as ReturnType<
      typeof createSupabaseBrowser
    >);

    const { result } = renderHook(() => usePlanCatalogue(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data?.[0]).toEqual({
      code: "free",
      name: "Duo",
      features: { accounts: { enabled: true, limit: 4 } },
    });
    expect(result.current.data?.[1]?.features.accounts).toEqual({
      enabled: true,
      limit: null,
    });
    expect(from).toHaveBeenCalledWith("plans");
    expect(from).toHaveBeenCalledWith("plan_features");
  });
});

describe("useHouseholdPlan", () => {
  it("returns the household's current plan code", async () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "1");
    const rpc = vi.fn().mockResolvedValue({ data: "plus", error: null });
    vi.mocked(createSupabaseBrowser).mockReturnValue({ rpc } as unknown as ReturnType<
      typeof createSupabaseBrowser
    >);

    const { result } = renderHook(() => useHouseholdPlan(HOUSEHOLD), { wrapper });

    await waitFor(() => expect(result.current.data).toBe("plus"));
    expect(rpc).toHaveBeenCalledWith("household_plan", { p_household: HOUSEHOLD });
  });
});
