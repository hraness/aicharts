import { withPostHogConfig } from "@posthog/nextjs-config";
import {
  type ProductionDeliveryProofEnvironment,
  withProductionDeliveryProof,
} from "@hraness/vercel-delivery";
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
        source: "/:path*",
        statusCode: 301,
      },
      {
        destination: "https://aicharts.io/:path*",
        has: [{ type: "host", value: "www.codingchart.com" }],
        source: "/:path*",
        statusCode: 301,
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

function withProductionSourceMaps(
  config: NextConfig,
  environment: ProductionDeliveryProofEnvironment,
): NextConfig {
  const personalApiKey = environment.POSTHOG_API_KEY;
  const projectId = environment.POSTHOG_PROJECT_ID;
  const releaseVersion = environment.VERCEL_GIT_COMMIT_SHA;
  const host = environment.POSTHOG_UI_HOST ?? "https://us.posthog.com";
  if (
    environment.VERCEL_ENV !== "production"
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

export function createNextConfig(
  environment: ProductionDeliveryProofEnvironment = process.env,
): NextConfig {
  return withProductionDeliveryProof(
    withProductionSourceMaps(nextConfig, environment),
    { environment, projectName: "aicharts" },
  );
}

export default createNextConfig();
