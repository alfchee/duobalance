import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/useHousehold", () => ({
  useHousehold: () => ({ householdId: "household-1" }),
}));

const progressMock = vi.fn(() => ({
  isLoading: false,
  hasAccounts: false,
  hasTransactions: false,
  hasBudgets: false,
  hasPartner: false,
  isComplete: false,
}));

vi.mock("@/hooks/useOnboardingProgress", () => ({
  useOnboardingProgress: () => progressMock(),
}));

vi.mock("@/store/accounts", () => ({
  useAccountsUiStore: () => ({ openCreate: vi.fn() }),
}));

vi.mock("@/store/transactions", () => ({
  useTransactionsUiStore: () => ({ openCreate: vi.fn() }),
}));

vi.mock("./first-run-prompt", () => ({
  FirstRunPrompt: () => <div>firstRun</div>,
}));

vi.mock("@/hooks/useInvites", () => ({
  useInviteMutations: () => ({ create: { mutateAsync: vi.fn() } }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { GettingStartedChecklist } from "./getting-started-checklist";

describe("GettingStartedChecklist", () => {
  it("renders first-run prompt when no transactions yet", () => {
    progressMock.mockReturnValue({
      isLoading: false,
      hasAccounts: false,
      hasTransactions: false,
      hasBudgets: false,
      hasPartner: false,
      isComplete: false,
    });
    render(<GettingStartedChecklist />);

    expect(screen.getByText("firstRun")).toBeTruthy();
  });

  it("renders checklist with post-transaction prompts when transactions exist", () => {
    progressMock.mockReturnValue({
      isLoading: false,
      hasAccounts: true,
      hasTransactions: true,
      hasBudgets: false,
      hasPartner: false,
      isComplete: false,
    });
    render(<GettingStartedChecklist />);

    expect(screen.getByText("badge")).toBeTruthy();
    expect(screen.getByText("title")).toBeTruthy();
    // Budget is no longer part of the checklist (#198) — it is surfaced
    // later as a data-driven suggestion. Only account (done) + partner remain.
    expect(screen.getByText("stepPartner")).toBeTruthy();
    expect(screen.queryByText("stepBudget")).toBeNull();
  });
});
