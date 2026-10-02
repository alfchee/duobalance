import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseUserClient: vi.fn() }));
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
import { createSupabaseUserClient } from "@/lib/supabase/server";
import { adminNotFound, adminTargetAllows, auditAdminAction, requireAdmin } from "./_shared";

const routeContext = vi.mocked(createRouteContext);
const authedUser = vi.mocked(getAuthedUser);
const userClientFactory = vi.mocked(createSupabaseUserClient);

const req = (url = "http://localhost/api/admin/me") => new Request(url);

function userDb(isAdmin: boolean | null, rpcError: boolean) {
  return {
    rpc: async (fn: string) => {
      expect(fn).toBe("is_admin");
      return rpcError
        ? { data: null, error: { message: "db down" } }
        : { data: isAdmin, error: null };
    },
  };
}

function auditDb(fail: boolean, seen: Array<Record<string, unknown>>) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      expect(fn).toBe("admin_log_action");
      if (fail) return { data: null, error: { message: "audit down" } };
      seen.push(args);
      return { data: "audit-id", error: null };
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.BUILD_TARGET;
  delete process.env.APP_MODE;
  delete process.env.ADMIN_APP_URL;
});

describe("requireAdmin (#271)", () => {
  it("returns null while billing is off, without touching auth", async () => {
    process.env.BILLING_ENABLED = "";
    expect(await requireAdmin(req())).toBeNull();
    expect(routeContext).not.toHaveBeenCalled();
  });

  it("returns null on user-target deployments", async () => {
    process.env.BILLING_ENABLED = "1";
    process.env.APP_MODE = "user";
    expect(await requireAdmin(req())).toBeNull();
    expect(routeContext).not.toHaveBeenCalled();
  });

  it("returns null for unauthenticated callers (neutral 404 upstream)", async () => {
    process.env.BILLING_ENABLED = "1";
    routeContext.mockResolvedValue({} as never);
    authedUser.mockRejectedValue(new Error("no session"));
    expect(await requireAdmin(req())).toBeNull();
    expect(userClientFactory).not.toHaveBeenCalled();
  });

  it("returns null when is_admin() is false or errors", async () => {
    process.env.BILLING_ENABLED = "1";
    routeContext.mockResolvedValue({} as never);
    authedUser.mockResolvedValue({ id: "u-outsider" } as never);
    userClientFactory.mockResolvedValue(userDb(false, false) as never);
    expect(await requireAdmin(req())).toBeNull();

    userClientFactory.mockResolvedValue(userDb(null, true) as never);
    expect(await requireAdmin(req())).toBeNull();
  });

  it("returns the caller-scoped context for rostered admins", async () => {
    process.env.BILLING_ENABLED = "1";
    routeContext.mockResolvedValue({} as never);
    authedUser.mockResolvedValue({ id: "u-admin" } as never);
    const db = userDb(true, false);
    userClientFactory.mockResolvedValue(db as never);
    const ctx = await requireAdmin(req());
    expect(ctx?.userId).toBe("u-admin");
    expect(ctx?.db).toBe(db);
  });
});

describe("adminTargetAllows (#271)", () => {
  const target = (url: string) => adminTargetAllows(new Request(url));

  it("allows when APP_MODE is unset (local dev; the flag still gates)", () => {
    expect(target("http://localhost:3000/api/admin/me")).toBe(true);
  });

  it("denies everything on user-target deployments", () => {
    process.env.APP_MODE = "user";
    expect(target("http://localhost:3000/api/admin/me")).toBe(false);
  });

  it("binds admin mode to ADMIN_APP_URL when pinned", () => {
    process.env.APP_MODE = "admin";
    expect(target("http://localhost:3000/api/admin/me")).toBe(true);

    process.env.ADMIN_APP_URL = "https://admin.duobalanceapp.com";
    expect(target("https://admin.duobalanceapp.com/api/admin/me")).toBe(true);
    expect(target("https://duobalanceapp.com/api/admin/me")).toBe(false);
    expect(target("https://evil.com/api/admin/me")).toBe(false);
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
  it("audits through admin_log_action with the caller as actor", async () => {
    const seen: Array<Record<string, unknown>> = [];
    await auditAdminAction(auditDb(false, seen) as never, "households.list", null);
    expect(seen).toEqual([
      {
        p_action: "households.list",
        p_target_household: undefined,
        p_reason: undefined,
        p_before: undefined,
        p_after: undefined,
      },
    ]);
  });

  it("fails closed: an audit outage fails the action instead of succeeding unaudited", async () => {
    const seen: Array<Record<string, unknown>> = [];
    await expect(
      auditAdminAction(auditDb(true, seen) as never, "households.view", "h-1"),
    ).rejects.toThrow("admin audit write failed");
  });
});
