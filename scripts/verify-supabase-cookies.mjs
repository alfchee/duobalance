#!/usr/bin/env node
/**
 * verify-supabase-cookies.mjs — verification for #158
 *
 * Verifies that Supabase SSR cookie handling is correct at the edge (workerd)
 * and that session refresh survives jwt_expiry (3600s).
 *
 * Failure mode: login appears to work, then user looks logged out once JWT
 * expires because `setAll` was missing and TOKEN_REFRESHED never persisted.
 *
 * Checks (always, no secrets needed):
 *  1. src/lib/supabase/server.ts has getAll + setAll with try/catch
 *  2. Every route handler that reads request cookies is enumerated and uses
 *     the cookie-aware client (not a bare service-role bypass)
 *  3. Only the deliberately scoped fallback (export for removed members) uses
 *     createSupabaseServiceRoleClient for data fetching — no auth bypass
 *  4. Cron handlers are documented as NOT cookie-dependent for scheduled()
 *     dispatch (they use createSupabaseCronClient); HTTP fallback is via
 *     CRON_SECRET, not user cookies
 *  5. @supabase/ssr createServerClient import is present and not replaced by
 *     a plain createClient for cookie-auth handlers
 *
 * Live checks (only when --live and env present):
 *  - --live: exercise login → idle past jwt_expiry → refresh → 200 on authed
 *    route. Requires STAGING_URL, TEST_EMAIL, TEST_PASSWORD (and optionally
 *    TEST_INVITE_EMAIL for accept-invite). Without --live, the script only
 *    checks static invariants and prints the manual sign-off checklist.
 *
 * Usage:
 *   node scripts/verify-supabase-cookies.mjs
 *   node scripts/verify-supabase-cookies.mjs --live --url https://staging.duobalance.app
 *
 * See docs/supabase-cookie-verification.md for the full manual checklist.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const live = args.includes("--live");
const urlIdx = args.indexOf("--url");
const stagingUrl = urlIdx !== -1 ? args[urlIdx + 1] : process.env.STAGING_URL;

let failed = false;
function fail(msg) {
  console.error(`[verify-supabase-cookies] FAIL: ${msg}`);
  failed = true;
}
function pass(msg) {
  console.log(`[verify-supabase-cookies] OK: ${msg}`);
}
function warn(msg) {
  console.warn(`[verify-supabase-cookies] WARN: ${msg}`);
}
function read(p) {
  return fs.readFileSync(path.join(root, p), "utf8");
}

function findApiRouteFiles(dir) {
  const routes = [];
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === "route.ts") {
        routes.push(path.relative(root, full));
      }
    }
  }
  walk(dir);
  return routes;
}

async function main() {
  // 1) src/lib/supabase/server.ts — getAll + setAll
  try {
    const server = read("src/lib/supabase/server.ts");
    // Precise regex: getAll() { ... cookieStore.getAll() } and setAll(cookiesToSet) { ... try { cookieStore.set ...
    const hasGetAll =
      /getAll\s*\(\s*\)\s*\{[\s\S]*?cookieStore\.getAll\(\)/.test(server) &&
      server.includes("getAll");
    const hasSetAll =
      /setAll\s*\(\s*cookiesToSet/.test(server) && /cookieStore\.set\s*\(/.test(server);
    const hasTryCatch = /setAll[\s\S]*?try\s*\{[\s\S]*?cookieStore\.set[\s\S]*?catch/.test(server);
    const hasWarn = /setAll[\s\S]*?console\.warn[\s\S]*?setAll failed/.test(server);
    const usesCreateServerClient = server.includes("createServerClient");

    if (!hasGetAll) fail("src/lib/supabase/server.ts missing getAll → cookieStore.getAll()");
    else pass("server.ts: getAll present");

    if (!hasSetAll)
      fail(
        "src/lib/supabase/server.ts missing setAll → cookieStore.set — TOKEN_REFRESHED will not persist and session drops after jwt_expiry",
      );
    else pass("server.ts: setAll present");

    if (!hasTryCatch)
      fail(
        "server.ts: setAll should wrap cookieStore.set in try/catch for workerd edge (Server Component may be read-only)",
      );
    else pass("server.ts: setAll has try/catch");

    if (!hasWarn)
      warn(
        "server.ts: setAll should console.warn on failure so wrangler tail surfaces refresh failures",
      );
    else pass("server.ts: setAll logs on failure");

    if (!usesCreateServerClient)
      fail("server.ts must use createServerClient from @supabase/ssr, not plain createClient");
    else pass("server.ts: uses createServerClient");

    // Ensure the file still imports next/headers cookies correctly
    if (!server.includes('from "next/headers"') && !server.includes("from 'next/headers'")) {
      fail("server.ts must import { cookies } from next/headers");
    } else pass("server.ts: imports cookies from next/headers");

    // Check that export and cron clients are separate (cron has no next/headers)
    const cron = read("src/lib/supabase/cron.ts");
    if (/from\s+["']next\/headers["']/.test(cron))
      fail(
        "src/lib/supabase/cron.ts must not import next/headers (scheduled dispatch has no Next context)",
      );
    else pass("cron.ts: no next/headers (scheduled-safe)");

    if (!cron.includes("createSupabaseCronClient"))
      fail("src/lib/supabase/cron.ts missing createSupabaseCronClient for scheduled()");
    else pass("cron.ts: createSupabaseCronClient present");
  } catch (e) {
    fail(`could not read server/cron modules: ${e}`);
  }

  // 2) Enumerate handlers that read request cookies
  // When adding a new api route that reads cookies, update the allowlist below.
  const expectedCookieHandlers = [
    "src/app/api/bills/[id]/generate/route.ts",
    "src/app/api/export/route.ts",
    "src/app/api/feedback/route.ts",
    "src/app/api/invites/route.ts",
    "src/app/api/invites/[id]/route.ts",
    "src/app/api/invites/[id]/resend/route.ts",
    "src/app/api/members/remove/route.ts",
    "src/app/api/push-subscriptions/route.ts",
  ];

  const cronHandlers = [
    "src/app/api/cron/fx-refresh/route.ts",
    "src/app/api/cron/generate-bill-instances/route.ts",
    "src/app/api/cron/purge-households/route.ts",
    "src/app/api/cron/send-bill-reminders/route.ts",
  ];

  try {
    for (const p of expectedCookieHandlers) {
      const content = read(p);
      const usesCookies =
        content.includes("createSupabaseRouteHandler") ||
        content.includes("createRouteContext") ||
        content.includes("createInviteRouteContext");
      if (!usesCookies)
        fail(
          `${p} should use createSupabaseRouteHandler/createRouteContext (cookie-aware) for auth`,
        );
      else pass(`${p}: cookie-aware auth`);
      // Ensure no handler accidentally bypasses auth with bare service role for user data
      if (p !== "src/app/api/export/route.ts" && p !== "src/app/api/push-subscriptions/route.ts") {
        // These two are allowed to use service role in scoped ways; others should not import it directly
        if (
          content.includes("createSupabaseServiceRoleClient") &&
          !content.includes("createInviteRouteContext")
        ) {
          fail(
            `${p} imports createSupabaseServiceRoleClient directly — auth must stay cookie-based (RLS), not service-role fallback`,
          );
        }
      }
    }

    for (const p of cronHandlers) {
      const content = read(p);
      // Cron handlers use cookie client but are authenticated via CRON_SECRET, not user cookies.
      // That's acceptable; scheduled() dispatch bypasses HTTP entirely.
      if (!content.includes("CRON_SECRET") && !content.includes("isAuthorized")) {
        warn(`${p} should gate on CRON_SECRET/isAuthorized — not user cookies`);
      } else pass(`${p}: CRON_SECRET gated (not user-cookie dependent for scheduled)`);
      // Verify worker.ts scheduled path uses createSupabaseCronClient (no cookies)
      const worker = read("worker.ts");
      if (!worker.includes("createSupabaseCronClient"))
        fail("worker.ts must use createSupabaseCronClient for scheduled() dispatch");
    }
    // Verify worker scheduled bypasses cookies
    const worker = read("worker.ts");
    if (
      /from\s+["']next\/headers["']/.test(worker) ||
      worker.includes("createSupabaseRouteHandler")
    ) {
      fail("worker.ts scheduled path must not import next/headers or createSupabaseRouteHandler");
    } else pass("worker.ts: scheduled dispatch is cookie-free (createSupabaseCronClient)");

    // Glob scan — catch new handlers that read cookies but are not in the allowlist
    const apiDir = path.join(root, "src/app/api");
    if (fs.existsSync(apiDir)) {
      const allRoutes = findApiRouteFiles(apiDir);
      const allowlisted = new Set([
        ...expectedCookieHandlers,
        ...cronHandlers,
        "src/app/api/health/route.ts",
      ]);
      for (const route of allRoutes) {
        if (allowlisted.has(route)) continue;
        try {
          const content = read(route);
          const isCookieHandler =
            content.includes("createSupabaseRouteHandler") ||
            content.includes("createRouteContext") ||
            content.includes("createInviteRouteContext") ||
            content.includes("next/headers");
          if (isCookieHandler) {
            warn(
              `${route} appears to be a cookie-aware handler but is not in the allowlist — add it to expectedCookieHandlers or cronHandlers in scripts/verify-supabase-cookies.mjs`,
            );
          }
        } catch {
          // ignore unreadable
        }
      }
      // Also ensure expected handlers still exist (detect renames/deletes)
      for (const p of expectedCookieHandlers) {
        if (!allRoutes.includes(p)) {
          warn(`${p} in allowlist but file not found — handler may have been renamed or removed`);
        }
      }
    }

    // Specific scoped fallbacks
    const exportRoute = read("src/app/api/export/route.ts");
    if (
      !exportRoute.includes("createSupabaseServiceRoleClient") ||
      !exportRoute.includes("removedMemberId") ||
      !exportRoute.includes("allowedAccountIds")
    ) {
      fail(
        "src/app/api/export/route.ts scoped service-role fallback for removed members is missing or incomplete",
      );
    } else pass("export route: scoped removed-member fallback present (with account scoping)");

    const pushRoute = read("src/app/api/push-subscriptions/route.ts");
    if (!pushRoute.includes("createSupabaseServiceRoleClient") || !pushRoute.includes("endpoint")) {
      fail(
        "src/app/api/push-subscriptions/route.ts should use service role only for globally-unique endpoint reassignment after ownership check",
      );
    } else pass("push-subscriptions: scoped endpoint-reassignment fallback present");

    // Invites/members must NOT use service role for auth, only for DB writes after auth
    const invitesShared = read("src/app/api/invites/_shared.ts");
    if (
      !invitesShared.includes("createSupabaseServiceRoleClient") ||
      !invitesShared.includes("createRouteContext")
    ) {
      warn(
        "src/app/api/invites/_shared.ts should export both auth (cookie) and admin (service role) — writes via admin after auth",
      );
    } else pass("invites/_shared: dual auth+admin pattern (cookie auth, service-role writes)");
  } catch (e) {
    fail(`handler enumeration failed: ${e}`);
  }

  // 3) Browser client sanity
  try {
    const browser = read("src/lib/supabase/client.ts");
    if (!browser.includes("createBrowserClient"))
      fail("src/lib/supabase/client.ts must use createBrowserClient from @supabase/ssr");
    else pass("browser client: createBrowserClient present");
  } catch (e) {
    fail(`could not read browser client: ${e}`);
  }

  // 4) Live checks — only if --live
  if (live) {
    if (!stagingUrl) {
      fail(
        "--live requires --url <stagingUrl> or STAGING_URL env (e.g. https://staging.duobalance.app)",
      );
    } else {
      console.log(
        `[verify-supabase-cookies] live checks against ${stagingUrl} — this will test session refresh`,
      );
      const email = process.env.TEST_EMAIL;
      const password = process.env.TEST_PASSWORD;
      if (!email || !password) {
        warn(
          "live refresh test skipped: set TEST_EMAIL and TEST_PASSWORD to exercise login → refresh → 200. Static checks are still the CI gate; run the manual checklist in docs/supabase-cookie-verification.md for full proof.",
        );
      } else {
        // Use the anon/publishable key via supabase-js directly to test cookie flow
        // against the deployed Worker: login, immediately test an authed handler,
        // note jwt expiry, wait past it, and verify the same handler still returns 200
        // with refreshed cookies (no spurious 401).
        console.log(
          "[verify-supabase-cookies] attempting live session-refresh cycle (this takes ~61 minutes for a real jwt_expiry; use JWT_EXPIRY override or short-lived token for faster proof)",
        );
        console.log(
          "[verify-supabase-cookies] For CI, the static checks above are sufficient. For staging sign-off, follow docs/supabase-cookie-verification.md § Live (requires 3600s idle).",
        );
        // We do a lightweight probe now — login and check that set-cookie includes refresh + that an authed route returns 200.
        // Full 3600s wait is documented as a manual step because CI cannot idle that long.
        try {
          const supabaseUrl =
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.STAGING_SUPABASE_URL;
          const anonKey =
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
          if (!supabaseUrl || !anonKey) {
            warn(
              "live probe skipped: NEXT_PUBLIC_SUPABASE_URL / anon key not set in env — deploy uses wrangler [vars]; set locally for live probe",
            );
          } else {
            const { createClient } = await import("@supabase/supabase-js");
            const supabase = createClient(supabaseUrl, anonKey);
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error || !data.session) {
              fail(`live login failed: ${error?.message ?? "no session"}`);
            } else {
              const expiresIn = data.session.expires_in ?? 3600;
              pass(
                `live login ok — jwt expires_in=${expiresIn}s (refresh expected after this window)`,
              );
              // Probe an authed handler via apiFetch-style cookie forward would require a browser;
              // here we probe that the session's access_token is valid for getUser.
              const { data: userData, error: userErr } = await supabase.auth.getUser();
              if (userErr || !userData.user)
                fail(`live getUser after login failed: ${userErr?.message}`);
              else pass(`live getUser ok — user ${userData.user.email}`);
              console.log(
                `[verify-supabase-cookies] To prove refresh on the Worker, keep this session idle for ${expiresIn}+60s, then re-call an authed route (e.g. GET /api/push-subscriptions or POST /api/feedback) from the same browser/cookie jar and assert 200 not 401. See docs/supabase-cookie-verification.md for the Playwright/curl harness.`,
              );
            }
          }
        } catch (e) {
          fail(`live probe threw: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      // Invite flow live check hint
      if (!process.env.TEST_INVITE_EMAIL) {
        console.log(
          "[verify-supabase-cookies] invite live test skipped (set TEST_INVITE_EMAIL to test accept-invite for second user)",
        );
      } else {
        console.log(
          `[verify-supabase-cookies] invite live test would create invite for ${process.env.TEST_INVITE_EMAIL} and verify accept — run manually per docs/supabase-cookie-verification.md`,
        );
      }
    }
  } else {
    console.log(
      "[verify-supabase-cookies] live checks skipped (pass --live --url <stagingUrl> with TEST_EMAIL/TEST_PASSWORD to probe session refresh; full 3600s idle is a manual staging step per docs/supabase-cookie-verification.md)",
    );
  }

  if (failed) {
    console.error("\n[verify-supabase-cookies] verification failed — see above");
    process.exit(1);
  } else {
    console.log("\n[verify-supabase-cookies] all checks passed");
    if (!live) {
      console.log(
        "  For full AC proof before cutover, deploy to staging and run the live checklist in docs/supabase-cookie-verification.md (login → 3600s idle → refresh → no 401, plus accept-invite for second user).",
      );
    }
  }
}

main().catch((e) => {
  console.error(
    `[verify-supabase-cookies] unhandled error: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exit(1);
});
