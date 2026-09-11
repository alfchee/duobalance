import { render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/useHousehold", () => ({
  useHousehold: () => ({ householdId: "household-1" }),
}));

const { progressMock, pwaInstallMock, pwaEnvMock } = vi.hoisted(() => ({
  progressMock: vi.fn(() => ({
    isLoading: false,
    hasAccounts: false,
    hasTransactions: false,
    hasBudgets: false,
    hasPartner: false,
    isComplete: false,
  })),
  pwaInstallMock: vi.fn(() => ({
    installed: false,
    install: vi.fn(),
    installAvailable: false,
  })),
  pwaEnvMock: { isIOS: false },
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

vi.mock("@/components/pwa/pwa-manager", () => ({
  usePwaInstall: () => pwaInstallMock(),
}));

vi.mock("@/lib/pwa", () => ({
  isIOS: () => pwaEnvMock.isIOS,
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
  beforeEach(() => {
    pwaEnvMock.isIOS = false;
  });

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
    pwaInstallMock.mockReturnValue({
      installed: false,
      install: vi.fn(),
      installAvailable: false,
    });
    render(<GettingStartedChecklist />);

    expect(screen.getByText("badge")).toBeTruthy();
    expect(screen.getByText("title")).toBeTruthy();
    // Budget is no longer part of the checklist (#198) — it is surfaced
    // later as a data-driven suggestion. Only account (done) + partner remain.
    expect(screen.getByText("stepPartner")).toBeTruthy();
    expect(screen.queryByText("stepBudget")).toBeNull();
    // No install method on this browser — the step stays hidden so
    // onboarding can still complete.
    expect(screen.queryByText("stepInstall")).toBeNull();
  });

  it("shows install as step 2 with a direct install button when prompt is available", () => {
    progressMock.mockReturnValue({
      isLoading: false,
      hasAccounts: false,
      hasTransactions: true,
      hasBudgets: false,
      hasPartner: false,
      isComplete: false,
    });
    pwaInstallMock.mockReturnValue({
      installed: false,
      install: vi.fn(),
      installAvailable: true,
    });
    render(<GettingStartedChecklist />);

    expect(screen.getByText("stepInstall")).toBeTruthy();
    expect(screen.getByText("stepInstallDescription")).toBeTruthy();
    expect(screen.getByRole("button", { name: /actionInstall/ })).toBeTruthy();
    expect(screen.getByText("progressCount")).toBeTruthy();
  });

  it("marks install complete when the app is already installed", () => {
    progressMock.mockReturnValue({
      isLoading: false,
      hasAccounts: false,
      hasTransactions: true,
      hasBudgets: false,
      hasPartner: false,
      isComplete: false,
    });
    pwaInstallMock.mockReturnValue({
      installed: true,
      install: vi.fn(),
      installAvailable: false,
    });
    render(<GettingStartedChecklist />);

    expect(screen.getByText("stepInstall")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /actionInstall/ })).toBeNull();
  });

  it("links to the iPhone guide on iOS instead of the native prompt", () => {
    pwaEnvMock.isIOS = true;
    progressMock.mockReturnValue({
      isLoading: false,
      hasAccounts: false,
      hasTransactions: true,
      hasBudgets: false,
      hasPartner: false,
      isComplete: false,
    });
    pwaInstallMock.mockReturnValue({
      installed: false,
      install: vi.fn(),
      installAvailable: false,
    });
    render(<GettingStartedChecklist />);

    expect(screen.getByText("stepInstall")).toBeTruthy();
    const guideLink = screen.getByRole("link", { name: /actionInstall/ });
    expect(guideLink.getAttribute("href")).toBe("/install");
    expect(screen.queryByRole("button", { name: /actionInstall/ })).toBeNull();
  });
});
