import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseRouteHandler: vi.fn() }));
import { createSupabaseRouteHandler } from "@/lib/supabase/server";

const payload = {
  householdId: "10000000-0000-4000-8000-000000000001",
  memberId: "10000000-0000-4000-8000-000000000002",
  endpoint: "https://push.example/subscription",
  p256dh: "key",
  auth: "auth",
  userAgent: "test-agent",
};

function makeClient(
  options: { user?: { id: string } | null; member?: unknown; existing?: unknown } = {},
) {
  const member = options.member === undefined ? { id: payload.memberId } : options.member;
  const existing = options.existing === undefined ? null : options.existing;
  const maybeSingle = vi.fn().mockResolvedValue({ data: member, error: null });
  const endpointMaybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) })),
  }));
  const remove = vi.fn(() => ({
    eq: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) })),
  }));
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? { id: "user-1" } } }),
    },
    from: vi.fn((table: string) => {
      if (table === "household_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: endpointMaybeSingle })) })),
        insert,
        update,
        delete: remove,
      };
    }),
    insert,
    update,
    remove,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("push subscriptions", () => {
  it("returns 400 for malformed POST and DELETE bodies", async () => {
    const post = await POST(
      new Request("http://localhost/api/push-subscriptions", { method: "POST", body: "{" }),
    );
    const remove = await DELETE(
      new Request("http://localhost/api/push-subscriptions", { method: "DELETE", body: "{}" }),
    );

    expect(post.status).toBe(400);
    expect(remove.status).toBe(400);
  });

  it("creates a subscription for its authenticated member", async () => {
    const client = makeClient();
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const response = await POST(
      new Request("http://localhost/api/push-subscriptions", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(204);
    expect(client.insert).toHaveBeenCalledTimes(1);
  });

  it("rejects an endpoint owned by another member", async () => {
    const client = makeClient({
      existing: {
        household_id: payload.householdId,
        member_id: "10000000-0000-4000-8000-000000000003",
      },
    });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const response = await POST(
      new Request("http://localhost/api/push-subscriptions", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(409);
    expect(client.insert).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
  });
});
