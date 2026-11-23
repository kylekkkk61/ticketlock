import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The pnpm workspace root, one level up, holds the lockfile and the deployment manifests.
  turbopack: {
    root: path.resolve(import.meta.dirname, ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
