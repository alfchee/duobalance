import { parseMoneyInput, roundToMinorUnit } from "@/lib/money";
import type { Database } from "@/lib/supabase/types";
import { serializeBillRecurrence, type BillEditorDraft } from "@/lib/bills/recurrence";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false };
export type BillWriteInput = Omit<Database["public"]["Tables"]["bills"]["Insert"], "household_id">;

export function createBillWriteInput(
  draft: BillEditorDraft,
  locale: string,
  minorUnit: number,
): ValidationResult<BillWriteInput> {
  const parsedAmount = draft.amount ? parseMoneyInput(draft.amount, locale) : null;
  const reminderDays = Number(draft.reminderDays);
  if (!draft.name.trim() || !draft.startsOn || (draft.amount && parsedAmount === null)) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      account_id: draft.accountId === "none" ? null : draft.accountId,
      category_id: draft.categoryId === "none" ? null : draft.categoryId,
      currency: draft.currency,
      default_amount: parsedAmount === null ? null : roundToMinorUnit(parsedAmount, minorUnit),
      ends_on: draft.endsOn || null,
      name: draft.name.trim(),
      reminder_days_before: Math.min(
        30,
        Math.max(0, Number.isFinite(reminderDays) ? reminderDays : 0),
      ),
      responsible_member_id:
        draft.responsibleMemberId === "joint" ? null : draft.responsibleMemberId,
      rrule: serializeBillRecurrence(draft),
      starts_on: draft.startsOn,
    },
  };
}

export function parseBillAmount(value: string, locale: string, minorUnit: number): number | null {
  const amount = parseMoneyInput(value, locale);
  return amount === null ? null : roundToMinorUnit(amount, minorUnit);
}
