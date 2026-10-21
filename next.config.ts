import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "300mb",
  },
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [{ source: "/learning-runtime/pyodide/:path*", headers: [
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
      { key: "Cache-Control", value: "public, max-age=86400" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ] }];
  },
};

export default nextConfig;
