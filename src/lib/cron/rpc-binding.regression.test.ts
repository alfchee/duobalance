// Regression test for #244.
//
// `SupabaseClient.rpc` is an instance method implemented as
// `return this.rest.rpc(...)`. Extracting it (`const rpc = supabase.rpc`)
// and calling `rpc(...)` loses `this` and throws
// "Cannot read properties of undefined (reading 'rest')" on the real client.
// Plain `vi.fn()` mocks hide the bug because they ignore `this`.
//
// These fakes are intentionally `this`-sensitive: `rpc` reads `this.rest`,
// so a detached extraction throws exactly like production, while bound
// `supabase.rpc(...)` invocation works.
//
// JS nuance (verified with node): `const f = c.rpc; f()` loses `this`,
// but the grouped form `(c.rpc)()` preserves it. So only the
// `const rpc = supabase.rpc` pattern in `send-bill-reminders.ts` caused the
// production crash; the grouped casts in `bill-instances.ts` and
// `app/api/bills/[id]/generate/route.ts` worked but were fragile, and are
// now bound calls too. The reminder tests below reproduce the exact production
// TypeError on the pre-fix code (the non-empty one covers the second,
// email-batch RPC, which the empty-inbox path never reaches); the generation
// test locks in bound-call behavior for that path.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sendReminderDigest } from "@/lib/bill-reminder-email";
import { sendBillReminderPush } from "@/lib/web-push";
import { runSendBillReminders } from "./send-bill-reminders";
import { generateAllInstances } from "@/lib/bill-instances";

vi.mock("@/lib/bill-reminder-email", () => ({ sendReminderDigest: vi.fn() }));
vi.mock("@/lib/web-push", () => ({ sendBillReminderPush: vi.fn() }));

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_secret";
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  vi.restoreAllMocks();
});

// Minimal `this`-sensitive stand-in for SupabaseClient for the
// send-bill-reminders path (empty inbox → only the first RPC is hit).
class ThisSensitiveReminderClient {
  rest = { marker: true };

  async rpc(
    this: ThisSensitiveReminderClient,
    fn: string,
  ): Promise<{ data: unknown[]; error: null }> {
    // Mimics the real client: detached calls have `this === undefined` and
    // throw `Cannot read properties of undefined (reading 'rest')`.
    void this.rest.marker;
    if (fn === "bill_instances_due_for_reminder") {
      return { data: [], error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  }

  from() {
    throw new Error("from() should not be called when no reminders are due");
  }
}

// `this`-sensitive stand-in exercising the full non-empty path, including
// the second RPC (`get_user_emails_batch`). The empty-inbox client above
// returns before that call, so without this a future unbound extraction
// scoped to just the email lookup would stay green while crashing in
// production on any non-empty inbox.
class ThisSensitiveReminderClientWithInbox {
  rest = { marker: true };

  async rpc(
    this: ThisSensitiveReminderClientWithInbox,
    fn: string,
    _args?: Record<string, unknown>,
  ): Promise<{ data: unknown[]; error: null }> {
    void this.rest.marker;
    if (fn === "bill_instances_due_for_reminder") {
      return {
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
      };
    }
    if (fn === "get_user_emails_batch") {
      return { data: [{ id: "u-1", email: "alice@test.local" }], error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  }

  from(table: string) {
    if (table === "household_members") {
      const members = [{ id: "m-1", user_id: "u-1", display_name: "Alice", household_id: "h-1" }];
      return {
        select: () => ({
          in: () => ({
            is: () => Promise.resolve({ data: members, error: null }),
          }),
        }),
      };
    }
    if (table === "push_subscriptions") {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      };
    }
    if (table === "bill_instances") {
      return {
        update: () => ({
          in: () => Promise.resolve({ error: null }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  }
}

// `this`-sensitive stand-in for the generate-bill-instances path. The real
// `rpc()` returns a Postgrest builder, so the fake returns
// `{ maybeSingle }` — but only when invoked bound.
class ThisSensitiveGenerationClient {
  rest = { marker: true };

  rpc(this: ThisSensitiveGenerationClient, fn: string, _args: Record<string, unknown>) {
    void this.rest.marker;
    if (fn !== "bill_instance_generation_bounds") {
      throw new Error(`unexpected rpc ${fn}`);
    }
    return {
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
  }

  from(table: string) {
    if (table !== "bills") throw new Error(`unexpected table ${table}`);
    return {
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: [{ id: "bill-1", household_id: "h-1", default_amount: 50 }],
            error: null,
          }),
      }),
    };
  }
}

describe("rpc binding regression (#244)", () => {
  it("runSendBillReminders calls rpc bound (no 'rest' TypeError on empty inbox)", async () => {
    const client = new ThisSensitiveReminderClient();
    const result = await runSendBillReminders(client as never);
    expect(result).toEqual({ sent: 0, instances: 0 });
  });

  it("runSendBillReminders calls the email-batch rpc bound (non-empty inbox)", async () => {
    vi.mocked(sendBillReminderPush).mockResolvedValue("failed");
    vi.mocked(sendReminderDigest).mockResolvedValue(undefined);
    const client = new ThisSensitiveReminderClientWithInbox();
    const result = await runSendBillReminders(client as never);
    expect(result).toEqual({ sent: 1, instances: 1 });
    expect(sendReminderDigest).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["alice@test.local"] }),
    );
  });

  it("generateAllInstances calls rpc bound (single bill with no bounds is skipped)", async () => {
    const client = new ThisSensitiveGenerationClient();
    const result = await generateAllInstances(client as never);
    expect(result).toEqual({});
  });
});
