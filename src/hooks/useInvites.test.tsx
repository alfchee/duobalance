import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowser: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));

import { createSupabaseBrowser } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api-fetch";
import { useInviteMutations, usePendingInvites } from "./useInvites";
import { createQueryClient, mockSupabase, QueryWrapper } from "./test-utils";

const INVITES = [
  {
    id: "i1",
    email: "partner@example.com",
    created_at: "2026-01-01T00:00:00Z",
    expires_at: "2026-01-08T00:00:00Z",
  },
];

const apiFetchMock = vi.mocked(apiFetch);

describe("usePendingInvites", () => {
  it("fetches pending invites for the household", async () => {
    const supabase = mockSupabase({ data: INVITES, error: null });
    const { result } = renderHook(() => usePendingInvites("h1"), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await waitFor(() => expect(result.current.data).toEqual(INVITES));
    expect(supabase.from).toHaveBeenCalledWith("household_invites");
    expect(supabase.is).toHaveBeenCalledWith("accepted_at", null);
    expect(supabase.order).toHaveBeenCalledWith("created_at");
  });

  it("does not fetch without a household id", async () => {
    const { result } = renderHook(() => usePendingInvites(null), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    expect(createSupabaseBrowser).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});

describe("useInviteMutations", () => {
  it("creates an invite via the route handler and invalidates the list", async () => {
    apiFetchMock.mockResolvedValue({ id: "i2" });
    const client = createQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useInviteMutations("h1"), {
      wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper>,
    });

    await act(async () => {
      result.current.create.mutate("partner@example.com");
    });

    expect(apiFetchMock).toHaveBeenCalledWith("/api/invites", {
      method: "POST",
      body: { household_id: "h1", email: "partner@example.com" },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["invites", "h1"] });
  });

  it("revokes an invite via DELETE", async () => {
    apiFetchMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useInviteMutations("h1"), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await act(async () => {
      result.current.revoke.mutate("i1");
    });

    expect(apiFetchMock).toHaveBeenCalledWith("/api/invites/i1", { method: "DELETE" });
  });

  it("resends an invite via POST to the resend endpoint", async () => {
    apiFetchMock.mockResolvedValue({ id: "i1" });
    const { result } = renderHook(() => useInviteMutations("h1"), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await act(async () => {
      result.current.resend.mutate("i1");
    });

    expect(apiFetchMock).toHaveBeenCalledWith("/api/invites/i1/resend", { method: "POST" });
  });

  it("records the api error on the mutation", async () => {
    const apiError = new Error("resend failed");
    apiFetchMock.mockRejectedValue(apiError);
    const { result } = renderHook(() => useInviteMutations("h1"), {
      wrapper: ({ children }) => (
        <QueryWrapper client={createQueryClient()}>{children}</QueryWrapper>
      ),
    });

    await act(async () => {
      result.current.resend.mutate("i1");
    });

    await waitFor(() => expect(result.current.resend.error).toBe(apiError));
  });
});
