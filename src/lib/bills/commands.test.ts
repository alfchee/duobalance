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

  it("rejects a missing start date and constrains reminder days to the supported range", () => {
    const draft = { ...createDefaultBillDraft("2026-08-15", "USD"), name: "Internet" };
    expect(createBillWriteInput({ ...draft, startsOn: "" }, "en", 2)).toEqual({ ok: false });
    expect(createBillWriteInput({ ...draft, reminderDays: "-3" }, "en", 2)).toMatchObject({
      ok: true,
      value: { reminder_days_before: 0 },
    });
    expect(createBillWriteInput({ ...draft, reminderDays: "31" }, "en", 2)).toMatchObject({
      ok: true,
      value: { reminder_days_before: 30 },
    });
  });
});
