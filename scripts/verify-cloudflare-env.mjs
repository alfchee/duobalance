#!/usr/bin/env node
/**
 * verify-cloudflare-env.mjs — guard for #156
 *
 * - Fails if any secret appears in wrangler.toml [vars]
 * - Optionally (with --build) greps the built client bundle for secrets
 *
 * Secrets are the server-only env vars that must never reach a client bundle
 * or be committed in [vars]. The list mirrors docs/cloudflare-env-mapping.md.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SECRETS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "EXCHANGERATE_API_KEY",
  "RESEND_API_KEY",
  "CRON_SECRET",
  "VAPID_PRIVATE_KEY",
  // VAPID_SUBJECT is `mailto:…` — low entropy, but still secret per #156.
  "VAPID_SUBJECT",
];

// Also guard against accidental NEXT_PUBLIC_ rename of a secret.
const RENAMED_SECRET_PATTERN =
  /NEXT_PUBLIC_.*(SERVICE_ROLE|RESEND_API|EXCHANGERATE|CRON_SECRET|VAPID_PRIVATE)/;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerPath = path.join(root, "wrangler.toml");
const args = process.argv.slice(2);
const checkBuild = args.includes("--build");

let failed = false;

function fail(msg) {
  console.error(`[verify-cloudflare-env] FAIL: ${msg}`);
  failed = true;
}

function pass(msg) {
  console.log(`[verify-cloudflare-env] OK: ${msg}`);
}

// 1) wrangler.toml [vars] must not contain any secret
if (!fs.existsSync(wranglerPath)) {
  fail(`wrangler.toml not found at ${wranglerPath}`);
} else {
  const toml = fs.readFileSync(wranglerPath, "utf8");
  // Extract the [vars] block — naive but sufficient for our flat toml.
  const varsMatch = toml.match(/\[vars\]([\s\S]*?)(?=\n\[|\n# Secrets|\n# Cron|$)/);
  const varsBlock = varsMatch ? varsMatch[1] : "";
  // Also extract staging vars if present.
  const stagingMatch = toml.match(/\[env\.staging\.vars\]([\s\S]*?)(?=\n\[|\n# Cron|$)/);
  const stagingBlock = stagingMatch ? stagingMatch[1] : "";
  const hasVars = /\[vars\]/.test(toml);

  if (!hasVars) {
    fail("wrangler.toml missing [vars] — public vars must be in [vars] per #156");
  } else {
    for (const secret of SECRETS) {
      // Only flag if the secret appears as a key assignment inside [vars]
      const inVars = new RegExp(`^\\s*${secret}\\s*=`, "m").test(varsBlock);
      if (inVars) {
        fail(
          `secret "${secret}" appears in wrangler.toml [vars] — move to \`wrangler secret put\``,
        );
      }
    }
    if (RENAMED_SECRET_PATTERN.test(varsBlock)) {
      fail("a secret appears to have been renamed to NEXT_PUBLIC_* in [vars] — not allowed");
    }
    if (!failed) pass("wrangler.toml [vars] contains no secrets");

    // Also guard staging vars if present.
    if (stagingMatch) {
      for (const secret of SECRETS) {
        const inStaging = new RegExp(`^\\s*${secret}\\s*=`, "m").test(stagingBlock);
        if (inStaging) {
          fail(
            `secret "${secret}" appears in wrangler.toml [env.staging.vars] — move to \`wrangler secret put --env staging\``,
          );
        }
      }
      if (RENAMED_SECRET_PATTERN.test(stagingBlock)) {
        fail(
          "a secret appears to have been renamed to NEXT_PUBLIC_* in [env.staging.vars] — not allowed",
        );
      } else if (!failed) pass("wrangler.toml [env.staging.vars] contains no secrets");
    }
  }

  // Also check the whole file for an accidental NEXT_PUBLIC_ service-role rename
  if (RENAMED_SECRET_PATTERN.test(toml)) {
    fail("a secret has been renamed to NEXT_PUBLIC_* somewhere in wrangler.toml");
  }

  // Ensure the required public vars are present (non-empty placeholder is fine)
  const requiredVars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_API_BASE_URL",
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    "APP_URL",
    "FEEDBACK_RECIPIENT_EMAIL",
    "RESEND_FROM",
  ];
  for (const v of requiredVars) {
    if (!new RegExp(`^\\s*${v}\\s*=`, "m").test(varsBlock)) {
      fail(`required public var "${v}" missing from wrangler.toml [vars]`);
    }
  }
  if (!failed) pass(`required ${requiredVars.length} public vars present in [vars]`);

  // Optional compat vars (not required but warn if divergence)
  const vapidPublic = varsBlock.match(/^\s*VAPID_PUBLIC_KEY\s*=\s*"?([^"\n]+)"?/m)?.[1]?.trim();
  const nextVapidPublic = varsBlock
    .match(/^\s*NEXT_PUBLIC_VAPID_PUBLIC_KEY\s*=\s*"?([^"\n]+)"?/m)?.[1]
    ?.trim();
  if (vapidPublic && nextVapidPublic && vapidPublic !== nextVapidPublic) {
    fail(
      `VAPID_PUBLIC_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY diverge in [vars] — keep them equal or use a single source with fallback in web-push.ts`,
    );
  }
  if (stagingMatch) {
    const stVapidPublic = stagingBlock
      .match(/^\s*VAPID_PUBLIC_KEY\s*=\s*"?([^"\n]+)"?/m)?.[1]
      ?.trim();
    const stNextVapidPublic = stagingBlock
      .match(/^\s*NEXT_PUBLIC_VAPID_PUBLIC_KEY\s*=\s*"?([^"\n]+)"?/m)?.[1]
      ?.trim();
    if (stVapidPublic && stNextVapidPublic && stVapidPublic !== stNextVapidPublic) {
      fail(
        `VAPID_PUBLIC_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY diverge in [env.staging.vars] — keep them equal`,
      );
    }
  }
}

// 2) Optional: grep built client bundle for secrets
if (checkBuild) {
  const assetsDir = path.join(root, ".open-next", "assets");
  const nextStaticDir = path.join(root, ".next", "static");

  const candidates = [];
  if (fs.existsSync(assetsDir)) candidates.push(assetsDir);
  if (fs.existsSync(nextStaticDir)) candidates.push(nextStaticDir);

  if (candidates.length === 0) {
    fail("no build output found (.open-next/assets or .next/static) — run `npm run build` first");
  } else {
    // Cheap recursive grep: read chunked files and search for secret identifiers.
    // We look for the identifier string, not the value — if the identifier
    // `SUPABASE_SERVICE_ROLE_KEY` appears in a client chunk, the bundler inlined it.
    const secretIdentifiers = [
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SECRET_KEY",
      "EXCHANGERATE_API_KEY",
      "RESEND_API_KEY",
      "CRON_SECRET",
      "VAPID_PRIVATE_KEY",
      "VAPID_SUBJECT",
    ];
    const clientFiles = [];
    for (const dir of candidates) {
      const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, entry.name);
          if (entry.isDirectory()) walk(p);
          else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) clientFiles.push(p);
        }
      };
      walk(dir);
    }
    if (clientFiles.length === 0) {
      fail(`no .js chunks found under ${candidates.join(", ")}`);
    } else {
      let leaks = 0;
      for (const file of clientFiles) {
        const content = fs.readFileSync(file, "utf8");
        for (const id of secretIdentifiers) {
          if (content.includes(id)) {
            fail(
              `secret identifier "${id}" leaked into client bundle: ${path.relative(root, file)}`,
            );
            leaks++;
            break;
          }
        }
      }
      if (leaks === 0) pass(`no secret identifiers in ${clientFiles.length} client chunks`);
    }
  }
}

if (failed) {
  console.error("\n[verify-cloudflare-env] verification failed — see above");
  process.exit(1);
} else {
  console.log("\n[verify-cloudflare-env] all checks passed");
}
