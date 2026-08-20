import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReportProblemModal } from "./report-problem-modal";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/useHousehold", () => ({
  useHousehold: () => ({
    householdId: "hh-123",
    memberId: "mem-456",
    role: "owner",
    numberFormat: "locale",
    baseCurrency: "USD",
    timezone: "UTC",
    locale: "en",
  }),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "user-123", email: "user@example.com" },
  }),
}));

describe("ReportProblemModal", () => {
  it("renders safely outside RealtimeStatus (e.g. in error boundary)", () => {
    const queryClient = new QueryClient();

    expect(() =>
      render(
        <QueryClientProvider client={queryClient}>
          <ReportProblemModal open={true} onOpenChange={() => {}} />
        </QueryClientProvider>,
      ),
    ).not.toThrow();

    expect(screen.getByText("title")).toBeDefined();
  });
});
