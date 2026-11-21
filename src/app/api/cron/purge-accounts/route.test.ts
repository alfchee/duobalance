import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseRouteHandler: vi.fn() }));
vi.mock("@/lib/cron/purge-accounts", () => ({
  runPurgeAccounts: vi.fn(),
  PurgeAccountsCapError: class PurgeAccountsCapError extends Error {
    constructor(
      public count: number,
      public cap: number,
    ) {
      super("purge count exceeds sanity cap");
    }
  },
}));

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { runPurgeAccounts, PurgeAccountsCapError } from "@/lib/cron/purge-accounts";
import { GET, POST } from "./route";

function authed(path: string, init: RequestInit = {}): Request {
  return new Request(path, {
    ...init,
    headers: { authorization: "Bearer test-secret", ...init.headers },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  vi.mocked(createSupabaseRouteHandler).mockReset();
  vi.mocked(runPurgeAccounts).mockReset();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe("/api/cron/purge-accounts", () => {
  it("rejects requests without the bearer secret", async () => {
    const res = await GET(new Request("http://localhost/api/cron/purge-accounts"));

    expect(res.status).toBe(401);
    expect(runPurgeAccounts).not.toHaveBeenCalled();
  });

  it("purges due accounts", async () => {
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue({} as never);
    vi.mocked(runPurgeAccounts).mockResolvedValue({
      purgedCount: 1,
      users: [{ user_id: "user-1", households: ["hh-a"] }],
      expiredLinksDeleted: 2,
    });

    const res = await GET(authed("http://localhost/api/cron/purge-accounts"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      purgedCount: 1,
      users: [{ user_id: "user-1", households: ["hh-a"] }],
      expiredLinksDeleted: 2,
    });
  });

  it("returns zero when nothing is due (POST)", async () => {
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue({} as never);
    vi.mocked(runPurgeAccounts).mockResolvedValue({
      purgedCount: 0,
      users: [],
      expiredLinksDeleted: 0,
    });

    const res = await POST(authed("http://localhost/api/cron/purge-accounts", { method: "POST" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      purgedCount: 0,
      users: [],
      expiredLinksDeleted: 0,
    });
  });

  it("returns 422 past the sanity cap", async () => {
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue({} as never);
    vi.mocked(runPurgeAccounts).mockRejectedValue(new PurgeAccountsCapError(51, 50));

    const res = await GET(authed("http://localhost/api/cron/purge-accounts"));

    expect(res.status).toBe(422);
  });

  it("returns 502 on lookup failure", async () => {
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue({} as never);
    vi.mocked(runPurgeAccounts).mockRejectedValue(new Error("lookup failed: db down"));

    const res = await GET(authed("http://localhost/api/cron/purge-accounts"));

    expect(res.status).toBe(502);
  });
});
