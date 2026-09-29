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
import { POST } from "./route";

const created = {
  id: "req-1",
  status: "pending",
  requested_at: "2026-09-29T00:00:00Z",
  confirmed_at: null,
  scheduled_purge_at: null,
  purged_at: null,
};

function request() {
  return new Request("http://localhost/api/account/deletion-request", { method: "POST" });
}

function makeClient(opts: {
  open?: { id: string; status: string } | null;
  created?: typeof created | null;
  insertError?: { message: string; code: string } | null;
}) {
  const openMaybe = vi.fn().mockResolvedValue({ data: opts.open ?? null, error: null });
  const createSingle = vi.fn().mockResolvedValue({
    data: opts.created ?? null,
    error: opts.insertError ?? null,
  });
  const selectEq = vi.fn(() => ({ in: vi.fn(() => ({ maybeSingle: openMaybe })) }));
  const from = vi.fn((table: string) => {
    if (table !== "account_deletion_requests") throw new Error(`unexpected table ${table}`);
    return {
      select: vi.fn(() => ({ eq: selectEq })),
      insert: vi.fn(() => ({ select: vi.fn(() => ({ single: createSingle })) })),
    };
  });
  return { from, openMaybe, createSingle };
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

describe("POST /api/account/deletion-request", () => {
  it("rejects unauthenticated callers", async () => {
    vi.mocked(createRouteContext).mockResolvedValue({} as never);
    vi.mocked(getAuthedUser).mockRejectedValue(new HttpError(401, "authentication required"));

    expect((await POST(request())).status).toBe(401);
  });

  it("returns 409 when a request is already open", async () => {
    const client = makeClient({ open: { id: "req-0", status: "confirmed" } });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request());

    expect(res.status).toBe(409);
  });

  it("creates a pending request", async () => {
    const client = makeClient({ open: null, created });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request());

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ request: created });
  });

  it("maps a concurrent-insert race to 409", async () => {
    const client = makeClient({
      open: null,
      insertError: { message: "duplicate key value", code: "23505" },
    });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request());

    expect(res.status).toBe(409);
  });
});
