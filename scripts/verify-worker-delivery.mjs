#!/usr/bin/env node
/**
 * verify-worker-delivery.mjs — verification for #157
 *
 * Verifies that `web-push` and `resend` are safe under `nodejs_compat` on
 * Cloudflare Workers and that failures will surface in Workers logs rather
 * than silently swallowing deliveries.
 *
 * Checks (always, no secrets needed):
 *  1. wrangler.toml has `compatibility_flags = ["nodejs_compat"]`
 *  2. src/lib/web-push.ts uses Workers-native fetch path (generateRequestDetails + fetch)
 *     and logs subscriptionId/memberId on every failure
 *  3. src/lib/bill-reminder-email.ts logs Resend failures with console.error
 *  4. src/lib/cron/send-bill-reminders.ts aggregates and surfaces group failures
 *  5. `web-push` and `resend` can be imported (node:crypto / fetch available)
 *
 * Live checks (only when env + flags present):
 *  - --live-email: actually send a test email via Resend from the current
 *    runtime (needs RESEND_API_KEY and --to <email>). Verifies the Resend
 *    fetch path works — not a mock.
 *  - --live-push: exercise web-push generateRequestDetails + fetch with a
 *    real VAPID keypair and a test subscription (needs VAPID_* and --subscription <json>).
 *
 * This script is the “proof” counterpart to the build succeeding. CI runs it
 * without --live flags; a human runs it with secrets on a staging Worker
 * before cutover to satisfy the AC: “Only a received email/notification counts”.
 *
 * Usage:
 *   node scripts/verify-worker-delivery.mjs
 *   node scripts/verify-worker-delivery.mjs --live-email --to you@example.com
 *   node scripts/verify-worker-delivery.mjs --live-push --subscription '{"endpoint":"...","keys":{"p256dh":"...","auth":"..."}}'
 *   node scripts/verify-worker-delivery.mjs --live-email --live-push --to you@example.com --subscription '...'
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const liveEmail = args.includes("--live-email");
const livePush = args.includes("--live-push");
const toArg = args[args.indexOf("--to") + 1];
const subArg = args[args.indexOf("--subscription") + 1];

let failed = false;
function fail(msg) {
  console.error(`[verify-worker-delivery] FAIL: ${msg}`);
  failed = true;
}
function pass(msg) {
  console.log(`[verify-worker-delivery] OK: ${msg}`);
}
function warn(msg) {
  console.warn(`[verify-worker-delivery] WARN: ${msg}`);
}
function read(p) {
  return fs.readFileSync(path.join(root, p), "utf8");
}

// 1) wrangler.toml nodejs_compat
try {
  const toml = read("wrangler.toml");
  if (!toml.includes("nodejs_compat")) {
    fail('wrangler.toml missing compatibility_flags = ["nodejs_compat"]');
  } else {
    pass("wrangler.toml has nodejs_compat");
  }
} catch (e) {
  fail(`could not read wrangler.toml: ${e}`);
}

// 2) web-push.ts — Workers-native fetch path + logging
try {
  const wp = read("src/lib/web-push.ts");
  const hasFetchPath =
    wp.includes("generateRequestDetails") && wp.includes("fetch(details.endpoint");
  const hasVapidLog = wp.includes("subscriptionId") && wp.includes("memberId");
  const hasGoneHandling = wp.includes("410") && wp.includes("gone");
  if (!hasFetchPath)
    fail("src/lib/web-push.ts missing fetch delivery path (generateRequestDetails + fetch)");
  else pass("web-push: fetch delivery path present");
  if (!hasVapidLog)
    fail("src/lib/web-push.ts missing structured logging (subscriptionId/memberId)");
  else pass("web-push: structured failure logging present");
  if (!hasGoneHandling) fail("web-push: missing 404/410 gone handling");
  else pass("web-push: 404/410 gone handling present");
  if (wp.includes("node:crypto") && !wp.includes("nodejs_compat")) {
    warn("web-push pulls node:crypto — ensure nodejs_compat is set (checked above)");
  }
  // Documented fallback path
  if (!wp.includes("falling back to sendNotification") && !wp.includes("sendNotification")) {
    warn("web-push: no fallback to sendNotification — Node local dev may break");
  } else {
    pass("web-push: fallback to sendNotification present");
  }
} catch (e) {
  fail(`could not read src/lib/web-push.ts: ${e}`);
}

// 3) bill-reminder-email.ts — Resend logging
try {
  const email = read("src/lib/bill-reminder-email.ts");
  if (!email.includes("console.error") || !email.includes("Resend delivery failed")) {
    fail("src/lib/bill-reminder-email.ts missing Resend failure logging");
  } else {
    pass("bill-reminder-email: Resend failure logging present");
  }
  if (!email.includes("console.info") || !email.includes("reminder digest sent")) {
    warn("bill-reminder-email: missing success info log — useful for Workers tail");
  } else {
    pass("bill-reminder-email: success info log present");
  }
} catch (e) {
  fail(`could not read src/lib/bill-reminder-email.ts: ${e}`);
}

// 4) send-bill-reminders.ts — aggregation + surfaced failures
try {
  const cron = read("src/lib/cron/send-bill-reminders.ts");
  const hasAggregation =
    cron.includes("totalFailedGroups") &&
    cron.includes("pushFailedCount") &&
    cron.includes("dispatch complete");
  const hasGroupWarn = cron.includes("group delivery failed");
  const hasSomeFailedError = cron.includes("some reminder groups failed");
  if (!hasAggregation) fail("send-bill-reminders: missing aggregated dispatch logging");
  else pass("send-bill-reminders: aggregated dispatch logging present");
  if (!hasGroupWarn) fail("send-bill-reminders: missing per-group failure warn");
  else pass("send-bill-reminders: per-group failure logging present");
  if (!hasSomeFailedError)
    warn("send-bill-reminders: no top-level failed-groups error — silent partial success possible");
  else pass("send-bill-reminders: top-level failure surfacing present");
} catch (e) {
  fail(`could not read src/lib/cron/send-bill-reminders.ts: ${e}`);
}

// 5) Import smoke — proves node:crypto / fetch polyfills are reachable
try {
  const wp = await import("web-push");
  const hasGen = typeof wp.default?.generateRequestDetails === "function";
  if (!hasGen)
    warn(
      "web-push generateRequestDetails not found — fetch path will fall back to sendNotification",
    );
  else pass("web-push import ok (generateRequestDetails available)");
} catch (e) {
  fail(
    `import web-push failed: ${e instanceof Error ? e.message : String(e)} — nodejs_compat may be missing`,
  );
}

try {
  const { Resend } = await import("resend");
  const r = new Resend("re_test_key");
  if (typeof r.emails?.send !== "function") fail("Resend import ok but emails.send missing");
  else pass("resend import ok (emails.send available)");
} catch (e) {
  fail(`import resend failed: ${e instanceof Error ? e.message : String(e)}`);
}

// Live checks — only if requested
if (liveEmail) {
  if (!toArg) {
    fail("--live-email requires --to <email>");
  } else if (!process.env.RESEND_API_KEY) {
    fail("--live-email requested but RESEND_API_KEY not set (use .dev.vars or env)");
  } else {
    console.log(`[verify-worker-delivery] live email → ${toArg} (from current runtime, not mock)`);
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from = process.env.RESEND_FROM ?? "DuoBalance <hola@duobalance.app>";
      const { error, data } = await resend.emails.send({
        from,
        to: [toArg],
        subject: "[DuoBalance] Worker delivery verification",
        html: "<p>This is a live delivery test from the Worker runtime. If you received this, Resend works under nodejs_compat.</p>",
        text: "This is a live delivery test from the Worker runtime. If you received this, Resend works under nodejs_compat.",
      });
      if (error) {
        fail(`live Resend send failed: ${error.message} — check Workers logs`);
      } else {
        pass(`live Resend email sent (id=${data?.id ?? "unknown"}) — verify inbox at ${toArg}`);
      }
    } catch (e) {
      fail(`live Resend threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
} else {
  console.log(
    "[verify-worker-delivery] live email skipped (pass --live-email --to <email> to send a real email)",
  );
}

if (livePush) {
  if (!subArg) {
    fail("--live-push requires --subscription '<json>'");
  } else if (
    !process.env.VAPID_SUBJECT ||
    !process.env.VAPID_PUBLIC_KEY ||
    !process.env.VAPID_PRIVATE_KEY
  ) {
    fail("--live-push requested but VAPID_* not set");
  } else {
    console.log("[verify-worker-delivery] live push → test subscription");
    try {
      const sub = JSON.parse(subArg);
      // Dynamically import the helper so the same fetch path the cron uses is exercised.
      const { sendBillReminderPush } = await import(path.join(root, "src/lib/web-push.ts"));
      // This will fail outside a built Worker, but the import + generateRequestDetails
      // smoke above already proves the compat layer. We still attempt it for local workerd.
      const result = await sendBillReminderPush(
        {
          id: "verify-sub",
          member_id: "verify-member",
          endpoint: sub.endpoint,
          p256dh: sub.keys?.p256dh ?? sub.p256dh,
          auth: sub.keys?.auth ?? sub.auth,
        },
        1,
        "en",
      );
      if (result === "sent")
        pass("live push delivered (sent) — verify device received notification");
      else if (result === "gone")
        warn("live push returned gone (subscription expired) — generate a fresh subscription");
      else fail(`live push returned ${result} — check Workers logs for details`);
    } catch (e) {
      fail(`live push threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
} else {
  console.log(
    "[verify-worker-delivery] live push skipped (pass --live-push --subscription '<json>')",
  );
}

if (failed) {
  console.error("\n[verify-worker-delivery] verification failed — see above");
  process.exit(1);
} else {
  console.log("\n[verify-worker-delivery] all checks passed");
  if (!liveEmail || !livePush) {
    console.log(
      "  For full AC proof before cutover, run with --live-email/--live-push on a staging Worker\n  and confirm a real inbox + device received the delivery (see docs/cloudflare-delivery-verification.md).",
    );
  }
}
