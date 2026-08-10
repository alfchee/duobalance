import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DuoBalance",
    short_name: "DuoBalance",
    description: "Household finance for two.",
    start_url: "/balances",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#3478d4",
    orientation: "portrait",
    icons: [
      { src: "/icons/192.svg", sizes: "192x192", type: "image/svg+xml" },
      { src: "/icons/512.svg", sizes: "512x512", type: "image/svg+xml" },
      {
        src: "/icons/512-maskable.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
