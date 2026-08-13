import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseRouteHandler: vi.fn() }));
import { createSupabaseRouteHandler } from "@/lib/supabase/server";

vi.mock("@/lib/bill-reminder-email", () => ({ sendReminderDigest: vi.fn() }));
import { sendReminderDigest } from "@/lib/bill-reminder-email";

vi.mock("@/lib/web-push", () => ({ sendBillReminderPush: vi.fn() }));
import { sendBillReminderPush } from "@/lib/web-push";

function authedRequest(path: string, init: RequestInit = {}): Request {
  return new Request(path, {
    ...init,
    headers: { authorization: "Bearer test-secret", ...init.headers },
  });
}

function makeClient(
  reminderRows: unknown[],
  opts?: {
    memberRows?: unknown[];
    userRows?: { id: string; email: string }[];
    subscriptionRows?: unknown[];
  },
) {
  const members = opts?.memberRows ?? [];
  const users = opts?.userRows ?? [];
  const subscriptions = opts?.subscriptionRows ?? [];
  return {
    rpc: vi.fn((name: string) => {
      if (name === "bill_instances_due_for_reminder") {
        return Promise.resolve({ data: reminderRows, error: null });
      }
      if (name === "get_user_emails_batch") {
        return Promise.resolve({ data: users, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    from: vi.fn((table: string) => {
      if (table === "household_members") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ data: members, error: null })),
            eq: vi.fn(() => ({
              select: vi.fn(() => Promise.resolve({ data: members, error: null })),
            })),
          })),
        };
      }
      if (table === "bill_instances") {
        return {
          update: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ error: null })),
          })),
        };
      }
      if (table === "push_subscriptions") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ data: subscriptions, error: null })),
          })),
          delete: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ error: null })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  process.env.RESEND_API_KEY = "re_secret";
  vi.mocked(sendBillReminderPush).mockResolvedValue("failed");
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.RESEND_API_KEY;
  vi.clearAllMocks();
});

describe("/api/cron/send-bill-reminders", () => {
  it("rejects a GET with no credentials", async () => {
    const res = await GET(new Request("http://localhost/api/cron/send-bill-reminders"));
    expect(res.status).toBe(401);
  });

  it("rejects a POST with no credentials", async () => {
    const res = await POST(
      new Request("http://localhost/api/cron/send-bill-reminders", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a wrong Bearer secret", async () => {
    const res = await POST(
      new Request("http://localhost/api/cron/send-bill-reminders", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 502 when RESEND_API_KEY is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await GET(authedRequest("http://localhost/api/cron/send-bill-reminders"));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "RESEND_API_KEY not configured" });
  });

  it("returns 200 with zero counts when no reminders are due", async () => {
    const client = makeClient([]);
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const res = await GET(authedRequest("http://localhost/api/cron/send-bill-reminders"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 0, instances: 0 });
  });

  it("sends a digest and marks instances as reminded", async () => {
    vi.mocked(sendReminderDigest).mockResolvedValue(undefined);

    const client = makeClient(
      [
        {
          instance_id: "i-1",
          bill_id: "b-1",
          household_id: "h-1",
          due_on: "2026-08-15",
          amount: 1000,
          bill_name: "Rent",
          currency: "USD",
          responsible_member_id: "m-1",
          household_name: "Test Home",
          household_timezone: "America/New_York",
          household_locale: "en",
        },
      ],
      {
        memberRows: [{ id: "m-1", user_id: "u-1", display_name: "Alice", household_id: "h-1" }],
        userRows: [{ id: "u-1", email: "alice@test.local" }],
      },
    );
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const res = await POST(
      authedRequest("http://localhost/api/cron/send-bill-reminders", { method: "POST" }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 1, instances: 1 });
    expect(sendReminderDigest).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["alice@test.local"],
        memberName: "Alice",
        householdName: "Test Home",
        locale: "en",
      }),
    );
  });

  it("prefers a successful push delivery over email", async () => {
    vi.mocked(sendBillReminderPush).mockResolvedValue("sent");
    const client = makeClient(
      [
        {
          instance_id: "i-1",
          bill_id: "b-1",
          household_id: "h-1",
          due_on: "2026-08-15",
          amount: 1000,
          bill_name: "Rent",
          currency: "USD",
          responsible_member_id: "m-1",
          household_name: "Test Home",
          household_timezone: "America/New_York",
          household_locale: "en",
        },
      ],
      {
        memberRows: [{ id: "m-1", user_id: "u-1", display_name: "Alice", household_id: "h-1" }],
        userRows: [{ id: "u-1", email: "alice@test.local" }],
        subscriptionRows: [
          {
            id: "p-1",
            member_id: "m-1",
            endpoint: "https://push.example/subscription",
            p256dh: "key",
            auth: "auth",
          },
        ],
      },
    );
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const res = await GET(authedRequest("http://localhost/api/cron/send-bill-reminders"));

    expect(res.status).toBe(200);
    expect(sendBillReminderPush).toHaveBeenCalledTimes(1);
    expect(sendReminderDigest).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ sent: 1, instances: 1 });
  });

  it("handles joint bills by sending individual emails to each member", async () => {
    vi.mocked(sendReminderDigest).mockResolvedValue(undefined);

    const client = makeClient(
      [
        {
          instance_id: "i-2",
          bill_id: "b-2",
          household_id: "h-1",
          due_on: "2026-08-20",
          amount: 500,
          bill_name: "Groceries",
          currency: "USD",
          responsible_member_id: null,
          household_name: "Test Home",
          household_timezone: "America/New_York",
          household_locale: "en",
        },
      ],
      {
        memberRows: [
          { id: "m-1", user_id: "u-1", display_name: "Alice", household_id: "h-1" },
          { id: "m-2", user_id: "u-2", display_name: "Bob", household_id: "h-1" },
        ],
        userRows: [
          { id: "u-1", email: "alice@test.local" },
          { id: "u-2", email: "bob@test.local" },
        ],
      },
    );
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const res = await GET(authedRequest("http://localhost/api/cron/send-bill-reminders"));

    expect(res.status).toBe(200);
    // Two individual emails sent
    expect(sendReminderDigest).toHaveBeenCalledTimes(2);
    expect(sendReminderDigest).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["alice@test.local"] }),
    );
    expect(sendReminderDigest).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["bob@test.local"] }),
    );
  });

  it("continues when one digest fails and still marks successful ones", async () => {
    vi.mocked(sendReminderDigest)
      .mockRejectedValueOnce(new Error("resend error")) // first fails
      .mockResolvedValueOnce(undefined); // second succeeds

    const client = makeClient(
      [
        {
          instance_id: "i-1",
          bill_id: "b-1",
          household_id: "h-1",
          due_on: "2026-08-15",
          amount: 1000,
          bill_name: "Rent",
          currency: "USD",
          responsible_member_id: "m-1",
          household_name: "Test",
          household_timezone: "America/New_York",
          household_locale: "en",
        },
        {
          instance_id: "i-2",
          bill_id: "b-2",
          household_id: "h-1",
          due_on: "2026-08-20",
          amount: 500,
          bill_name: "Water",
          currency: "USD",
          responsible_member_id: "m-2",
          household_name: "Test",
          household_timezone: "America/New_York",
          household_locale: "en",
        },
      ],
      {
        memberRows: [
          { id: "m-1", user_id: "u-1", display_name: "Alice", household_id: "h-1" },
          { id: "m-2", user_id: "u-2", display_name: "Bob", household_id: "h-1" },
        ],
        userRows: [
          { id: "u-1", email: "alice@test.local" },
          { id: "u-2", email: "bob@test.local" },
        ],
      },
    );
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const res = await GET(authedRequest("http://localhost/api/cron/send-bill-reminders"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 1, instances: 1 });
    // Only the successful instance should be marked as reminded
  });

  it("rejects a vercel-cron user agent when no CRON_SECRET is configured", async () => {
    delete process.env.CRON_SECRET;
    const client = makeClient([]);
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const res = await GET(
      new Request("http://localhost/api/cron/send-bill-reminders", {
        headers: { "user-agent": "vercel-cron/1.0" },
      }),
    );

    expect(res.status).toBe(401);
  });

  it("returns 502 and does not send anything when the member lookup fails", async () => {
    const client = {
      rpc: vi.fn((name: string) => {
        if (name === "bill_instances_due_for_reminder") {
          return Promise.resolve({
            data: [
              {
                instance_id: "i-1",
                bill_id: "b-1",
                household_id: "h-1",
                due_on: "2026-08-15",
                amount: 1000,
                bill_name: "Rent",
                currency: "USD",
                responsible_member_id: "m-1",
                household_name: "Test Home",
                household_timezone: "America/New_York",
                household_locale: "en",
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(() => Promise.resolve({ data: null, error: { message: "connection reset" } })),
        })),
      })),
    };
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const res = await GET(authedRequest("http://localhost/api/cron/send-bill-reminders"));

    expect(res.status).toBe(502);
    expect(sendReminderDigest).not.toHaveBeenCalled();
  });

  it("continues attempting every recipient in a joint digest even if an earlier one fails", async () => {
    vi.mocked(sendReminderDigest)
      .mockRejectedValueOnce(new Error("resend error")) // Alice fails
      .mockResolvedValueOnce(undefined); // Bob must still be attempted

    const client = makeClient(
      [
        {
          instance_id: "i-2",
          bill_id: "b-2",
          household_id: "h-1",
          due_on: "2026-08-20",
          amount: 500,
          bill_name: "Groceries",
          currency: "USD",
          responsible_member_id: null,
          household_name: "Test Home",
          household_timezone: "America/New_York",
          household_locale: "en",
        },
      ],
      {
        memberRows: [
          { id: "m-1", user_id: "u-1", display_name: "Alice", household_id: "h-1" },
          { id: "m-2", user_id: "u-2", display_name: "Bob", household_id: "h-1" },
        ],
        userRows: [
          { id: "u-1", email: "alice@test.local" },
          { id: "u-2", email: "bob@test.local" },
        ],
      },
    );
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(client as never);

    const res = await GET(authedRequest("http://localhost/api/cron/send-bill-reminders"));

    expect(res.status).toBe(200);
    // Bob must still get an attempt even though Alice's send failed first.
    expect(sendReminderDigest).toHaveBeenCalledTimes(2);
    expect(sendReminderDigest).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["bob@test.local"] }),
    );
    // The group isn't marked reminded because not every recipient succeeded.
    await expect(res.json()).resolves.toEqual({ sent: 0, instances: 0 });
  });
});
