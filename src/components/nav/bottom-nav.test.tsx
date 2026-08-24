import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openCreate = vi.fn();
const logout = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/balances",
}));

vi.mock("@/store/transactions", () => ({
  useTransactionsUiStore: (selector: (state: { openCreate: typeof openCreate }) => unknown) =>
    selector({ openCreate }),
}));

vi.mock("@/hooks/useAuthCommands", () => ({
  useAuthCommands: () => ({ logout }),
}));

import { BottomNav } from "./bottom-nav";

describe("BottomNav", () => {
  beforeEach(() => {
    openCreate.mockReset();
    logout.mockReset();
  });

  it("keeps transaction entry immediately available outside the drawer", () => {
    render(<BottomNav />);

    fireEvent.click(screen.getByRole("button", { name: "newTransaction" }));
    expect(openCreate).toHaveBeenCalledOnce();
  });

  it("opens an accessible drawer containing every navigation destination", () => {
    render(<BottomNav />);

    const menu = screen.getByRole("button", { name: "more" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(menu);

    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "balances" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "transactions" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "budget" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "reports" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "bills" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "settings" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "help" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "logout" })).toBeTruthy();
  });
});
