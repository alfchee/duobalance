# PWA offline verification — #159

> **AC gates production cutover.** With OpenNext the PWA must still load
> offline after a first visit on the **Cloudflare deployment**. Hashed
> filenames (`/_next/static/chunks/*.js`, `_buildManifest.js`, etc.) differ
> between local and deployed builds, so verification on `wrangler dev` is not
> sufficient. Test on the actual deployed Worker.

## Context

`scripts/generate-service-worker.mjs` previously read only `.next/static` +
`.next/server/app` to build `public/sw-assets.js`. OpenNext emits to
`.open-next/assets` and Cloudflare serves the `ASSETS` binding from there. If
the script is not re-run after `opennextjs-cloudflare build`, the precache
contains stale local hashes and is incomplete for the deployed asset set.
Online the app works; offline it fails to load because the shell never
precached — a failure nobody hits during a normal smoke test. `BUILD_TARGET=tauri`
uses `out/` and must remain unaffected.

## Fix

### `scripts/generate-service-worker.mjs` — additive OpenNext awareness

```js
const nextStaticDirectory = ".next/static";
const openNextStaticDirectory = ".open-next/assets/_next/static";

// Collect from whichever exists; union when both exist so a stale .next
// after an incremental build cannot leave the precache incomplete.
const staticDirectories = [];
if (existsSync(nextStaticDirectory)) staticDirectories.push(nextStaticDirectory);
if (existsSync(openNextStaticDirectory)) staticDirectories.push(openNextStaticDirectory);

const buildAssets = union(listFiles(dir) for dir in staticDirectories);
```

- `--opennext` flag (or `OPENNEXT=1` env) is accepted for the post-step; without
  it the script still prefers whatever exists, so `npm run build` (Tauri/web)
  continues to work. When `--opennext` is requested but `.open-next` is not
  yet built, it warns and falls back to `.next/static`.
- `BUILD_TARGET=tauri` is scoped: the generator reads **only** `.next/static`
  and does **not** union `.open-next` nor write to `.open-next/assets/sw-assets.js`.
  This prevents a previous web `opennext` build left on disk from polluting the
  Tauri precache with the web buildId (otherwise `out/sw-assets.js` would list
  chunks not present in `out/_next/static`).
- Writes to `public/sw-assets.js` **and** (when not Tauri) `.open-next/assets/sw-assets.js`
  when `.open-next/assets` exists, so the deployed `sw-assets.js` is always the
  open-next-aware version. The `out/` Tauri export (`out/_next/static` + `out/sw-assets.js`)
  is left unchanged and never depends on `.open-next`.

### `package.json` — post-step

```json
"preview": "opennextjs-cloudflare build && node scripts/generate-service-worker.mjs --opennext && opennextjs-cloudflare preview",
"deploy":  "opennextjs-cloudflare build && node scripts/generate-service-worker.mjs --opennext && opennextjs-cloudflare deploy"
```

The `build` script (`next build && generate-service-worker`) is unchanged for
web/Tauri. `preview`/`deploy` now re-run the generator after the OpenNext
emitter so `.open-next/assets/sw-assets.js` hashes the actually-deployed
`_next/static` set.

### Verification — `scripts/verify-pwa-assets.mjs`

Automated, no secrets:

```bash
node scripts/verify-pwa-assets.mjs
```

Checks:

1. `generate-service-worker.mjs` mentions `.open-next/assets/_next/static`,
   handles `--opennext`, writes `.open-next/assets/sw-assets.js`, preserves
   `out/` (Tauri).
2. `package.json` `preview`/`deploy` contain the `--opennext` post-step.
3. `public/sw-assets.js` parses, `version == sha256(sorted entries)[0:12]`,
   every `/_next/static/*` entry has a file on disk in `.next/static` _or_
   `.open-next/assets/_next/static`, is a subset of the deployed set when
   `.open-next` exists, and includes `/offline.html`.
4. When `.open-next/assets/sw-assets.js` exists it is byte-identical to
   `public/sw-assets.js`.
5. `public/sw.js` references `sw-assets.js` and does cache-first for `/_next/static/`.

Wired into `npm run check` as `verify:pwa` (after `verify:cookies`).

## Verification

### Automated (no build — checks structure)

```bash
node scripts/verify-pwa-assets.mjs
# also:
npm run check  # includes verify:pwa
```

### After a build (hashes + deployed set)

```bash
# Web build
npm run build  # next build + generate-service-worker (from .next)
# Full OpenNext build (also regenerates from .open-next)
npx opennextjs-cloudflare build
node scripts/generate-service-worker.mjs --opennext
node scripts/verify-pwa-assets.mjs  # now checks .open-next subset + equality
```

CI does `npm run build` + `npx opennextjs-cloudflare build` (in `.github/workflows/ci.yml`);
`verify-pwa-assets.mjs` will be run after both (via `check`) — if `.open-next`
is present it enforces the subset/equality invariant.

### Live (requires deployed Cloudflare Worker — run before cutover)

The AC is only satisfied by **offline on Cloudflare**, not `wrangler dev`.

```bash
# 1) Deploy staging with the post-step
npm run build
npx opennextjs-cloudflare build && node scripts/generate-service-worker.mjs --opennext
npx wrangler deploy --env staging  # or npm run deploy

# 2) Quick fetch check — proves sw-assets.js is served and assets are 200
node scripts/verify-pwa-assets.mjs --live --url https://staging.duobalance.app
# Expect: /sw.js and /sw-assets.js 200, sampled _next/static chunks 200

# 3) True offline proof — on the Cloudflare deployment, not wrangler dev
#    (hashed filenames differ per build, so a local compare is not proof).

# In a real browser (desktop or device) against the deployed origin:

# a) Visit https://staging.duobalance.app — let service worker install (DevTools → Application → Service Workers → Status: activated).
#    DevTools → Application → Cache Storage → duobalance-shell-<version> should show ~60-70 entries including /offline.html + /_next/static/chunks/*.js + documents.
# b) DevTools → Application → Service Workers → check "Offline" (or disable network / airplane mode on device).
# c) Hard-reload or navigate: / , /balances, /bills, /help/adding-accounts —
#    each should still render the shell/offline fallback, not a blank page.
# d) Disable Offline, reload — no console errors for 404 _next/static chunks.

# Alternatively, Playwright (Chromium offline simulation) against staging:

#   npx playwright test --grep @pwa-offline  # if such spec exists
#   # or manually: await context.setOffline(true); await page.reload();

# 4) Tauri build unaffected (generator excludes .open-next for Tauri)
BUILD_TARGET=tauri npm run build
# → out/sw-assets.js + out/_next/static exist and public/sw-assets.js still valid
# The generator does not union .open-next for Tauri, so a stale web
# .open-next left on disk does not pollute the Tauri precache.
node scripts/verify-pwa-assets.mjs  # should still pass; prior web buildId mismatch is now warn-only for Tauri
ls out/sw-assets.js out/_next/static  # exists
```

**Sign-off checklist (before production cutover):**

- [ ] `node scripts/verify-pwa-assets.mjs` passes (CI also runs via `npm run check`)
- [ ] After `npx opennextjs-cloudflare build && node scripts/generate-service-worker.mjs --opennext`, `public/sw-assets.js` == `.open-next/assets/sw-assets.js` and version hash matches
- [ ] `/_next/static` entries in precache are subset of `.open-next/assets/_next/static` file set (no 404 on deploy)
- [ ] Staging on **Cloudflare deployment** (not `wrangler dev`) loads after first visit, then loads offline after checking "Offline" in DevTools (or device airplane mode)
- [ ] `BUILD_TARGET=tauri npm run build` still produces `out/sw-assets.js` + `out/_next/static` (Tauri unaffected)

## References

- #159 — Patch the service worker asset manifest for the OpenNext build
- #152 — Epic: Migrate hosting from Vercel to Cloudflare Workers
- #154 — OpenNext Cloudflare adapter
- `scripts/generate-service-worker.mjs` — additive fix (union of .next + .open-next)
- `scripts/verify-pwa-assets.mjs` — hash + subset + equality checks
- `package.json` preview/deploy — post-step wiring
- `public/sw.js` / `public/sw-assets.js` — precache version + offline fallback
