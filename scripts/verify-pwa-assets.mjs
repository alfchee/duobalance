#!/usr/bin/env node
/**
 * verify-pwa-assets.mjs — verification for #159
 *
 * Verifies that the PWA precache is OpenNext-aware and matches the deployed
 * asset set. The failure mode is an app that works online and breaks offline
 * because `generate-service-worker.mjs` only hashed `.next/static` while
 * Cloudflare deploys from `.open-next/assets`.
 *
 * Checks (always, no secrets needed):
 *  1. `scripts/generate-service-worker.mjs` reads from `.open-next/assets/_next/static`
 *     when present (union with `.next/static`), writes to `.open-next/assets/sw-assets.js`,
 *     and keeps the Tauri `out/` path unchanged
 *  2. `package.json` preview/deploy run `generate-service-worker.mjs --opennext` as a
 *     post-step after `opennextjs-cloudflare build`
 *  3. `public/sw-assets.js` exists, parses, version matches sha256(sorted entries)[0:12],
 *     and every `/_next/static/*` entry has a corresponding file on disk
 *     (in `.next/static` or `.open-next/assets/_next/static`)
 *  4. When `.open-next/assets/sw-assets.js` exists, it matches `public/sw-assets.js`
 *     (deployed precache == generated precache)
 *  5. `public/sw.js` references `sw-assets.js` and cache-first for `/_next/static/`
 *
 * Live checks (only with --live --url <deployedOrigin>):
 *  - Fetches `<url>/sw.js` and `<url>/sw-assets.js` from the deployed Worker
 *    and asserts the deployed `sw-assets.js` content equals the local
 *    `public/sw-assets.js` when built from the same commit (hash check). For
 *    true offline proof (hashed filenames differ per build), see the manual
 *    checklist in docs/pwa-offline-verification.md — must be verified on the
 *    actual Cloudflare deployment, not `wrangler dev`.
 *
 * Usage:
 *   node scripts/verify-pwa-assets.mjs
 *   node scripts/verify-pwa-assets.mjs --live --url https://staging.duobalance.app
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const live = args.includes("--live");
const urlIdx = args.indexOf("--url");
const liveUrl = urlIdx !== -1 ? args[urlIdx + 1] : process.env.PWA_URL || process.env.STAGING_URL;

let failed = false;
function fail(msg) {
  console.error(`[verify-pwa-assets] FAIL: ${msg}`);
  failed = true;
}
function pass(msg) {
  console.log(`[verify-pwa-assets] OK: ${msg}`);
}
function warn(msg) {
  console.warn(`[verify-pwa-assets] WARN: ${msg}`);
}
function read(p) {
  return fs.readFileSync(path.join(root, p), "utf8");
}
function exists(p) {
  return fs.existsSync(path.join(root, p));
}

async function main() {
  // 1) generate-service-worker.mjs — OpenNext awareness
  try {
    const gsw = read("scripts/generate-service-worker.mjs");
    const hasOpenNextDir = gsw.includes(".open-next") && gsw.includes("assets");
    const hasOpenNextStatic = gsw.includes("_next") && gsw.includes("static");
    const hasOpenNextFlag = gsw.includes("--opennext") || gsw.includes("isOpenNextPostStep");
    const writesOpenNext = gsw.includes(".open-next/assets/sw-assets.js");
    const keepsTauri = gsw.includes('join(root, "out")') || gsw.includes("exportDirectory");
    const unionsBoth = gsw.includes("staticDirectories") || gsw.includes("buildAssetsLists");

    if (!hasOpenNextDir || !hasOpenNextStatic)
      fail(
        "generate-service-worker.mjs must be aware of .open-next/assets/_next/static for the web OpenNext build",
      );
    else pass("generate-service-worker: OpenNext assets aware");

    if (!hasOpenNextFlag)
      warn("generate-service-worker: should handle --opennext flag or OPENNEXT env for post-step");
    else pass("generate-service-worker: --opennext handling present");

    if (!writesOpenNext)
      fail(
        "generate-service-worker: must write to .open-next/assets/sw-assets.js when .open-next exists",
      );
    else pass("generate-service-worker: writes .open-next/assets/sw-assets.js");

    if (!keepsTauri)
      warn(
        "generate-service-worker: Tauri out/ path not detected — ensure out/_next/static + out/sw-assets.js still written",
      );
    else pass("generate-service-worker: Tauri path preserved");

    if (!unionsBoth)
      warn(
        "generate-service-worker: should union .next/static + .open-next/assets/_next/static (dedupe) so stale .next cannot leave precache incomplete",
      );
    else pass("generate-service-worker: unions both static dirs (or falls back)");

    // Check that the script no longer reads only .next/static in isolation
    const onlyNextStatic = /listFiles\(nextStaticDirectory\)/.test(gsw) && !hasOpenNextDir;
    if (onlyNextStatic)
      fail("generate-service-worker: must not only read .next/static for Cloudflare builds");
  } catch (e) {
    fail(`could not read generate-service-worker.mjs: ${e}`);
  }

  // 2) package.json preview/deploy post-step
  try {
    const pkg = read("package.json");
    const hasPreviewPostStep =
      pkg.includes("opennextjs-cloudflare build") &&
      pkg.includes("generate-service-worker.mjs --opennext") &&
      pkg.includes("preview");
    const hasDeployPostStep =
      pkg.includes("opennextjs-cloudflare build") &&
      pkg.includes("generate-service-worker.mjs --opennext") &&
      pkg.includes("deploy");
    if (!hasPreviewPostStep)
      fail(
        'package.json preview must run "opennextjs-cloudflare build && node scripts/generate-service-worker.mjs --opennext && ..."',
      );
    else pass("package.json: preview runs generate-service-worker --opennext post-step");
    if (!hasDeployPostStep)
      fail(
        'package.json deploy must run "opennextjs-cloudflare build && node scripts/generate-service-worker.mjs --opennext && ..."',
      );
    else pass("package.json: deploy runs generate-service-worker --opennext post-step");
  } catch (e) {
    fail(`could not read package.json: ${e}`);
  }

  // 3) public/sw-assets.js integrity
  try {
    if (!exists("public/sw-assets.js")) {
      fail("public/sw-assets.js missing — run node scripts/generate-service-worker.mjs");
    } else {
      const content = read("public/sw-assets.js");
      const versionMatch = content.match(
        /self\.__DUOBALANCE_PRECACHE_VERSION__\s*=\s*"([a-f0-9]{12})"/,
      );
      const precacheMatch = content.match(/self\.__DUOBALANCE_PRECACHE__\s*=\s*(\[[\s\S]*?\]);/);
      if (!versionMatch) fail("public/sw-assets.js missing __DUOBALANCE_PRECACHE_VERSION__");
      else pass(`sw-assets.js: version ${versionMatch[1]} present`);
      if (!precacheMatch) fail("public/sw-assets.js missing __DUOBALANCE_PRECACHE__ array");
      else {
        const assets = JSON.parse(precacheMatch[1]);
        if (!Array.isArray(assets) || assets.length === 0)
          fail("public/sw-assets.js precache empty");
        else pass(`sw-assets.js: precache has ${assets.length} entries`);

        // Version must be sha256(sorted assets)[0:12]
        const expectedVersion = createHash("sha256")
          .update([...assets].sort().join("\n"))
          .digest("hex")
          .slice(0, 12);
        if (versionMatch && versionMatch[1] !== expectedVersion)
          fail(
            `public/sw-assets.js version ${versionMatch[1]} != expected ${expectedVersion} (sha256 of sorted entries)`,
          );
        else if (versionMatch) pass("sw-assets.js: version hash matches sorted precache");

        // Every /_next/static/* must exist on disk in at least one static dir
        const staticEntries = assets.filter((a) => a.startsWith("/_next/static/"));
        const nextStaticExists = exists(".next/static");
        const openNextStaticExists = exists(".open-next/assets/_next/static");
        if (staticEntries.length === 0)
          warn("precache has no /_next/static entries — did generation run without a build?");
        else {
          let missing = 0;
          for (const entry of staticEntries) {
            const rel = entry.replace(/^\/_next\/static\//, "");
            const inNext = nextStaticExists && exists(path.join(".next/static", rel));
            const inOpenNext =
              openNextStaticExists && exists(path.join(".open-next/assets/_next/static", rel));
            if (!inNext && !inOpenNext) missing++;
          }
          if (missing > 0)
            fail(
              `precache has ${missing} /_next/static entries with no file on disk (checked .next/static and .open-next/assets/_next/static) — hashes stale or build missing`,
            );
          else pass(`sw-assets.js: all ${staticEntries.length} _next/static entries exist on disk`);

          // Staleness: if .open-next exists, precache should be subset of its file set, not just .next
          if (openNextStaticExists) {
            // Build the set of files that actually exist in .open-next
            const deployedFiles = new Set();
            function walk(dir, base) {
              for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, ent.name);
                if (ent.isDirectory()) walk(full, base);
                else
                  deployedFiles.add(
                    `/_next/static/${path.relative(base, full).split(path.sep).join("/")}`,
                  );
              }
            }
            walk(
              path.join(root, ".open-next/assets/_next/static"),
              path.join(root, ".open-next/assets/_next/static"),
            );
            const notInDeployed = staticEntries.filter((e) => !deployedFiles.has(e));
            if (notInDeployed.length > 0)
              fail(
                `precache contains ${notInDeployed.length} entries not in .open-next/assets/_next/static — precache would 404 on Cloudflare. Did you run generate-service-worker --opennext after opennext build? Example: ${notInDeployed[0]}`,
              );
            else pass("sw-assets.js: _next/static entries subset of .open-next deployed set");
            const extraDeployed = [...deployedFiles].filter((f) => !staticEntries.includes(f));
            if (extraDeployed.length > 0)
              warn(
                `.open-next has ${extraDeployed.length} _next/static files not in precache (e.g. ${extraDeployed[0]}) — they will be fetched network-first, not precached. Regenerate sw-assets.js if these are shell-critical.`,
              );
          }
        }

        // Must include offline.html and at least one document
        if (!assets.includes("/offline.html")) fail('precache should include "/offline.html"');
        else pass('precache includes "/offline.html"');
        if (!assets.includes("/") && !assets.some((a) => a === "/index.html"))
          warn('precache should include "/" (index) for offline navigation');
      }
    }
  } catch (e) {
    fail(`public/sw-assets.js check failed: ${e}`);
  }

  // 4) .open-next/assets/sw-assets.js matches public when .open-next exists
  try {
    if (exists(".open-next/assets") && exists(".open-next/assets/sw-assets.js")) {
      const pub = read("public/sw-assets.js");
      const open = read(".open-next/assets/sw-assets.js");
      if (pub !== open)
        fail(
          ".open-next/assets/sw-assets.js != public/sw-assets.js — run node scripts/generate-service-worker.mjs --opennext after opennext build so deployed precache matches",
        );
      else pass(".open-next deployed sw-assets.js matches public/sw-assets.js");
    } else if (exists(".open-next/assets")) {
      warn(
        ".open-next/assets exists but sw-assets.js missing — run generate-service-worker --opennext",
      );
    } else {
      console.log(
        "[verify-pwa-assets] .open-next not built — deployed-precache check skipped (run npx opennextjs-cloudflare build first for full check)",
      );
    }
  } catch (e) {
    fail(`.open-next sw-assets.js check failed: ${e}`);
  }

  // 5) public/sw.js sanity
  try {
    const sw = read("public/sw.js");
    if (!sw.includes("sw-assets.js") && !sw.includes("__DUOBALANCE_PRECACHE"))
      fail("public/sw.js should importScripts / reference sw-assets.js");
    else pass("sw.js: references sw-assets.js");
    if (!sw.includes("_next/static"))
      fail("public/sw.js should handle cache-first for /_next/static/");
    else pass("sw.js: cache-first for /_next/static present");
  } catch (e) {
    fail(`public/sw.js check failed: ${e}`);
  }

  // 6) Live checks — only with --live
  if (live) {
    if (!liveUrl) {
      fail("--live requires --url <deployedOrigin> (e.g. https://staging.duobalance.app)");
    } else {
      console.log(`[verify-pwa-assets] live check against ${liveUrl}`);
      try {
        const base = liveUrl.replace(/\/$/, "");
        const swRes = await fetch(`${base}/sw.js`, { cache: "no-store" });
        if (!swRes.ok) fail(`live GET /sw.js ${swRes.status}`);
        else pass("live: /sw.js fetchable from deployed Worker");
        const assetsRes = await fetch(`${base}/sw-assets.js`, { cache: "no-store" });
        if (!assetsRes.ok) fail(`live GET /sw-assets.js ${assetsRes.status}`);
        else {
          const deployed = await assetsRes.text();
          const local = exists("public/sw-assets.js") ? read("public/sw-assets.js") : null;
          if (local && deployed === local)
            pass(
              "live: deployed sw-assets.js matches local public/sw-assets.js (same commit/build)",
            );
          else if (local)
            warn(
              "live: deployed sw-assets.js != local — expected when deployed build hashes differ from local; verify the deployed precache's _next/static entries all 200 on the deployed origin (see docs/pwa-offline-verification.md)",
            );
          else warn("live: local public/sw-assets.js missing — cannot compare");

          // Check that at least a couple of precached _next/static URLs are 200 on deployed origin
          const m = deployed.match(/"\/_next\/static\/[^"]+"/g);
          const sample = m ? m.slice(0, 3).map((s) => s.slice(1, -1)) : [];
          for (const assetPath of sample) {
            const r = await fetch(`${base}${assetPath}`, { cache: "no-store" });
            if (!r.ok)
              fail(
                `live: precached asset ${assetPath} not fetchable on deployed origin (${r.status}) — precache would fail offline`,
              );
            else pass(`live: precached asset ${assetPath} → ${r.status}`);
          }
        }
      } catch (e) {
        fail(`live fetches failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      console.log(
        "[verify-pwa-assets] For full offline proof, follow docs/pwa-offline-verification.md — load on Cloudflare deployment, go offline, verify PWA still loads (hashed filenames differ per build, so live hash compare is not sufficient).",
      );
    }
  } else {
    console.log(
      "[verify-pwa-assets] live checks skipped (pass --live --url <deployedOrigin> to fetch deployed sw-assets.js; true offline must be tested on the Cloudflare deployment per docs)",
    );
  }

  if (failed) {
    console.error("\n[verify-pwa-assets] verification failed — see above");
    process.exit(1);
  } else {
    console.log("\n[verify-pwa-assets] all checks passed");
    if (!live)
      console.log("  For offline proof on Cloudflare, see docs/pwa-offline-verification.md.");
  }
}

main().catch((e) => {
  console.error(`[verify-pwa-assets] unhandled: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
