import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  runtimeCaching: [
    {
      urlPattern: /^\/api\/products\/lookup/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "api-product-lookup",
        expiration: { maxEntries: 2000, maxAgeSeconds: 7 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /^\/api\/sync/,
      handler: "NetworkOnly",
    },
    {
      urlPattern: /^\/api\//,
      handler: "NetworkFirst",
      options: {
        cacheName: "api-cache",
        networkTimeoutSeconds: 5,
        expiration: { maxAgeSeconds: 24 * 60 * 60 },
      },
    },
  ],
});

const isElectronBuild = process.env.ELECTRON_BUILD === "1";

const nextConfig: NextConfig = {
  // Required for Electron: bundles all dependencies into the standalone output
  output: "standalone",
  // Skip PWA when building for Electron (service workers don't work in Electron)
  ...(isElectronBuild ? {} : {}),
};

export default isElectronBuild ? nextConfig : withPWA(nextConfig);
