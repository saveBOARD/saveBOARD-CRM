import type { MetadataRoute } from "next";

// "Add to Home Screen" on iPhone and Android opens straight to Log a call (phase 4.1).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "saveBOARD CRM",
    short_name: "saveBOARD CRM",
    description: "Log calls and see today's chases.",
    start_url: "/log",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1f2933",
    icons: [
      { src: "/icon.png", sizes: "any", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
