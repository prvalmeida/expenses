import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle so the runtime image ships only the
  // traced dependencies instead of the full node_modules tree.
  output: 'standalone',
  // pdf-parse reads test files via fs at runtime; keeping it external prevents
  // webpack from bundling it and breaking those relative-path reads.
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
};

export default nextConfig;
