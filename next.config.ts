import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "300mb",
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
