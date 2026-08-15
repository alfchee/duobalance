"use client";

import { useHouseholdContext } from "@/components/household-provider";

// AC (#14): useHousehold() provides id, member id, role, base currency,
// timezone, locale. `null` fields mean no active household is resolved yet
// (loading, no membership, or a pending picker — check `loading`/`needsPicker`).
export function useHousehold() {
  const { active, loading, needsPicker, memberships, error, selectHousehold } =
    useHouseholdContext();

  return {
    householdId: active?.householdId ?? null,
    memberId: active?.memberId ?? null,
    role: active?.role ?? null,
    numberFormat: active?.numberFormat ?? "locale",
    baseCurrency: active?.household.baseCurrency ?? null,
    timezone: active?.household.timezone ?? null,
    locale: active?.household.locale ?? null,
    householdName: active?.household.name ?? null,
    loading,
    needsPicker,
    memberships,
    error,
    selectHousehold,
  };
}
