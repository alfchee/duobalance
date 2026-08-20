import type { NextConfig } from "next";

const isTauri = process.env.BUILD_TARGET === "tauri";

const config: NextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: isTauri,
  },
  ...(isTauri && {
    output: "export" as const,
    trailingSlash: true,
  }),
};

export default config;
