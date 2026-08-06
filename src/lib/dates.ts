// Business dates are always computed in the household's timezone. Never call
// `new Date()` and format with the browser's local timezone — a household at
// 21:00 Managua time is not the same day as the server's UTC clock.

function ymdPartsInTimezone(
  date: Date,
  timezone: string,
): {
  year: string;
  month: string;
  day: string;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function todayInHousehold(timezone: string, now: Date = new Date()): string {
  const { year, month, day } = ymdPartsInTimezone(now, timezone);
  return `${year}-${month}-${day}`;
}

export function startOfMonthInHousehold(timezone: string, now: Date = new Date()): string {
  return `${todayInHousehold(timezone, now).slice(0, 8)}01`;
}

export function formatDate(date: Date, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
