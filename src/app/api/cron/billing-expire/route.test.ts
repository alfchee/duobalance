import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceRoleClient: vi.fn() }));
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

type Row = {
  id: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
};

function makeClient(rows: Row[], updated: string[]) {
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      in: vi.fn(() => Promise.resolve({ data: rows, error: null })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn((col: string, value: unknown) => {
        if (col === "id") updated.push(value as string);
        return Promise.resolve({ error: null });
      }),
    })),
  }));
  return { from } as never;
}

function authed(path: string): Request {
  return new Request(path, { headers: { authorization: "Bearer test-secret" } });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  delete process.env.CRON_DISABLED;
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.CRON_SECRET;
  delete process.env.CRON_DISABLED;
  vi.clearAllMocks();
});

describe("/api/cron/billing-expire (#260)", () => {
  it("rejects unauthenticated calls", async () => {
    const res = await GET(new Request("http://localhost/api/cron/billing-expire"));
    expect(res.status).toBe(401);
  });

  it("expires due subscriptions and reports the sweep", async () => {
    const updated: string[] = [];
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      makeClient(
        [
          {
            id: "s1",
            status: "past_due",
            trial_ends_at: null,
            current_period_end: "2020-01-01T00:00:00.000Z",
            grace_ends_at: "2020-01-01T00:00:00.000Z",
          },
          {
            id: "s2",
            status: "active",
            trial_ends_at: null,
            current_period_end: "2030-01-01T00:00:00.000Z",
            grace_ends_at: null,
          },
        ],
        updated,
      ),
    );
    const res = await POST(authed("http://localhost/api/cron/billing-expire"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: 2, expired: ["s1"] });
    expect(updated).toEqual(["s1"]);
  });

  it("no-ops with 200 when CRON_DISABLED is set", async () => {
    process.env.CRON_DISABLED = "true";
    const res = await GET(authed("http://localhost/api/cron/billing-expire"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disabled: true, job: "billing-expire" });
    expect(createSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });
});
