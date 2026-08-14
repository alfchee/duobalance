import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseRouteHandler: vi.fn(),
  createSupabaseServiceRoleClient: vi.fn(),
}));
import { createSupabaseRouteHandler, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const payload = {
  householdId: "10000000-0000-4000-8000-000000000001",
  memberId: "10000000-0000-4000-8000-000000000002",
  endpoint: "https://push.example/subscription",
  p256dh: "key",
  auth: "auth",
  userAgent: "test-agent",
};

// The RLS-scoped client: only used for auth.getUser() and the
// household_members ownership check (filtered by user_id = the caller).
function makeRouteHandlerClient(options: { user?: { id: string } | null; member?: unknown } = {}) {
  const member = options.member === undefined ? { id: payload.memberId } : options.member;
  const memberEqUser = vi.fn(() => ({
    maybeSingle: vi.fn().mockResolvedValue({ data: member, error: null }),
  }));
  const memberEqHousehold = vi.fn(() => ({ eq: memberEqUser }));
  const memberEqId = vi.fn(() => ({ eq: memberEqHousehold }));
  const deleteEqEndpoint = vi.fn().mockResolvedValue({ error: null });
  const deleteEqMember = vi.fn(() => ({ eq: deleteEqEndpoint }));
  const deleteEqHousehold = vi.fn(() => ({ eq: deleteEqMember }));
  const user = options.user === undefined ? { id: "user-1" } : options.user;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn((table: string) => {
      if (table === "household_members") {
        return { select: vi.fn(() => ({ eq: memberEqId })) };
      }
      // push_subscriptions.delete() — used by DELETE only.
      return { delete: vi.fn(() => ({ eq: deleteEqHousehold })) };
    }),
    deleteEqHousehold,
    deleteEqEndpoint,
  };
}

// The service-role client: used for the endpoint pre-check and write in POST.
function makeAdminClient(options: { existing?: { id: string } | null; error?: unknown } = {}) {
  const existing = options.existing === undefined ? null : options.existing;
  const selectMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: existing, error: options.error ?? null });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const updateEqId = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({ eq: updateEqId }));
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: selectMaybeSingle })) })),
      insert,
      update,
    })),
    insert,
    update,
    updateEqId,
  };
}

function postRequest(body: unknown = payload) {
  return new Request("http://localhost/api/push-subscriptions", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deleteRequest(body: unknown = payload) {
  return new Request("http://localhost/api/push-subscriptions", {
    method: "DELETE",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/push-subscriptions", () => {
  it("returns 400 for a malformed body", async () => {
    const response = await POST(postRequest("{"));
    expect(response.status).toBe(400);
  });

  it("returns 401 when there is no authenticated user", async () => {
    const client = makeRouteHandlerClient({ user: null });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const response = await POST(postRequest());

    expect(response.status).toBe(401);
  });

  it("returns 403 when memberId does not belong to the caller", async () => {
    const client = makeRouteHandlerClient({ member: null });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);
    const admin = makeAdminClient();
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(admin as never);

    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("creates a subscription when no row exists for this endpoint", async () => {
    const client = makeRouteHandlerClient();
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);
    const admin = makeAdminClient({ existing: null });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(admin as never);

    const response = await POST(postRequest());

    expect(response.status).toBe(204);
    expect(admin.insert).toHaveBeenCalledTimes(1);
    expect(admin.update).not.toHaveBeenCalled();
  });

  it("reassigns an endpoint previously owned by another member instead of returning a permanent conflict", async () => {
    const client = makeRouteHandlerClient();
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);
    const admin = makeAdminClient({ existing: { id: "existing-row-id" } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(admin as never);

    const response = await POST(postRequest());

    expect(response.status).toBe(204);
    expect(admin.update).toHaveBeenCalledTimes(1);
    expect(admin.updateEqId).toHaveBeenCalledWith("id", "existing-row-id");
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("returns 502 when the endpoint lookup errors", async () => {
    const client = makeRouteHandlerClient();
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);
    const admin = makeAdminClient({ error: { message: "boom" } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(admin as never);

    const response = await POST(postRequest());

    expect(response.status).toBe(502);
  });

  it("returns 409 on a unique-constraint race", async () => {
    const client = makeRouteHandlerClient();
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);
    const admin = makeAdminClient({ existing: null });
    admin.insert.mockResolvedValue({ error: { code: "23505" } });
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(admin as never);

    const response = await POST(postRequest());

    expect(response.status).toBe(409);
  });
});

describe("DELETE /api/push-subscriptions", () => {
  it("returns 400 for a malformed body", async () => {
    const response = await DELETE(deleteRequest("{"));
    expect(response.status).toBe(400);
  });

  it("returns 401 when there is no authenticated user", async () => {
    const client = makeRouteHandlerClient({ user: null });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(401);
  });

  it("returns 403 when memberId does not belong to the caller", async () => {
    const client = makeRouteHandlerClient({ member: null });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(403);
    expect(client.deleteEqHousehold).not.toHaveBeenCalled();
  });

  it("removes the caller's own subscription", async () => {
    const client = makeRouteHandlerClient();
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(204);
    expect(client.deleteEqHousehold).toHaveBeenCalledWith("household_id", payload.householdId);
    expect(client.deleteEqEndpoint).toHaveBeenCalledWith("endpoint", payload.endpoint);
  });
});
