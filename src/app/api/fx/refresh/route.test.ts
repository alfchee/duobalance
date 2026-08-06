import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseRouteHandler: vi.fn() }));
vi.mock("@/lib/fx/refresh", () => ({ runFxRefresh: vi.fn() }));

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { runFxRefresh } from "@/lib/fx/refresh";

// Only auth.getUser() is used by the handler (getAuthedUser); runFxRefresh is
// mocked, so the client it receives never touches the database.
function makeClient(user: unknown) {
  const getUser = vi
    .fn()
    .mockResolvedValue(
      user
        ? { data: { user }, error: null }
        : { data: { user: null }, error: new Error("no session") },
    );
  return { auth: { getUser } } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.mocked(createSupabaseRouteHandler).mockReset();
  vi.mocked(runFxRefresh).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/fx/refresh", () => {
  it("rejects an unauthenticated request", async () => {
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(makeClient(null));

    const res = await POST();

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "authentication required" });
    expect(runFxRefresh).not.toHaveBeenCalled();
  });

  it("runs the refresh for an authenticated user and returns counts", async () => {
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(makeClient({ id: "user-1" }));
    vi.mocked(runFxRefresh).mockResolvedValue({
      rateDate: "2026-08-06",
      inserted: 1,
      updated: 0,
      skipped: 0,
    });

    const res = await POST();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      rateDate: "2026-08-06",
      inserted: 1,
      updated: 0,
      skipped: 0,
    });
    expect(runFxRefresh).toHaveBeenCalledTimes(1);
  });

  it("maps a refresh failure to 502", async () => {
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(makeClient({ id: "user-1" }));
    vi.mocked(runFxRefresh).mockRejectedValue(new Error("provider down"));

    const res = await POST();

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "fx refresh failed" });
  });
});
