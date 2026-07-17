import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A package-lock also exists higher in the home directory; pinning the root
  // keeps Turbopack's resolver and file tracing scoped to this application.
  turbopack: { root: __dirname },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ddragon.leagueoflegends.com",
        pathname: "/cdn/16.14.1/img/champion/**",
      },
      {
        protocol: "https",
        hostname: "static.wikia.nocookie.net",
        pathname: "/lolesports_gamepedia_en/images/**",
      },
    ],
  },
};

export default nextConfig;
