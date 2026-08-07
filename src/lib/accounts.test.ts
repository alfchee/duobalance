import { describe, expect, it } from "vitest";
import {
  accountBalance,
  displayBalance,
  isAccountKind,
  isDebtKind,
  isPrivateNeedsOwnerError,
  nextDisplayOrder,
  reorderAccounts,
  type Account,
} from "./accounts";

function account(overrides: Partial<Account>): Account {
  return {
    id: "a1",
    household_id: "h1",
    name: "Checking",
    kind: "checking",
    currency: "CLP",
    balance_mode: "ledger",
    opening_balance: 1000,
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

describe("isAccountKind", () => {
  it("accepts every declared kind and rejects the rest", () => {
    for (const kind of ["cash", "checking", "savings", "credit_card", "loan", "investment"]) {
      expect(isAccountKind(kind)).toBe(true);
    }
    expect(isAccountKind("crypto")).toBe(false);
    expect(isAccountKind("")).toBe(false);
  });
});

describe("isDebtKind", () => {
  it("treats credit_card and loan as debt", () => {
    expect(isDebtKind("credit_card")).toBe(true);
    expect(isDebtKind("loan")).toBe(true);
    expect(isDebtKind("checking")).toBe(false);
    expect(isDebtKind("investment")).toBe(false);
  });
});

describe("accountBalance", () => {
  it("returns manual_balance for manual accounts", () => {
    expect(accountBalance(account({ balance_mode: "manual", manual_balance: 500 }))).toBe(500);
  });

  it("falls back to opening_balance when manual_balance is null", () => {
    expect(accountBalance(account({ balance_mode: "manual", manual_balance: null }))).toBe(0);
  });

  it("returns opening_balance for ledger accounts", () => {
    expect(accountBalance(account({ balance_mode: "ledger", opening_balance: 2500 }))).toBe(2500);
  });
});

describe("displayBalance", () => {
  it("renders debt kinds as a negative obligation", () => {
    expect(displayBalance(account({ kind: "credit_card", opening_balance: 300 }))).toBe(-300);
    expect(displayBalance(account({ kind: "loan", opening_balance: -50 }))).toBe(-50);
  });

  it("keeps asset kinds positive", () => {
    expect(displayBalance(account({ kind: "checking", opening_balance: 900 }))).toBe(900);
  });
});

describe("nextDisplayOrder", () => {
  it("is one past the current maximum display_order", () => {
    const list = [
      account({ id: "a", display_order: 1 }),
      account({ id: "b", display_order: null }),
      account({ id: "c", display_order: 4 }),
    ];
    expect(nextDisplayOrder(list)).toBe(5);
  });

  it("returns 0 for an empty list", () => {
    expect(nextDisplayOrder([])).toBe(0);
  });
});

describe("isPrivateNeedsOwnerError", () => {
  it("matches the accounts_private_needs_owner constraint violation", () => {
    const err = {
      code: "23514",
      message:
        'new row for relation "accounts" violates check constraint "accounts_private_needs_owner"',
    };
    expect(isPrivateNeedsOwnerError(err)).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isPrivateNeedsOwnerError({ code: "23514", message: "other constraint" })).toBe(false);
    expect(isPrivateNeedsOwnerError(new Error("boom"))).toBe(false);
    expect(isPrivateNeedsOwnerError(null)).toBe(false);
  });
});

describe("reorderAccounts", () => {
  const joint = account({ id: "a", display_order: 0 });
  const mine = account({ id: "b", owner_member_id: "m1", display_order: 1 });
  const archived = account({ id: "c", is_archived: true, display_order: 2 });

  it("applies the new visible order and renumbers all accounts", () => {
    const reordered = reorderAccounts([joint, mine, archived], [mine, joint]);
    expect(reordered.map((a) => a.id)).toEqual(["b", "a", "c"]);
    expect(reordered.map((a) => a.display_order)).toEqual([0, 1, 2]);
  });

  it("keeps archived accounts in their slots", () => {
    const reordered = reorderAccounts([archived, joint, mine], [joint, mine]);
    expect(reordered.map((a) => a.id)).toEqual(["c", "a", "b"]);
  });

  it("falls back to the original account when visible runs short", () => {
    const reordered = reorderAccounts([joint, mine], [mine]);
    expect(reordered.map((a) => a.id)).toEqual(["b", "a"]);
  });
});
