"use client";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "es",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: string; href: string }) => (
    <a href={href}>{children}</a>
  ),
  Link: ({ children, href }: { children: string; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/hooks/useEntitlement", () => ({ useEntitlement: vi.fn() }));

import { useEntitlement } from "@/hooks/useEntitlement";
import { FeatureGate } from "./feature-gate";
import { LimitApproaching } from "./limit-approaching";

const HOUSEHOLD = "10000000-0000-4000-8000-000000000001";

function entitled(overrides: Partial<ReturnType<typeof useEntitlement>> = {}) {
  return {
    entitled: true,
    limit: 2147483647,
    unlimited: true,
    pending: false,
    ...overrides,
  } as ReturnType<typeof useEntitlement>;
}

describe("FeatureGate (#264)", () => {
  it("renders the feature while entitled", () => {
    vi.mocked(useEntitlement).mockReturnValue(entitled());
    render(
      <FeatureGate householdId={HOUSEHOLD} feature="export">
        <button type="button">Export</button>
      </FeatureGate>,
    );
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
  });

  it("renders nothing while the entitlement is pending, never flashing the gated feature", () => {
    vi.mocked(useEntitlement).mockReturnValue(entitled({ entitled: false, pending: true }));
    render(
      <FeatureGate householdId={HOUSEHOLD} feature="export">
        <button type="button">Export</button>
      </FeatureGate>,
    );
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
    expect(screen.queryByText("billing.upgrade.title")).toBeNull();
  });

  it("renders the upgrade prompt in place of the gated feature when not entitled", () => {
    vi.mocked(useEntitlement).mockReturnValue(
      entitled({ entitled: false, limit: 0, unlimited: false }),
    );
    render(
      <FeatureGate householdId={HOUSEHOLD} feature="export">
        <button type="button">Export</button>
      </FeatureGate>,
    );
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
    expect(screen.getByText("billing.upgrade.title")).toBeTruthy();
    // The prompt offers the upgrade and points at the comparison screen.
    expect(screen.getByRole("link", { name: "billing.upgrade.cta" }).getAttribute("href")).toBe(
      "/settings#plan",
    );
  });
});

describe("LimitApproaching (#264)", () => {
  it("is silent below the approach threshold", () => {
    vi.mocked(useEntitlement).mockReturnValue(
      entitled({ entitled: true, limit: 4, unlimited: false }),
    );
    render(<LimitApproaching householdId={HOUSEHOLD} feature="accounts" used={2} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns from 75% of the limit, before the limit is hit", () => {
    vi.mocked(useEntitlement).mockReturnValue(
      entitled({ entitled: true, limit: 4, unlimited: false }),
    );
    render(<LimitApproaching householdId={HOUSEHOLD} feature="accounts" used={3} />);
    expect(screen.getByRole("status").textContent).toBe("billing.limits.approaching");
  });

  it("switches to the at-limit guidance at or over the limit", () => {
    vi.mocked(useEntitlement).mockReturnValue(
      entitled({ entitled: true, limit: 4, unlimited: false }),
    );
    render(<LimitApproaching householdId={HOUSEHOLD} feature="accounts" used={4} />);
    expect(screen.getByRole("status").textContent).toBe("billing.limits.atLimit");
  });

  it("stays silent for unlimited plans", () => {
    vi.mocked(useEntitlement).mockReturnValue(entitled());
    render(<LimitApproaching householdId={HOUSEHOLD} feature="accounts" used={9} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is silent while pending", () => {
    vi.mocked(useEntitlement).mockReturnValue(
      entitled({ entitled: false, limit: 4, unlimited: false, pending: true }),
    );
    render(<LimitApproaching householdId={HOUSEHOLD} feature="accounts" used={4} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
