export type DatePreset = "this_month" | "3m" | "6m" | "12m" | "ytd" | "custom";

export interface DateRange {
  from: string;
  to: string;
}

export function getReportDateRange(
  preset: DatePreset,
  timezone: string,
  now: Date = new Date(),
  customFrom?: string,
  customTo?: string,
): DateRange {
  if (preset === "custom") {
    if (customFrom && customTo) {
      return { from: customFrom, to: customTo };
    }
    return { from: customFrom ?? "", to: customTo ?? "" };
  }

  let safeTimezone = timezone;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch (err) {
    console.error(`Invalid household timezone "${timezone}", falling back to UTC:`, err);
    safeTimezone = "UTC";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const currentYear = parseInt(getPart("year"), 10) || now.getUTCFullYear();
  const currentMonth = parseInt(getPart("month"), 10) || now.getUTCMonth() + 1;

  const lastDayOfCurrentMonth = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const to = `${currentYear}-${pad(currentMonth)}-${pad(lastDayOfCurrentMonth)}`;

  let fromYear = currentYear;
  let fromMonth = currentMonth;

  if (preset === "this_month") {
    fromYear = currentYear;
    fromMonth = currentMonth;
  } else if (preset === "3m") {
    const totalMonths = currentYear * 12 + (currentMonth - 1) - 2;
    fromYear = Math.floor(totalMonths / 12);
    fromMonth = (totalMonths % 12) + 1;
  } else if (preset === "6m") {
    const totalMonths = currentYear * 12 + (currentMonth - 1) - 5;
    fromYear = Math.floor(totalMonths / 12);
    fromMonth = (totalMonths % 12) + 1;
  } else if (preset === "12m") {
    const totalMonths = currentYear * 12 + (currentMonth - 1) - 11;
    fromYear = Math.floor(totalMonths / 12);
    fromMonth = (totalMonths % 12) + 1;
  } else if (preset === "ytd") {
    fromYear = currentYear;
    fromMonth = 1;
  }

  const from = `${fromYear}-${pad(fromMonth)}-01`;
  return { from, to };
}

export function calculateRolling3MonthAverage(
  totals: readonly { period_month: string; net: number }[],
): number[] {
  return totals.map((_, index) => {
    const start = Math.max(0, index - 2);
    const window = totals.slice(start, index + 1);
    const sum = window.reduce((acc, curr) => acc + curr.net, 0);
    return sum / window.length;
  });
}

// The RPCs only return a row for months that had at least one transaction, so
// a month with zero activity in the middle of the selected range is simply
// absent rather than zeroed. Left as-is, that gap shifts calculateRolling3MonthAverage's
// window-by-array-position math and shrinks the bar/x-axis count below the
// selected range. Fill every YYYY-MM-01 key between from/to with a zero row so
// downstream consumers see one entry per calendar month. Returns [] untouched
// when totals is empty, so a household with literally no data in range keeps
// showing the dedicated "no data" empty state instead of an all-zero chart.
export function densifyMonthlyTotals<T extends { period_month: string }>(
  totals: readonly T[],
  from: string,
  to: string,
  emptyValues: Omit<T, "period_month">,
): T[] {
  if (totals.length === 0) return [];

  const byMonth = new Map(totals.map((t) => [t.period_month, t]));
  const [fromYear, fromMonth] = from.split("-").map((n) => parseInt(n, 10));
  const [toYear, toMonth] = to.split("-").map((n) => parseInt(n, 10));
  if (!fromYear || !fromMonth || !toYear || !toMonth) return [...totals];

  const pad = (n: number) => String(n).padStart(2, "0");
  const result: T[] = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    const key = `${year}-${pad(month)}-01`;
    result.push(byMonth.get(key) ?? ({ period_month: key, ...emptyValues } as T));
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return result;
}

// period_month is a date-only value (e.g. "2026-08-01") with no time
// component, so it must be labeled in UTC regardless of the household's
// timezone — formatting it in a negative-offset zone (most of this app's
// target market: Santiago, São Paulo, Managua…) rolls it back to the
// previous day, and therefore the previous month.
export function formatReportMonthLabel(periodMonth: string, locale: string): string {
  const date = new Date(`${periodMonth}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "short",
    year: "2-digit",
  }).format(date);
}
