import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The HubSpot contacts export (~0.9 MB, about 1.5 MB as rows) is sent to a server action on the Imports screen.
    // Vercel caps request bodies at 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
