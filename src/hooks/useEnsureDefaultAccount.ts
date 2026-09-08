"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccounts, useAccountMutations } from "@/hooks/useAccounts";
import { useHousehold } from "@/hooks/useHousehold";
import {
  clearCreatingDefaultCash,
  getDefaultCashName,
  isCreatingDefaultCash,
  markCreatingDefaultCash,
} from "@/lib/accounts/default-cash";
import type { AccountWithBalance } from "@/lib/accounts";

/**
 * Client-side fallback for #192: ensures a household with zero visible accounts
 * gets a joint Cash account in its base currency. The RPC path (migration
 * 20260909000000) covers new households; this covers households that slipped
 * through (e.g. created before the migration, or a race where the backfill
 * hasn't run yet) so the transaction sheet is never blocked.
 *
 * Guarded to run at most once per householdId and deduplicated against the
 * transaction sheet's inline creation via the shared `creatingHouseholds` set.
 */
export function useEnsureDefaultAccount(householdId: string | null) {
  const { baseCurrency, locale } = useHousehold();
  const { data: accounts, isLoading } = useAccounts(householdId);
  const { create } = useAccountMutations(householdId);
  const queryClient = useQueryClient();
  const attemptedRef = useRef<string | null>(null);
  const createRef = useRef(create);
  createRef.current = create;

  const hasUsableAccount = (accounts ?? []).some((a) => !a.is_archived);
  const createPending = create.isPending;

  useEffect(() => {
    if (!householdId || !baseCurrency || isLoading) return;
    if (hasUsableAccount) return;
    if (createPending) return;
    if (isCreatingDefaultCash(householdId)) return;
    if (attemptedRef.current === householdId) return;

    // Final guard: re-read cache in case sheet just created it. Invalidate
    // first so a just-inserted row from another tab is visible.
    void queryClient.invalidateQueries({ queryKey: ["accounts", householdId] });
    const cached = queryClient.getQueryData<AccountWithBalance[]>(["accounts", householdId]) ?? [];
    if (cached.some((a) => !a.is_archived)) return;

    attemptedRef.current = householdId;
    markCreatingDefaultCash(householdId);

    void createRef.current
      .mutateAsync({
        name: getDefaultCashName(locale),
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
        attemptedRef.current = null;
      })
      .finally(() => {
        clearCreatingDefaultCash(householdId);
      });
  }, [householdId, baseCurrency, locale, isLoading, hasUsableAccount, createPending, queryClient]);
}
