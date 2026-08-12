import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/hooks/useHousehold", () => ({ useHousehold: vi.fn() }));

import { useHousehold } from "@/hooks/useHousehold";
import { HouseholdPicker } from "./household-picker";

describe("HouseholdPicker", () => {
  it("presents memberships and delegates the selection interaction", () => {
    const selectHousehold = vi.fn();
    vi.mocked(useHousehold).mockReturnValue({
      memberships: [
        {
          householdId: "household-1",
          household: { name: "Home" },
        },
      ],
      selectHousehold,
    } as unknown as ReturnType<typeof useHousehold>);

    render(<HouseholdPicker />);

    fireEvent.click(screen.getByRole("button", { name: /home/i }));
    expect(selectHousehold).toHaveBeenCalledWith("household-1");
  });
});
