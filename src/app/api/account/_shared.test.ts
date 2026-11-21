import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { auditAccountEvent, tryAudit } from "./_shared";

type Membership = { id: string; household_id: string };

function makeAdmin(memberships: Membership[] | null, failInsert = false) {
  const inserts: Array<{ table: string; row: unknown }> = [];
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "household_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: memberships, error: null }),
          })),
        };
      }
      if (table === "deletion_audit_log") {
        return {
          insert: vi.fn((row: unknown) => {
            inserts.push({ table, row });
            if (failInsert) return Promise.reject(new Error("audit store down"));
            return Promise.resolve({ error: null });
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { admin, inserts };
}

describe("auditAccountEvent", () => {
  it("writes one audit row per household membership (ids only)", async () => {
    const { admin, inserts } = makeAdmin([
      { id: "m-1", household_id: "hh-1" },
      { id: "m-2", household_id: "hh-2" },
    ]);

    await auditAccountEvent(admin as never, "user-1", "account_deletion_requested");

    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toEqual({
      table: "deletion_audit_log",
      row: {
        household_id: "hh-1",
        event_type: "account_deletion_requested",
        actor_member_id: "m-1",
        target_member_id: "m-1",
      },
    });
    expect(inserts[1]).toEqual({
      table: "deletion_audit_log",
      row: {
        household_id: "hh-2",
        event_type: "account_deletion_requested",
        actor_member_id: "m-2",
        target_member_id: "m-2",
      },
    });
  });

  it("writes nothing when the user belongs to no household", async () => {
    const { admin, inserts } = makeAdmin([]);

    await auditAccountEvent(admin as never, "user-1", "account_deletion_cancelled");

    expect(inserts).toHaveLength(0);
  });
});

describe("tryAudit", () => {
  it("swallows audit failures so the deletion path never breaks (but logs them)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = makeAdmin([{ id: "m-1", household_id: "hh-1" }], true);
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(admin as never);

    await expect(tryAudit("user-1", "account_deletion_requested")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "account-deletion: audit write failed",
      expect.objectContaining({ userId: "user-1" }),
    );

    errorSpy.mockRestore();
    vi.mocked(createSupabaseServiceRoleClient).mockReset();
  });
});
