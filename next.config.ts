import type { NextConfig } from "next";

const isTauri = process.env.BUILD_TARGET === "tauri";

const config: NextConfig = {
  reactStrictMode: true,
  ...(isTauri && {
    output: "export" as const,
    images: { unoptimized: true },
    trailingSlash: true,
  }),
};

export default config;
