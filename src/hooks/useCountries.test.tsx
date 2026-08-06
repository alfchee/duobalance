import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowser: vi.fn() }));

import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useCountries } from "./useCountries";
import { createQueryClient, mockSupabase, QueryWrapper } from "./test-utils";

describe("useCountries", () => {
  it("returns the country list from country_defaults", async () => {
    const supabase = mockSupabase({ data: [{ country: "CL" }, { country: "US" }], error: null });
    const { result } = renderHook(() => useCountries(), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await waitFor(() => expect(result.current.data).toEqual(["CL", "US"]));
    expect(supabase.from).toHaveBeenCalledWith("country_defaults");
    expect(supabase.order).toHaveBeenCalledWith("country");
  });

  it("returns an empty list when supabase is not configured", async () => {
    vi.mocked(createSupabaseBrowser).mockReturnValue(null);
    const { result } = renderHook(() => useCountries(), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("surfaces a supabase error", async () => {
    const dbError = new Error("db down");
    mockSupabase({ data: null, error: dbError });
    const { result } = renderHook(() => useCountries(), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await waitFor(() => expect(result.current.error).toBe(dbError));
  });

  it("does not fetch when disabled", async () => {
    const { result } = renderHook(() => useCountries({ enabled: false }), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    expect(createSupabaseBrowser).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
