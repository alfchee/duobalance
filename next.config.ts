import type { NextConfig } from "next";

const isTauri = process.env.BUILD_TARGET === "tauri";

const config: NextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  ...(isTauri && {
    output: "export" as const,
    trailingSlash: true,
  }),
};

export default config;
