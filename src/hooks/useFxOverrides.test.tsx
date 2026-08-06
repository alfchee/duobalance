import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowser: vi.fn() }));
vi.mock("@/components/household-provider", () => ({ useHouseholdContext: vi.fn() }));

import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useHouseholdContext } from "@/components/household-provider";
import type { Membership } from "@/components/household-provider";
import { useFxOverrides } from "./useFxOverrides";
import { createQueryClient, QueryWrapper } from "./test-utils";

const contextMock = vi.mocked(useHouseholdContext);

const ACTIVE: Membership = {
  memberId: "m1",
  householdId: "h1",
  role: "owner",
  displayName: "Ana",
  household: {
    name: "Casa 123",
    country: "CL",
    baseCurrency: "CLP",
    timezone: "America/Santiago",
    locale: "es",
  },
};

// The hook issues three distinct queries; the mock dispatches on table + select
// so each resolves its own payload in the right order, with the exact chain
// shape each query uses (override: ...order; newest-date: ...order.limit;
// feed: ...eq).
function mockSupabaseForFx(options: {
  overrides?: { code: string; rate_date: string; usd_rate: number; note: string | null }[];
  newestDate?: string | null;
  feed?: { code: string; rate_date: string; usd_rate: number; source: string }[];
}) {
  const { overrides = [], newestDate = null, feed = [] } = options;
  const overrideRes = { data: overrides, error: null };
  const newestRes = { data: newestDate ? [{ rate_date: newestDate }] : [], error: null };
  const feedRes = { data: feed, error: null };

  const from = vi.fn((table: string) => {
    if (table === "fx_overrides") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            lte: vi.fn(() => ({ order: vi.fn().mockResolvedValue(overrideRes) })),
          })),
        })),
      };
    }
    return {
      select: vi.fn((cols: string) => {
        if (cols === "rate_date") {
          return { order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(newestRes) })) };
        }
        return { eq: vi.fn().mockResolvedValue(feedRes) };
      }),
    };
  });

  vi.mocked(createSupabaseBrowser).mockReturnValue({ from } as unknown as ReturnType<
    typeof createSupabaseBrowser
  >);
  return { from };
}

describe("useFxOverrides", () => {
  it("prefers a household override over the newer global feed rate", async () => {
    contextMock.mockReturnValue({
      active: ACTIVE,
      loading: false,
      needsPicker: false,
      memberships: [ACTIVE],
      error: null,
      selectHousehold: vi.fn(),
    });
    mockSupabaseForFx({
      overrides: [{ code: "NIO", rate_date: "2026-07-29", usd_rate: 37, note: "fix" }],
      newestDate: "2026-07-30",
      feed: [{ code: "NIO", rate_date: "2026-07-30", usd_rate: 36.6, source: "exchangerate-api" }],
    });

    const { result } = renderHook(() => useFxOverrides(), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        code: "NIO",
        usdRate: 37,
        source: "override",
        rateDate: "2026-07-29",
        note: "fix",
      },
    ]);
  });

  it("falls back to the global feed rate when there is no override", async () => {
    contextMock.mockReturnValue({
      active: ACTIVE,
      loading: false,
      needsPicker: false,
      memberships: [ACTIVE],
      error: null,
      selectHousehold: vi.fn(),
    });
    mockSupabaseForFx({
      newestDate: "2026-07-30",
      feed: [{ code: "CLP", rate_date: "2026-07-30", usd_rate: 940, source: "exchangerate-api" }],
    });

    const { result } = renderHook(() => useFxOverrides(), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        code: "CLP",
        usdRate: 940,
        source: "feed",
        rateDate: "2026-07-30",
        note: null,
      },
    ]);
  });

  it("does not fetch until a household is active", async () => {
    contextMock.mockReturnValue({
      active: null,
      loading: false,
      needsPicker: true,
      memberships: [],
      error: null,
      selectHousehold: vi.fn(),
    });
    const { from } = mockSupabaseForFx({ newestDate: "2026-07-30", feed: [] });

    const { result } = renderHook(() => useFxOverrides(), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    expect(from).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
