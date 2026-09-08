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
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    return { year: value("year"), month: value("month"), day: value("day") };
  } catch {
    // Invalid timezone (RangeError) — fallback to UTC to avoid crashing the
    // subtree. Callers treat null dates as hidden, so UTC fallback is safe.
    const iso = date.toISOString().slice(0, 10);
    const [year, month, day] = iso.split("-");
    return { year: year ?? "", month: month ?? "", day: day ?? "" };
  }
}

export function dateInHousehold(timezone: string, date: Date): string {
  const { year, month, day } = ymdPartsInTimezone(date, timezone);
  return `${year}-${month}-${day}`;
}

export function todayInHousehold(timezone: string, now: Date = new Date()): string {
  return dateInHousehold(timezone, now);
}

export function addDays(ymd: string, days: number): string {
  const value = new Date(`${ymd}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function diffDays(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(`${end}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function diffDaysInclusive(start: string, end: string): number {
  return diffDays(start, end) + 1;
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
