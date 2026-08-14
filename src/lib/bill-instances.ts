// Server-only: RRULE-based bill instance generation using the `rrule` library.
// Imported only from app/api/** route handlers — it is a Node.js module.
//
// The rrule parser runs here (TypeScript), not in pgSQL. The database provides
// helper functions (bill_instance_generation_bounds) to supply the per-bill
// bounds; this module uses those bounds with the rrule library to produce the
// exact list of due dates, then inserts rows.

import { RRule, rrulestr } from "rrule";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type GenerationBounds = {
  horizon_start: string;
  horizon_end: string;
  starts_on: string;
  ends_on: string | null;
  rrule: string;
  default_amount: number | null;
};

export type BillRow = {
  id: string;
  household_id: string;
  default_amount: number | null;
};

export type InsertResult = {
  bill_id: string;
  count: number;
};

export class BillGenerationError extends Error {
  constructor(
    public readonly billId: string,
    message: string,
  ) {
    super(message);
    this.name = "BillGenerationError";
  }
}

/**
 * Parse an RRULE string and return due dates for a bill within the
 * given bounds. Skips dates before starts_on and after ends_on; includes
 * horizon_start itself (it's already the day after the last existing
 * instance, so nothing at horizon_start could be a duplicate).
 */
export function computeDueDates(
  rrule: string,
  startsOn: Date,
  endsOn: Date | null,
  horizonStart: Date,
  horizonEnd: Date,
): Date[] {
  let rule: RRule;
  try {
    rule = rrulestr(rrule, { forceset: false }) as RRule;
  } catch {
    // rrulestr can throw for invalid rules — this is caught upstream
    throw new Error(`invalid RRULE: ${rrule}`);
  }

  // Set dtstart to starts_on so the rule knows its origin. The rrule library
  // uses dtstart as the reference point for generating occurrences; without it
  // the between() call may produce no results.
  rule = new RRule({
    ...rule.origOptions,
    dtstart: startsOn,
  });

  const all = rule.between(horizonStart, horizonEnd, true);

  return all.filter((d: Date) => {
    // Normalize to UTC date-only values to avoid timezone shifts
    // (the rrule library returns Date objects that can drift when the server
    //  runtime is not UTC — e.g. America/Managua UTC-6).
    const dt = utcDateOnly(d);
    const start = utcDateOnly(startsOn);
    if (dt < start) return false;
    if (endsOn) {
      const end = utcDateOnly(endsOn);
      if (dt > end) return false;
    }
    return true;
  });
}

/** Convert a Date to midnight-UTC date-only (milliseconds precision). */
function utcDateOnly(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Generate bill instances for a single active bill.
 * Returns the number of instances inserted.
 */
export async function generateInstancesForBill(
  supabase: SupabaseClient<Database>,
  bounds: GenerationBounds,
  billId: string,
  householdId: string,
): Promise<number> {
  const horizonStart = new Date(bounds.horizon_start);
  const horizonEnd = new Date(bounds.horizon_end);
  const startsOn = new Date(bounds.starts_on);
  const endsOn = bounds.ends_on ? new Date(bounds.ends_on) : null;

  const dueDates = computeDueDates(bounds.rrule, startsOn, endsOn, horizonStart, horizonEnd);

  if (dueDates.length === 0) return 0;

  // Bills without a fixed default_amount are "variable" — instances still
  // need to materialize (so they show up on the calendar and can be paid),
  // just with a 0 placeholder amount that the per-instance amount editor
  // fills in before payment.
  const instanceAmount = bounds.default_amount ?? 0;

  const rows = dueDates.map((dueOn) => ({
    bill_id: billId,
    household_id: householdId,
    due_on: dueOn.toISOString().slice(0, 10),
    amount: instanceAmount,
  }));

  // Batch insert with ON CONFLICT DO NOTHING (unique on bill_id, due_on)
  const { data, error } = await supabase
    .from("bill_instances")
    .upsert(rows, {
      onConflict: "bill_id, due_on",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) {
    throw new BillGenerationError(billId, error.message);
  }

  return data?.length ?? 0;
}

/**
 * Run generation for all active bills. Returns a per-bill count map.
 */
export async function generateAllInstances(
  supabase: SupabaseClient<Database>,
): Promise<Record<string, number>> {
  const { data: bills, error: billsError } = await supabase
    .from("bills")
    .select("id, household_id, default_amount")
    .eq("is_active", true);

  if (billsError) throw new Error(`failed to fetch active bills: ${billsError.message}`);

  if (!bills || bills.length === 0) return {};

  const results: Record<string, number> = {};

  for (const bill of bills) {
    try {
      const { data: boundsRaw, error: boundsError } = await (
        supabase.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => {
          maybeSingle: () => Promise<{ data: GenerationBounds | null; error: unknown }>;
        }
      )("bill_instance_generation_bounds", { p_bill_id: bill.id }).maybeSingle();

      if (boundsError) {
        throw new BillGenerationError(bill.id, `bounds fetch failed: ${String(boundsError)}`);
      }

      if (!boundsRaw) {
        // Bounds helper legitimately returns nothing for an inactive bill —
        // not a failure, so the bill is simply omitted from the results.
        continue;
      }

      const count = await generateInstancesForBill(supabase, boundsRaw, bill.id, bill.household_id);
      if (count > 0) {
        results[bill.id] = count;
      }
    } catch (err) {
      console.error(`generateAllInstances: bill ${bill.id} failed`, err);
      results[bill.id] = -1; // signal failure so the cron reports it, regardless of error type
    }
  }

  return results;
}
