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
  rpc: ReturnType<typeof vi.fn>;
};

// Service-role client fake supporting the three tables runFxRefresh touches:
// currencies (select), fx_rates (select+upsert), fx_fetch_log (insert).
function makeClient(opts: { currencies?: string[] }) {
  const upsertRates = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn((fn: string) => {
    if (fn === "claim_fx_refresh") return Promise.resolve({ data: true, error: null });
    if (fn === "record_fx_refresh_success") return Promise.resolve({ data: true, error: null });
    if (fn === "record_fx_refresh_failure") return Promise.resolve({ data: null, error: null });
    throw new Error(`unexpected function ${fn}`);
  });
  const from = vi.fn((table: string) => {
    if (table === "currencies") {
      return {
        select: vi.fn().mockResolvedValue({
          data: (opts.currencies ?? []).map((code) => ({ code })),
          error: null,
        }),
      };
    }
    if (table === "fx_rates") return { upsert: upsertRates };
    throw new Error(`unexpected table ${table}`);
  });
  return { from, rpc, upsertRates } as unknown as FakeClient;
}

function providerResponse(conversion_rates: Record<string, number>, status = 200) {
  return new Response(JSON.stringify({ result: "success", conversion_rates }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authedRequest(path: string, init: RequestInit = {}): Request {
  return new Request(path, {
    ...init,
    headers: { authorization: "Bearer test-secret", ...init.headers },
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
  it("rejects a GET with no credentials", async () => {
    const res = await GET(new Request("http://localhost/api/cron/fx-refresh"));
    expect(res.status).toBe(401);
  });

  it("rejects a POST with no credentials", async () => {
    const res = await POST(new Request("http://localhost/api/cron/fx-refresh", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("rejects a wrong Bearer secret even with a spoofable user agent", async () => {
    const res = await POST(
      new Request("http://localhost/api/cron/fx-refresh", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong",
          "user-agent": "vercel-cron/1.0",
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts a GET with the matching Bearer CRON_SECRET and returns counts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse({ USD: 1, CLP: 950 })));
    const client = makeClient({ currencies: ["USD", "CLP"] });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await GET(authedRequest("http://localhost/api/cron/fx-refresh"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      rateDate: expect.stringMatching(RATE_DATE_RE),
      status: "success",
      currenciesUpdated: 2,
      skipped: 0,
    });
    expect(client.upsertRates).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith(
      "record_fx_refresh_success",
      expect.objectContaining({ updated_currencies: 2 }),
    );
  });

  it("accepts a POST with the matching Bearer CRON_SECRET and returns counts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse({ USD: 1, CLP: 950 })));
    const client = makeClient({ currencies: ["USD", "CLP"] });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await POST(
      authedRequest("http://localhost/api/cron/fx-refresh", { method: "POST" }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      rateDate: expect.stringMatching(RATE_DATE_RE),
      status: "success",
      currenciesUpdated: 2,
      skipped: 0,
    });
    expect(client.upsertRates).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith(
      "record_fx_refresh_success",
      expect.objectContaining({ updated_currencies: 2 }),
    );
  });

  it("falls back to the vercel-cron user agent when no CRON_SECRET is configured", async () => {
    delete process.env.CRON_SECRET;
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
      status: "success",
      currenciesUpdated: 2,
      skipped: 0,
    });
    expect(client.upsertRates).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith(
      "record_fx_refresh_success",
      expect.objectContaining({ updated_currencies: 2 }),
    );
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
      authedRequest("http://localhost/api/cron/fx-refresh", { method: "POST" }),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.rpc).toHaveBeenCalledWith("record_fx_refresh_success", expect.any(Object));
  });

  it("returns 502 and logs a failed run when the provider keeps failing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse({}, 500)));
    const client = makeClient({ currencies: ["USD"] });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await POST(
      authedRequest("http://localhost/api/cron/fx-refresh", { method: "POST" }),
    );

    expect(res.status).toBe(502);
    expect(client.rpc).toHaveBeenCalledWith(
      "record_fx_refresh_failure",
      expect.objectContaining({ failure_error: expect.any(String) }),
    );
  });

  it("skips a claimed same-day refresh without calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient({ currencies: ["USD"] });
    client.rpc.mockImplementation((fn: string) => {
      if (fn === "claim_fx_refresh") return Promise.resolve({ data: false, error: null });
      throw new Error(`unexpected function ${fn}`);
    });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await GET(authedRequest("http://localhost/api/cron/fx-refresh"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      rateDate: expect.stringMatching(RATE_DATE_RE),
      status: "skipped",
      currenciesUpdated: 0,
      skipped: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
