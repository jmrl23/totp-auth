import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "totp-auth",
    short_name: "totp-auth",
    description: "Self-hosted two-factor codes, encrypted in your browser.",
    id: "/",
    start_url: "/vault",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f3f3f0",
    theme_color: "#111111",
    categories: ["security", "utilities"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
