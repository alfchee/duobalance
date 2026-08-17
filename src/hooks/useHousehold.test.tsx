import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/components/household-provider", () => ({ useHouseholdContext: vi.fn() }));

import { useHouseholdContext } from "@/components/household-provider";
import type { Membership } from "@/components/household-provider";
import { useHousehold } from "./useHousehold";

const contextMock = vi.mocked(useHouseholdContext);

const ACTIVE: Membership = {
  memberId: "m1",
  householdId: "h1",
  role: "owner",
  displayName: "Ana",
  household: {
    name: "Casa 123",
    country: "CL",
    baseCurrency: "CLP",
    timezone: "America/Santiago",
    locale: "es",
  },
};

const selectHousehold = vi.fn();

function context(overrides: Partial<ReturnType<typeof useHouseholdContext>>) {
  return {
    loading: false,
    error: null,
    memberships: [ACTIVE],
    active: ACTIVE,
    needsPicker: false,
    numberFormat: "locale" as const,
    selectHousehold,
    ...overrides,
  };
}

describe("useHousehold", () => {
  it("derives household fields from the active membership", () => {
    contextMock.mockReturnValue(context({}));
    const { result } = renderHook(() => useHousehold());

    expect(result.current).toEqual({
      householdId: "h1",
      memberId: "m1",
      role: "owner",
      numberFormat: "locale",
      baseCurrency: "CLP",
      timezone: "America/Santiago",
      locale: "es",
      householdName: "Casa 123",
      loading: false,
      needsPicker: false,
      memberships: [ACTIVE],
      error: null,
      selectHousehold,
    });
  });

  it("uses the user-scoped number format regardless of active household", () => {
    contextMock.mockReturnValue(context({ numberFormat: "comma_decimal" }));
    const { result } = renderHook(() => useHousehold());

    expect(result.current.numberFormat).toBe("comma_decimal");
  });

  it("yields null household fields when nothing is active", () => {
    contextMock.mockReturnValue(context({ active: null, memberships: [], needsPicker: true }));
    const { result } = renderHook(() => useHousehold());

    expect(result.current.householdId).toBeNull();
    expect(result.current.memberId).toBeNull();
    expect(result.current.role).toBeNull();
    expect(result.current.numberFormat).toBe("locale");
    expect(result.current.baseCurrency).toBeNull();
    expect(result.current.timezone).toBeNull();
    expect(result.current.locale).toBeNull();
    expect(result.current.householdName).toBeNull();
    expect(result.current.needsPicker).toBe(true);
  });

  it("passes through loading and error", () => {
    const error = new Error("nope");
    contextMock.mockReturnValue(context({ loading: true, error }));
    const { result } = renderHook(() => useHousehold());

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(error);
  });
});
