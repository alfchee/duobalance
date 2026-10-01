import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_BILLING_EVENT_KEYS,
  ADMIN_FORBIDDEN_KEYS,
  ADMIN_HOUSEHOLD_KEYS,
  ADMIN_METRIC_ACTIVATION_KEYS,
  ADMIN_METRIC_ARTICLE_KEYS,
  ADMIN_METRIC_FUNNEL_KEYS,
  ADMIN_METRIC_RETENTION_KEYS,
  ADMIN_METRIC_SOURCE_KEYS,
  ADMIN_METRIC_SUBSCRIPTION_KEYS,
  ADMIN_SUBSCRIPTION_KEYS,
  projectAdminKeys,
} from "./scope";

// Admin boundary (issue #271, ADR 0005): no impersonation ever, admin
// responses carry billing state + counts only, and every admin route gates
// through requireAdmin (flag + roster, neutral 404). These tests lock the
// boundary in source so a helpful future PR cannot widen it quietly. The
// data-layer half is proved by supabase/tests/36_admin_access_model.sql.

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

/** Every .ts/.tsx source under src/, recursively. */
function srcFiles(): string[] {
  const root = path.join(process.cwd(), "src");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        out.push(path.relative(process.cwd(), full));
      }
    }
  };
  walk(root);
  return out.sort();
}

function adminRouteFiles(): string[] {
  return srcFiles().filter((f) => f.includes("src/app/api/admin/") && !f.endsWith(".test.ts"));
}

// Files allowed to contain the word "impersonat": only the ones that record
// the deliberate ABSENCE of the feature (this test, the shared route
// comment, the admin login note). Any other occurrence — helper, endpoint,
// button — fails the build.
const IMPERSONATION_WORD_ALLOWLIST = new Set([
  "src/lib/admin/boundary.test.ts",
  "src/lib/admin/scope.ts",
  "src/app/api/admin/_shared.ts",
  "src/app/(admin)/admin/login/page.tsx",
]);

describe("admin allowlist (#271)", () => {
  it("allowed and forbidden key sets are disjoint", () => {
    const allowed = new Set<string>([
      ...ADMIN_HOUSEHOLD_KEYS,
      ...ADMIN_SUBSCRIPTION_KEYS,
      ...ADMIN_BILLING_EVENT_KEYS,
      ...ADMIN_METRIC_ACTIVATION_KEYS,
      ...ADMIN_METRIC_FUNNEL_KEYS,
      ...ADMIN_METRIC_RETENTION_KEYS,
      ...ADMIN_METRIC_ARTICLE_KEYS,
      ...ADMIN_METRIC_SOURCE_KEYS,
      ...ADMIN_METRIC_SUBSCRIPTION_KEYS,
    ]);
    for (const key of ADMIN_FORBIDDEN_KEYS) {
      expect(allowed.has(key), `forbidden key ${key} must not be allowlisted`).toBe(false);
    }
  });

  it("projectAdminKeys drops unknown keys instead of passing them through", () => {
    const out = projectAdminKeys(
      { household_id: "h", description: "Secret groceries", amount: -2500 },
      ADMIN_HOUSEHOLD_KEYS,
    );
    expect(out.household_id).toBe("h");
    expect("description" in out).toBe(false);
    expect("amount" in out).toBe(false);
  });

  it("household allowlist carries counts, never contents", () => {
    for (const key of ["member_count", "account_count", "transaction_count"]) {
      expect(ADMIN_HOUSEHOLD_KEYS).toContain(key);
    }
    for (const key of ["description", "amount", "merchant", "account_name", "payload"]) {
      expect(ADMIN_HOUSEHOLD_KEYS).not.toContain(key);
    }
  });
});

describe("admin no-impersonation rule (#271)", () => {
  it("the word appears only where the absence is recorded", () => {
    const offenders: string[] = [];
    for (const file of srcFiles()) {
      if (file.endsWith(".test.ts")) continue;
      if (IMPERSONATION_WORD_ALLOWLIST.has(file)) continue;
      if (/impersonat/i.test(read(file))) offenders.push(file);
    }
    expect(offenders, "impersonation affordance outside the allowlist").toEqual([]);
  });

  it("no admin route mints sessions or acts as a member", () => {
    // Session-minting and user-creation APIs would be the machinery of an
    // impersonation feature. Admin routes verify + read + audit only.
    for (const file of adminRouteFiles()) {
      const source = read(file);
      for (const pattern of [
        "auth.admin",
        "generateLink",
        "createUser",
        "signInWithPassword",
        "exchangeCodeForSession",
      ]) {
        expect(source, `${file} must not contain ${pattern}`).not.toContain(pattern);
      }
    }
  });

  it("no admin route gates on household membership", () => {
    // The roster (admin_users) is the only check. is_member() would let a
    // household session imply admin access — the exact path that must not
    // exist (roles are distinct, ADR 0005).
    for (const file of adminRouteFiles()) {
      const source = read(file);
      expect(source, `${file} must gate through requireAdmin, not is_member()`).not.toContain(
        "is_member(",
      );
      expect(source, `${file} must gate through requireAdmin`).toContain("requireAdmin");
    }
  });
});

describe("admin response shape (#271)", () => {
  it("admin data flows through the DEFINER readers, never direct table reads", () => {
    // Routes call admin_* RPCs on the caller-scoped client so authorization
    // (is_admin()) and the response shape stay enforced at the database
    // boundary. A general service-role table query here would make the
    // TypeScript allowlist the only protection — exactly what this bans.
    for (const file of adminRouteFiles()) {
      if (file.endsWith("_shared.ts")) continue;
      if (file.endsWith("me/route.ts")) continue; // { isAdmin: true } — its RPCs run inside requireAdmin/audit
      const source = read(file);
      expect(source, `${file} must read through admin RPCs`).toContain(".rpc(");
      expect(source, `${file} must not query tables directly`).not.toContain('.from("');
    }
  });

  it("no admin route selects transaction-content columns", () => {
    for (const file of adminRouteFiles()) {
      const source = read(file);
      for (const col of ["description", "merchant", "account_name", "opening_balance"]) {
        expect(source, `${file} must not select ${col}`).not.toMatch(
          new RegExp(`select[^;]*${col}`, "i"),
        );
      }
      // billing_events payload is metadata-only at the API (see _shared):
      // routes may name the table, but never the payload column.
      expect(source, `${file} must not select the billing payload`).not.toMatch(
        /billing_events[^;]*payload/i,
      );
      expect(source, `${file} must not select payload`).not.toMatch(/select\(".*payload/i);
    }
  });

  it("every admin route answers through the allowlist projector", () => {
    for (const file of adminRouteFiles()) {
      if (file.endsWith("_shared.ts")) continue;
      if (file.endsWith("me/route.ts")) continue; // { isAdmin: true } — no household data
      const source = read(file);
      expect(source, `${file} must project through the allowlist`).toContain("projectAdminKeys");
    }
  });

  it("the service-role key never appears outside the server boundary", () => {
    // Built by concatenation so this very assertion does not trip the CI
    // source grep for the key name (that guard has no test-file exemption).
    const keyName = ["SUPABASE", "SERVICE_ROLE_KEY"].join("_");
    for (const file of srcFiles()) {
      if (file.endsWith(".test.ts")) continue;
      if (file.includes("src/app/api/")) continue;
      if (file === "src/lib/supabase/server.ts") continue;
      if (file === "src/lib/supabase/cron.ts") continue;
      if (file === "src/lib/env.ts") continue;
      expect(read(file), `${file} must not reference the service-role key`).not.toContain(keyName);
    }
  });
});

describe("admin gating (#271)", () => {
  it("admin UI calls the API only through apiFetch", () => {
    const uiFiles = srcFiles().filter(
      (f) => f.includes("src/app/(admin)/") || f.includes("src/components/admin/"),
    );
    expect(uiFiles.length).toBeGreaterThan(0);
    for (const file of uiFiles) {
      if (file.endsWith(".test.ts")) continue;
      const source = read(file);
      expect(source, `${file} must not call fetch('/api/…)`).not.toMatch(/fetch\(\s*["'`]\/api\//);
    }
  });

  it("shared gate checks the flag first and denies neutrally", () => {
    const source = read("src/app/api/admin/_shared.ts");
    expect(source).toContain("isBillingEnabled");
    expect(source).toContain("adminNotFound");
    // The neutral denial is a single body: no per-cause 401/403 strings that
    // would hint the resource exists to a probe.
    expect(source).not.toContain("status: 401");
    expect(source).not.toContain("status: 403");
  });

  it("shared gate denies per deployment target and binds the admin domain", () => {
    const source = read("src/app/api/admin/_shared.ts");
    expect(source).toContain("APP_MODE");
    expect(source).toContain("ADMIN_APP_URL");
    expect(source).toContain("adminTargetAllows");
  });

  it("every admin route writes an audit row on success", () => {
    for (const file of adminRouteFiles()) {
      if (file.endsWith("_shared.ts")) continue;
      expect(read(file), `${file} must audit the action`).toContain("auditAdminAction");
    }
  });

  it("every admin response is no-store with hardening headers", () => {
    const shared = read("src/app/api/admin/_shared.ts");
    for (const header of [
      "private, no-store",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
    ]) {
      expect(shared).toContain(header);
    }
  });
});
