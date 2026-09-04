# Supabase SSR cookie handling at the edge — #158

> **AC gates production cutover.** A session must survive a full token refresh
> cycle on the Worker. A smoke test that finishes in two minutes will not catch
> the failure — `jwt_expiry` is 3600s, so the test must deliberately idle past
> expiry.

## Context

`@supabase/ssr` `createServerClient` expects a `getAll`/`setAll` cookie
interface. On Cloudflare Workers the cookie API is workerd's polyfilled Web API
rather than Node's `http`. The failure mode is subtle and slow: login appears
to work, then the user looks logged out once the JWT expires and
`TOKEN_REFRESHED` cannot persist new cookies. With `jwt_expiry` at 3600s this is
invisible to a short smoke test.

`src/lib/supabase/server.ts` previously configured only `getAll`. The
`@supabase/ssr` internals then installed a warning stub for `setAll` that never
writes `Set-Cookie`, so every refresh is lost. After one hour the session
drops with a spurious 401 on every handler that calls `supabase.auth.getUser()`.

## Fix

### `src/lib/supabase/server.ts` — add `setAll`

```ts
const cookieStore = await cookies();
return createServerClient(url, serviceRoleKey, {
  cookies: {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      } catch (error) {
        console.warn("[supabase] setAll failed — session refresh may not persist", error);
      }
    },
  },
});
```

- `getAll` returns all `sb-*` chunk cookies (Supabase chunks large JWTs into
  multiple cookies; `getAll` preserves that).
- `setAll` is called from `client.auth.onAuthStateChange` on `SIGNED_IN`,
  `TOKEN_REFRESHED`, `USER_UPDATED`, `SIGNED_OUT`, etc. Without it the warning
  stub in `node_modules/@supabase/ssr/dist/module/cookies.js:123` fires:
  `createServerClient was configured without the setAll cookie method…random
logouts, early session termination`.
- `try/catch` is required because `cookies().set` throws when called from a
  read-only Server Component context. Route handlers (`app/api/**`) are writable,
  but the guard makes the failure mode visible in `wrangler tail` instead of
  silently dropping the refresh.
- `console.warn` surfaces the failure so `wrangler tail` shows it; otherwise
  the cron/user path would return 401 without a log line.

Cron `scheduled()` dispatch is explicitly not affected: `worker.ts` uses
`createSupabaseCronClient` from `src/lib/supabase/cron.ts`, which has no
`next/headers` import and uses a bare `createClient` with `persistSession:
false`. It does not read or write cookies at all.

## Handler audit — every handler that reads request cookies

| Handler                                      | Auth                                               | Cookie?                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/bills/[id]/generate`              | `getAuthedUser(supabase, Bearer?)`                 | Yes — `createRouteContext()`                                             | Accepts `Authorization: Bearer` OR body `accessToken` as explicit token, but primary path is cookie. No service-role fallback; RLS enforced.                                                                                                                                                                                                                                          |
| `GET/POST /api/cron/fx-refresh`              | `CRON_SECRET` Bearer                               | No (user) — uses `createSupabaseRouteHandler` but gated on `CRON_SECRET` | DB work uses same service-role key; scheduled dispatch bypasses HTTP via `createSupabaseCronClient`. Not user-cookie dependent.                                                                                                                                                                                                                                                       |
| `GET/POST /api/cron/generate-bill-instances` | `CRON_SECRET`                                      | Same as above                                                            | Same — candidate for pure service-role but current path is fine; failure of `cookieStore.getAll()` with no cookies returns `[]` and does not affect cron writes.                                                                                                                                                                                                                      |
| `GET/POST /api/cron/purge-households`        | `CRON_SECRET`                                      | Same                                                                     | Same.                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET/POST /api/cron/send-bill-reminders`     | `CRON_SECRET` + `RESEND_API_KEY`                   | Same                                                                     | Same.                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET /api/export`                            | `getAuthedUser` (cookie)                           | Yes                                                                      | **Scoped fallback**: if active membership not found, retries via `createSupabaseServiceRoleClient` to allow a freshly-removed member to export past data. Scope is replicated RLS: `removed_at` cutoff + `allowedAccountIds` (`is_shared ∨ owner_member_id`). This is the only handler where cookie failure legitimately falls back to service role for user data, and it is bounded. |
| `POST /api/feedback`                         | `supabase.auth.getUser()`                          | Yes                                                                      | Rate-limited by user.id from cookie auth. No fallback.                                                                                                                                                                                                                                                                                                                                |
| `POST /api/invites`                          | `getAuthedUser(auth)` + `admin` for writes         | Yes (auth) + service role for DB                                         | `createInviteRouteContext()` returns `{auth, admin}`; auth is cookie-based, admin is service role for `household_invites`/`invite_sends` after `requireOwner` check. No auth bypass.                                                                                                                                                                                                  |
| `POST /api/invites/[id]/resend`              | Same as above                                      | Yes                                                                      | Same dual pattern.                                                                                                                                                                                                                                                                                                                                                                    |
| `DELETE /api/invites/[id]`                   | Same                                               | Yes                                                                      | Same.                                                                                                                                                                                                                                                                                                                                                                                 |
| `POST /api/members/remove`                   | `getAuthedUser(auth)`                              | Yes                                                                      | Same dual pattern; RPC `remove_member` executed as cookie-auth client so RLS still enforces ownership.                                                                                                                                                                                                                                                                                |
| `POST /api/push-subscriptions`               | `requireOwnMember` via cookie + `admin` for upsert | Yes + scoped                                                             | Uses service role only to upsert `push_subscriptions` by globally-unique `endpoint` after ownership check — avoids 409 on shared browser profile. Not an auth fallback.                                                                                                                                                                                                               |
| `DELETE /api/push-subscriptions`             | Same                                               | Yes                                                                      | Pure cookie auth, no service role.                                                                                                                                                                                                                                                                                                                                                    |
| `GET /api/health`                            | None                                               | No                                                                       | `force-static`, no auth.                                                                                                                                                                                                                                                                                                                                                              |

**Result:** No user-facing handler other than `export` should fall back to
service role for auth. Doing so would bypass RLS and expose cross-household
data. The table above is the allowlist; any new handler must follow the same
rule.

## Fallback analysis

- **Should _not_ use service-role fallback:** `bills/generate`, `feedback`,
  `invites/*`, `members/remove`, `push-subscriptions` (except the scoped
  endpoint upsert). These are RLS-gated user data paths; a silent fallback
  would leak data across households. The correct fix is the `setAll`
  implementation above, not a bypass.

- **Already-scoped fallbacks (do not widen):**
  - `export` — allowed because a removed member must still export data created
    before `removed_at`/`deleted_at`. The fallback replicates the RLS predicate
    explicitly (`is_shared ∨ owner_member_id`, `created_at ≤ cutoff`,
    `account_id ∈ allowedAccountIds`). Expanding this pattern to other handlers
    would be a last resort and must be audited per-handler, per-table.
  - `push-subscriptions` — service role is only for the `endpoint` unique
    constraint reassignment after `requireOwnMember`; reads are still RLS-gated.

- **Candidates that _could_ use service role instead (but don't need to):**
  Cron HTTP handlers (`/api/cron/*`). They are gated by `CRON_SECRET`, not user
  cookies, and the `scheduled()` path already uses pure service role. Moving the
  HTTP cron handlers to `createSupabaseServiceRoleClient` directly would remove
  the (harmless) `cookieStore.getAll()` call entirely. Left as-is to minimise
  diff; the verification script flags them as CRON_SECRET-gated, not
  user-cookie dependent. If workerd's cookie polyfill ever regresses, the first
  handler to migrate would be these HTTP cron adapters.

See `scripts/verify-supabase-cookies.mjs` for the machine-checked version of
this audit.

## Verification

### Automated (no secrets — runs in CI)

```bash
node scripts/verify-supabase-cookies.mjs
```

Checks:

1. `src/lib/supabase/server.ts` has `getAll` + `setAll` with `try/catch` and
   `console.warn`
2. `src/lib/supabase/cron.ts` has `createSupabaseCronClient` and no
   `next/headers`
3. Every handler in the audit table uses the cookie-aware client; no handler
   except the allowlisted `export`/`push-subscriptions` imports
   `createSupabaseServiceRoleClient` for auth bypass
4. `worker.ts` scheduled dispatch uses `createSupabaseCronClient` (no cookies)
5. `@supabase/ssr` `createBrowserClient` still used on the client

CI runs this without `--live` — it proves the fix and the audit are present.

The script is wired into `npm run check` as `verify:cookies`.

### Live (requires secrets — run on staging before cutover)

The AC is only satisfied by a session that survives `jwt_expiry` on the Worker
plus an accept-invite for a second user. Use a staging Worker with real
Supabase secrets (`.dev.vars` or `wrangler secret put`) and run:

```bash
# 1) Deploy staging with the fix
npx opennextjs-cloudflare build
npx wrangler deploy --env staging   # or wrangler dev for local workerd

# 2) Quick probe — proves login works on the Worker at all
STAGING_URL=https://staging.duobalance.app \
TEST_EMAIL=you+test1@example.com TEST_PASSWORD='<pw>' \
node scripts/verify-supabase-cookies.mjs --live --url https://staging.duobalance.app
# Expect: live login ok, getUser ok

# 3) Full refresh cycle — the only proof that matters for this issue
# Open the staging app in a real browser (or Playwright with a persistent
# cookie jar), log in, then idle past jwt_expiry. Do NOT close the tab.
#
# Option A — browser + wall clock (simplest):
#   - Log in as TEST_EMAIL.
#   - Note the Set-Cookie expiry / jwt `exp` claim (jwt_expiry = 3600s).
#   - Wait 3600s + 60s (61 minutes) without interacting. Keep the tab open
#     so the browser's Supabase client can attempt refresh on next request.
#   - Hit any authed route: `fetch('/api/feedback', {method:'POST', body:'{}'})`
#     or simply navigate to /balances — the server handler will call
#     `supabase.auth.getUser()` which triggers TOKEN_REFRESHED if needed.
#   - Assert: 200 / balances load, not a redirect to /login.
#   - `npx wrangler tail --env staging` should show no `spurious 401` and, if
#     refresh fired, the Supabase auth logs/any `[supabase] setAll` warn (none).
#
# Option B — Playwright with cookie jar (reproducible, see e2e/supabase-refresh.spec.ts if added):
#   npm run test:e2e -- supabase-refresh
#
# Option C — curl with cookie jar (headless):
#   JAR=$(mktemp)
#   curl -c $JAR -b $JAR -X POST https://staging.duobalance.app/api/auth/login \
#        -H 'Content-Type: application/json' \
#        -d '{"email":"you+test1@example.com","password":"<pw>"}'
#   # Idle 3660s … then:
#   curl -c $JAR -b $JAR https://staging.duobalance.app/api/export?householdId=<id>
#   # → 200 (not 401). Inspect Set-Cookie on the 200 for refreshed sb-* cookies.

# 4) Accept-invite for second user (proves @supabase/ssr PKCE + cookie flow end-to-end)
#   As owner (first user), create an invite:
#     curl -b $JAR -X POST https://staging.duobalance.app/api/invites \
#          -H 'Content-Type: application/json' -d '{"household_id":"<hh>","email":"you+test2@example.com"}'
#   Copy the token from the household_invites row (or the email if Resend is live).
#   As second user (new browser profile/incognito), complete signup + accept_invite RPC:
#     POST /auth/v1/signup with email you+test2@example.com
#     GET  /?invite_token=<token> → accept flow → POST /api/invites/accept (or direct RPC)
#   Sign in as second user and hit GET /api/export?householdId=<hh> → 200.

# 5) No spurious 401 on any cookie handler
#   After the 61-minute idle, hit each handler from the audit table with the
#   original user's JAR — every one should return its normal 200/400/403, not 401.
#   401 after expiry = refresh did not persist → fails the AC.

# Check logs:
npx wrangler tail --env staging
# Look for: "[supabase] setAll failed" (should be absent), "TOKEN_REFRESHED" (if logged by Supabase),
# and absence of "No handler returns a spurious 401 after token expiry".
```

**Sign-off checklist (before production cutover):**

- [ ] `node scripts/verify-supabase-cookies.mjs` passes (CI also runs it)
- [ ] `npm run check` passes (includes `verify:cookies`)
- [ ] Staging: login, signup, and accept-invite for a second user all succeed on
      the Worker (`*.workers.dev` or staging URL)
- [ ] Staging: after idling 3660s, an authed handler still returns 200 (not a
      redirect/401) — session survived a full `jwt_expiry` cycle
- [ ] `wrangler tail --env staging` shows no `[supabase] setAll failed` and no
      spurious 401s on any handler after expiry
- [ ] Fallback analysis reviewed — no new service-role bypass added

## References

- #158 — Verify Supabase SSR cookie handling and session refresh at the edge
- #152 — Epic: Migrate hosting from Vercel to Cloudflare Workers
- `src/lib/supabase/server.ts` — the fix (getAll + setAll)
- `src/lib/supabase/cron.ts` — cookie-free scheduled dispatch
- `worker.ts:scheduled` — cron dispatch via `createSupabaseCronClient`
- `scripts/verify-supabase-cookies.mjs` — automated audit
