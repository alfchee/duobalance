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

import { createRouteContext, getAuthedUser, HttpError } from "@/app/api/_shared";
import { GET } from "./route";

const householdId = "10000000-0000-4000-8000-000000000001";

function makeClient(member: { households: { id: string; name: string } } | null) {
  const range = vi.fn().mockResolvedValue({ data: [], error: null });
  const order = vi.fn(() => ({ range }));
  const exportEq = vi.fn(() => ({ order }));
  const membershipMaybeSingle = vi.fn().mockResolvedValue({ data: member, error: null });
  const membershipEqHousehold = vi.fn(() => ({ maybeSingle: membershipMaybeSingle }));
  const membershipEqUser = vi.fn(() => ({ eq: membershipEqHousehold }));
  const membershipSelect = vi.fn(() => ({ eq: membershipEqUser }));
  const from = vi.fn((table: string) =>
    table === "household_members"
      ? { select: membershipSelect }
      : { select: vi.fn(() => ({ eq: exportEq })) },
  );
  return { from, range, order };
}

function request(format = "json") {
  return new Request(`http://localhost/api/export?format=${format}&householdId=${householdId}`);
}

beforeEach(() => {
  vi.mocked(createRouteContext).mockReset();
  vi.mocked(getAuthedUser).mockReset();
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

  it("returns a non-cacheable JSON backup with deterministic pagination", async () => {
    const client = makeClient({ households: { id: householdId, name: "Alex Home" } });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Content-Disposition")).toContain("duobalance-alex-home-");
    expect(client.order).toHaveBeenCalledWith("id", { ascending: true });
    await expect(response.json()).resolves.toMatchObject({ household: { id: householdId } });
  });

  it("returns a non-cacheable transaction CSV", async () => {
    const client = makeClient({ households: { id: householdId, name: "Alex Home" } });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const response = await GET(request("csv"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.text()).resolves.toContain("occurred_on");
  });
});
