import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the app can run
  // as a plain Node process in a container on Hetzner — no Vercel runtime needed.
  output: "standalone",

  // The app is served ON THE PORTAL'S OWN DOMAIN under this prefix (Caddy
  // proxies /ostext-app/* to this container on every portal host, house and
  // white-label alike). Same-origin means the embedded iframe session cookie
  // is always first-party, and no house domain ever shows in a customer URL.
  basePath: "/ostext-app",

  // Serve /ostext-app/ directly instead of 308-stripping to the bare
  // /ostext-app path: the SSO landing redirect ends on the trailing-slash URL,
  // and the bare path needs a separate proxy matcher at the edge. Skipping the
  // normalization redirect makes the sign-in chain edge-config-independent.
  skipTrailingSlashRedirect: true,

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
