import { RRule, rrulestr } from "rrule";
import { dateFromYmd } from "@/lib/bills/model";

export type RecurrenceKind =
  "monthly-day" | "monthly-last" | "weekly" | "yearly" | "monthly-interval";

export type BillEditorDraft = {
  accountId: string;
  amount: string;
  categoryId: string;
  currency: string;
  endsOn: string;
  interval: string;
  name: string;
  reminderDays: string;
  responsibleMemberId: string;
  startsOn: string;
  recurrence: RecurrenceKind;
  weekday: string;
};

export type RecurrencePreview = { dates: string[]; valid: boolean };

export function createDefaultBillDraft(today: string, currency: string): BillEditorDraft {
  return {
    accountId: "none",
    amount: "",
    categoryId: "none",
    currency,
    endsOn: "",
    interval: "1",
    name: "",
    recurrence: "monthly-day",
    reminderDays: "3",
    responsibleMemberId: "joint",
    startsOn: today,
    weekday: "MO",
  };
}

// A plain BYMONTHDAY=29/30/31 makes RRule skip any month too short to have
// that day (Feb, and Apr/Jun/Sep/Nov for 31) instead of falling back to the
// month's last day — so a bill due "on the 31st" would fire 7 times a year.
// Listing every day from `day` through 31 plus -1 (the actual last day) and
// taking BYSETPOS=1 (earliest match) picks `day` when it exists and clamps to
// the month's end when it doesn't.
function monthlyDayRule(day: number): string {
  if (day < 29) return `BYMONTHDAY=${day}`;
  const candidates = [];
  for (let d = day; d <= 31; d++) candidates.push(d);
  candidates.push(-1);
  return `BYMONTHDAY=${candidates.join(",")};BYSETPOS=1`;
}

export function serializeBillRecurrence(draft: BillEditorDraft): string {
  const start = dateFromYmd(draft.startsOn);
  if (draft.recurrence === "monthly-last") return "FREQ=MONTHLY;BYMONTHDAY=-1";
  if (draft.recurrence === "weekly") {
    return `FREQ=WEEKLY;INTERVAL=${Math.max(1, Number(draft.interval) || 1)};BYDAY=${draft.weekday}`;
  }
  if (draft.recurrence === "yearly") {
    return `FREQ=YEARLY;BYMONTH=${start.getUTCMonth() + 1};BYMONTHDAY=${start.getUTCDate()}`;
  }
  if (draft.recurrence === "monthly-interval") {
    return `FREQ=MONTHLY;INTERVAL=${Math.max(1, Number(draft.interval) || 1)};${monthlyDayRule(start.getUTCDate())}`;
  }
  return `FREQ=MONTHLY;${monthlyDayRule(start.getUTCDate())}`;
}

export function previewBillRecurrence(draft: BillEditorDraft, limit = 6): RecurrencePreview {
  if (!draft.startsOn) return { dates: [], valid: true };
  try {
    const parsed = rrulestr(serializeBillRecurrence(draft)) as RRule;
    const rule = new RRule({ ...parsed.origOptions, dtstart: dateFromYmd(draft.startsOn) });
    return {
      dates: rule
        .between(dateFromYmd(draft.startsOn), dateFromYmd(draft.endsOn || "2099-12-31"), true)
        .slice(0, limit)
        .map((date) => date.toISOString().slice(0, 10)),
      valid: true,
    };
  } catch {
    return { dates: [], valid: false };
  }
}
