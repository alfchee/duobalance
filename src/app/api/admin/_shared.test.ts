import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/app/api/_shared", () => ({
  createRouteContext: vi.fn(),
  getAuthedUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { createRouteContext, getAuthedUser } from "@/app/api/_shared";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { adminNotFound, auditAdminAction, requireAdmin } from "./_shared";

const routeContext = vi.mocked(createRouteContext);
const authedUser = vi.mocked(getAuthedUser);
const serviceRole = vi.mocked(createSupabaseServiceRoleClient);

function rosterDb(hasRow: boolean) {
  return {
    from: (table: string) => {
      expect(table).toBe("admin_users");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: hasRow ? { user_id: "u-admin" } : null }),
          }),
        }),
      };
    },
  };
}

function auditDb(fail: boolean, seen: Array<Record<string, unknown>>) {
  return {
    from: (table: string) => {
      expect(table).toBe("admin_audit_log");
      return {
        insert: async (row: Record<string, unknown>) => {
          if (fail) throw new Error("audit down");
          seen.push(row);
          return { error: null };
        },
      };
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.BUILD_TARGET;
});

describe("requireAdmin (#271)", () => {
  it("returns null while billing is off, without touching auth", () => {
    process.env.BILLING_ENABLED = "";
    return requireAdmin().then((ctx) => {
      expect(ctx).toBeNull();
      expect(routeContext).not.toHaveBeenCalled();
    });
  });

  it("returns null for unauthenticated callers (neutral 404 upstream)", async () => {
    process.env.BILLING_ENABLED = "1";
    routeContext.mockResolvedValue({} as never);
    authedUser.mockRejectedValue(new Error("no session"));
    expect(await requireAdmin()).toBeNull();
    expect(serviceRole).not.toHaveBeenCalled();
  });

  it("returns null for authenticated non-admins", async () => {
    process.env.BILLING_ENABLED = "1";
    routeContext.mockResolvedValue({} as never);
    authedUser.mockResolvedValue({ id: "u-outsider" } as never);
    serviceRole.mockReturnValue(rosterDb(false) as never);
    expect(await requireAdmin()).toBeNull();
  });

  it("returns the caller-scoped context for rostered admins", async () => {
    process.env.BILLING_ENABLED = "1";
    routeContext.mockResolvedValue({} as never);
    authedUser.mockResolvedValue({ id: "u-admin" } as never);
    const admin = rosterDb(true);
    serviceRole.mockReturnValue(admin as never);
    const ctx = await requireAdmin();
    expect(ctx?.userId).toBe("u-admin");
    expect(ctx?.admin).toBe(admin);
  });
});

describe("adminNotFound (#271)", () => {
  it("is a neutral 404 with no-store hardening headers", async () => {
    const res = adminNotFound();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("auditAdminAction (#271)", () => {
  it("appends actor, action and target", async () => {
    const seen: Array<Record<string, unknown>> = [];
    await auditAdminAction(auditDb(false, seen) as never, "u-admin", "households.list", null);
    expect(seen).toEqual([
      { actor: "u-admin", action: "households.list", target_household: null, reason: null },
    ]);
  });

  it("never throws: an audit outage must not break the read", async () => {
    const seen: Array<Record<string, unknown>> = [];
    await expect(
      auditAdminAction(auditDb(true, seen) as never, "u-admin", "households.view", "h-1"),
    ).resolves.toBeUndefined();
  });
});
