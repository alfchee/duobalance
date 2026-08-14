import { describe, expect, it, vi } from "vitest";
import {
  BillGenerationError,
  computeDueDates,
  generateAllInstances,
  generateInstancesForBill,
  type GenerationBounds,
} from "./bill-instances";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

describe("computeDueDates", () => {
  it("returns monthly dates within the given bounds", () => {
    const result = computeDueDates(
      "FREQ=MONTHLY;BYMONTHDAY=15",
      new Date("2026-01-15"),
      null,
      new Date("2026-02-16"),
      new Date("2026-06-15"),
    );

    expect(result).toHaveLength(4);
    expect(result[0]!.toISOString().slice(0, 10)).toBe("2026-03-15");
    expect(result[1]!.toISOString().slice(0, 10)).toBe("2026-04-15");
    expect(result[2]!.toISOString().slice(0, 10)).toBe("2026-05-15");
    expect(result[3]!.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("respects ends_on", () => {
    const result = computeDueDates(
      "FREQ=MONTHLY;BYMONTHDAY=1",
      new Date("2026-01-01"),
      new Date("2026-03-31"),
      new Date("2026-01-01"),
      new Date("2026-12-31"),
    );

    expect(result).toHaveLength(3);
    expect(result[0]!.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(result[1]!.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(result[2]!.toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("skips dates before starts_on", () => {
    const result = computeDueDates(
      "FREQ=MONTHLY;BYMONTHDAY=10",
      new Date("2026-06-01"),
      null,
      new Date("2026-01-01"),
      new Date("2026-12-31"),
    );

    for (const d of result) {
      expect(d.getTime()).toBeGreaterThanOrEqual(new Date("2026-06-01").getTime());
    }
  });

  it("handles weekly recurrence", () => {
    const result = computeDueDates(
      "FREQ=WEEKLY;BYDAY=MO",
      new Date("2026-01-05"),
      null,
      new Date("2026-01-06"),
      new Date("2026-01-26"),
    );

    // Mondays: Jan 12, Jan 19, Jan 26
    expect(result).toHaveLength(3);
    expect(result[0]!.toISOString().slice(0, 10)).toBe("2026-01-12");
    expect(result[1]!.toISOString().slice(0, 10)).toBe("2026-01-19");
    expect(result[2]!.toISOString().slice(0, 10)).toBe("2026-01-26");
  });

  it("handles biweekly recurrence", () => {
    const result = computeDueDates(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
      new Date("2026-01-02"),
      null,
      new Date("2026-01-03"),
      new Date("2026-02-13"),
    );

    expect(result).toHaveLength(3);
    expect(result[0]!.toISOString().slice(0, 10)).toBe("2026-01-16");
    expect(result[1]!.toISOString().slice(0, 10)).toBe("2026-01-30");
    expect(result[2]!.toISOString().slice(0, 10)).toBe("2026-02-13");
  });

  it("handles yearly recurrence", () => {
    const result = computeDueDates(
      "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25",
      new Date("2025-12-25"),
      null,
      new Date("2025-12-26"),
      new Date("2027-12-31"),
    );

    expect(result).toHaveLength(2);
    expect(result[0]!.toISOString().slice(0, 10)).toBe("2026-12-25");
    expect(result[1]!.toISOString().slice(0, 10)).toBe("2027-12-25");
  });

  it("returns empty array when horizon is empty", () => {
    const result = computeDueDates(
      "FREQ=MONTHLY;BYMONTHDAY=1",
      new Date("2026-01-01"),
      new Date("2026-01-01"),
      new Date("2026-01-02"),
      new Date("2026-01-02"),
    );

    // The only occurrence (Jan 1) is before horizon_start, so none match
    expect(result).toHaveLength(0);
  });

  it("returns empty when no dates fall in range", () => {
    const result = computeDueDates(
      "FREQ=MONTHLY;BYMONTHDAY=1",
      new Date("2026-01-01"),
      new Date("2026-01-15"),
      new Date("2026-02-01"),
      new Date("2026-12-31"),
    );

    expect(result).toHaveLength(0);
  });

  it("throws on invalid RRULE", () => {
    expect(() =>
      computeDueDates(
        "INVALID;RULE",
        new Date("2026-01-01"),
        null,
        new Date("2026-01-01"),
        new Date("2026-12-31"),
      ),
    ).toThrow("invalid RRULE");
  });
});

/**
 * Minimal fake Supabase client covering exactly the calls
 * generateInstancesForBill/generateAllInstances make:
 *   from("bills").select().eq()
 *   from("bill_instance_deletions").select().eq()
 *   from("bill_instances").select().eq().gte().lte()  (count, called twice)
 *   from("bill_instances").upsert()
 *   rpc("bill_instance_generation_bounds", {...}).maybeSingle()
 */
function makeSupabase(opts: {
  bills?: Array<{ id: string; household_id: string; default_amount: number | null }>;
  bounds?: Record<string, { data: GenerationBounds | null; error: unknown }>;
  billInstanceCounts?: number[];
  deletedDueDates?: string[];
  deletedInstancesError?: { message: string } | null;
  upsertError?: { message: string } | null;
}) {
  const counts = [...(opts.billInstanceCounts ?? [])];
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null });

  const from = vi.fn((table: string) => {
    if (table === "bills") {
      return {
        select: () => ({ eq: () => Promise.resolve({ data: opts.bills ?? [], error: null }) }),
      };
    }
    if (table === "bill_instances") {
      return {
        select: () => ({
          eq: () => ({
            gte: () => ({
              lte: () => Promise.resolve({ count: counts.shift() ?? 0, error: null }),
            }),
          }),
        }),
        upsert,
      };
    }
    if (table === "bill_instance_deletions") {
      return {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: (opts.deletedDueDates ?? []).map((due_on) => ({ due_on })),
              error: opts.deletedInstancesError ?? null,
            }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    if (name !== "bill_instance_generation_bounds") {
      throw new Error(`unexpected rpc ${name}`);
    }
    const result = opts.bounds?.[args.p_bill_id as string] ?? { data: null, error: null };
    return { maybeSingle: () => Promise.resolve(result) };
  });

  return { from, rpc, upsert } as unknown as SupabaseClient<Database> & { upsert: typeof upsert };
}

const oneDayBounds: GenerationBounds = {
  horizon_start: "2026-01-15",
  horizon_end: "2026-01-15",
  starts_on: "2026-01-15",
  ends_on: null,
  rrule: "FREQ=MONTHLY;BYMONTHDAY=15",
  default_amount: 50,
};

describe("generateInstancesForBill", () => {
  it("generates a variable-amount bill's instances with amount 0 instead of skipping it", async () => {
    const supabase = makeSupabase({ billInstanceCounts: [0, 1] });
    const bounds = { ...oneDayBounds, default_amount: null };

    const count = await generateInstancesForBill(supabase, bounds, "bill-1", "household-1");

    expect(count).toBe(1);
    expect(supabase.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ amount: 0 })],
      expect.anything(),
    );
  });

  it("returns 0 without touching the database when there are no due dates", async () => {
    const supabase = makeSupabase({});
    const bounds = { ...oneDayBounds, horizon_start: "2026-02-01", horizon_end: "2026-02-01" };

    const count = await generateInstancesForBill(supabase, bounds, "bill-1", "household-1");

    expect(count).toBe(0);
    expect(supabase.upsert).not.toHaveBeenCalled();
  });

  it("does not regenerate a deleted occurrence", async () => {
    const supabase = makeSupabase({ deletedDueDates: ["2026-01-15"] });

    const count = await generateInstancesForBill(supabase, oneDayBounds, "bill-1", "household-1");

    expect(count).toBe(0);
    expect(supabase.upsert).not.toHaveBeenCalled();
  });

  it("wraps a count-query failure in BillGenerationError", async () => {
    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          gte: () => ({ lte: () => Promise.resolve({ count: null, error: { message: "boom" } }) }),
        }),
      }),
    }));
    const supabase = { from } as unknown as SupabaseClient<Database>;

    await expect(
      generateInstancesForBill(supabase, oneDayBounds, "bill-1", "household-1"),
    ).rejects.toThrow(BillGenerationError);
  });
});

describe("generateAllInstances", () => {
  it("records a bounds-fetch error as a failure and logs it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = makeSupabase({
      bills: [{ id: "bill-1", household_id: "household-1", default_amount: 50 }],
      bounds: { "bill-1": { data: null, error: { message: "connection reset" } } },
    });

    const results = await generateAllInstances(supabase);

    expect(results).toEqual({ "bill-1": -1 });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("records any unexpected error (not just BillGenerationError) as a failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = makeSupabase({
      bills: [{ id: "bill-1", household_id: "household-1", default_amount: 50 }],
      bounds: {
        "bill-1": { data: { ...oneDayBounds, rrule: "INVALID;RULE" }, error: null },
      },
    });

    const results = await generateAllInstances(supabase);

    expect(results).toEqual({ "bill-1": -1 });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("omits a bill with no bounds row instead of marking it failed", async () => {
    const supabase = makeSupabase({
      bills: [{ id: "bill-1", household_id: "household-1", default_amount: 50 }],
      bounds: { "bill-1": { data: null, error: null } },
    });

    const results = await generateAllInstances(supabase);

    expect(results).toEqual({});
  });

  it("records the inserted count for a successful bill", async () => {
    const supabase = makeSupabase({
      bills: [{ id: "bill-1", household_id: "household-1", default_amount: 50 }],
      bounds: { "bill-1": { data: oneDayBounds, error: null } },
      billInstanceCounts: [0, 1],
    });

    const results = await generateAllInstances(supabase);

    expect(results).toEqual({ "bill-1": 1 });
  });
});
