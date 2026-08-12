import { describe, expect, it } from "vitest";
import { createBillWriteInput, parseBillAmount } from "./commands";
import { createDefaultBillDraft } from "./recurrence";

describe("bill commands", () => {
  it("normalizes optional fields and rounds the entered amount", () => {
    const draft = {
      ...createDefaultBillDraft("2026-08-15", "USD"),
      amount: "12.345",
      name: "Internet",
    };
    expect(createBillWriteInput(draft, "en", 2)).toMatchObject({
      ok: true,
      value: { account_id: null, category_id: null, default_amount: 12.35, name: "Internet" },
    });
  });

  it("rejects missing names and invalid money", () => {
    expect(createBillWriteInput(createDefaultBillDraft("2026-08-15", "USD"), "en", 2)).toEqual({
      ok: false,
    });
    expect(parseBillAmount("not-money", "en", 2)).toBeNull();
  });
});
