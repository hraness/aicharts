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

/**
 * Model routes that moved to a checked model-card identity. Index-only pages
 * and provisional `/models/unlisted/...` cards fold into the one canonical card
 * for that model once its catalog identity and first-party release date land.
 */
export const MODEL_ROUTE_REDIRECTS = [
  ["/models/anthropic/claude-opus-5-5/index", "/models/anthropic/claude-opus-5.5/max"],
  ["/models/openai/gpt-6-sol/index", "/models/openai/gpt-6-sol/max"],
  ["/models/openai/gpt-6-luna/index", "/models/openai/gpt-6-luna/max"],
  ["/models/xai/grok-4-7/index", "/models/spacexai/grok-4.7/xhigh"],
  ["/models/unlisted/opus-5-5.b958c16d6e9d4ca8979907a4/max", "/models/anthropic/claude-opus-5.5/max"],
  ["/models/unlisted/gpt-6-sol.51d76cb8a0598a113a64caf1/max", "/models/openai/gpt-6-sol/max"],
  ["/models/unlisted/gpt-6-luna.e5786855c646d1b4080cc158/max", "/models/openai/gpt-6-luna/max"],
  ["/models/unlisted/grok-4-7.4d350d6b4877df4c73975497/xhigh", "/models/spacexai/grok-4.7/xhigh"],
  ["/models/unlisted/grok-4-6.8d0cb9ac05267687236dffd8/xhigh", "/models/spacexai/grok-4.6/xhigh"],
  ["/models/unlisted/glm-5-3.fffd32adf07098d3cd835ee1/default", "/models/zai/glm-5.3/default"],
] as const satisfies readonly (readonly [`/models/${string}`, `/models/${string}`])[];

/**
 * The page loads its own scripts and styles, the consent-gated PostHog
 * capture host, the Hraness account host used by the footer, and the
 * Cloudflare Turnstile widget. Inline script and style stay allowed because
 * Next.js and the theme bootstrap emit inline tags that carry no nonce.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://us.i.posthog.com https://eu.i.posthog.com https://account.hraness.com https://usage.aicharts.io https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
] as const;

const nextConfig: NextConfig = {
  async headers() {
    return [{ headers: [...SECURITY_HEADERS], source: "/:path*" }];
  },
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
      ...MODEL_ROUTE_REDIRECTS.map(([source, destination]) => ({
        destination,
        permanent: true,
        source,
      })),
      {
        destination: "/blog/open-models-coding-agent-benchmarks",
        permanent: true,
        source: "/blog/are-open-models-catching-up",
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
