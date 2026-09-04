import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const nextStaticDirectory = join(root, ".next", "static");
const openNextAssetsDirectory = join(root, ".open-next", "assets");
const openNextStaticDirectory = join(openNextAssetsDirectory, "_next", "static");
const publicDirectory = join(root, "public");
const appDirectory = join(root, ".next", "server", "app");
const baseAssets = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
  "/install/ios-share.png",
  "/install/ios-add-to-home-screen.png",
  "/install/ios-home-screen.png",
  "/splash/apple-splash-1290-2796.png",
  "/splash/apple-splash-1179-2556.png",
  "/splash/apple-splash-1284-2778.png",
  "/splash/apple-splash-1170-2532.png",
  "/splash/apple-splash-1125-2436.png",
  "/splash/apple-splash-1242-2688.png",
  "/splash/apple-splash-828-1792.png",
  "/splash/apple-splash-750-1334.png",
  "/splash/apple-splash-2048-2732.png",
  "/splash/apple-splash-1668-2388.png",
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return files.flat();
}

// OpenNext-aware build asset collection.
// For web builds, Next emits to .next/static. OpenNext copies (and may
// transform) to .open-next/assets/_next/static — the latter is what
// Cloudflare actually deploys via the ASSETS binding. If the script runs
// as a post-step after `opennextjs-cloudflare build`, the deployed hashes
// live in .open-next; otherwise they live in .next. We collect from
// whichever exists (union when both exist so a stale .next after an
// incremental build cannot leave the precache incomplete).
const isOpenNextPostStep = process.argv.includes("--opennext") || process.env.OPENNEXT === "1";
const isTauri = process.env.BUILD_TARGET === "tauri";

const staticDirectories = [];
if (isTauri) {
  // Tauri (output: export) must not include .open-next — otherwise a
  // previous web `opennext` build left on disk would pollute the Tauri
  // precache with the web buildId and `out/_next/static` (copied only
  // from .next) would not contain those chunks.
  if (existsSync(nextStaticDirectory)) staticDirectories.push(nextStaticDirectory);
} else {
  if (existsSync(nextStaticDirectory)) staticDirectories.push(nextStaticDirectory);
  if (existsSync(openNextStaticDirectory)) staticDirectories.push(openNextStaticDirectory);
}

// When invoked as --opennext but .open-next not yet built, fall back to .next
// so CI that runs the script before opennext still produces a valid public
// sw-assets.js; the post-step will overwrite with the open-next-aware version.
if (staticDirectories.length === 0) {
  throw new Error(
    `generate-service-worker: no static directory found. Expected ${nextStaticDirectory} or ${openNextStaticDirectory}`,
  );
}

if (
  isOpenNextPostStep &&
  staticDirectories.length === 1 &&
  staticDirectories[0] === nextStaticDirectory
) {
  console.warn(
    "generate-service-worker: --opennext requested but .open-next/assets/_next/static not found — using .next/static",
  );
}

const buildAssetsLists = await Promise.all(
  staticDirectories.map(async (dir) => {
    const files = await listFiles(dir);
    return files.map((file) => `/_next/static/${relative(dir, file).split(sep).join("/")}`);
  }),
);
const buildAssets = [...new Set(buildAssetsLists.flat())].sort();

let documents = [];
try {
  documents = (await listFiles(appDirectory))
    .filter((file) => file.endsWith(".html"))
    .map((file) => relative(appDirectory, file).split(sep).join("/"))
    // _not-found.html has no matching route — the App Router serves it inline
    // with a 404 status rather than at a fetchable "/404" URL, so precaching
    // it as "/404" made cache.addAll() reject the response and fail the whole
    // install. __placeholder__ segments are generateStaticParams build
    // scaffolding, not real pages.
    .filter((path) => path !== "_not-found.html" && !path.includes("__placeholder__"))
    .map((path) => (path === "index.html" ? "/" : `/${path.replace(/\.html$/, "")}`));
} catch (err) {
  if (isOpenNextPostStep) {
    // In an OpenNext-only environment the app html may not be at .next/server/app
    // (it is in .open-next/server-functions). For offline we still need at
    // least "/" and the base assets; the hashed _next/static assets are the
    // critical part. Warn but do not fail.
    console.warn(`generate-service-worker: could not list ${appDirectory}: ${err}`);
  } else {
    throw err;
  }
}
const assets = [...new Set([...baseAssets, ...buildAssets, ...documents])].sort();
const version = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 12);
const content = `self.__DUOBALANCE_PRECACHE_VERSION__ = "${version}";\nself.__DUOBALANCE_PRECACHE__ = ${JSON.stringify(assets)};\n`;

await writeFile(join(publicDirectory, "sw-assets.js"), content);
console.log(
  `generate-service-worker: wrote public/sw-assets.js (${assets.length} entries, version ${version}) from ${staticDirectories.join(", ")}`,
);

// OpenNext: keep the deployed sw-assets.js in sync with what is actually in
// .open-next/assets. When the script runs as a post-step, public/sw-assets.js
// has already been copied to .open-next/assets during the initial build, so
// we overwrite it here with the open-next-aware version (same content if the
// two static dirs were in sync, or if they diverged). This satisfies the AC:
// "precache list matches the deployed asset set" — hashes come from .open-next.
if (!isTauri && existsSync(openNextAssetsDirectory)) {
  await writeFile(join(openNextAssetsDirectory, "sw-assets.js"), content);
  console.log(`generate-service-worker: wrote .open-next/assets/sw-assets.js (version ${version})`);
}

// Tauri static export — unchanged. BUILD_TARGET=tauri uses output: export,
// so the offline-capable export lives in out/. This path must remain additive
// and not depend on .open-next.
const exportDirectory = join(root, "out");
await mkdir(join(exportDirectory, "_next", "static"), { recursive: true });
// Prefer the .next source for Tauri (it is the export source). If only
// .open-next exists (unlikely for Tauri), use it as fallback.
const tauriSource = existsSync(nextStaticDirectory) ? nextStaticDirectory : openNextStaticDirectory;
if (existsSync(tauriSource)) {
  await cp(tauriSource, join(exportDirectory, "_next", "static"), { recursive: true });
}
await writeFile(join(exportDirectory, "sw-assets.js"), content);
