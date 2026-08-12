import { describe, expect, it } from "vitest";
import {
  createDefaultBillDraft,
  previewBillRecurrence,
  serializeBillRecurrence,
} from "./recurrence";

describe("bill recurrence", () => {
  it("serializes every-month recurrence using the draft start day", () => {
    const draft = {
      ...createDefaultBillDraft("2026-08-15", "USD"),
      recurrence: "monthly-day" as const,
    };
    expect(serializeBillRecurrence(draft)).toBe("FREQ=MONTHLY;BYMONTHDAY=15");
  });

  it("previews bounded weekly occurrences", () => {
    const draft = {
      ...createDefaultBillDraft("2026-08-03", "USD"),
      endsOn: "2026-08-31",
      recurrence: "weekly" as const,
    };
    expect(previewBillRecurrence(draft).dates).toEqual([
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
    ]);
  });

  it("serializes every supported recurrence option", () => {
    const draft = createDefaultBillDraft("2026-08-15", "USD");
    expect(serializeBillRecurrence({ ...draft, recurrence: "monthly-last" })).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=-1",
    );
    expect(
      serializeBillRecurrence({ ...draft, recurrence: "weekly", interval: "2", weekday: "FR" }),
    ).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR");
    expect(serializeBillRecurrence({ ...draft, recurrence: "yearly" })).toBe(
      "FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=15",
    );
    expect(
      serializeBillRecurrence({ ...draft, recurrence: "monthly-interval", interval: "3" }),
    ).toBe("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15");
  });

  it("uses a safe preview for an unset start date", () => {
    expect(
      previewBillRecurrence({ ...createDefaultBillDraft("2026-08-15", "USD"), startsOn: "" }),
    ).toEqual({
      dates: [],
      valid: true,
    });
  });
});
