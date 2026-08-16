import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/_shared", () => ({
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  createRouteContext: vi.fn(),
  getAuthedUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createRouteContext, getAuthedUser, HttpError } from "@/app/api/_shared";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { GET } from "./route";

const householdId = "10000000-0000-4000-8000-000000000001";

function makeClient(
  member: {
    id?: string;
    removed_at?: string | null;
    households: { id: string; name: string };
  } | null,
  tablePages: Record<string, unknown[][]> = {},
  errorTables: ReadonlySet<string> = new Set(),
) {
  const orderCalls: Array<{ table: string; column: string }> = [];
  const rangeCalls: Array<{ table: string; from: number; to: number }> = [];
  const fromCalls: string[] = [];
  const lteCalls: Array<{ table: string; column: string; value: string }> = [];
  const orCalls: Array<{ table: string; expression: string }> = [];

  const callCounts = new Map<string, number>();

  function tableChain(table: string) {
    const pages = tablePages[table] ?? [[]];
    const chain: Record<string, unknown> = {};

    chain.order = vi.fn((column: string) => {
      orderCalls.push({ table, column });
      return chain;
    });

    chain.lte = vi.fn((column: string, value: string) => {
      lteCalls.push({ table, column, value });
      return chain;
    });

    chain.or = vi.fn((expression: string) => {
      orCalls.push({ table, expression });
      return chain;
    });

    chain.range = vi.fn((from: number, to: number) => {
      rangeCalls.push({ table, from, to });
      if (errorTables.has(table)) {
        return Promise.resolve({ data: null, error: { message: "boom" } });
      }
      const call = callCounts.get(table) ?? 0;
      callCounts.set(table, call + 1);
      const data = pages[call] ?? [];
      return Promise.resolve({ data, error: null });
    });

    return chain;
  }

  const membershipMaybeSingle = vi.fn().mockResolvedValue({ data: member, error: null });
  const membershipEqHousehold = vi.fn(() => ({ maybeSingle: membershipMaybeSingle }));
  const membershipEqUser = vi.fn(() => ({ eq: membershipEqHousehold }));
  const membershipSelect = vi.fn(() => ({ eq: membershipEqUser }));

  const from = vi.fn((table: string) => {
    fromCalls.push(table);
    if (table === "household_members") return { select: membershipSelect };
    return { select: vi.fn(() => ({ eq: vi.fn(() => tableChain(table)) })) };
  });

  return { from, orderCalls, rangeCalls, fromCalls, lteCalls, orCalls };
}

function request(format = "json") {
  return new Request(`http://localhost/api/export?format=${format}&householdId=${householdId}`);
}

beforeEach(() => {
  vi.mocked(createRouteContext).mockReset();
  vi.mocked(getAuthedUser).mockReset();
  vi.mocked(createSupabaseServiceRoleClient).mockReset();
  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(makeClient(null) as never);
  delete process.env.BUILD_TARGET;
});

afterEach(() => {
  delete process.env.BUILD_TARGET;
  vi.clearAllMocks();
});

describe("GET /api/export", () => {
  it("returns an unavailable response during Tauri static export", async () => {
    process.env.BUILD_TARGET = "tauri";

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(createRouteContext).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(createRouteContext).mockResolvedValue({} as never);
    vi.mocked(getAuthedUser).mockRejectedValue(new HttpError(401, "authentication required"));

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "authentication required" });
  });

  it("rejects callers who are not members of the requested household", async () => {
    const client = makeClient(null);
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const response = await GET(request());

    expect(response.status).toBe(403);
  });

  it("allows removed members to export past data via service role fallback with cutoff and privacy filters", async () => {
    const client = makeClient(null);
    const removedAt = "2026-08-01T12:00:00Z";
    const admin = makeClient({
      id: "member-1",
      removed_at: removedAt,
      households: { id: householdId, name: "Past Home" },
    });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(admin as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      household: { id: householdId, name: "Past Home" },
    });

    expect(admin.lteCalls).toContainEqual({
      table: "transactions",
      column: "created_at",
      value: removedAt,
    });
    expect(admin.orCalls).toContainEqual({
      table: "accounts",
      expression: "is_shared.eq.true,owner_member_id.eq.member-1",
    });
  });

  it("returns a non-cacheable JSON backup, ordering every table by id except fx_overrides", async () => {
    const client = makeClient({ households: { id: householdId, name: "Alex Home" } });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Content-Disposition")).toContain("duobalance-alex-home-");
    expect(client.orderCalls).toContainEqual({ table: "transactions", column: "id" });
    expect(client.orderCalls).toContainEqual({ table: "fx_overrides", column: "code" });
    expect(client.orderCalls).toContainEqual({ table: "fx_overrides", column: "rate_date" });
    expect(client.orderCalls).not.toContainEqual({ table: "fx_overrides", column: "id" });
    await expect(response.json()).resolves.toMatchObject({ household: { id: householdId } });
  });

  it("returns 502 instead of crashing when a table query errors", async () => {
    const client = makeClient(
      { households: { id: householdId, name: "Alex Home" } },
      {},
      new Set(["fx_overrides"]),
    );
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const response = await GET(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "export failed" });
  });

  it("paginates across the 1000-row boundary and concatenates all pages", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ id: `row-${i}` }));
    const partialPage = [{ id: "row-1000" }, { id: "row-1001" }, { id: "row-1002" }];
    const client = makeClient(
      { households: { id: householdId, name: "Alex Home" } },
      { transactions: [fullPage, partialPage] },
    );
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const response = await GET(request());
    const body = (await response.json()) as { data: { transactions: unknown[] } };

    expect(body.data.transactions).toHaveLength(1003);
    expect(client.rangeCalls.filter((call) => call.table === "transactions")).toEqual([
      { table: "transactions", from: 0, to: 999 },
      { table: "transactions", from: 1000, to: 1999 },
    ]);
  });

  it("returns a non-cacheable transaction CSV, only fetching the transactions table", async () => {
    const client = makeClient({ households: { id: householdId, name: "Alex Home" } });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const response = await GET(request("csv"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.text()).resolves.toContain("occurred_on");
    expect(client.fromCalls).toContain("transactions");
    expect(client.fromCalls).not.toContain("accounts");
    expect(client.fromCalls).not.toContain("fx_overrides");
  });

  it("neutralizes formula-injection strings but preserves negative numeric amounts", async () => {
    const row = {
      id: "tx-1",
      occurred_on: "2026-01-01",
      description: '=cmd|"/c calc"!A1',
      amount: -50,
      currency: "USD",
      base_amount: -50,
      fx_rate: 1,
      merchant: "+SUM(1,2)",
      notes: "@mention",
      account_id: "acc-1",
      category_id: "cat-1",
      spent_by: "member-1",
      is_cleared: true,
      is_pending_review: false,
      transfer_group_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const client = makeClient(
      { households: { id: householdId, name: "Alex Home" } },
      { transactions: [[row]] },
    );
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const response = await GET(request("csv"));
    const text = await response.text();

    expect(text).toContain(",-50,");
    expect(text).not.toContain("'-50");
    expect(text).toContain(`"'=cmd|""/c calc""!A1"`);
    expect(text).toContain("'+SUM(1,2)");
    expect(text).toContain("'@mention");
  });
});
