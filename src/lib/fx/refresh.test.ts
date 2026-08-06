import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { applyDailyRates } from "./refresh";
import { daysSinceNewestRate } from "./staleness";

type FakeClient = SupabaseClient<Database> & {
  from: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};

function makeClient(opts: { currencies?: string[]; existingRateCodes?: string[] }) {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === "currencies") {
      return {
        select: vi.fn().mockResolvedValue({
          data: (opts.currencies ?? []).map((code) => ({ code })),
          error: null,
        }),
      };
    }
    if (table === "fx_rates") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: (opts.existingRateCodes ?? []).map((code) => ({ code })),
            error: null,
          }),
        })),
        upsert,
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from, upsert } as unknown as FakeClient;
}

describe("applyDailyRates", () => {
  it("upserts one row per known code and counts inserted/updated/skipped", async () => {
    const client = makeClient({ currencies: ["USD", "CLP", "NIO"], existingRateCodes: ["USD"] });
    const result = await applyDailyRates(
      client,
      { USD: 1, CLP: 950, NIO: 36.6, XXX: 123 },
      "2026-08-06",
    );
    expect(result).toEqual({ inserted: 2, updated: 1, skipped: 1 });
    expect(client.upsert).toHaveBeenCalledWith(
      [
        { rate_date: "2026-08-06", code: "USD", usd_rate: 1 },
        { rate_date: "2026-08-06", code: "CLP", usd_rate: 950 },
        { rate_date: "2026-08-06", code: "NIO", usd_rate: 36.6 },
      ],
      { onConflict: "rate_date,code" },
    );
  });

  it("skips the upsert entirely when no code is known", async () => {
    const client = makeClient({ currencies: ["USD"] });
    const result = await applyDailyRates(client, { FOO: 1 }, "2026-08-06");
    expect(result).toEqual({ inserted: 0, updated: 0, skipped: 1 });
    expect(client.upsert).not.toHaveBeenCalled();
  });

  it("normalizes char(3) padding when counting existing codes", async () => {
    const client = makeClient({ currencies: ["USD"], existingRateCodes: ["USD "] });
    const result = await applyDailyRates(client, { USD: 1 }, "2026-08-06");
    expect(result).toEqual({ inserted: 0, updated: 1, skipped: 0 });
  });

  it("propagates a database error", async () => {
    const dbError = new Error("db down");
    const from = vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: null, error: dbError }),
    }));
    const client = { from } as unknown as SupabaseClient<Database>;
    await expect(applyDailyRates(client, { USD: 1 }, "2026-08-06")).rejects.toBe(dbError);
  });
});

describe("daysSinceNewestRate", () => {
  it("returns null when there are no rows", () => {
    expect(daysSinceNewestRate([], "2026-08-06")).toBeNull();
    expect(daysSinceNewestRate(null, "2026-08-06")).toBeNull();
  });

  it("returns 0 when the newest rate is today", () => {
    expect(daysSinceNewestRate([{ rate_date: "2026-08-06" }], "2026-08-06")).toBe(0);
  });

  it("counts days since the newest rate", () => {
    expect(daysSinceNewestRate([{ rate_date: "2026-08-02" }], "2026-08-06")).toBe(4);
  });

  it("uses the newest row when several exist", () => {
    expect(
      daysSinceNewestRate([{ rate_date: "2026-07-01" }, { rate_date: "2026-08-04" }], "2026-08-06"),
    ).toBe(2);
  });
});
