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
  requireUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createRouteContext, getAuthedUser, requireUser } from "@/app/api/_shared";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { GET } from "./route";

const token = "b".repeat(64);
const householdId = "10000000-0000-4000-8000-000000000001";
const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function request(format?: string) {
  const suffix = format ? `?format=${format}` : "";
  return new Request(`http://localhost/api/exports/${token}${suffix}`);
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

type LinkRow = {
  token: string;
  household_id: string;
  format: string;
  expires_at: string;
  households: { id: string; name: string };
} | null;

function setup(opts: { link?: LinkRow; member?: { id: string } | null }) {
  const adminFrom = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.link ?? null, error: null }),
      })),
    })),
  }));
  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ from: adminFrom } as never);

  const authFrom = vi.fn((table: string) => {
    if (table === "household_members") {
      // Membership chain incl. the soft-deleted-household predicate:
      // select → eq → eq → is → is → maybeSingle.
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: opts.member ?? null, error: null }),
                })),
              })),
            })),
          })),
        })),
      };
    }
    return { select: vi.fn(() => ({ eq: vi.fn(() => tableChain()) })) };
  });
  vi.mocked(createRouteContext).mockResolvedValue({ from: authFrom } as never);
  vi.mocked(requireUser).mockResolvedValue({
    supabase: { from: authFrom } as never,
    user: { id: "user-1" } as never,
  });
  return { adminFrom, authFrom };
}

function linkRow(expires_at: string, format = "json"): Exclude<LinkRow, null> {
  return {
    token,
    household_id: householdId,
    format,
    expires_at,
    households: { id: householdId, name: "Casa" },
  };
}

beforeEach(() => {
  vi.mocked(createRouteContext).mockReset();
  vi.mocked(getAuthedUser).mockReset();
  vi.mocked(requireUser).mockReset();
  vi.mocked(createSupabaseServiceRoleClient).mockReset();
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
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      response: Response.json({ error: "authentication required" }, { status: 401 }),
    });

    const res = await GET(request(), { params: Promise.resolve({ token }) });

    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown token", async () => {
    setup({ link: null });

    const res = await GET(request(), { params: Promise.resolve({ token }) });

    expect(res.status).toBe(404);
  });

  it("returns 403 before checking expiry for a non-member", async () => {
    // Even with an expired link, a non-member gets 403: membership first.
    setup({ link: linkRow(past), member: null });

    const res = await GET(request(), { params: Promise.resolve({ token }) });

    expect(res.status).toBe(403);
  });

  it("returns 403 for a member of a soft-deleted household", async () => {
    // Household deletion revokes access immediately: the membership join
    // filters out deleted households, so the lookup yields no row — same
    // 403 as a non-member, and the link dies with the household.
    setup({ link: linkRow(future), member: null });

    const res = await GET(request(), { params: Promise.resolve({ token }) });

    expect(res.status).toBe(403);
  });

  it("returns 410 for an expired link presented by a member", async () => {
    setup({ link: linkRow(past), member: { id: "m-1" } });

    const res = await GET(request(), { params: Promise.resolve({ token }) });

    expect(res.status).toBe(410);
  });

  it("rejects a format override that disagrees with the link", async () => {
    setup({ link: linkRow(future, "json"), member: { id: "m-1" } });

    const res = await GET(request("csv"), { params: Promise.resolve({ token }) });

    expect(res.status).toBe(400);
  });

  it("streams the JSON backup for a member before expiry", async () => {
    setup({ link: linkRow(future), member: { id: "m-1" } });

    const res = await GET(request(), { params: Promise.resolve({ token }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(res.json()).resolves.toMatchObject({
      household: { id: householdId },
    });
  });
});
