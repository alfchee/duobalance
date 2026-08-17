import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/invites/_shared", () => ({
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  createInviteRouteContext: vi.fn(),
  getAuthedUser: vi.fn(),
}));

vi.mock("@/lib/member-removal-email", () => ({
  isSupportedEmailLocale: (value: unknown) => value === "es" || value === "en",
  sendMemberRemovalEmail: vi.fn(),
}));

import { createInviteRouteContext, getAuthedUser, HttpError } from "@/app/api/invites/_shared";
import { sendMemberRemovalEmail } from "@/lib/member-removal-email";
import { POST } from "./route";

const householdId = "10000000-0000-4000-8000-000000000001";
const memberId = "10000000-0000-4000-8000-000000000002";

function request(body: unknown) {
  return new Request("http://localhost/api/members/remove", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makeContext(opts: {
  targetMember?: {
    id: string;
    display_name: string;
    user_id: string;
    households: { id: string; name: string; locale: string } | null;
  } | null;
  authUser?: { email: string } | null;
  authUserError?: unknown;
  rpcError?: { message: string } | null;
}) {
  const targetMember =
    opts.targetMember === undefined
      ? {
          id: memberId,
          display_name: "Bob",
          user_id: "user-bob",
          households: { id: householdId, name: "Casa Duo", locale: "es" },
        }
      : opts.targetMember;

  const maybeSingle = vi.fn().mockResolvedValue({ data: targetMember, error: null });
  const is = vi.fn(() => ({ maybeSingle }));
  const eqHousehold = vi.fn(() => ({ is }));
  const eqId = vi.fn(() => ({ eq: eqHousehold }));
  const select = vi.fn(() => ({ eq: eqId }));

  const getUserById = vi.fn().mockResolvedValue({
    data:
      opts.authUser === undefined
        ? { user: { email: "bob@example.com" } }
        : { user: opts.authUser },
    error: opts.authUserError ?? null,
  });

  const rpc = vi.fn().mockResolvedValue({ error: opts.rpcError ?? null });

  const admin = {
    from: vi.fn(() => ({ select })),
    auth: { admin: { getUserById } },
  };
  const auth = { rpc };

  return { auth, admin, rpc, getUserById, maybeSingle };
}

beforeEach(() => {
  vi.mocked(createInviteRouteContext).mockReset();
  vi.mocked(getAuthedUser).mockReset();
  vi.mocked(sendMemberRemovalEmail).mockReset();
  vi.mocked(sendMemberRemovalEmail).mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/members/remove", () => {
  it("rejects an unauthenticated caller", async () => {
    const ctx = makeContext({});
    vi.mocked(createInviteRouteContext).mockResolvedValue(ctx as never);
    vi.mocked(getAuthedUser).mockRejectedValue(new HttpError(401, "authentication required"));

    const res = await POST(request({ household_id: householdId, member_id: memberId }));

    expect(res.status).toBe(401);
    expect(ctx.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed request body", async () => {
    const ctx = makeContext({});
    vi.mocked(createInviteRouteContext).mockResolvedValue(ctx as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request({ household_id: "not-a-uuid" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid request body" });
    expect(ctx.rpc).not.toHaveBeenCalled();
  });

  it("returns 404 when the target member is not found or not active", async () => {
    const ctx = makeContext({ targetMember: null });
    vi.mocked(createInviteRouteContext).mockResolvedValue(ctx as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request({ household_id: householdId, member_id: memberId }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "target member not found or not active in this household",
    });
    expect(ctx.rpc).not.toHaveBeenCalled();
  });

  it("removes the member and sends a notification email", async () => {
    const ctx = makeContext({});
    vi.mocked(createInviteRouteContext).mockResolvedValue(ctx as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(
      request({
        household_id: householdId,
        member_id: memberId,
        account_disposition: { "acc-1": "transfer" },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, notified: true });
    expect(ctx.rpc).toHaveBeenCalledWith("remove_member", {
      p_household: householdId,
      p_member: memberId,
      p_account_disposition: { "acc-1": "transfer" },
    });
    expect(sendMemberRemovalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "bob@example.com", locale: "es" }),
    );
  });

  it("removes the member without a notification when no email is on file", async () => {
    const ctx = makeContext({ authUser: null });
    vi.mocked(createInviteRouteContext).mockResolvedValue(ctx as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request({ household_id: householdId, member_id: memberId }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, notified: false });
    expect(sendMemberRemovalEmail).not.toHaveBeenCalled();
  });

  it("logs and reports notified:false when the getUserById lookup errors", async () => {
    const ctx = makeContext({ authUser: null, authUserError: { message: "rate limited" } });
    vi.mocked(createInviteRouteContext).mockResolvedValue(ctx as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request({ household_id: householdId, member_id: memberId }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, notified: false });
    expect(console.error).toHaveBeenCalledWith(
      "members/remove: failed to look up target user email",
      { message: "rate limited" },
    );
  });

  it("removes the member and reports notified:false when the email send fails", async () => {
    const ctx = makeContext({});
    vi.mocked(createInviteRouteContext).mockResolvedValue(ctx as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(sendMemberRemovalEmail).mockRejectedValue(new Error("resend down"));

    const res = await POST(request({ household_id: householdId, member_id: memberId }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, notified: false });
    expect(console.error).toHaveBeenCalledWith(
      "members/remove: failed to send member removal email",
      expect.any(Error),
    );
  });

  it("falls back to English when the household locale isn't a supported email locale", async () => {
    const ctx = makeContext({
      targetMember: {
        id: memberId,
        display_name: "Bob",
        user_id: "user-bob",
        households: { id: householdId, name: "Casa Duo", locale: "pt-BR" },
      },
    });
    vi.mocked(createInviteRouteContext).mockResolvedValue(ctx as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    await POST(request({ household_id: householdId, member_id: memberId }));

    expect(sendMemberRemovalEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: "en" }));
  });

  it("maps the unresolved-owned-accounts RPC failure to 400", async () => {
    const ctx = makeContext({ rpcError: { message: "unresolved owned accounts" } });
    vi.mocked(createInviteRouteContext).mockResolvedValue(ctx as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request({ household_id: householdId, member_id: memberId }));

    expect(res.status).toBe(400);
    expect(sendMemberRemovalEmail).not.toHaveBeenCalled();
  });

  it("maps a TOCTOU target-not-found RPC failure to 404, matching the pre-check", async () => {
    const ctx = makeContext({
      rpcError: { message: "target member not found or not active in this household" },
    });
    vi.mocked(createInviteRouteContext).mockResolvedValue(ctx as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request({ household_id: householdId, member_id: memberId }));

    expect(res.status).toBe(404);
  });

  it("maps every other RPC failure (e.g. not an owner, cannot remove an owner) to 403", async () => {
    const ctx = makeContext({
      rpcError: { message: "cannot remove another owner; transfer ownership before removal" },
    });
    vi.mocked(createInviteRouteContext).mockResolvedValue(ctx as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request({ household_id: householdId, member_id: memberId }));

    expect(res.status).toBe(403);
  });
});
