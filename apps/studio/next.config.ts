import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolated browser checks can run beside the owner's dev server.
  distDir: process.env.AGENTCUT_NEXT_DIST || ".next",
  // The release ships the studio as a standalone server the CLI downloads on first use.
  output: process.env.AGENTCUT_STANDALONE === "1" ? "standalone" : undefined,
  // Core and the compositions are TypeScript source in this workspace.
  transpilePackages: ["@agentcut/core", "@agentcut/render"],
  // Trace from the workspace root, so core's files are found where they live.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  turbopack: { root: path.join(__dirname, "../..") },
  // The standalone studio must run on any platform: next/image is not used, so its
  // native sharp build (one platform's) stays out, as does everything that is data.
  outputFileTracingExcludes: {
    "/*": ["../../workspace/**", "../../.release/**", "../../packs/**", "../../apps/web/**", "./src/**", "../../node_modules/.pnpm/@img+sharp*/**", "../../node_modules/.pnpm/sharp@*/**"],
  },
  // Native binaries and the Remotion renderer must not be bundled by webpack/turbopack.
  serverExternalPackages: [
    "@remotion/renderer",
    "@remotion/bundler",
    "ffmpeg-static",
    "ffprobe-static",
    "esbuild",
    "@remotion/tailwind-v4",
    "@tailwindcss/node",
    "@tailwindcss/webpack",
    "lightningcss",
  ],
  // How `agentcut studio` recognises a studio already listening on its port.
  headers: async () => [{ source: "/:path*", headers: [{ key: "x-agentcut", value: "studio" }] }],
  experimental: {
    // Uploading a long video through the form route.
    serverActions: { bodySizeLimit: "2gb" },
  },
};

export default nextConfig;
