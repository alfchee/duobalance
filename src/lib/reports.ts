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
  if (preset === "custom" && customFrom && customTo) {
    return { from: customFrom, to: customTo };
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
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
