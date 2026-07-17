import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A package-lock also exists higher in the home directory; pinning the root
  // keeps Turbopack's resolver and file tracing scoped to this application.
  turbopack: { root: __dirname },
};

export default nextConfig;
