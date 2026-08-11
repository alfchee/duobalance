import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseRouteHandler: vi.fn() }));
import { createSupabaseRouteHandler } from "@/lib/supabase/server";

vi.mock("@/lib/bill-instances", () => ({ generateAllInstances: vi.fn() }));
import { generateAllInstances } from "@/lib/bill-instances";

function authedRequest(path: string, init: RequestInit = {}): Request {
  return new Request(path, {
    ...init,
    headers: { authorization: "Bearer test-secret", ...init.headers },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe("/api/cron/generate-bill-instances", () => {
  it("rejects a GET with no credentials", async () => {
    const res = await GET(new Request("http://localhost/api/cron/generate-bill-instances"));
    expect(res.status).toBe(401);
  });

  it("rejects a POST with no credentials", async () => {
    const res = await POST(
      new Request("http://localhost/api/cron/generate-bill-instances", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a wrong Bearer secret", async () => {
    const res = await POST(
      new Request("http://localhost/api/cron/generate-bill-instances", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts a GET with matching CRON_SECRET and returns results", async () => {
    vi.mocked(generateAllInstances).mockResolvedValue({
      "bill-1": 3,
      "bill-2": 1,
    });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue({} as never);

    const res = await GET(authedRequest("http://localhost/api/cron/generate-bill-instances"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      inserted: 4,
      failed: 0,
      details: { "bill-1": 3, "bill-2": 1 },
    });
    expect(generateAllInstances).toHaveBeenCalledTimes(1);
  });

  it("accepts a POST with matching CRON_SECRET and returns results", async () => {
    vi.mocked(generateAllInstances).mockResolvedValue({
      "bill-1": 3,
      "bill-2": -1,
    });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue({} as never);

    const res = await POST(
      authedRequest("http://localhost/api/cron/generate-bill-instances", { method: "POST" }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      inserted: 3,
      failed: 1,
      details: { "bill-1": 3, "bill-2": -1 },
    });
    expect(generateAllInstances).toHaveBeenCalledTimes(1);
  });

  it("returns empty results when no bills exist", async () => {
    vi.mocked(generateAllInstances).mockResolvedValue({});
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue({} as never);

    const res = await GET(authedRequest("http://localhost/api/cron/generate-bill-instances"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      inserted: 0,
      failed: 0,
      details: {},
    });
  });

  it("returns 502 when generation throws", async () => {
    vi.mocked(generateAllInstances).mockRejectedValue(new Error("db error"));
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue({} as never);

    const res = await GET(authedRequest("http://localhost/api/cron/generate-bill-instances"));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "instance generation failed" });
  });

  it("rejects a vercel-cron user agent when no CRON_SECRET is configured", async () => {
    delete process.env.CRON_SECRET;
    vi.mocked(generateAllInstances).mockResolvedValue({});
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue({} as never);

    const res = await GET(
      new Request("http://localhost/api/cron/generate-bill-instances", {
        headers: { "user-agent": "vercel-cron/1.0" },
      }),
    );

    expect(res.status).toBe(401);
  });
});
