"use client";

import { useMemo } from "react";
import { useFxOverrides, type EffectiveRate } from "@/hooks/useFxOverrides";
import type { RatesByCode } from "@/lib/balances";

// Builds the RatesByCode Map once per household from the useFxOverrides array.
// Before this hook existed, BalancesHeader and each BalancesSection rebuilt
// the same Map independently up to 5 times (header + 4 sections) from the
// same array on every rates change. Threading a shared Memo through a context
// is the right way to eliminate the duplicate work.
export function useRatesByCode(): RatesByCode {
  const { data: rates } = useFxOverrides();
  return useMemo(() => {
    const m = new Map<string, EffectiveRate>();
    for (const r of rates ?? []) m.set(r.code, r);
    return m;
  }, [rates]);
}
