import { withPostHogConfig } from "@posthog/nextjs-config";
import type { NextConfig } from "next";

const POSTHOG_UI_HOSTS = new Set([
  "https://eu.posthog.com",
  "https://us.posthog.com",
]);

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        destination: "https://aicharts.io/:path*",
        has: [{ type: "host", value: "codingchart.com" }],
        permanent: true,
        source: "/:path*",
      },
      {
        destination: "https://aicharts.io/:path*",
        has: [{ type: "host", value: "www.codingchart.com" }],
        permanent: true,
        source: "/:path*",
      },
      {
        destination: "https://aicharts.io/:path*",
        has: [{ type: "host", value: "www.aicharts.io" }],
        permanent: true,
        source: "/:path*",
      },
    ];
  },
  reactStrictMode: true,
};

function withProductionSourceMaps(config: NextConfig): NextConfig {
  const personalApiKey = process.env.POSTHOG_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const releaseVersion = process.env.VERCEL_GIT_COMMIT_SHA;
  const host = process.env.POSTHOG_UI_HOST ?? "https://us.posthog.com";
  if (
    process.env.VERCEL_ENV !== "production"
    || !personalApiKey?.startsWith("phx_")
    || !projectId?.match(/^[1-9]\d*$/u)
    || !releaseVersion
    || !POSTHOG_UI_HOSTS.has(host)
  ) {
    return config;
  }
  return withPostHogConfig(config, {
    personalApiKey,
    projectId,
    host,
    logLevel: "error",
    sourcemaps: {
      enabled: true,
      releaseName: "aicharts",
      releaseVersion,
      deleteAfterUpload: true,
    },
  });
}

export default withProductionSourceMaps(nextConfig);
