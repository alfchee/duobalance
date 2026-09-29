import { describe, expect, it, vi } from "vitest";
import { runPurgeAccounts, PurgeAccountsCapError } from "./purge-accounts";
import { ANONYMIZED_MEMBER_NAME } from "@/lib/account-deletion";

function makeClient(opts: {
  due?: Array<{ id: string; user_id: string }>;
  selectError?: Error | null;
  members?: Record<string, Array<{ id: string; household_id: string }>>;
  membersError?: Error | null;
  updateError?: Error | null;
  auditError?: Error | null;
  markError?: Error | null;
}) {
  const calls = {
    updates: [] as unknown[],
    audits: [] as unknown[],
    marks: [] as unknown[],
  };
  const from = vi.fn((table: string) => {
    if (table === "account_deletion_requests") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            lt: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({
                data: opts.selectError ? null : (opts.due ?? []),
                error: opts.selectError ?? null,
              }),
            })),
          })),
        })),
        update: vi.fn((values: unknown) => {
          calls.marks.push(values);
          return { eq: vi.fn().mockResolvedValue({ error: opts.markError ?? null }) };
        }),
      };
    }
    if (table === "household_members") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col: string, userId: string) => {
            void col;
            return Promise.resolve({
              data: opts.members?.[userId] ?? [],
              error: opts.membersError ?? null,
            });
          }),
        })),
        update: vi.fn((values: unknown) => {
          calls.updates.push(values);
          return {
            eq: vi.fn(() => ({
              is: vi.fn().mockResolvedValue({ error: opts.updateError ?? null }),
            })),
          };
        }),
      };
    }
    if (table === "deletion_audit_log") {
      return {
        insert: vi.fn((row: unknown) => {
          calls.audits.push(row);
          return Promise.resolve({ error: opts.auditError ?? null });
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from, calls } as unknown as {
    from: ReturnType<typeof vi.fn>;
    calls: typeof calls;
  };
}

describe("runPurgeAccounts", () => {
  it("returns zero when nothing is past grace", async () => {
    const client = makeClient({ due: [] });

    await expect(runPurgeAccounts(client as never)).resolves.toEqual({
      purgedCount: 0,
      users: [],
    });
  });

  it("anonymizes memberships, audits per household, and marks purged", async () => {
    const client = makeClient({
      due: [{ id: "req-1", user_id: "user-1" }],
      members: {
        "user-1": [
          { id: "m-1", household_id: "hh-a" },
          { id: "m-2", household_id: "hh-b" },
        ],
      },
    });

    const result = await runPurgeAccounts(client as never);

    expect(result).toEqual({
      purgedCount: 1,
      users: [{ user_id: "user-1", households: ["hh-a", "hh-b"] }],
    });
    // Anonymize in place: display name stubbed, soft-removed as left.
    expect(client.calls.updates).toEqual([
      expect.objectContaining({
        display_name: ANONYMIZED_MEMBER_NAME,
        removal_reason: "left",
      }),
    ]);
    // One audit row per household, ids only — no email, name, or amounts.
    expect(client.calls.audits).toHaveLength(2);
    for (const audit of client.calls.audits as Array<Record<string, unknown>>) {
      expect(audit.event_type).toBe("account_deletion_purged");
      expect(Object.keys(audit).sort()).toEqual(
        ["event_type", "household_id", "target_member_id"].sort(),
      );
    }
    expect(client.calls.marks).toEqual([expect.objectContaining({ status: "purged" })]);
  });

  it("marks purged without touching members when the user has none", async () => {
    const client = makeClient({
      due: [{ id: "req-1", user_id: "ghost" }],
      members: {},
    });

    const result = await runPurgeAccounts(client as never);

    expect(result.purgedCount).toBe(1);
    expect(client.calls.updates).toHaveLength(0);
    expect(client.calls.audits).toHaveLength(0);
    expect(client.calls.marks).toHaveLength(1);
  });

  it("refuses to run past the sanity cap", async () => {
    const due = Array.from({ length: 51 }, (_, i) => ({ id: `req-${i}`, user_id: `u-${i}` }));
    const client = makeClient({ due });

    await expect(runPurgeAccounts(client as never)).rejects.toBeInstanceOf(PurgeAccountsCapError);
  });

  it("surfaces lookup failures", async () => {
    const client = makeClient({ selectError: new Error("db down") });

    await expect(runPurgeAccounts(client as never)).rejects.toThrow(/lookup failed/);
  });
});
