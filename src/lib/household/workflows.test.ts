import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptInvite,
  clearActiveHouseholdId,
  createHousehold,
  deleteHousehold,
  getHouseholdActionErrorKey,
  getInviteErrorKey,
  leaveHousehold,
  readActiveHouseholdId,
  removeMemberWorkflow,
  saveActiveHouseholdId,
  transferOwnership,
} from "./workflows";

beforeEach(() => localStorage.clear());

describe("household workflows", () => {
  it("normalizes household input before the RPC boundary", async () => {
    const port = vi.fn().mockResolvedValue({ data: "household-1", error: null });
    await expect(
      createHousehold(port, {
        name: " Home ",
        country: "CL",
        baseCurrency: "CLP",
        displayName: " Partner ",
      }),
    ).resolves.toEqual({ ok: true, value: { householdId: "household-1" } });
    expect(port).toHaveBeenCalledWith({
      p_name: "Home",
      p_country: "CL",
      p_base_currency: "CLP",
      p_display_name: "Partner",
    });
  });

  it("maps invite domain failures to stable UI keys", async () => {
    await expect(
      acceptInvite(
        vi.fn().mockResolvedValue({ data: null, error: { message: "invite expired" } }),
        " token ",
      ),
    ).resolves.toEqual({ ok: false, errorKey: "expired" });
    expect(getInviteErrorKey({ message: "unknown" })).toBe("generic");
  });

  it("persists active-household selection through one repository", () => {
    expect(readActiveHouseholdId(localStorage)).toBeNull();
    saveActiveHouseholdId(localStorage, "household-1");
    expect(readActiveHouseholdId(localStorage)).toBe("household-1");
  });

  it("clears the active-household selection on demand", () => {
    saveActiveHouseholdId(localStorage, "household-1");
    clearActiveHouseholdId(localStorage);
    expect(readActiveHouseholdId(localStorage)).toBeNull();
  });

  describe("getHouseholdActionErrorKey", () => {
    it.each([
      ["household limit reached", "householdLimitReached"],
      [
        "owners cannot leave a household with remaining members; transfer ownership first",
        "ownerTransferRequired",
      ],
      ["only active owners can delete a household", "notOwner"],
      ["only active owners can transfer ownership", "notOwner"],
      ["only active owners can remove members", "notOwner"],
      ["not an active member of this household", "notMember"],
      ["target member not found or not active in this household", "targetNotFound"],
      [
        "owners cannot remove themselves; use transfer_ownership or leave_household",
        "selfRemovalForbidden",
      ],
      ["unresolved owned accounts", "unresolvedAccounts"],
      ["household must retain at least one active owner", "ownerTransferRequired"],
      ["cannot remove another owner; transfer ownership before removal", "targetIsOwner"],
    ])("maps %s to %s", (message, key) => {
      expect(getHouseholdActionErrorKey({ message })).toBe(key);
    });

    it("falls back to generic for an unrecognized message", () => {
      expect(getHouseholdActionErrorKey({ message: "some new postgres error" })).toBe("generic");
    });

    it("falls back to generic for a non-error value", () => {
      expect(getHouseholdActionErrorKey(null)).toBe("generic");
      expect(getHouseholdActionErrorKey(undefined)).toBe("generic");
    });
  });

  describe("deleteHousehold", () => {
    it("returns ok on success", async () => {
      const port = vi.fn().mockResolvedValue({ error: null });
      await expect(deleteHousehold(port, "household-1")).resolves.toEqual({
        ok: true,
        value: undefined,
      });
      expect(port).toHaveBeenCalledWith({ p_household: "household-1" });
    });

    it("maps a domain failure to its error key", async () => {
      const port = vi
        .fn()
        .mockResolvedValue({ error: { message: "only active owners can delete a household" } });
      await expect(deleteHousehold(port, "household-1")).resolves.toEqual({
        ok: false,
        errorKey: "notOwner",
      });
    });

    it("returns generic when no port is available", async () => {
      await expect(deleteHousehold(null, "household-1")).resolves.toEqual({
        ok: false,
        errorKey: "generic",
      });
    });
  });

  describe("leaveHousehold", () => {
    it("returns ok on success", async () => {
      const port = vi.fn().mockResolvedValue({ error: null });
      await expect(leaveHousehold(port, "household-1")).resolves.toEqual({
        ok: true,
        value: undefined,
      });
    });

    it("maps the owner-must-transfer-first failure", async () => {
      const port = vi.fn().mockResolvedValue({
        error: {
          message:
            "owners cannot leave a household with remaining members; transfer ownership first",
        },
      });
      await expect(leaveHousehold(port, "household-1")).resolves.toEqual({
        ok: false,
        errorKey: "ownerTransferRequired",
      });
    });
  });

  describe("transferOwnership", () => {
    it("passes demoteSelf through to the RPC", async () => {
      const port = vi.fn().mockResolvedValue({ error: null });
      await expect(transferOwnership(port, "household-1", "member-2", true)).resolves.toEqual({
        ok: true,
        value: undefined,
      });
      expect(port).toHaveBeenCalledWith({
        p_household: "household-1",
        p_new_owner: "member-2",
        p_demote_self: true,
      });
    });

    it("defaults demoteSelf to false", async () => {
      const port = vi.fn().mockResolvedValue({ error: null });
      await transferOwnership(port, "household-1", "member-2");
      expect(port).toHaveBeenCalledWith(expect.objectContaining({ p_demote_self: false }));
    });
  });

  describe("removeMemberWorkflow", () => {
    it("returns ok on success", async () => {
      const port = vi.fn().mockResolvedValue({ error: undefined });
      await expect(
        removeMemberWorkflow(port, "household-1", "member-2", { "acc-1": "transfer" }),
      ).resolves.toEqual({ ok: true, value: undefined });
      expect(port).toHaveBeenCalledWith({
        household_id: "household-1",
        member_id: "member-2",
        account_disposition: { "acc-1": "transfer" },
      });
    });

    it("maps the unresolved-owned-accounts failure", async () => {
      const port = vi.fn().mockResolvedValue({ error: { message: "unresolved owned accounts" } });
      await expect(removeMemberWorkflow(port, "household-1", "member-2")).resolves.toEqual({
        ok: false,
        errorKey: "unresolvedAccounts",
      });
    });

    it("maps the cannot-remove-an-owner failure", async () => {
      const port = vi.fn().mockResolvedValue({
        error: { message: "cannot remove another owner; transfer ownership before removal" },
      });
      await expect(removeMemberWorkflow(port, "household-1", "member-2")).resolves.toEqual({
        ok: false,
        errorKey: "targetIsOwner",
      });
    });

    it("defaults account disposition to an empty object", async () => {
      const port = vi.fn().mockResolvedValue({ error: undefined });
      await removeMemberWorkflow(port, "household-1", "member-2");
      expect(port).toHaveBeenCalledWith(expect.objectContaining({ account_disposition: {} }));
    });
  });
});
