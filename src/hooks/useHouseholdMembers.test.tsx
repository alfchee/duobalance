import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowser: vi.fn() }));

import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useHouseholdMembers } from "./useHouseholdMembers";
import { createQueryClient, mockSupabase, QueryWrapper } from "./test-utils";

const MEMBERS = [
  {
    id: "m1",
    user_id: "u1",
    display_name: "Ana",
    role: "owner",
    joined_at: "2026-01-01T00:00:00Z",
    color_hex: "#3B82F6",
  },
];

describe("useHouseholdMembers", () => {
  it("fetches members for the active household", async () => {
    const supabase = mockSupabase({ data: MEMBERS, error: null });
    const { result } = renderHook(() => useHouseholdMembers("h1"), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await waitFor(() => expect(result.current.data).toEqual(MEMBERS));
    expect(supabase.from).toHaveBeenCalledWith("household_members");
    expect(supabase.eq).toHaveBeenCalledWith("household_id", "h1");
    expect(supabase.order).toHaveBeenCalledWith("joined_at");
  });

  it("does not fetch without a household id", async () => {
    const { result } = renderHook(() => useHouseholdMembers(null), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    expect(createSupabaseBrowser).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("throws when supabase is not configured", async () => {
    vi.mocked(createSupabaseBrowser).mockReturnValue(null);
    const { result } = renderHook(() => useHouseholdMembers("h1"), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  });

  it("surfaces a supabase error", async () => {
    const dbError = new Error("db down");
    mockSupabase({ data: null, error: dbError });
    const { result } = renderHook(() => useHouseholdMembers("h1"), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await waitFor(() => expect(result.current.error).toBe(dbError));
  });
});
