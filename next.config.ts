import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the app can run
  // as a plain Node process in a container on Hetzner — no Vercel runtime needed.
  output: "standalone",

  experimental: {
    serverActions: {
      // CSV contact uploads go through a Server Action; the default body limit is
      // 1 MB, which silently rejects larger lists. Raise it so big contact CSVs
      // (thousands of rows w/ LinkedIn URLs, custom columns) upload cleanly.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
