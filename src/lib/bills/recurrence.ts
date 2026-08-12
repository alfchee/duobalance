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
    return `FREQ=MONTHLY;INTERVAL=${Math.max(1, Number(draft.interval) || 1)};BYMONTHDAY=${start.getUTCDate()}`;
  }
  return `FREQ=MONTHLY;BYMONTHDAY=${start.getUTCDate()}`;
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
