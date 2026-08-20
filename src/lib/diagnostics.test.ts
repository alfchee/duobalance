import { describe, expect, it } from "vitest";
import {
  assertNoFinancialData,
  collectDiagnosticContext,
  type DiagnosticContext,
} from "./diagnostics";

describe("diagnostics", () => {
  it("collects diagnostic context without financial data", () => {
    const diag = collectDiagnosticContext({
      householdId: "hh-123",
      memberId: "mem-456",
      role: "owner",
      locale: "es",
      numberFormat: "1.234,56",
      baseCurrency: "CLP",
      timezone: "America/Santiago",
      accountCount: 3,
      transactionCount: 42,
      queuedWrites: 0,
      lastError: {
        message: "Network timeout",
        stack: "Error: Network timeout at ...",
        at: "2026-08-19T10:00:00Z",
      },
      currentRoute: "/balances",
    });

    expect(diag.householdId).toBe("hh-123");
    expect(diag.memberId).toBe("mem-456");
    expect(diag.role).toBe("owner");
    expect(diag.locale).toBe("es");
    expect(diag.numberFormat).toBe("1.234,56");
    expect(diag.baseCurrency).toBe("CLP");
    expect(diag.accountCount).toBe(3);
    expect(diag.transactionCount).toBe(42);
    expect(diag.lastError?.message).toBe("Network timeout");
    expect(diag.currentRoute).toBe("/balances");

    // Must pass financial check
    expect(() => assertNoFinancialData(diag as unknown as Record<string, unknown>)).not.toThrow();
  });

  it("throws an error if payload accidentally contains financial data fields", () => {
    const dirtyPayload = {
      appVersion: "1.1.0",
      householdId: "hh-123",
      accountCount: 2,
      amount: 15000, // forbidden!
      description: "Supermarket purchase", // forbidden!
    };

    expect(() => assertNoFinancialData(dirtyPayload as unknown as Record<string, unknown>)).toThrow(
      /must not contain financial key/,
    );
  });

  it("throws an error if nested payload contains account names or balances", () => {
    const dirtyPayload = {
      appVersion: "1.1.0",
      details: {
        accountName: "Checking Account", // forbidden!
        balance: 500.25, // forbidden!
      },
    };

    expect(() => assertNoFinancialData(dirtyPayload as unknown as Record<string, unknown>)).toThrow(
      /must not contain financial key/,
    );
  });

  it("ensures DiagnosticContext structure only has required fields and identifiers/counts", () => {
    const diag = collectDiagnosticContext({});
    const keys = Object.keys(diag) as Array<keyof DiagnosticContext>;

    const allowedKeys: Array<keyof DiagnosticContext> = [
      "appVersion",
      "householdId",
      "memberId",
      "role",
      "locale",
      "numberFormat",
      "baseCurrency",
      "timezone",
      "accountCount",
      "transactionCount",
      "isStandalone",
      "isOnline",
      "queuedWrites",
      "userAgent",
      "lastError",
      "currentRoute",
    ];

    for (const key of keys) {
      expect(allowedKeys).toContain(key);
    }

    // Explicitly verify accountCount and transactionCount are numbers
    expect(typeof diag.accountCount).toBe("number");
    expect(typeof diag.transactionCount).toBe("number");
  });
});
