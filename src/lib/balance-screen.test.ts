import { describe, expect, it } from "vitest";
import {
  createBalanceScreenModel,
  createRatesByCode,
  prepareBalanceReorder,
} from "./balance-screen";
import type { AccountWithBalance } from "./accounts";
import type { EffectiveRate } from "@/hooks/useFxOverrides";

function account(overrides: Partial<AccountWithBalance> = {}): AccountWithBalance {
  return {
    account_id: "a1",
    balance: 100,
    balance_mode: "ledger",
    balance_updated_at: null,
    created_at: "2026-01-01T00:00:00Z",
    credit_limit: null,
    currency: "USD",
    display_order: 0,
    household_id: "h1",
    id: "a1",
    institution: null,
    is_archived: false,
    is_shared: true,
    kind: "checking",
    last_transaction_at: null,
    manual_balance: null,
    name: "Checking",
    opening_balance: 100,
    owner_member_id: null,
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const rates: EffectiveRate[] = [
  { code: "CLP", note: null, rateDate: "2026-08-01", source: "feed", usdRate: 900 },
  { code: "NIO", note: null, rateDate: "2026-08-01", source: "override", usdRate: 36 },
];

describe("createRatesByCode", () => {
  it("maps each effective rate by currency code", () => {
    const result = createRatesByCode(rates);
    expect(result.get("CLP")?.usdRate).toBe(900);
    expect(result.get("NIO")?.source).toBe("override");
  });
});

describe("createBalanceScreenModel", () => {
  it("derives the visible groups, totals, currency breakdown, and rate date", () => {
    const result = createBalanceScreenModel({
      accounts: [
        account({ balance: 900, currency: "CLP", id: "mine", owner_member_id: "m1" }),
        account({ balance: 36, currency: "NIO", id: "joint" }),
        account({ balance: 50, currency: "USD", id: "partner", owner_member_id: "p1" }),
      ],
      baseCurrency: "CLP",
      memberId: "m1",
      ratesByCode: createRatesByCode(rates),
      tab: "all",
    });

    expect(result.visibleSectionIds).toEqual(["cash"]);
    expect(result.sectionTotals.cash).toBeCloseTo(46_800);
    expect(result.netWorth).toBeCloseTo(46_800);
    expect(result.breakdown.map((line) => line.code)).toEqual(["NIO", "USD"]);
    expect(result.baseRateDate).toBe("2026-08-01");
  });

  it("honours the selected ownership tab and missing base currency", () => {
    const result = createBalanceScreenModel({
      accounts: [account({ id: "mine", owner_member_id: "m1" }), account({ id: "joint" })],
      baseCurrency: null,
      memberId: "m1",
      ratesByCode: new Map(),
      tab: "mine",
    });

    expect(result.visibleAccounts.map((item) => item.id)).toEqual(["mine"]);
    expect(result.netWorth).toBeNull();
    expect(result.breakdown).toEqual([]);
    expect(result.baseRateDate).toBeNull();
  });

  it("keeps the base-rate date empty when the base uses an implicit or unavailable rate", () => {
    const result = createBalanceScreenModel({
      accounts: [account()],
      baseCurrency: "USD",
      memberId: "m1",
      ratesByCode: new Map(),
      tab: "all",
    });

    expect(result.baseRateDate).toBeNull();
    expect(result.netWorth).toBe(100);
  });
});

describe("prepareBalanceReorder", () => {
  it("does not reorder without an active member", () => {
    const accounts = [account({ id: "a" })];
    expect(
      prepareBalanceReorder({ accounts, memberId: null, reorderedSection: accounts }),
    ).toBeNull();
  });

  it("keeps partner-owned accounts locked while reordering editable accounts", () => {
    const accounts = [
      account({ display_order: 0, id: "a" }),
      account({ display_order: 1, id: "partner", owner_member_id: "p1" }),
      account({ display_order: 2, id: "b" }),
    ];
    const result = prepareBalanceReorder({
      accounts,
      memberId: "m1",
      reorderedSection: [accounts[2]!, accounts[1]!, accounts[0]!],
    });

    expect(result?.map((item) => item.id)).toEqual(["b", "partner", "a"]);
    expect(result?.find((item) => item.id === "partner")?.display_order).toBe(1);
  });

  it("preserves an account when the reordered section omits it", () => {
    const accounts = [account({ id: "a" }), account({ display_order: 1, id: "b" })];
    const result = prepareBalanceReorder({
      accounts,
      memberId: "m1",
      reorderedSection: [accounts[1]!],
    });

    expect(result?.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("keeps an archived account in place without duplicating or dropping visible rows", () => {
    const accounts = [
      account({ display_order: 0, id: "a" }),
      account({ display_order: 1, id: "archived", is_archived: true }),
      account({ display_order: 2, id: "c" }),
      account({ display_order: 3, id: "d" }),
    ];
    const result = prepareBalanceReorder({
      accounts,
      memberId: "m1",
      // drag "d" above "c" within the visible (non-archived) list
      reorderedSection: [accounts[0]!, accounts[3]!, accounts[2]!],
    });

    expect(result?.map((item) => item.id)).toEqual(["a", "archived", "d", "c"]);
    expect(new Set(result?.map((item) => item.id)).size).toBe(accounts.length);
    expect(result?.find((item) => item.id === "archived")).toEqual(accounts[1]);
  });
});
