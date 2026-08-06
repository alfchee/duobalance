import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseRouteHandler: vi.fn() }));
import { createSupabaseRouteHandler } from "@/lib/supabase/server";

const RATE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type FakeClient = SupabaseClient<Database> & {
  from: ReturnType<typeof vi.fn>;
  upsertRates: ReturnType<typeof vi.fn>;
  insertLog: ReturnType<typeof vi.fn>;
};

// Service-role client fake supporting the three tables runFxRefresh touches:
// currencies (select), fx_rates (select+upsert), fx_fetch_log (insert).
function makeClient(opts: { currencies?: string[] }) {
  const insertLog = vi.fn().mockResolvedValue({ error: null });
  const upsertRates = vi.fn().mockResolvedValue({ error: null });
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
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
        upsert: upsertRates,
      };
    }
    if (table === "fx_fetch_log") {
      return { insert: insertLog };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from, insertLog, upsertRates } as unknown as FakeClient;
}

function providerResponse(conversion_rates: Record<string, number>, status = 200) {
  return new Response(JSON.stringify({ result: "success", conversion_rates }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  process.env.EXCHANGERATE_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CRON_SECRET;
  delete process.env.EXCHANGERATE_API_KEY;
  vi.clearAllMocks();
});

describe("/api/cron/fx-refresh", () => {
  it("rejects a GET without the vercel-cron user agent", async () => {
    const res = await GET(new Request("http://localhost/api/cron/fx-refresh"));
    expect(res.status).toBe(401);
  });

  it("accepts a GET with the vercel-cron user agent and returns counts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse({ USD: 1, CLP: 950 })));
    const client = makeClient({ currencies: ["USD", "CLP"] });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await GET(
      new Request("http://localhost/api/cron/fx-refresh", {
        headers: { "user-agent": "vercel-cron/1.0" },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      rateDate: expect.stringMatching(RATE_DATE_RE),
      inserted: 2,
      updated: 0,
      skipped: 0,
    });
    expect(client.upsertRates).toHaveBeenCalledTimes(1);
    expect(client.insertLog).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "success", inserted: 2 }),
    );
  });

  it("rejects requests without the cron secret or vercel-cron user agent", async () => {
    const res = await POST(new Request("http://localhost/api/cron/fx-refresh", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("accepts a matching Bearer CRON_SECRET and returns counts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse({ USD: 1, CLP: 950 })));
    const client = makeClient({ currencies: ["USD", "CLP"] });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await POST(
      new Request("http://localhost/api/cron/fx-refresh", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      rateDate: expect.stringMatching(RATE_DATE_RE),
      inserted: 2,
      updated: 0,
      skipped: 0,
    });
    expect(client.upsertRates).toHaveBeenCalledTimes(1);
    expect(client.insertLog).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "success", inserted: 2 }),
    );
  });

  it("accepts the vercel-cron user agent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse({ USD: 1 })));
    const client = makeClient({ currencies: ["USD"] });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await POST(
      new Request("http://localhost/api/cron/fx-refresh", {
        method: "POST",
        headers: { "user-agent": "vercel-cron/1.0" },
      }),
    );

    expect(res.status).toBe(200);
  });

  it("rejects a wrong Bearer secret even with a spoofable user agent", async () => {
    const res = await POST(
      new Request("http://localhost/api/cron/fx-refresh", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong",
          "user-agent": "not-vercel-cron",
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("retries once on a transient provider failure, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(providerResponse({}, 500))
      .mockResolvedValueOnce(providerResponse({ USD: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient({ currencies: ["USD"] });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await POST(
      new Request("http://localhost/api/cron/fx-refresh", {
        method: "POST",
        headers: { "user-agent": "vercel-cron/1.0" },
      }),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.insertLog).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("returns 502 and logs a failed run when the provider keeps failing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse({}, 500)));
    const client = makeClient({ currencies: ["USD"] });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await POST(
      new Request("http://localhost/api/cron/fx-refresh", {
        method: "POST",
        headers: { "user-agent": "vercel-cron/1.0" },
      }),
    );

    expect(res.status).toBe(502);
    expect(client.insertLog).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", error: expect.any(String) }),
    );
  });
});
