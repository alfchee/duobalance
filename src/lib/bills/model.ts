import { formatMoney } from "@/lib/money";
import type { NumberFormatPref } from "@/lib/money";
import type { Database } from "@/lib/supabase/types";

export type Bill = Database["public"]["Tables"]["bills"]["Row"];
export type BillInstance = Database["public"]["Views"]["bill_instances_view"]["Row"];
export type BillWithInstances = Bill & { instances: BillInstance[] };
export type BillStatus = "due" | "overdue" | "paid" | "skipped";
export type BillWindow = { end: string; start: string };
export type SelectedBillInstance = { bill: BillWithInstances; instance: BillInstance };

export function dateFromYmd(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function moveBillMonth(value: string, offset: number): string {
  const date = dateFromYmd(`${value}-01`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function getBillMonthWindow(month: string): BillWindow {
  const date = dateFromYmd(`${month}-01`);
  const start = date.toISOString().slice(0, 10);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return { end: date.toISOString().slice(0, 10), start };
}

export function getBillWeekStart(date: string): string {
  const value = dateFromYmd(date);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

export function formatBillDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dateFromYmd(date));
}

export function getBillStatus(status: string | null): BillStatus {
  if (status === "paid" || status === "overdue" || status === "skipped") return status;
  return "due";
}

export function createBillStatusCounts(
  values: readonly SelectedBillInstance[],
): Record<BillStatus, number> {
  return values.reduce<Record<BillStatus, number>>(
    (counts, { instance }) => {
      counts[getBillStatus(instance.effective_status)] += 1;
      return counts;
    },
    { due: 0, overdue: 0, paid: 0, skipped: 0 },
  );
}

export function createBillInstancesByDate(
  values: readonly SelectedBillInstance[],
): ReadonlyMap<string, SelectedBillInstance[]> {
  const result = new Map<string, SelectedBillInstance[]>();
  for (const value of values) {
    if (!value.instance.due_on) continue;
    const current = result.get(value.instance.due_on) ?? [];
    result.set(value.instance.due_on, [...current, value]);
  }
  return result;
}

export function createBillWeeks(
  values: readonly SelectedBillInstance[],
): ReadonlyArray<readonly [string, SelectedBillInstance[]]> {
  const grouped = new Map<string, SelectedBillInstance[]>();
  for (const value of values) {
    if (!value.instance.due_on) continue;
    const week = getBillWeekStart(value.instance.due_on);
    grouped.set(week, [...(grouped.get(week) ?? []), value]);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export function calculateBillWeekTotal(
  values: readonly SelectedBillInstance[],
  locale: string,
  numberFormat: NumberFormatPref = "locale",
): string {
  const totals = new Map<string, number>();
  for (const { bill, instance } of values) {
    if (getBillStatus(instance.effective_status) === "skipped") continue;
    totals.set(bill.currency, (totals.get(bill.currency) ?? 0) + (instance.amount ?? 0));
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => formatMoney(amount, currency, locale, numberFormat))
    .join(" · ");
}
