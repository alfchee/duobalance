import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptInvite,
  clearActiveHouseholdId,
  createHousehold,
  getInviteErrorKey,
  readActiveHouseholdId,
  saveActiveHouseholdId,
} from "./workflows";

beforeEach(() => localStorage.clear());

describe("household workflows", () => {
  it("normalizes household input before the RPC boundary", async () => {
    const port = vi.fn().mockResolvedValue({ error: null });
    await expect(
      createHousehold(port, {
        name: " Home ",
        country: "CL",
        baseCurrency: "CLP",
        displayName: " Partner ",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
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
});
