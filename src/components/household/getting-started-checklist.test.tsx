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

vi.mock("@/hooks/useOnboardingProgress", () => ({
  useOnboardingProgress: () => ({
    isLoading: false,
    hasAccounts: false,
    hasTransactions: false,
    hasBudgets: false,
    hasPartner: false,
    isComplete: false,
  }),
}));

vi.mock("@/store/accounts", () => ({
  useAccountsUiStore: () => ({ openCreate: vi.fn() }),
}));

vi.mock("@/store/transactions", () => ({
  useTransactionsUiStore: () => ({ openCreate: vi.fn() }),
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
  it("renders checklist when onboarding is incomplete", () => {
    render(<GettingStartedChecklist />);

    expect(screen.getByText("badge")).toBeTruthy();
    expect(screen.getByText("title")).toBeTruthy();
    expect(screen.getByText("stepAccount")).toBeTruthy();
    expect(screen.getByText("stepTransaction")).toBeTruthy();
    expect(screen.getByText("stepBudget")).toBeTruthy();
    expect(screen.getByText("stepPartner")).toBeTruthy();
  });
});
