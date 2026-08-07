import { describe, expect, it } from "vitest";
import {
  buildCurrencyBreakdown,
  convertToBase,
  filterByTab,
  formatUpdatedAgo,
  groupBySection,
  isStaleBalance,
  sumBalances,
  type RatesByCode,
} from "./balances";
import { displayBalance, type Account } from "./accounts";
import type { EffectiveRate } from "@/hooks/useFxOverrides";

function account(overrides: Partial<Account>): Account {
  return {
    id: "a1",
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
        account({ id: "c", currency: "CLP", opening_balance: 1000 }),
        account({ id: "n", currency: "NIO", opening_balance: 36 }), // -> 1 USD -> 900 CLP
        account({ id: "d", kind: "credit_card", currency: "USD", opening_balance: 0.5 }), // -0.5 USD -> -450 CLP
      ],
      "CLP",
      r,
      displayBalance,
    );
    // 1000 + 900 + (-0.5*900) = 1450
    expect(total).toBeCloseTo(1450, 6);
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

  it("returns a 'today' phrasing for a null timestamp", () => {
    const { text, days } = formatUpdatedAgo(null, NOW, "en");
    expect(days).toBeNull();
    expect(text).toBe("today");
  });

  it("returns the day count for multi-day ages", () => {
    const { text, days } = formatUpdatedAgo("2026-08-04T12:00:00Z", NOW, "en");
    expect(days).toBe(3);
    expect(text).toBe("3 days ago");
  });

  it("returns the hour count for sub-day ages", () => {
    const { text, days } = formatUpdatedAgo("2026-08-07T09:00:00Z", NOW, "en");
    expect(days).toBe(0);
    expect(text).toBe("3 hours ago");
  });

  it("uses the active locale", () => {
    const { text } = formatUpdatedAgo("2026-08-04T12:00:00Z", NOW, "es");
    expect(text).toBe("hace 3 días");
  });
});
