import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/bill-reminder-email", () => ({ sendReminderDigest: vi.fn() }));
import { sendReminderDigest } from "@/lib/bill-reminder-email";

vi.mock("@/lib/web-push", () => ({ sendBillReminderPush: vi.fn() }));
import { sendBillReminderPush } from "@/lib/web-push";

import { runSendBillReminders } from "./send-bill-reminders";

function makeClient(
  reminderRows: unknown[],
  opts?: {
    memberRows?: unknown[];
    userRows?: { id: string; email: string }[];
    subscriptionRows?: unknown[];
    updateError?: unknown;
    rpcError?: unknown;
    memberError?: unknown;
  },
): Record<string, unknown> & {
  rpc: ReturnType<typeof vi.fn>;
  deletePushSubscriptionsIn: ReturnType<typeof vi.fn>;
  updateIn: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
} {
  const members = opts?.memberRows ?? [];
  const users = opts?.userRows ?? [];
  const subscriptions = opts?.subscriptionRows ?? [];
  const deletePushSubscriptionsIn = vi.fn().mockResolvedValue({ error: null });
  const updateIn = vi.fn(() =>
    Promise.resolve(opts?.updateError ? { error: opts.updateError } : { error: null }),
  );
  const update = vi.fn(() => ({ in: updateIn }));
  return {
    rpc: vi.fn((name: string) => {
      if (opts?.rpcError && name === "bill_instances_due_for_reminder")
        return Promise.resolve({ data: null, error: opts.rpcError });
      if (name === "bill_instances_due_for_reminder")
        return Promise.resolve({ data: reminderRows, error: null });
      if (name === "get_user_emails_batch") return Promise.resolve({ data: users, error: null });
      return Promise.resolve({ data: null, error: null });
    }),
    deletePushSubscriptionsIn,
    updateIn,
    from: vi.fn((table: string) => {
      if (table === "household_members") {
        if (opts?.memberError)
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => ({
                is: vi.fn(() => Promise.resolve({ data: null, error: opts.memberError })),
              })),
            })),
          };
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              is: vi.fn(() => Promise.resolve({ data: members, error: null })),
            })),
          })),
        };
      }
      if (table === "bill_instances") {
        return { update };
      }
      if (table === "push_subscriptions") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => Promise.resolve({ data: subscriptions, error: null })),
          })),
          delete: vi.fn(() => ({ in: deletePushSubscriptionsIn })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as ReturnType<typeof makeClient> & { updateIn: typeof updateIn };
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_secret";
  vi.mocked(sendBillReminderPush).mockResolvedValue("failed");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("runSendBillReminders", () => {
  it("throws when RESEND_API_KEY is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const client = makeClient([]) as never;
    await expect(runSendBillReminders(client as never)).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("returns zero counts when no reminders are due", async () => {
    const client = makeClient([]);
    const result = await runSendBillReminders(client as never);
    expect(result).toEqual({ sent: 0, instances: 0 });
  });

  it("propagates fetch reminders failure", async () => {
    const client = makeClient([], { rpcError: { message: "db down" } });
    await expect(runSendBillReminders(client as never)).rejects.toThrow(/fetch reminders failed/);
  });

  it("sends a digest for a responsible member and returns sent:1", async () => {
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
    const result = await runSendBillReminders(client as never);
    expect(result).toEqual({ sent: 1, instances: 1 });
    expect(sendReminderDigest).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["alice@test.local"], memberName: "Alice" }),
    );
  });

  it("prefers push over email when push succeeds", async () => {
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
            endpoint: "https://push.example/s",
            p256dh: "k",
            auth: "a",
          },
        ],
      },
    );
    const result = await runSendBillReminders(client as never);
    expect(result).toEqual({ sent: 1, instances: 1 });
    expect(sendBillReminderPush).toHaveBeenCalledTimes(1);
    expect(sendReminderDigest).not.toHaveBeenCalled();
  });

  it("prunes gone subscriptions and falls back to email", async () => {
    vi.mocked(sendBillReminderPush).mockResolvedValue("gone");
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
        subscriptionRows: [
          {
            id: "dead-sub",
            member_id: "m-1",
            endpoint: "https://push.example/s",
            p256dh: "k",
            auth: "a",
          },
        ],
      },
    );
    const result = await runSendBillReminders(client as never);
    expect(result).toEqual({ sent: 1, instances: 1 });
    expect(sendReminderDigest).toHaveBeenCalledTimes(1);
    expect(client.deletePushSubscriptionsIn).toHaveBeenCalledWith("id", ["dead-sub"]);
  });

  it("marks only successful groups, not failed ones", async () => {
    vi.mocked(sendReminderDigest)
      .mockRejectedValueOnce(new Error("resend error"))
      .mockResolvedValueOnce(undefined);
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
    const result = await runSendBillReminders(client as never);
    expect(result).toEqual({ sent: 1, instances: 1 });
    // update called with only successful instance
    expect(client.updateIn).toHaveBeenCalledWith("id", ["i-2"]);
  });

  it("throws when marking reminded_at fails", async () => {
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
        updateError: { message: "update failed" },
      },
    );
    await expect(runSendBillReminders(client as never)).rejects.toThrow(/failed to mark instances/);
  });
});
