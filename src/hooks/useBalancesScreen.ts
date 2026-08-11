"use client";

import { useEffect, useMemo } from "react";
import { useAccountMutations, useAccounts } from "@/hooks/useAccounts";
import { useFxOverrides } from "@/hooks/useFxOverrides";
import { useHousehold } from "@/hooks/useHousehold";
import {
  createBalanceScreenModel,
  createRatesByCode,
  prepareBalanceReorder,
} from "@/lib/balance-screen";
import type { AccountWithBalance } from "@/lib/accounts";
import { todayInHousehold } from "@/lib/dates";
import { useBalancesUiStore } from "@/store/balances";

export function useBalancesScreen() {
  const { baseCurrency, householdId, memberId, timezone } = useHousehold();
  const accountsQuery = useAccounts(householdId);
  const ratesQuery = useFxOverrides();
  const tab = useBalancesUiStore((state) => state.tab);
  const hydrate = useBalancesUiStore((state) => state.hydrate);
  const { reorder } = useAccountMutations(householdId);
  const now = useMemo(() => new Date(), []);
  const ratesByCode = useMemo(() => createRatesByCode(ratesQuery.data ?? []), [ratesQuery.data]);
  const model = useMemo(
    () =>
      createBalanceScreenModel({
        accounts: accountsQuery.data ?? [],
        baseCurrency,
        memberId,
        ratesByCode,
        tab,
      }),
    [accountsQuery.data, baseCurrency, memberId, ratesByCode, tab],
  );

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  function reorderSection(reorderedSection: AccountWithBalance[]) {
    const accounts = accountsQuery.data;
    if (!accounts) return;
    const ordered = prepareBalanceReorder({ accounts, memberId, reorderedSection });
    if (!ordered || !memberId) return;
    reorder.mutate({ accounts: ordered, memberId });
  }

  return {
    accounts: accountsQuery.data ?? [],
    baseCurrency,
    hasAccounts: (accountsQuery.data?.length ?? 0) > 0,
    isError: accountsQuery.isError || ratesQuery.isError,
    isLoading: accountsQuery.isLoading || ratesQuery.isLoading,
    model,
    now,
    reorderSection,
    retry: () => {
      void accountsQuery.refetch();
      void ratesQuery.refetch();
    },
    today: timezone ? todayInHousehold(timezone, now) : null,
  };
}
