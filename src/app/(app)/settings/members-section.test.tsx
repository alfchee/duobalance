import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));
vi.mock("@/hooks/useHousehold", () => ({ useHousehold: vi.fn() }));
vi.mock("@/hooks/useHouseholdCommands", () => ({ useHouseholdCommands: vi.fn() }));
vi.mock("@/hooks/useHouseholdMembers", () => ({ useHouseholdMembers: vi.fn() }));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: vi.fn() }));
vi.mock("@/hooks/useInvites", () => ({
  usePendingInvites: vi.fn(),
  useInviteMutations: vi.fn(),
}));

import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdCommands } from "@/hooks/useHouseholdCommands";
import { useHouseholdMembers } from "@/hooks/useHouseholdMembers";
import { useAccounts } from "@/hooks/useAccounts";
import { useInviteMutations, usePendingInvites } from "@/hooks/useInvites";
import { MembersSection } from "./members-section";

const MEMBERS = [
  {
    id: "self",
    user_id: "u-self",
    display_name: "Me",
    role: "owner",
    joined_at: "2026-01-01T00:00:00Z",
    color_hex: null,
  },
  {
    id: "co-owner",
    user_id: "u-co",
    display_name: "Co-Owner",
    role: "owner",
    joined_at: "2026-01-02T00:00:00Z",
    color_hex: null,
  },
  {
    id: "partner",
    user_id: "u-partner",
    display_name: "Partner",
    role: "partner",
    joined_at: "2026-01-03T00:00:00Z",
    color_hex: null,
  },
];

function setup() {
  vi.mocked(useHousehold).mockReturnValue({
    householdId: "household-1",
    role: "owner",
    memberId: "self",
  } as unknown as ReturnType<typeof useHousehold>);
  vi.mocked(useHouseholdMembers).mockReturnValue({
    data: MEMBERS,
    isPending: false,
  } as unknown as ReturnType<typeof useHouseholdMembers>);
  vi.mocked(useAccounts).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useAccounts>);
  vi.mocked(usePendingInvites).mockReturnValue({
    data: [],
    isPending: false,
  } as unknown as ReturnType<typeof usePendingInvites>);
  vi.mocked(useInviteMutations).mockReturnValue({
    create: { mutateAsync: vi.fn(), isPending: false },
    revoke: { mutateAsync: vi.fn(), isPending: false },
    resend: { mutateAsync: vi.fn(), isPending: false },
  } as unknown as ReturnType<typeof useInviteMutations>);
  vi.mocked(useHouseholdCommands).mockReturnValue({
    transferOwnership: vi.fn(),
    removeMember: vi.fn(),
  } as unknown as ReturnType<typeof useHouseholdCommands>);
}

describe("MembersSection", () => {
  it("does not offer removing a co-owner, even though the caller is an owner", () => {
    setup();
    render(<MembersSection embedded />);

    const coOwnerRow = screen.getByText("Co-Owner").closest("li")!;
    expect(within(coOwnerRow).queryByText("settings.members.removeMember")).toBeNull();
    expect(within(coOwnerRow).queryByText("settings.members.transferOwnership")).toBeNull();
  });

  it("offers removing (and transferring ownership to) a partner", () => {
    setup();
    render(<MembersSection embedded />);

    const partnerRow = screen.getByText("Partner").closest("li")!;
    expect(within(partnerRow).getByText("settings.members.removeMember")).toBeTruthy();
    expect(within(partnerRow).getByText("settings.members.transferOwnership")).toBeTruthy();
  });

  it("never offers managing the caller's own row", () => {
    setup();
    render(<MembersSection embedded />);

    const selfRow = screen.getByText("Me").closest("li")!;
    expect(within(selfRow).queryByText("settings.members.removeMember")).toBeNull();
    expect(within(selfRow).queryByText("settings.members.transferOwnership")).toBeNull();
  });

  it("offers no management actions to a non-owner", () => {
    setup();
    vi.mocked(useHousehold).mockReturnValue({
      householdId: "household-1",
      role: "partner",
      memberId: "partner",
    } as unknown as ReturnType<typeof useHousehold>);
    render(<MembersSection embedded />);

    expect(screen.queryByText("settings.members.removeMember")).toBeNull();
    expect(screen.queryByText("settings.members.transferOwnership")).toBeNull();
  });
});
