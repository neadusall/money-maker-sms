import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the app can run
  // as a plain Node process in a container on Hetzner — no Vercel runtime needed.
  output: "standalone",
};

export default nextConfig;
