import type { Account } from "@/lib/accounts";
import type { EffectiveRate } from "@/hooks/useFxOverrides";

// Issue #21: Balances screen helpers. Pure functions — no React, no Supabase.
// Components import these for tab filtering, kind grouping, multi-currency
// conversion to the household base, and freshness indicators.

export const BALANCE_TABS = ["mine", "all", "joint"] as const;
export type BalanceTab = (typeof BALANCE_TABS)[number];

// Section order is fixed by the issue: Cash & Checking → Credit Cards →
// Savings & Investments → Loans. Keeping the mapping centralised means the
// header, the section iteration, and the tests share one source of truth.
export const BALANCE_SECTIONS = [
  { id: "cash", kinds: ["cash", "checking"] },
  { id: "credit", kinds: ["credit_card"] },
  { id: "savings", kinds: ["savings", "investment"] },
  { id: "loans", kinds: ["loan"] },
] as const;

export type BalanceSectionId = (typeof BALANCE_SECTIONS)[number]["id"];

export function isBalanceTab(value: string): value is BalanceTab {
  return (BALANCE_TABS as readonly string[]).includes(value);
}

// Tab filter — non-archived only. Archived accounts are a management concern
// (#20), not a balances-screen concern, and the issue's layout spec doesn't
// list them.
export function filterByTab(
  accounts: Account[],
  tab: BalanceTab,
  currentMemberId: string | null,
): Account[] {
  const active = accounts.filter((a) => !a.is_archived);
  switch (tab) {
    case "mine":
      return active.filter((a) => a.owner_member_id === currentMemberId);
    case "joint":
      return active.filter((a) => a.owner_member_id === null);
    case "all":
      return active;
  }
}

// Group accounts by section id, preserving the section order. Sections with
// no accounts are still emitted so the iteration can decide whether to render
// them or collapse the section list (callers filter as they like).
export function groupBySection(accounts: Account[]): Record<BalanceSectionId, Account[]> {
  const out: Record<BalanceSectionId, Account[]> = {
    cash: [],
    credit: [],
    savings: [],
    loans: [],
  };
  for (const account of accounts) {
    const section = sectionForKind(account.kind);
    if (section) out[section].push(account);
  }
  return out;
}

function sectionForKind(kind: string): BalanceSectionId | null {
  for (const section of BALANCE_SECTIONS) {
    if ((section.kinds as readonly string[]).includes(kind)) return section.id;
  }
  return null;
}

// A "rates" lookup keyed by code. The base currency always resolves to 1 even
// when the feed has no row for it (the base's own row never exists per the
// fx_overrides_resolution comment in #18). Missing rows return null — the
// caller decides what to show.
export type RatesByCode = Map<string, EffectiveRate>;

// `1 CODE -> X BASE` for an account balance in `code`. Mirrors fx_rate_on:
// amount_in_base = amount_in_code * (usdRate_base / usdRate_code). Same-currency
// returns the amount unchanged.
export function convertToBase(
  amount: number,
  code: string,
  base: string,
  rates: RatesByCode,
): number | null {
  if (code === base) return amount;
  const from = rates.get(code);
  const to = rates.get(base);
  if (!from || !to) return null;
  return (amount * to.usdRate) / from.usdRate;
}

// Per-currency breakdown: one entry per non-base currency that appears in the
// list, with the rate used, the source, and the date. Used by the header
// popover so a user can see why a number is what it is.
export type CurrencyLine = {
  code: string;
  amount: number;
  baseAmount: number;
  usdRate: number;
  source: "override" | "feed";
  rateDate: string;
};

export function buildCurrencyBreakdown(
  accounts: Account[],
  base: string,
  rates: RatesByCode,
  accountBalanceValue: (account: Account) => number,
): CurrencyLine[] {
  const totals = new Map<string, number>();
  for (const account of accounts) {
    if (account.is_archived) continue;
    const balance = accountBalanceValue(account);
    if (account.currency === base) continue;
    totals.set(account.currency, (totals.get(account.currency) ?? 0) + balance);
  }
  const baseRate = rates.get(base);
  const lines: CurrencyLine[] = [];
  for (const [code, amount] of totals) {
    const rate = rates.get(code);
    if (!rate || !baseRate) continue;
    const baseAmount = (amount * baseRate.usdRate) / rate.usdRate;
    lines.push({
      code,
      amount,
      baseAmount,
      usdRate: rate.usdRate,
      source: rate.source,
      rateDate: rate.rateDate,
    });
  }
  return lines.sort((a, b) => a.code.localeCompare(b.code));
}

// Sum the display balances (debt kinds already negative) across the list.
// Debt is preserved by the caller passing `displayBalance` as
// `accountBalanceValue`; the net worth is the sum of those.
export function sumBalances(
  accounts: Account[],
  base: string,
  rates: RatesByCode,
  accountBalanceValue: (account: Account) => number,
): number | null {
  let total = 0;
  let allResolved = true;
  for (const account of accounts) {
    if (account.is_archived) continue;
    const balance = accountBalanceValue(account);
    const baseAmount = convertToBase(balance, account.currency, base, rates);
    if (baseAmount == null) {
      allResolved = false;
      continue;
    }
    total += baseAmount;
  }
  return allResolved ? total : null;
}

// The 14-day threshold for the "stale manual" affordance. Issue spec.
export const STALE_BALANCE_DAYS = 14;

// A manual-mode account is stale when its last update is older than
// STALE_BALANCE_DAYS days. Ledger accounts aren't flagged — every transaction
// refreshes them implicitly once #26 lands.
export function isStaleBalance(
  account: Account,
  now: Date,
  staleDays: number = STALE_BALANCE_DAYS,
): boolean {
  if (account.balance_mode !== "manual") return false;
  if (!account.balance_updated_at) return true;
  const ageMs = now.getTime() - new Date(account.balance_updated_at).getTime();
  if (ageMs < 0) return false;
  return ageMs > staleDays * 86_400_000;
}

// Relative-time formatter for the "Updated Nd ago" line. Mirrors the spec
// examples: hours when <1 day, days otherwise. Intl.RelativeTimeFormat picks
// the right unit for the locale (es "hace 3 d" / en "3 days ago" patterns
// are produced by the same `numeric: 'auto'` setting).
//
// `balance_updated_at === null` means the balance has never been refreshed
// (manual accounts right after creation, or ledger accounts whose field is
// simply NULL). The issue explicitly forbids implying that a value is
// authoritative when we don't know, so this case returns a caller-visible
// `never: true` flag — the caller (BalancesRow) can then render a distinct
// translated string instead of saying "Updated today" which would mislead.
export function formatUpdatedAgo(
  iso: string | null,
  now: Date,
  locale: string,
): { text: string; days: number | null; never: boolean } {
  if (!iso) return { text: "", days: null, never: true };
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return { text: "", days: 0, never: true };
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 1) {
    return {
      text: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day"),
      days,
      never: false,
    };
  }
  const hours = Math.max(0, Math.floor(diffMs / 3_600_000));
  return {
    text: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-hours, "hour"),
    days: 0,
    never: false,
  };
}
