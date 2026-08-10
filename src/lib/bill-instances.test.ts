import { describe, expect, it } from "vitest";
import { computeDueDates } from "./bill-instances";

describe("computeDueDates", () => {
  it("returns monthly dates within the given bounds", () => {
    const result = computeDueDates(
      "FREQ=MONTHLY;BYMONTHDAY=15",
      new Date("2026-01-15"),
      null,
      new Date("2026-02-16"),
      new Date("2026-06-15"),
    );

    expect(result).toHaveLength(4);
    expect(result[0]!.toISOString().slice(0, 10)).toBe("2026-03-15");
    expect(result[1]!.toISOString().slice(0, 10)).toBe("2026-04-15");
    expect(result[2]!.toISOString().slice(0, 10)).toBe("2026-05-15");
    expect(result[3]!.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("respects ends_on", () => {
    const result = computeDueDates(
      "FREQ=MONTHLY;BYMONTHDAY=1",
      new Date("2026-01-01"),
      new Date("2026-03-31"),
      new Date("2026-01-01"),
      new Date("2026-12-31"),
    );

    expect(result).toHaveLength(3);
    expect(result[0]!.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(result[1]!.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(result[2]!.toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("skips dates before starts_on", () => {
    const result = computeDueDates(
      "FREQ=MONTHLY;BYMONTHDAY=10",
      new Date("2026-06-01"),
      null,
      new Date("2026-01-01"),
      new Date("2026-12-31"),
    );

    for (const d of result) {
      expect(d.getTime()).toBeGreaterThanOrEqual(new Date("2026-06-01").getTime());
    }
  });

  it("handles weekly recurrence", () => {
    const result = computeDueDates(
      "FREQ=WEEKLY;BYDAY=MO",
      new Date("2026-01-05"),
      null,
      new Date("2026-01-06"),
      new Date("2026-01-26"),
    );

    // Mondays: Jan 12, Jan 19, Jan 26
    expect(result).toHaveLength(3);
    expect(result[0]!.toISOString().slice(0, 10)).toBe("2026-01-12");
    expect(result[1]!.toISOString().slice(0, 10)).toBe("2026-01-19");
    expect(result[2]!.toISOString().slice(0, 10)).toBe("2026-01-26");
  });

  it("handles biweekly recurrence", () => {
    const result = computeDueDates(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
      new Date("2026-01-02"),
      null,
      new Date("2026-01-03"),
      new Date("2026-02-13"),
    );

    expect(result).toHaveLength(3);
    expect(result[0]!.toISOString().slice(0, 10)).toBe("2026-01-16");
    expect(result[1]!.toISOString().slice(0, 10)).toBe("2026-01-30");
    expect(result[2]!.toISOString().slice(0, 10)).toBe("2026-02-13");
  });

  it("handles yearly recurrence", () => {
    const result = computeDueDates(
      "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25",
      new Date("2025-12-25"),
      null,
      new Date("2025-12-26"),
      new Date("2027-12-31"),
    );

    expect(result).toHaveLength(2);
    expect(result[0]!.toISOString().slice(0, 10)).toBe("2026-12-25");
    expect(result[1]!.toISOString().slice(0, 10)).toBe("2027-12-25");
  });

  it("returns empty array when horizon is empty", () => {
    const result = computeDueDates(
      "FREQ=MONTHLY;BYMONTHDAY=1",
      new Date("2026-01-01"),
      new Date("2026-01-01"),
      new Date("2026-01-02"),
      new Date("2026-01-02"),
    );

    // The only occurrence (Jan 1) is before horizon_start, so none match
    expect(result).toHaveLength(0);
  });

  it("returns empty when no dates fall in range", () => {
    const result = computeDueDates(
      "FREQ=MONTHLY;BYMONTHDAY=1",
      new Date("2026-01-01"),
      new Date("2026-01-15"),
      new Date("2026-02-01"),
      new Date("2026-12-31"),
    );

    expect(result).toHaveLength(0);
  });

  it("throws on invalid RRULE", () => {
    expect(() =>
      computeDueDates(
        "INVALID;RULE",
        new Date("2026-01-01"),
        null,
        new Date("2026-01-01"),
        new Date("2026-12-31"),
      ),
    ).toThrow("invalid RRULE");
  });
});
