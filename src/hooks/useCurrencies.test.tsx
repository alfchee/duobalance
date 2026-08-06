import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowser: vi.fn() }));

import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useCurrencies } from "./useCurrencies";
import { createQueryClient, mockSupabase, QueryWrapper } from "./test-utils";

const CURRENCIES = [
  { code: "CLP", name_en: "Chilean Peso", symbol: "$" },
  { code: "USD", name_en: "US Dollar", symbol: "$" },
];

describe("useCurrencies", () => {
  it("returns only enabled currencies, ordered by code", async () => {
    const supabase = mockSupabase({ data: CURRENCIES, error: null });
    const { result } = renderHook(() => useCurrencies(), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await waitFor(() => expect(result.current.data).toEqual(CURRENCIES));
    expect(supabase.from).toHaveBeenCalledWith("currencies");
    expect(supabase.eq).toHaveBeenCalledWith("is_enabled", true);
    expect(supabase.order).toHaveBeenCalledWith("code");
  });

  it("returns an empty list when supabase is not configured", async () => {
    vi.mocked(createSupabaseBrowser).mockReturnValue(null);
    const { result } = renderHook(() => useCurrencies(), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("surfaces a supabase error", async () => {
    const dbError = new Error("db down");
    mockSupabase({ data: null, error: dbError });
    const { result } = renderHook(() => useCurrencies(), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await waitFor(() => expect(result.current.error).toBe(dbError));
  });

  it("does not fetch when disabled", async () => {
    const { result } = renderHook(() => useCurrencies({ enabled: false }), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    expect(createSupabaseBrowser).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
