import { describe, expect, it } from "vitest";
import {
  buildCurrencyBreakdown,
  convertToBase,
  filterByTab,
  formatUpdatedAgo,
  groupBySection,
  isBalanceTab,
  isStaleBalance,
  sumBalances,
  type RatesByCode,
} from "./balances";
import { displayBalance, type AccountWithBalance } from "./accounts";
import type { EffectiveRate } from "@/hooks/useFxOverrides";

function account(overrides: Partial<AccountWithBalance>): AccountWithBalance {
  return {
    id: "a1",
    account_id: "a1",
    household_id: "h1",
    name: "Checking",
    kind: "checking",
    currency: "CLP",
    balance_mode: "ledger",
    opening_balance: 0,
    manual_balance: null,
    credit_limit: null,
    institution: null,
    is_shared: true,
    owner_member_id: null,
    is_archived: false,
    display_order: 0,
    balance_updated_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    balance: 0,
    last_transaction_at: null,
    ...overrides,
  };
}

function rate(code: string, usdRate: number, partial: Partial<EffectiveRate> = {}): EffectiveRate {
  return {
    code,
    usdRate,
    source: "feed",
    rateDate: "2026-08-01",
    note: null,
    ...partial,
  };
}

function rates(entries: Array<[string, number]>): RatesByCode {
  return new Map(entries.map(([code, usdRate]) => [code, rate(code, usdRate)]));
}

describe("filterByTab", () => {
  const mine = account({ id: "m", owner_member_id: "u1" });
  const partner = account({ id: "p", owner_member_id: "u2" });
  const joint = account({ id: "j", owner_member_id: null });
  const archived = account({ id: "x", owner_member_id: "u1", is_archived: true });
  const all = [mine, partner, joint, archived];

  it("Mine shows only accounts the current member owns (and not the partner's)", () => {
    expect(filterByTab(all, "mine", "u1").map((a) => a.id)).toEqual(["m"]);
  });

  it("Mine is empty for a member with no accounts", () => {
    expect(filterByTab(all, "mine", "u9")).toEqual([]);
  });

  it("Mine is empty before the active member resolves", () => {
    expect(filterByTab(all, "mine", null)).toEqual([]);
  });

  it("Joint shows only accounts with a null owner", () => {
    expect(filterByTab(all, "joint", "u1").map((a) => a.id)).toEqual(["j"]);
  });

  it("All shows every active account regardless of owner", () => {
    expect(filterByTab(all, "all", "u1").map((a) => a.id)).toEqual(["m", "p", "j"]);
  });

  it("All, Mine, and Joint never include archived accounts", () => {
    for (const tab of ["mine", "joint", "all"] as const) {
      expect(filterByTab(all, tab, "u1").some((a) => a.is_archived)).toBe(false);
    }
  });
});

describe("isBalanceTab", () => {
  it("accepts the three canonical values", () => {
    expect(isBalanceTab("mine")).toBe(true);
    expect(isBalanceTab("all")).toBe(true);
    expect(isBalanceTab("joint")).toBe(true);
  });

  it("rejects case variants, whitespace, typos and empty input", () => {
    expect(isBalanceTab("")).toBe(false);
    expect(isBalanceTab("MINE")).toBe(false);
    expect(isBalanceTab("mine ")).toBe(false);
    expect(isBalanceTab("All")).toBe(false);
    expect(isBalanceTab("mines")).toBe(false);
    expect(isBalanceTab("individual")).toBe(false);
    expect(isBalanceTab("shared")).toBe(false);
  });
});

describe("groupBySection", () => {
  it("groups kinds into the four sections in the issue's order", () => {
    const result = groupBySection([
      account({ id: "c1", kind: "cash" }),
      account({ id: "c2", kind: "checking" }),
      account({ id: "cc", kind: "credit_card" }),
      account({ id: "s1", kind: "savings" }),
      account({ id: "i1", kind: "investment" }),
      account({ id: "l1", kind: "loan" }),
    ]);
    expect(result.cash.map((a) => a.id)).toEqual(["c1", "c2"]);
    expect(result.credit.map((a) => a.id)).toEqual(["cc"]);
    expect(result.savings.map((a) => a.id)).toEqual(["s1", "i1"]);
    expect(result.loans.map((a) => a.id)).toEqual(["l1"]);
  });

  it("ignores unknown kinds rather than throwing", () => {
    const result = groupBySection([account({ id: "x", kind: "crypto" })]);
    expect(result.cash).toEqual([]);
    expect(result.loans).toEqual([]);
  });
});

describe("convertToBase", () => {
  // 1 USD = 36 NIO, 1 USD = 900 CLP — NIO -> CLP = 900/36 ≈ 25
  const r = rates([
    ["USD", 1],
    ["NIO", 36],
    ["CLP", 900],
  ]);
  // Matches the real feed — no USD row (fx_rates never writes USD, since USD is
  // the implicit base). resolveRate() in balances.ts must synthesise it.
  const noUsdRow = rates([
    ["NIO", 36],
    ["CLP", 900],
  ]);

  it("returns the amount unchanged when the account is in the base currency", () => {
    expect(convertToBase(1234, "CLP", "CLP", r)).toBe(1234);
  });

  it("uses the cross-rate (usdRate_base / usdRate_code) for a foreign currency", () => {
    // 36 NIO -> 36/36 USD -> 0.04 USD; USD base = 0.04
    expect(convertToBase(36, "NIO", "USD", r)).toBeCloseTo(1, 10);
    // 900 CLP -> 1 USD; in CLP base = 900
    expect(convertToBase(1, "USD", "CLP", r)).toBeCloseTo(900, 10);
    // 36 NIO -> 1 USD -> 900 CLP
    expect(convertToBase(36, "NIO", "CLP", r)).toBeCloseTo(900, 10);
  });

  it("synthesises USD=1 implicitly when the feed has no USD row (USD base household)", () => {
    // USD is the base and is missing from the rates map; NIO -> USD cross-rate
    // should still compute because resolveRate injects USD.
    expect(convertToBase(36, "NIO", "USD", noUsdRow)).toBeCloseTo(1, 10);
    expect(convertToBase(72, "NIO", "USD", noUsdRow)).toBeCloseTo(2, 10);
  });

  it("synthesises USD=1 implicitly when the feed has no USD row (USD-denominated account)", () => {
    // USD is the *account* code and is missing from rates map; USD -> CLP should
    // resolve to the USD feed rate for CLP (i.e. 1 USD = 900 CLP).
    expect(convertToBase(1, "USD", "CLP", noUsdRow)).toBeCloseTo(900, 10);
    expect(convertToBase(2.5, "USD", "CLP", noUsdRow)).toBeCloseTo(2250, 10);
  });

  it("synthesises USD=1 implicitly for a three-way cross through USD with no USD row", () => {
    // NIO -> CLP goes NIO -> USD -> CLP; neither leg is the code/base but USD
    // still has to resolve to 1 internally. Without the synthetic row this would
    // be null.
    expect(convertToBase(36, "NIO", "CLP", noUsdRow)).toBeCloseTo(900, 10);
  });

  it("returns null when either leg has no rate (a missing override/feed row)", () => {
    const partial = rates([["USD", 1]]);
    expect(convertToBase(100, "NIO", "USD", partial)).toBeNull();
  });
});

describe("buildCurrencyBreakdown", () => {
  it("lists only the non-base currencies present, with each rate's source/date", () => {
    const r = rates([
      ["CLP", 900],
      ["NIO", 36],
    ]);
    const breakdown = buildCurrencyBreakdown(
      [
        account({ id: "c", kind: "checking", currency: "CLP", opening_balance: 5000 }),
        account({ id: "n", kind: "cash", currency: "NIO", opening_balance: 1000 }),
        account({ id: "n2", kind: "cash", currency: "NIO", opening_balance: 2000 }),
      ],
      "CLP",
      r,
      (a) => a.opening_balance,
    );
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toMatchObject({
      code: "NIO",
      amount: 3000,
      source: "feed",
      rateDate: "2026-08-01",
      usdRate: 36,
    });
    // 3000 NIO -> 3000/36 USD = 83.33 USD; 83.33 * 900 CLP/USD = 75,000 CLP
    expect(breakdown[0]?.baseAmount).toBeCloseTo(75_000, 6);
  });

  it("omits the base currency itself", () => {
    const r = rates([
      ["CLP", 900],
      ["NIO", 36],
    ]);
    const breakdown = buildCurrencyBreakdown(
      [account({ id: "c", currency: "CLP", opening_balance: 5000 })],
      "CLP",
      r,
      (a) => a.opening_balance,
    );
    expect(breakdown).toEqual([]);
  });

  it("skips a currency that has no rate (the header popover shows only what's resolvable)", () => {
    const r = rates([["CLP", 900]]);
    const breakdown = buildCurrencyBreakdown(
      [account({ id: "n", currency: "NIO", opening_balance: 1000 })],
      "CLP",
      r,
      (a) => a.opening_balance,
    );
    expect(breakdown).toEqual([]);
  });

  it("resolves a USD-denominated line in the breakdown even when the feed has no USD row", () => {
    // Non-USD base (CLP = 900/USD), and we hold a USD account. Since buildCurrencyBreakdown
    // now routes through convertToBase + resolveRate, the USD rate should be synthesised.
    const noUsdRow = rates([["CLP", 900]]);
    const breakdown = buildCurrencyBreakdown(
      [account({ id: "u", kind: "checking", currency: "USD", opening_balance: 2.5 })],
      "CLP",
      noUsdRow,
      (a) => a.opening_balance,
    );
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toMatchObject({
      code: "USD",
      amount: 2.5,
      usdRate: 1,
      source: "feed",
    });
    // 2.5 USD → 2250 CLP
    expect(breakdown[0]?.baseAmount).toBeCloseTo(2250, 6);
  });
});

describe("sumBalances", () => {
  it("sums same-currency balances directly", () => {
    const r = rates([["CLP", 900]]);
    const total = sumBalances(
      [
        account({ id: "a", currency: "CLP", opening_balance: 1000 }),
        account({ id: "b", currency: "CLP", opening_balance: -250 }),
      ],
      "CLP",
      r,
      (a) => a.opening_balance,
    );
    expect(total).toBe(750);
  });

  it("converts across currencies and includes debt as negative", () => {
    const r = rates([
      ["CLP", 900],
      ["NIO", 36],
      ["USD", 1],
    ]);
    const total = sumBalances(
      [
        account({ id: "c", currency: "CLP", balance: 1000 }),
        account({ id: "n", currency: "NIO", balance: 36 }), // -> 1 USD -> 900 CLP
        account({ id: "d", kind: "credit_card", currency: "USD", balance: 0.5 }), // -0.5 USD -> -450 CLP
      ],
      "CLP",
      r,
      displayBalance,
    );
    // 1000 + 900 + (-0.5*900) = 1450
    expect(total).toBeCloseTo(1450, 6);
  });

  it("resolves a USD base household with foreign accounts when the feed has no USD row", () => {
    const noUsdRow = rates([["NIO", 36]]);
    const total = sumBalances(
      [
        account({ id: "u", currency: "USD", opening_balance: 10 }), // identity
        account({ id: "n", currency: "NIO", opening_balance: 360 }), // 360 NIO = 10 USD
      ],
      "USD",
      noUsdRow,
      (a) => a.opening_balance,
    );
    expect(total).toBeCloseTo(20, 6);
  });

  it("resolves USD-denominated accounts in a non-USD base when feed has no USD row", () => {
    const noUsdRow = rates([["CLP", 900]]);
    const total = sumBalances(
      [
        account({ id: "u", currency: "USD", opening_balance: 2 }), // 2 USD = 1800 CLP
        account({ id: "c", currency: "CLP", opening_balance: 9000 }),
      ],
      "CLP",
      noUsdRow,
      (a) => a.opening_balance,
    );
    expect(total).toBeCloseTo(10_800, 6);
  });

  it("returns null when at least one currency has no rate", () => {
    const r = rates([["CLP", 900]]);
    const total = sumBalances(
      [
        account({ id: "a", currency: "CLP", opening_balance: 1000 }),
        account({ id: "n", currency: "NIO", opening_balance: 100 }),
      ],
      "CLP",
      r,
      (a) => a.opening_balance,
    );
    expect(total).toBeNull();
  });
});

describe("isStaleBalance", () => {
  const NOW = new Date("2026-08-07T12:00:00Z");
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

  it("is never stale for ledger accounts", () => {
    const acct = account({ balance_mode: "ledger", balance_updated_at: null });
    expect(isStaleBalance(acct, NOW)).toBe(false);
  });

  it("is stale when a manual account has never been updated", () => {
    const acct = account({ balance_mode: "manual", manual_balance: 100, balance_updated_at: null });
    expect(isStaleBalance(acct, NOW)).toBe(true);
  });

  it("is stale when a manual account was updated > 14 days ago", () => {
    const acct = account({
      balance_mode: "manual",
      manual_balance: 100,
      balance_updated_at: "2026-07-20T12:00:00Z", // 18 days before NOW
    });
    expect(isStaleBalance(acct, NOW)).toBe(true);
  });

  it("marks exactly-14d-old manual data as fresh (boundary)", () => {
    const exactlyFourteen = new Date(NOW.getTime() - FOURTEEN_DAYS_MS).toISOString();
    const acct = account({
      balance_mode: "manual",
      manual_balance: 100,
      balance_updated_at: exactlyFourteen,
    });
    expect(isStaleBalance(acct, NOW)).toBe(false);
  });

  it("marks 14d + 1ms old manual data as stale (boundary)", () => {
    const staleByOne = new Date(NOW.getTime() - FOURTEEN_DAYS_MS - 1).toISOString();
    const acct = account({
      balance_mode: "manual",
      manual_balance: 100,
      balance_updated_at: staleByOne,
    });
    expect(isStaleBalance(acct, NOW)).toBe(true);
  });

  it("is fresh when a manual account was updated recently", () => {
    const acct = account({
      balance_mode: "manual",
      manual_balance: 100,
      balance_updated_at: "2026-08-05T12:00:00Z", // 2 days before NOW
    });
    expect(isStaleBalance(acct, NOW)).toBe(false);
  });
});

describe("formatUpdatedAgo", () => {
  const NOW = new Date("2026-08-07T12:00:00Z");

  it("flags never=true and returns empty text for a null timestamp", () => {
    const freshness = formatUpdatedAgo(null, NOW, "en");
    expect(freshness.never).toBe(true);
    expect(freshness.days).toBeNull();
    expect(freshness.text).toBe("");
  });

  it("returns the day count for multi-day ages", () => {
    const { text, days, never } = formatUpdatedAgo("2026-08-04T12:00:00Z", NOW, "en");
    expect(days).toBe(3);
    expect(text).toBe("3 days ago");
    expect(never).toBe(false);
  });

  it("returns the hour count for sub-day ages", () => {
    const { text, days, never } = formatUpdatedAgo("2026-08-07T09:00:00Z", NOW, "en");
    expect(days).toBe(0);
    expect(text).toBe("3 hours ago");
    expect(never).toBe(false);
  });

  it("uses the active locale", () => {
    const { text } = formatUpdatedAgo("2026-08-04T12:00:00Z", NOW, "es");
    expect(text).toBe("hace 3 días");
  });
});
