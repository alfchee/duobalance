import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/hooks/useHousehold", () => ({ useHousehold: vi.fn() }));
vi.mock("@/hooks/useHouseholdCommands", () => ({ useHouseholdCommands: vi.fn() }));
vi.mock("@/hooks/useCountries", () => ({ useCountries: vi.fn() }));
vi.mock("@/hooks/useCurrencies", () => ({ useCurrencies: vi.fn() }));

import { useCountries } from "@/hooks/useCountries";
import { useCurrencies } from "@/hooks/useCurrencies";
import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdCommands } from "@/hooks/useHouseholdCommands";
import { HouseholdSwitcher } from "./household-switcher";

describe("HouseholdSwitcher", () => {
  it("exposes household actions to a user with one household", () => {
    vi.mocked(useHousehold).mockReturnValue({
      householdId: "household-1",
      householdName: "Home",
      memberships: [{ householdId: "household-1", household: { name: "Home" } }],
      selectHousehold: vi.fn(),
    } as unknown as ReturnType<typeof useHousehold>);
    vi.mocked(useHouseholdCommands).mockReturnValue({ create: vi.fn(), accept: vi.fn() } as never);
    vi.mocked(useCountries).mockReturnValue({ data: [] } as never);
    vi.mocked(useCurrencies).mockReturnValue({ data: [] } as never);

    render(<HouseholdSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: /home/i }));

    expect(screen.getByRole("button", { name: "create" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "join" })).toBeTruthy();
  });
});
