import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));
vi.mock("@/hooks/useHousehold", () => ({ useHousehold: vi.fn() }));
vi.mock("@/hooks/useHouseholdMembers", () => ({ useHouseholdMembers: vi.fn() }));
vi.mock("@/hooks/useHouseholdCommands", () => ({ useHouseholdCommands: vi.fn() }));

import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdCommands } from "@/hooks/useHouseholdCommands";
import { useHouseholdMembers } from "@/hooks/useHouseholdMembers";
import { HouseholdDangerSection } from "./household-danger-section";

const OWNER_HOUSEHOLD: {
  householdId: string;
  householdName: string;
  role: "owner" | "partner";
} = {
  householdId: "household-1",
  householdName: "Casa Duo",
  role: "owner",
};

function mockHousehold(overrides: Partial<typeof OWNER_HOUSEHOLD>) {
  vi.mocked(useHousehold).mockReturnValue({
    ...OWNER_HOUSEHOLD,
    ...overrides,
  } as unknown as ReturnType<typeof useHousehold>);
}

function mockMembers(data: unknown, isPending = false) {
  vi.mocked(useHouseholdMembers).mockReturnValue({
    data,
    isPending,
  } as unknown as ReturnType<typeof useHouseholdMembers>);
}

const TWO_MEMBERS = [
  { id: "m1", role: "owner" },
  { id: "m2", role: "partner" },
];

beforeEach(() => {
  vi.mocked(useHouseholdCommands).mockReturnValue({
    removeHousehold: vi.fn(),
    leave: vi.fn(),
  } as unknown as ReturnType<typeof useHouseholdCommands>);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HouseholdDangerSection", () => {
  it("only shows the delete-household action to an owner", () => {
    mockHousehold({ role: "partner" });
    mockMembers(TWO_MEMBERS);
    render(<HouseholdDangerSection />);

    expect(screen.queryByText("settings.actions.delete.button")).toBeNull();
  });

  it("shows the delete-household action to an owner", () => {
    mockHousehold({ role: "owner" });
    mockMembers(TWO_MEMBERS);
    render(<HouseholdDangerSection />);

    expect(screen.getByText("settings.actions.delete.button")).toBeTruthy();
  });

  describe("leave dialog", () => {
    it("shows the last-member notice and lets a sole partner confirm leaving", async () => {
      mockHousehold({ role: "partner" });
      mockMembers([{ id: "m1", role: "partner" }]);
      const leave = vi.fn().mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(useHouseholdCommands).mockReturnValue({
        removeHousehold: vi.fn(),
        leave,
      } as unknown as ReturnType<typeof useHouseholdCommands>);
      render(<HouseholdDangerSection />);

      fireEvent.click(screen.getByText("settings.actions.leave.button"));
      expect(screen.getByText("settings.actions.leave.lastMemberNotice")).toBeTruthy();

      fireEvent.click(screen.getByText("settings.actions.leave.confirmButton"));
      await waitFor(() => expect(leave).toHaveBeenCalledWith("household-1"));
    });

    it("shows the partner notice (not last-member) when other active members remain", () => {
      mockHousehold({ role: "partner" });
      mockMembers(TWO_MEMBERS);
      render(<HouseholdDangerSection />);

      fireEvent.click(screen.getByText("settings.actions.leave.button"));
      expect(screen.getByText("settings.actions.leave.partnerNotice")).toBeTruthy();
      expect(screen.queryByText("settings.actions.leave.lastMemberNotice")).toBeNull();
    });

    it("does not show a last-member notice while members are still loading", () => {
      mockHousehold({ role: "partner" });
      mockMembers(undefined, true);
      render(<HouseholdDangerSection />);

      fireEvent.click(screen.getByText("settings.actions.leave.button"));
      expect(screen.queryByText("settings.actions.leave.lastMemberNotice")).toBeNull();
      expect(screen.queryByText("settings.actions.leave.partnerNotice")).toBeNull();
    });

    it("hides the confirm button for an owner with other active members and shows the owner notice", () => {
      mockHousehold({ role: "owner" });
      mockMembers(TWO_MEMBERS);
      render(<HouseholdDangerSection />);

      fireEvent.click(screen.getByText("settings.actions.leave.button"));
      expect(screen.getByText("settings.actions.leave.ownerNotice")).toBeTruthy();
      expect(screen.queryByText("settings.actions.leave.confirmButton")).toBeNull();
    });

    it("shows the mapped error key when leave fails", async () => {
      mockHousehold({ role: "partner" });
      mockMembers(TWO_MEMBERS);
      const leave = vi.fn().mockResolvedValue({ ok: false, errorKey: "notMember" });
      vi.mocked(useHouseholdCommands).mockReturnValue({
        removeHousehold: vi.fn(),
        leave,
      } as unknown as ReturnType<typeof useHouseholdCommands>);
      render(<HouseholdDangerSection />);

      fireEvent.click(screen.getByText("settings.actions.leave.button"));
      fireEvent.click(screen.getByText("settings.actions.leave.confirmButton"));

      await waitFor(() =>
        expect(screen.getByText("settings.actions.errors.notMember")).toBeTruthy(),
      );
    });

    it("logs and shows a generic error when leave throws unexpectedly", async () => {
      mockHousehold({ role: "partner" });
      mockMembers(TWO_MEMBERS);
      const leave = vi.fn().mockRejectedValue(new Error("network down"));
      vi.mocked(useHouseholdCommands).mockReturnValue({
        removeHousehold: vi.fn(),
        leave,
      } as unknown as ReturnType<typeof useHouseholdCommands>);
      render(<HouseholdDangerSection />);

      fireEvent.click(screen.getByText("settings.actions.leave.button"));
      fireEvent.click(screen.getByText("settings.actions.leave.confirmButton"));

      await waitFor(() => expect(screen.getByText("settings.actions.errors.generic")).toBeTruthy());
      expect(console.error).toHaveBeenCalledWith(
        "household-danger-section: unexpected error leaving household",
        expect.any(Error),
      );
    });
  });

  describe("delete dialog", () => {
    it("disables the confirm button until the typed name matches exactly", () => {
      mockHousehold({ role: "owner" });
      mockMembers(TWO_MEMBERS);
      render(<HouseholdDangerSection />);

      fireEvent.click(screen.getByText("settings.actions.delete.button"));
      const confirmButton = screen
        .getByText("settings.actions.delete.confirmButton")
        .closest("button") as HTMLButtonElement;
      expect(confirmButton.disabled).toBe(true);

      const input = screen.getByPlaceholderText("settings.actions.delete.confirmPlaceholder");
      fireEvent.change(input, { target: { value: "Wrong Name" } });
      expect(confirmButton.disabled).toBe(true);

      fireEvent.change(input, { target: { value: "Casa Duo" } });
      expect(confirmButton.disabled).toBe(false);
    });

    it("trims whitespace when comparing the typed name", () => {
      mockHousehold({ role: "owner" });
      mockMembers(TWO_MEMBERS);
      render(<HouseholdDangerSection />);

      fireEvent.click(screen.getByText("settings.actions.delete.button"));
      const input = screen.getByPlaceholderText("settings.actions.delete.confirmPlaceholder");
      fireEvent.change(input, { target: { value: "  Casa Duo  " } });

      const confirmButton = screen
        .getByText("settings.actions.delete.confirmButton")
        .closest("button") as HTMLButtonElement;
      expect(confirmButton.disabled).toBe(false);
    });

    it("calls removeHousehold and closes the dialog on success", async () => {
      mockHousehold({ role: "owner" });
      mockMembers(TWO_MEMBERS);
      const removeHousehold = vi.fn().mockResolvedValue({ ok: true, value: undefined });
      vi.mocked(useHouseholdCommands).mockReturnValue({
        removeHousehold,
        leave: vi.fn(),
      } as unknown as ReturnType<typeof useHouseholdCommands>);
      render(<HouseholdDangerSection />);

      fireEvent.click(screen.getByText("settings.actions.delete.button"));
      fireEvent.change(screen.getByPlaceholderText("settings.actions.delete.confirmPlaceholder"), {
        target: { value: "Casa Duo" },
      });
      fireEvent.click(screen.getByText("settings.actions.delete.confirmButton"));

      await waitFor(() => expect(removeHousehold).toHaveBeenCalledWith("household-1"));
      await waitFor(() =>
        expect(screen.queryByText("settings.actions.delete.dialogTitle")).toBeNull(),
      );
    });

    it("shows the mapped error key when delete fails", async () => {
      mockHousehold({ role: "owner" });
      mockMembers(TWO_MEMBERS);
      const removeHousehold = vi.fn().mockResolvedValue({ ok: false, errorKey: "notOwner" });
      vi.mocked(useHouseholdCommands).mockReturnValue({
        removeHousehold,
        leave: vi.fn(),
      } as unknown as ReturnType<typeof useHouseholdCommands>);
      render(<HouseholdDangerSection />);

      fireEvent.click(screen.getByText("settings.actions.delete.button"));
      fireEvent.change(screen.getByPlaceholderText("settings.actions.delete.confirmPlaceholder"), {
        target: { value: "Casa Duo" },
      });
      fireEvent.click(screen.getByText("settings.actions.delete.confirmButton"));

      await waitFor(() =>
        expect(screen.getByText("settings.actions.errors.notOwner")).toBeTruthy(),
      );
    });

    it("logs and shows a generic error when delete throws unexpectedly", async () => {
      mockHousehold({ role: "owner" });
      mockMembers(TWO_MEMBERS);
      const removeHousehold = vi.fn().mockRejectedValue(new Error("network down"));
      vi.mocked(useHouseholdCommands).mockReturnValue({
        removeHousehold,
        leave: vi.fn(),
      } as unknown as ReturnType<typeof useHouseholdCommands>);
      render(<HouseholdDangerSection />);

      fireEvent.click(screen.getByText("settings.actions.delete.button"));
      fireEvent.change(screen.getByPlaceholderText("settings.actions.delete.confirmPlaceholder"), {
        target: { value: "Casa Duo" },
      });
      fireEvent.click(screen.getByText("settings.actions.delete.confirmButton"));

      await waitFor(() => expect(screen.getByText("settings.actions.errors.generic")).toBeTruthy());
      expect(console.error).toHaveBeenCalledWith(
        "household-danger-section: unexpected error deleting household",
        expect.any(Error),
      );
    });
  });
});
