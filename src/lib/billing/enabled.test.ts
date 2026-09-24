import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  effectiveEntitlement,
  isBillingEnabled,
  parseBillingEnabledFlag,
  shouldBypassPlanGating,
} from "./enabled";

// BILLING_ENABLED gating tests (issue #262).
//
// The flag defaults to OFF and is read through exactly one accessor
// (`isBillingEnabled()` in `enabled.ts`). The text scans below lock both
// properties alongside the CI grep guard — they read sources as text, the
// same pattern as `boundary.test.ts`.

function clearFlagEnv(): void {
  delete process.env.BILLING_ENABLED;
  delete process.env.NEXT_PUBLIC_BILLING_ENABLED;
}

/** Every non-test .ts/.tsx source under src/, recursively. */
function appSources(): string[] {
  const root = path.join(process.cwd(), "src");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(path.relative(process.cwd(), full));
      }
    }
  };
  walk(root);
  return out.sort();
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearFlagEnv();
});

describe("BILLING_ENABLED flag (#262)", () => {
  it("defaults to off when neither var is set", () => {
    clearFlagEnv();
    expect(isBillingEnabled()).toBe(false);
  });

  it("parses truthy values case- and whitespace-insensitively", () => {
    for (const value of ["1", "true", "TRUE", " True ", "yes", "YES", "on", "ON"]) {
      expect(parseBillingEnabledFlag(value), `expected ${JSON.stringify(value)} on`).toBe(true);
    }
  });

  it("treats empty, falsy and unknown values as off", () => {
    for (const value of [undefined, "", "0", "false", "FALSE", "no", "off", "bananas"]) {
      expect(parseBillingEnabledFlag(value), `expected ${JSON.stringify(value)} off`).toBe(false);
    }
  });

  it("turns on through the server var", () => {
    clearFlagEnv();
    vi.stubEnv("BILLING_ENABLED", "1");
    expect(isBillingEnabled()).toBe(true);
  });

  it("falls back to the NEXT_PUBLIC_ mirror when the server var is unset", () => {
    clearFlagEnv();
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "true");
    expect(isBillingEnabled()).toBe(true);
  });

  it("gives the server var precedence over a stale mirror", () => {
    clearFlagEnv();
    vi.stubEnv("BILLING_ENABLED", "0");
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "yes");
    expect(isBillingEnabled()).toBe(false);
    vi.stubEnv("BILLING_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "0");
    expect(isBillingEnabled()).toBe(true);
  });

  it("treats the server var as authoritative even when empty", () => {
    // wrangler.toml ships BILLING_ENABLED="" — a mirror set alone (e.g. via
    // dashboard drift) must never re-enable server routes.
    clearFlagEnv();
    vi.stubEnv("BILLING_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "yes");
    expect(isBillingEnabled()).toBe(false);
  });

  it("bypasses plan gating while the flag is off (deliberate fail-open)", () => {
    clearFlagEnv();
    expect(shouldBypassPlanGating()).toBe(true);
    expect(effectiveEntitlement(false)).toBe(true);
    expect(effectiveEntitlement(true)).toBe(true);
  });

  it("passes entitlements through untouched once the flag is on", () => {
    clearFlagEnv();
    vi.stubEnv("BILLING_ENABLED", "true");
    expect(shouldBypassPlanGating()).toBe(false);
    expect(effectiveEntitlement(false)).toBe(false);
    expect(effectiveEntitlement(true)).toBe(true);
  });

  it("is read through exactly one accessor — no direct env reads elsewhere in src/", () => {
    const offenders: string[] = [];
    for (const file of appSources()) {
      if (file === path.join("src", "lib", "billing", "enabled.ts")) continue;
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      if (/BILLING_ENABLED/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders, "BILLING_ENABLED must only be read in src/lib/billing/enabled.ts").toEqual(
      [],
    );
  });

  it("ships off: wrangler vars carry no truthy flag and .env.example documents it", () => {
    const toml = readFileSync(path.join(process.cwd(), "wrangler.toml"), "utf8");
    for (const match of toml.matchAll(
      /^\s*(?:NEXT_PUBLIC_)?BILLING_ENABLED\s*=\s*"?([^"\n#]*)"?\s*$/gm,
    )) {
      expect(
        parseBillingEnabledFlag(match[1]?.trim()),
        `wrangler.toml must not ship the billing flag on (found ${JSON.stringify(match[0].trim())})`,
      ).toBe(false);
    }
    const example = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    expect(example).toContain("BILLING_ENABLED");
    const exampleOn = [...example.matchAll(/^\s*(?:NEXT_PUBLIC_)?BILLING_ENABLED\s*=\s*(.+)$/gm)]
      .map((m) => m[1]?.trim().replace(/^["']|["']$/g, ""))
      .filter((v) => v && parseBillingEnabledFlag(v));
    expect(exampleOn, ".env.example must document the flag defaulting to off").toEqual([]);
  });
});
