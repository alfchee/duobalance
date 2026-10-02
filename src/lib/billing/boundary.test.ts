import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Import boundary for the billing port (issue #258, ADR 0002): no vendor
// type may cross into the domain. These tests lock the boundary in place
// alongside the eslint rule — they read sources as text so the test files
// themselves never import an adapter.

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

/** Every .ts source under src/lib/billing, recursively. */
function billingSources(): string[] {
  const root = path.join(process.cwd(), "src", "lib", "billing");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts")) {
        out.push(path.relative(process.cwd(), full));
      }
    }
  };
  walk(root);
  return out.sort();
}

describe("billing import boundary (#258)", () => {
  it("the domain layer imports no adapter (provider.ts, money.ts)", () => {
    for (const file of ["src/lib/billing/provider.ts", "src/lib/billing/money.ts"]) {
      const source = read(file);
      // Match real imports only — comments may name the adapters directory.
      expect(source, `${file} must not import from adapters/`).not.toMatch(
        /from\s+["'][^"']*adapters\//,
      );
      expect(source, `${file} must not dynamically import from adapters/`).not.toMatch(
        /import\s*\(\s*["'][^"']*adapters\//,
      );
    }
  });

  it("only the registry (composition root) may import adapters/", () => {
    // Any adapter import — new adapters land here with one registerProvider
    // line each (ADR 0002) without touching this test.
    expect(read("src/lib/billing/registry.ts")).toMatch(/from\s+["']\.\/adapters\//);
  });

  it("an eslint rule bans adapters/ imports everywhere else", () => {
    const config = read("eslint.config.mjs");
    // The boundary selectors match static, re-export, and dynamic imports.
    // (Matches the raw selector text `source.value=/billing…` — avoids
    // backslash-escaping ambiguity between the config source and this file.)
    expect(config).toContain("source.value=/billing");
    expect(config).toContain("ImportDeclaration");
    expect(config).toContain("ImportExpression");
    expect(config).toContain("ExportAllDeclaration");
    expect(config).toContain("258");
    // The exemption list is exactly the composition root + the adapters dir.
    expect(config).toContain("lib/billing/registry.ts");
    expect(config).toContain("lib/billing/adapters");
  });

  it("Money is an object type with currency, not a number alias", () => {
    const source = read("src/lib/billing/money.ts");
    expect(source).toMatch(/currency/);
    expect(source).not.toMatch(/type Money = number/);
  });
});

describe("billing clock boundary (#259)", () => {
  it("an eslint rule bans direct system-clock reads in billing code", () => {
    const config = read("eslint.config.mjs");
    expect(config).toContain('CallExpression[callee.object.name="Date"]');
    expect(config).toContain("NewExpression[callee.name='Date']");
    expect(config).toContain("259");
    expect(config).toContain("lib/billing/clock.ts");
  });

  it("no shippable billing source reads the clock except clock.ts", () => {
    // Text scan backs the eslint rule where entry exemptions apply
    // (clock.ts itself, test files): real clock reads, not fixed dates or
    // defensive copies (those carry arguments and are fine).
    const exempt = new Set(["src/lib/billing/clock.ts"]);
    for (const file of billingSources()) {
      if (file.endsWith(".test.ts") || exempt.has(file)) continue;
      const source = read(file);
      expect(source, `${file} must not call Date.now()`).not.toContain("Date.now(");
      expect(source, `${file} must not call argument-less new Date()`).not.toMatch(
        /new Date\(\s*\)/,
      );
    }
  });

  it("the adapter goes through the injected clock", () => {
    // registry.ts never reads time at all (covered by the scan above); the
    // stub is the file that must demonstrably use clock.now().
    const source = read("src/lib/billing/adapters/stub.ts");
    expect(source).toMatch(/clock\.now\(\)/);
  });
});
