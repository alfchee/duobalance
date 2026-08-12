import type { EffectiveRate } from "@/hooks/useFxOverrides";
import { reorderAccounts, type AccountWithBalance } from "@/lib/accounts";
import {
  buildCurrencyBreakdown,
  filterByTab,
  groupBySection,
  sumBalances,
  type BalanceSectionId,
  type BalanceTab,
  type CurrencyLine,
  type RatesByCode,
} from "@/lib/balances";
import { displayBalance } from "@/lib/accounts";

export interface BalanceScreenModel {
  readonly baseRateDate: string | null;
  readonly breakdown: CurrencyLine[];
  readonly groupedAccounts: Record<BalanceSectionId, AccountWithBalance[]>;
  readonly netWorth: number | null;
  readonly sectionTotals: Readonly<Record<BalanceSectionId, number | null>>;
  readonly visibleAccounts: AccountWithBalance[];
  readonly visibleSectionIds: BalanceSectionId[];
}

const sectionIds: readonly BalanceSectionId[] = ["cash", "credit", "savings", "loans"];

export function createRatesByCode(rates: readonly EffectiveRate[]): RatesByCode {
  return new Map(rates.map((rate) => [rate.code, rate]));
}

export function createBalanceScreenModel({
  accounts,
  baseCurrency,
  memberId,
  ratesByCode,
  tab,
}: {
  accounts: AccountWithBalance[];
  baseCurrency: string | null;
  memberId: string | null;
  ratesByCode: RatesByCode;
  tab: BalanceTab;
}): BalanceScreenModel {
  const visibleAccounts = filterByTab(accounts, tab, memberId);
  const groupedAccounts = groupBySection(visibleAccounts);
  const sectionTotals = Object.fromEntries(
    sectionIds.map((section) => [
      section,
      baseCurrency
        ? sumBalances(groupedAccounts[section], baseCurrency, ratesByCode, displayBalance)
        : null,
    ]),
  ) as Record<BalanceSectionId, number | null>;

  return {
    breakdown: baseCurrency
      ? buildCurrencyBreakdown(accounts, baseCurrency, ratesByCode, displayBalance)
      : [],
    baseRateDate: baseCurrency ? (ratesByCode.get(baseCurrency)?.rateDate ?? null) : null,
    groupedAccounts,
    netWorth: baseCurrency
      ? sumBalances(accounts, baseCurrency, ratesByCode, displayBalance)
      : null,
    sectionTotals,
    visibleAccounts,
    visibleSectionIds: sectionIds.filter((section) => groupedAccounts[section].length > 0),
  };
}

export function prepareBalanceReorder({
  accounts,
  memberId,
  reorderedSection,
}: {
  accounts: AccountWithBalance[];
  memberId: string | null;
  reorderedSection: AccountWithBalance[];
}): AccountWithBalance[] | null {
  if (!memberId) return null;

  const reorderedIds = new Set(reorderedSection.map((account) => account.id));
  let nextIndex = 0;
  const reorderedAccounts = accounts.map((account) =>
    reorderedIds.has(account.id) ? (reorderedSection[nextIndex++] ?? account) : account,
  );
  const lockedIds = new Set(
    accounts
      .filter((account) => account.owner_member_id !== null && account.owner_member_id !== memberId)
      .map((account) => account.id),
  );

  return reorderAccounts(
    accounts,
    reorderedAccounts.filter((account) => !account.is_archived),
    { lockedIds },
  );
}
