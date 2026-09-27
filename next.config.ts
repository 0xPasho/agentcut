import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolated browser checks can run beside the owner's dev server.
  distDir: process.env.AGENTCUT_NEXT_DIST || ".next",
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
  experimental: {
    // Uploading a long video through the form route.
    serverActions: { bodySizeLimit: "2gb" },
  },
};

export default nextConfig;
