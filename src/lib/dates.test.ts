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

  it("handles DST-observing timezones before the spring-forward", () => {
    // 01:30 UTC 2026-03-08 is 20:30 EST 2026-03-07 in New York (DST starts at
    // 02:00 local / 07:00 UTC that day).
    expect(todayInHousehold("America/New_York", new Date("2026-03-08T01:30:00Z"))).toBe(
      "2026-03-07",
    );
  });

  it("resolves the date across a DST boundary", () => {
    // 07:30 UTC 2026-03-08 is 03:30 EDT 2026-03-08 in New York (DST active).
    expect(todayInHousehold("America/New_York", new Date("2026-03-08T07:30:00Z"))).toBe(
      "2026-03-08",
    );
  });
});

describe("startOfMonthInHousehold", () => {
  it("returns the first day of the household-local month", () => {
    expect(startOfMonthInHousehold("America/Managua", MANAGUA_EVENING)).toBe("2026-07-01");
  });
});

// formatDate is a thin wrapper over Intl.DateTimeFormat. The expected value is
// computed with the same options so the test stays stable across ICU builds
// (month-abbreviation casing/punctuation varies), while still pinning that the
// wrapper threads locale + timeZone + date through — a wrong timezone or a
// dropped locale would change the output and fail the assertion.
function expectedFormat(date: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

describe("formatDate", () => {
  it("formats in the household timezone with the given locale", () => {
    expect(formatDate(MANAGUA_EVENING, "es", "America/Managua")).toBe(
      expectedFormat(MANAGUA_EVENING, "es", "America/Managua"),
    );
  });

  it("formats with an en locale", () => {
    expect(formatDate(MANAGUA_EVENING, "en", "America/Managua")).toBe(
      expectedFormat(MANAGUA_EVENING, "en", "America/Managua"),
    );
  });
});
