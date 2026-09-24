"use client";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "es",
  useTranslations: (namespace: string) => {
    const dict: Record<string, Record<string, string>> = {
      "settings.plan": {
        title: "Plan",
        subtitle: "Comparación",
        currentPlanBadge: "Tu plan",
        unlimited: "Ilimitado",
        unlimitedHistory: "Historial ilimitado",
        days: "{count} días",
        notIncluded: "No incluido",
        error: "No se pudo cargar.",
      },
      "settings.plan.features": {
        accounts: "Cuentas",
        budgets: "Presupuestos",
        export: "Exportar tus datos",
        partner_sharing: "Compartir con tu pareja",
        write_access: "write_access",
      },
    };
    const table = dict[namespace] ?? {};
    return (key: string) => table[key] ?? `${namespace}.${key}`;
  },
}));
vi.mock("@/hooks/useEntitlement", () => ({
  usePlanCatalogue: vi.fn(),
  useHouseholdPlan: vi.fn(),
  UNLIMITED_LIMIT: 2147483647,
}));
vi.mock("@/hooks/useBillingEnabled", () => ({ useBillingEnabled: vi.fn() }));
vi.mock("@/hooks/useHousehold", () => ({ useHousehold: vi.fn() }));

import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import { useHousehold } from "@/hooks/useHousehold";
import {
  useHouseholdPlan,
  usePlanCatalogue,
  type PlanCatalogueEntry,
} from "@/hooks/useEntitlement";
import { PlanSection } from "./plan-section";

function pendingQuery() {
  return {
    data: undefined,
    error: null,
    isPending: true,
    isError: false,
    isLoading: true,
  } as unknown as ReturnType<typeof usePlanCatalogue>;
}

function resolvedQuery<T>(data: T) {
  return {
    data,
    error: null,
    isPending: false,
    isError: false,
    isLoading: false,
  } as unknown as ReturnType<typeof usePlanCatalogue>;
}

const CATALOGUE: PlanCatalogueEntry[] = [
  {
    code: "free",
    name: "Duo",
    features: {
      accounts: { enabled: true, limit: 4 },
      budgets: { enabled: true, limit: null },
      export: { enabled: false, limit: null },
      partner_sharing: { enabled: false, limit: null },
      write_access: { enabled: true, limit: null },
    },
  },
  {
    code: "plus",
    name: "Plus",
    features: {
      accounts: { enabled: true, limit: null },
      budgets: { enabled: true, limit: null },
      export: { enabled: true, limit: null },
      partner_sharing: { enabled: true, limit: null },
    },
  },
];

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.NEXT_PUBLIC_BILLING_ENABLED;
});

describe("PlanSection (#264)", () => {
  it("renders nothing while billing is off — no billing surface for a user", () => {
    vi.mocked(useBillingEnabled).mockReturnValue(false);
    render(<PlanSection />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Plan")).toBeNull();
  });

  it("renders the comparison from the plans table data, not hardcoded copy", () => {
    process.env.NEXT_PUBLIC_BILLING_ENABLED = "1";
    vi.mocked(useBillingEnabled).mockReturnValue(true);
    vi.mocked(usePlanCatalogue).mockReturnValue(resolvedQuery(CATALOGUE));
    vi.mocked(useHouseholdPlan).mockReturnValue(
      resolvedQuery("free") as unknown as ReturnType<typeof useHouseholdPlan>,
    );
    vi.mocked(useHousehold).mockReturnValue({
      householdId: "household-1",
    } as unknown as ReturnType<typeof useHousehold>);

    render(<PlanSection />);

    // Plan names come from the mocked plans-table rows (badge text is
    // concatenated by accessible-name normalization).
    expect(screen.getByRole("columnheader", { name: /Duo/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Plus/ })).toBeTruthy();
    // Feature keys become rows; the internal write_access vocabulary is hidden.
    expect(screen.getByRole("rowheader", { name: "settings.plan.features.accounts" })).toBeTruthy();
    expect(
      screen.queryByRole("rowheader", { name: "settings.plan.features.write_access" }),
    ).toBeNull();
    // Values: counted limit, unlimited, and not included.
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getAllByText("Ilimitado").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No incluido").length).toBeGreaterThan(0);
  });

  it("badges the household's current plan", () => {
    process.env.NEXT_PUBLIC_BILLING_ENABLED = "1";
    vi.mocked(useBillingEnabled).mockReturnValue(true);
    vi.mocked(usePlanCatalogue).mockReturnValue(resolvedQuery(CATALOGUE));
    vi.mocked(useHouseholdPlan).mockReturnValue(
      resolvedQuery("plus") as unknown as ReturnType<typeof useHouseholdPlan>,
    );
    vi.mocked(useHousehold).mockReturnValue({
      householdId: "household-1",
    } as unknown as ReturnType<typeof useHousehold>);

    render(<PlanSection />);
    expect(screen.getByText("Tu plan")).toBeTruthy();
  });

  it("renders an error state when the catalogue query fails", () => {
    process.env.NEXT_PUBLIC_BILLING_ENABLED = "1";
    vi.mocked(useBillingEnabled).mockReturnValue(true);
    vi.mocked(usePlanCatalogue).mockReturnValue({
      data: undefined,
      error: new Error("db down"),
      isPending: false,
      isError: true,
      isLoading: false,
    } as unknown as ReturnType<typeof usePlanCatalogue>);

    render(<PlanSection />);
    expect(screen.getByRole("alert").textContent).toBe("No se pudo cargar.");
  });

  it("shows a skeleton while the catalogue is pending", () => {
    process.env.NEXT_PUBLIC_BILLING_ENABLED = "1";
    vi.mocked(useBillingEnabled).mockReturnValue(true);
    vi.mocked(usePlanCatalogue).mockReturnValue(pendingQuery());

    render(<PlanSection />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Plan")).toBeTruthy();
  });
});
