import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseRouteHandler: vi.fn() }));
import { createSupabaseRouteHandler } from "@/lib/supabase/server";

type FakeClient = SupabaseClient<Database> & {
  from: ReturnType<typeof vi.fn>;
  deleteIn: ReturnType<typeof vi.fn>;
};

function makeClient(opts: {
  households?: Array<{ id: string; name: string; deleted_at: string }>;
  selectError?: Error | null;
  deleteError?: Error | null;
}) {
  const deleteIn = vi.fn().mockResolvedValue({ error: opts.deleteError ?? null });
  const from = vi.fn((table: string) => {
    if (table === "households") {
      return {
        select: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            lt: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: opts.selectError ? null : (opts.households ?? []),
                error: opts.selectError ?? null,
              }),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          in: deleteIn,
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from, deleteIn } as unknown as FakeClient;
}

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

describe("/api/cron/purge-households", () => {
  it("rejects request with missing or invalid credentials", async () => {
    const res = await GET(new Request("http://localhost/api/cron/purge-households"));
    expect(res.status).toBe(401);
  });

  it("purges soft-deleted households older than 30 days", async () => {
    const households = [{ id: "hh-1", name: "Old House", deleted_at: "2026-07-01T00:00:00Z" }];
    const client = makeClient({ households });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await GET(authedRequest("http://localhost/api/cron/purge-households"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      purgedCount: 1,
      households,
    });
    expect(client.deleteIn).toHaveBeenCalledWith("id", ["hh-1"]);
  });

  it("returns 0 purged count when no households match cutoff", async () => {
    const client = makeClient({ households: [] });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await POST(
      authedRequest("http://localhost/api/cron/purge-households", { method: "POST" }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      purgedCount: 0,
      households: [],
    });
    expect(client.deleteIn).not.toHaveBeenCalled();
  });

  it("refuses to run and returns 422 when sanity cap is exceeded", async () => {
    const households = Array.from({ length: 51 }, (_, i) => ({
      id: `hh-${i}`,
      name: `House ${i}`,
      deleted_at: "2026-07-01T00:00:00Z",
    }));
    const client = makeClient({ households });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await GET(authedRequest("http://localhost/api/cron/purge-households"));
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error).toMatch(/sanity cap/i);
    expect(client.deleteIn).not.toHaveBeenCalled();
  });

  it("returns 502 if household lookup fails", async () => {
    const client = makeClient({ selectError: new Error("db query error") });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client);

    const res = await GET(authedRequest("http://localhost/api/cron/purge-households"));
    expect(res.status).toBe(502);
  });
});
