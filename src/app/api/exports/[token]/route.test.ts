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

const token = "b".repeat(64);
const householdId = "10000000-0000-4000-8000-000000000001";
const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function request() {
  return new Request(`http://localhost/api/exports/${token}`);
}

function tableChain(pages: unknown[][] = [[]]) {
  let call = 0;
  const chain: Record<string, unknown> = {};
  chain.order = vi.fn(() => chain);
  chain.range = vi.fn(() => {
    const data = pages[call] ?? [];
    call += 1;
    return Promise.resolve({ data, error: null });
  });
  return chain;
}

function makeClient(opts: {
  link?: {
    token: string;
    household_id: string;
    format: string;
    expires_at: string;
    households: { id: string; name: string };
  } | null;
  member?: { id: string } | null;
}) {
  const from = vi.fn((table: string) => {
    if (table === "data_export_links") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: opts.link ?? null, error: null }),
          })),
        })),
      };
    }
    if (table === "household_members") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: opts.member ?? null, error: null }),
              })),
            })),
          })),
        })),
      };
    }
    return { select: vi.fn(() => ({ eq: vi.fn(() => tableChain()) })) };
  });
  return { from };
}

function linkRow(expires_at: string) {
  return {
    token,
    household_id: householdId,
    format: "json",
    expires_at,
    households: { id: householdId, name: "Casa" },
  };
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

describe("GET /api/exports/[token]", () => {
  it("returns 404 for a malformed token without touching auth", async () => {
    const res = await GET(new Request("http://localhost/api/exports/not-a-token"), {
      params: Promise.resolve({ token: "not-a-token" }),
    });

    expect(res.status).toBe(404);
    expect(createRouteContext).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    vi.mocked(createRouteContext).mockResolvedValue({} as never);
    vi.mocked(getAuthedUser).mockRejectedValue(new HttpError(401, "authentication required"));

    const res = await GET(request(), { params: Promise.resolve({ token }) });

    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown token", async () => {
    const client = makeClient({ link: null });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await GET(request(), { params: Promise.resolve({ token }) });

    expect(res.status).toBe(404);
  });

  it("returns 410 for an expired link", async () => {
    const client = makeClient({ link: linkRow(past), member: { id: "m-1" } });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await GET(request(), { params: Promise.resolve({ token }) });

    expect(res.status).toBe(410);
  });

  it("returns 403 when the caller is not a member of the link household", async () => {
    const client = makeClient({ link: linkRow(future), member: null });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await GET(request(), { params: Promise.resolve({ token }) });

    expect(res.status).toBe(403);
  });

  it("streams the JSON backup for a member before expiry", async () => {
    const client = makeClient({ link: linkRow(future), member: { id: "m-1" } });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await GET(request(), { params: Promise.resolve({ token }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(res.json()).resolves.toMatchObject({
      household: { id: householdId },
    });
  });
});
