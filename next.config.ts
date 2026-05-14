import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse reads test files via fs at runtime; keeping it external prevents
  // webpack from bundling it and breaking those relative-path reads.
  serverExternalPackages: ['pdf-parse'],
};

export default nextConfig;
