import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A test server or production build must never share the dev server's .next folder
  // (doing so caused an "HMR hash mismatch" reload loop). Override per process, e.g.
  // NEXT_DIST_DIR=.next-e2e next dev -p 3920.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Hide the on-screen dev badge; compile and runtime errors still surface.
  devIndicators: false,
  reactCompiler: true,
  experimental: {
    agentUpgrade: "security",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
