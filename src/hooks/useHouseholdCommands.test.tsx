import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";

vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowser: vi.fn() }));
vi.mock("@/lib/api-fetch", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-fetch")>("@/lib/api-fetch");
  return { ...actual, apiFetch: vi.fn() };
});

import { createSupabaseBrowser } from "@/lib/supabase/client";
import { apiFetch, ApiError } from "@/lib/api-fetch";
import { useHouseholdCommands } from "./useHouseholdCommands";
import { createQueryClient, QueryWrapper } from "./test-utils";
import { ACTIVE_HOUSEHOLD_STORAGE_KEY } from "@/lib/household/workflows";

function renderCommands() {
  const client = createQueryClient();
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(
    () => ({ commands: useHouseholdCommands(), queryClient: useQueryClient() }),
    { wrapper: ({ children }) => <QueryWrapper client={client}>{children}</QueryWrapper> },
  );
  return { result, invalidateSpy };
}

function mockRpc(rpcResult: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  vi.mocked(createSupabaseBrowser).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof createSupabaseBrowser
  >);
  return rpc;
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(createSupabaseBrowser).mockReset();
});

describe("useHouseholdCommands", () => {
  it("create() saves the active household and invalidates memberships on success", async () => {
    mockRpc({ data: "household-1", error: null });
    const { result, invalidateSpy } = renderCommands();

    let outcome;
    await act(async () => {
      outcome = await result.current.commands.create({
        name: "Home",
        country: "CL",
        baseCurrency: "CLP",
        displayName: "Ana",
      });
    });

    expect(outcome).toEqual({ ok: true, value: { householdId: "household-1" } });
    expect(localStorage.getItem(ACTIVE_HOUSEHOLD_STORAGE_KEY)).toBe("household-1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["households", "memberships"] });
  });

  it("removeHousehold() clears the active-household id only if it was the removed one", async () => {
    localStorage.setItem(ACTIVE_HOUSEHOLD_STORAGE_KEY, "household-other");
    mockRpc({ error: null });
    const { result } = renderCommands();

    await act(async () => {
      await result.current.commands.removeHousehold("household-1");
    });

    expect(localStorage.getItem(ACTIVE_HOUSEHOLD_STORAGE_KEY)).toBe("household-other");
  });

  it("removeHousehold() clears the active-household id when it matches the removed household", async () => {
    localStorage.setItem(ACTIVE_HOUSEHOLD_STORAGE_KEY, "household-1");
    mockRpc({ error: null });
    const { result } = renderCommands();

    await act(async () => {
      await result.current.commands.removeHousehold("household-1");
    });

    expect(localStorage.getItem(ACTIVE_HOUSEHOLD_STORAGE_KEY)).toBeNull();
  });

  it("leave() clears the active-household id when it matches the left household", async () => {
    localStorage.setItem(ACTIVE_HOUSEHOLD_STORAGE_KEY, "household-1");
    mockRpc({ error: null });
    const { result } = renderCommands();

    await act(async () => {
      await result.current.commands.leave("household-1");
    });

    expect(localStorage.getItem(ACTIVE_HOUSEHOLD_STORAGE_KEY)).toBeNull();
  });

  it("transferOwnership() invalidates memberships and household-members on success", async () => {
    mockRpc({ error: null });
    const { result, invalidateSpy } = renderCommands();

    await act(async () => {
      await result.current.commands.transferOwnership("household-1", "member-2", true);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["households", "memberships"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["household-members"] });
  });

  describe("removeMember", () => {
    it("sends the request body as a plain object, not a pre-stringified string", async () => {
      vi.mocked(apiFetch).mockResolvedValue({ ok: true });
      const { result } = renderCommands();

      await act(async () => {
        await result.current.commands.removeMember("household-1", "member-2", {
          "acc-1": "transfer",
        });
      });

      expect(apiFetch).toHaveBeenCalledWith(
        "/api/members/remove",
        expect.objectContaining({
          method: "POST",
          body: {
            household_id: "household-1",
            member_id: "member-2",
            account_disposition: { "acc-1": "transfer" },
          },
        }),
      );
    });

    it("invalidates memberships, household-members, accounts, and bills on success", async () => {
      vi.mocked(apiFetch).mockResolvedValue({ ok: true });
      const { result, invalidateSpy } = renderCommands();

      await act(async () => {
        await result.current.commands.removeMember("household-1", "member-2");
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["households", "memberships"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["household-members"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["accounts"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["bills"] });
    });

    it("reads the real Postgres error from the response body, not ApiError.message", async () => {
      vi.mocked(apiFetch).mockRejectedValue(
        new ApiError(400, { error: "unresolved owned accounts" }, "POST /api/members/remove → 400"),
      );
      const { result } = renderCommands();

      let outcome;
      await act(async () => {
        outcome = await result.current.commands.removeMember("household-1", "member-2");
      });

      expect(outcome).toEqual({ ok: false, errorKey: "unresolvedAccounts" });
    });

    it("falls back to the ApiError message when the body has no error field", async () => {
      vi.mocked(apiFetch).mockRejectedValue(
        new ApiError(500, null, "POST /api/members/remove → 500"),
      );
      const { result } = renderCommands();

      let outcome;
      await act(async () => {
        outcome = await result.current.commands.removeMember("household-1", "member-2");
      });

      expect(outcome).toEqual({ ok: false, errorKey: "generic" });
    });

    it("does not invalidate any queries when the removal fails", async () => {
      vi.mocked(apiFetch).mockRejectedValue(
        new ApiError(403, { error: "only active owners can remove members" }, "POST → 403"),
      );
      const { result, invalidateSpy } = renderCommands();

      await act(async () => {
        await result.current.commands.removeMember("household-1", "member-2");
      });

      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });
});
