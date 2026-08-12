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

  it("clamps a day-31 monthly bill to the last day of shorter months instead of skipping them", () => {
    const draft = {
      ...createDefaultBillDraft("2026-01-31", "USD"),
      recurrence: "monthly-day" as const,
    };
    expect(serializeBillRecurrence(draft)).toBe("FREQ=MONTHLY;BYMONTHDAY=31,-1;BYSETPOS=1");
    const dates = previewBillRecurrence({ ...draft, endsOn: "2026-06-30" }, 20).dates;
    expect(dates).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
  });

  it("clamps a day-29 monthly-interval bill for February while keeping day 29 elsewhere", () => {
    const draft = {
      ...createDefaultBillDraft("2026-01-29", "USD"),
      recurrence: "monthly-interval" as const,
      interval: "1",
    };
    expect(serializeBillRecurrence(draft)).toBe(
      "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=29,30,31,-1;BYSETPOS=1",
    );
    const dates = previewBillRecurrence({ ...draft, endsOn: "2026-03-29" }, 20).dates;
    expect(dates).toEqual(["2026-01-29", "2026-02-28", "2026-03-29"]);
  });
});
