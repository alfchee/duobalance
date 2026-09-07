"use client";

import { useEffect, useRef } from "react";
import { useAccounts, useAccountMutations } from "@/hooks/useAccounts";
import { useHousehold } from "@/hooks/useHousehold";

/**
 * Client-side fallback for #192: ensures a household with zero visible accounts
 * gets a joint Cash account in its base currency. The RPC path (migration
 * 20260909000000) covers new households; this covers households that slipped
 * through (e.g. created before the migration, or a race where the backfill
 * hasn't run yet) so the transaction sheet is never blocked.
 *
 * Guarded to run at most once per householdId.
 */
export function useEnsureDefaultAccount(householdId: string | null) {
  const { baseCurrency } = useHousehold();
  const { data: accounts, isLoading } = useAccounts(householdId);
  const { create } = useAccountMutations(householdId);
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!householdId || !baseCurrency || isLoading) return;
    if ((accounts?.length ?? 0) > 0) return;
    if (create.isPending) return;
    if (attemptedRef.current === householdId) return;
    attemptedRef.current = householdId;

    void create
      .mutateAsync({
        name: "Cash",
        kind: "cash",
        currency: baseCurrency,
        balance_mode: "ledger",
        opening_balance: 0,
        manual_balance: null,
        credit_limit: null,
        is_shared: true,
        owner_member_id: null,
      })
      .catch(() => {
        // Allow retry if it failed (e.g. transient network)
        attemptedRef.current = null;
      });
  }, [householdId, baseCurrency, isLoading, accounts, create]);
}
