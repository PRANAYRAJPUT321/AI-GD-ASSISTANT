import type { MetadataRoute } from "next";

/** The web app manifest: lets browsers install GD Arena as an app (home screen, own window). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GD Arena: group discussion practice",
    short_name: "GD Arena",
    description:
      "Practise a group discussion out loud against five AI participants, then get a scorecard and the full transcript.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#4f46e5",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
