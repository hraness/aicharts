import type { Instrumentation } from "next";
import { PostHog } from "posthog-node";

import { approvedPostHogEndpoint } from "@/lib/posthog-endpoint";
import { sanitizedServerError } from "@/lib/server-error-analytics";

const allowedHosts = new Set(["aicharts.io", "www.aicharts.io"]);
const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const endpoint = approvedPostHogEndpoint(process.env.NEXT_PUBLIC_POSTHOG_HOST);

function headerValue(headers: NodeJS.Dict<string | string[]>, name: string): string {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function hostname(headers: NodeJS.Dict<string | string[]>): string {
  return headerValue(headers, "x-forwarded-host")
    .split(",")[0]
    ?.trim()
    .toLowerCase()
    .replace(/:\d+$/u, "") ?? "";
}

let client: PostHog | null = null;

function analyticsClient(): PostHog | null {
  if (!apiKey?.startsWith("phc_") || endpoint === null) return null;
  client ??= new PostHog(apiKey, {
    host: endpoint.apiHost,
    flushAt: 1,
    flushInterval: 0,
    maxQueueSize: 100,
    disableGeoip: true,
    privacyMode: true,
    enableExceptionAutocapture: false,
  });
  return client;
}

export const onRequestError: Instrumentation.onRequestError = async (value, request, context) => {
  if (process.env.VERCEL_ENV !== "production" || !allowedHosts.has(hostname(request.headers))) return;
  const posthog = analyticsClient();
  if (!posthog) return;
  try {
    await posthog.captureExceptionImmediate(sanitizedServerError(value), "server:aicharts", {
      site_id: "aicharts",
      event_schema_version: 1,
      error_surface: "server",
      request_method: request.method.slice(0, 12).toUpperCase(),
      route_type: context.routeType,
      router_kind: context.routerKind,
      framework_route: context.routePath,
      $process_person_profile: false,
    });
  } catch {
    // Observability must never interfere with error handling.
  }
};
