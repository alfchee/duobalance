import { describe, expect, it } from "vitest";
import { formatDate, startOfMonthInHousehold, todayInHousehold } from "./dates";

// America/Managua is UTC-6 year-round (no DST since 2006). 03:00 UTC on
// 2026-07-05 is 21:00 on 2026-07-04 in Managua — a UTC-format date would be
// wrong by a day.
const MANAGUA_EVENING = new Date("2026-07-05T03:00:00Z");

describe("todayInHousehold", () => {
  it("returns the household-local date, not the UTC date", () => {
    expect(todayInHousehold("America/Managua", MANAGUA_EVENING)).toBe("2026-07-04");
  });

  it("returns YYYY-MM-DD for the same day across midnight", () => {
    expect(todayInHousehold("America/Managua", new Date("2026-07-04T12:00:00Z"))).toBe(
      "2026-07-04",
    );
  });

  it("handles timezones east of UTC", () => {
    // 20:00 UTC 2026-07-04 is 05:00 2026-07-05 in Tokyo (UTC+9).
    expect(todayInHousehold("Asia/Tokyo", new Date("2026-07-04T20:00:00Z"))).toBe("2026-07-05");
  });
});

describe("startOfMonthInHousehold", () => {
  it("returns the first day of the household-local month", () => {
    expect(startOfMonthInHousehold("America/Managua", MANAGUA_EVENING)).toBe("2026-07-01");
  });
});

describe("formatDate", () => {
  it("formats in the household timezone with the given locale", () => {
    expect(formatDate(MANAGUA_EVENING, "es", "America/Managua")).toBe("4 jul 2026");
  });
});
