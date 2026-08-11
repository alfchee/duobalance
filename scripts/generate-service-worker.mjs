import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const nextStaticDirectory = join(root, ".next", "static");
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

const buildAssets = (await listFiles(nextStaticDirectory)).map(
  (file) => `/_next/static/${relative(nextStaticDirectory, file).split(sep).join("/")}`,
);
const documents = (await listFiles(appDirectory))
  .filter((file) => file.endsWith(".html"))
  .map((file) => relative(appDirectory, file).split(sep).join("/"))
  // _not-found.html has no matching route — the App Router serves it inline
  // with a 404 status rather than at a fetchable "/404" URL, so precaching
  // it as "/404" made cache.addAll() reject the response and fail the whole
  // install. __placeholder__ segments are generateStaticParams build
  // scaffolding, not real pages.
  .filter((path) => path !== "_not-found.html" && !path.includes("__placeholder__"))
  .map((path) => (path === "index.html" ? "/" : `/${path.replace(/\.html$/, "")}`));
const assets = [...new Set([...baseAssets, ...buildAssets, ...documents])].sort();
const version = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 12);
const content = `self.__DUOBALANCE_PRECACHE_VERSION__ = "${version}";\nself.__DUOBALANCE_PRECACHE__ = ${JSON.stringify(assets)};\n`;

await writeFile(join(publicDirectory, "sw-assets.js"), content);

const exportDirectory = join(root, "out");
await mkdir(join(exportDirectory, "_next", "static"), { recursive: true });
await cp(nextStaticDirectory, join(exportDirectory, "_next", "static"), { recursive: true });
await writeFile(join(exportDirectory, "sw-assets.js"), content);
