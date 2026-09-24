import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));
vi.mock("@/lib/api-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-fetch")>()),
  apiFetch: vi.fn(),
}));
vi.mock("@/hooks/useHousehold", () => ({ useHousehold: vi.fn() }));
vi.mock("@/hooks/useEntitlement", () => ({ useEntitlement: vi.fn() }));

import { ApiError, apiFetch } from "@/lib/api-fetch";
import { useHousehold } from "@/hooks/useHousehold";
import { useEntitlement } from "@/hooks/useEntitlement";
import { downloadFilename, ExportSection } from "./export-section";

describe("downloadFilename", () => {
  it("matches the household backup filename contract", () => {
    expect(
      downloadFilename("Alex & Sam's Home", "json", new Date("2026-08-13T12:00:00.000Z")),
    ).toBe("duobalance-alex-sam-s-home-2026-08-13.json");
  });
});

describe("ExportSection 402 handling (#264)", () => {
  const HOUSEHOLD = "10000000-0000-4000-8000-000000000001";

  function setup(entitled = true) {
    vi.mocked(useHousehold).mockReturnValue({
      householdId: HOUSEHOLD,
      householdName: "Home",
    } as unknown as ReturnType<typeof useHousehold>);
    vi.mocked(useEntitlement).mockReturnValue({
      entitled,
      limit: 2147483647,
      unlimited: true,
      pending: false,
    } as unknown as ReturnType<typeof useEntitlement>);
  }

  it("maps a 402 from the route's plan check onto the upgrade prompt", async () => {
    setup();
    vi.mocked(apiFetch).mockRejectedValue(
      new ApiError(402, { error: "plan upgrade required" }, ""),
    );

    render(<ExportSection />);
    fireEvent.click(screen.getByRole("button", { name: "settings.export.json" }));

    // The gate was open (entitled) but the server denied: the UI must land
    // on the upgrade prompt, not a dead generic error.
    expect(await screen.findByText("billing.upgrade.title")).toBeTruthy();
    expect(screen.queryByText("settings.export.error")).toBeNull();
  });

  it("shows the generic error for non-402 failures", async () => {
    setup();
    vi.mocked(apiFetch).mockRejectedValue(new Error("network down"));

    render(<ExportSection />);
    fireEvent.click(screen.getByRole("button", { name: "settings.export.csv" }));

    expect(await screen.findByText("settings.export.error")).toBeTruthy();
    expect(screen.queryByText("billing.upgrade.title")).toBeNull();
  });
});
