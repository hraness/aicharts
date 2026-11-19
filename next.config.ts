import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "codingchart.com" }],
        destination: "https://aicharts.io/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.codingchart.com" }],
        destination: "https://aicharts.io/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.aicharts.io" }],
        destination: "https://aicharts.io/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
