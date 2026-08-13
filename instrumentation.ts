import type { Instrumentation } from "next";
import { PostHog } from "posthog-node";

const allowedHosts = new Set(["codingchart.com", "www.codingchart.com"]);
const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

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

function sanitizeError(value: unknown): Error {
  const source = value instanceof Error ? value : new Error("Unknown request error");
  const safe = new Error(
    source.message
      .slice(0, 500)
      .replaceAll(/https?:\/\/\S+/gu, "[url]")
      .replaceAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[email]")
      .replaceAll(/(?:token|secret|key|code)=\S+/giu, "$1=[redacted]"),
  );
  safe.name = source.name.slice(0, 100);
  if (source.stack) safe.stack = source.stack.slice(0, 12_000);
  return safe;
}

let client: PostHog | null = null;

function analyticsClient(): PostHog | null {
  if (!apiKey?.startsWith("phc_")) return null;
  client ??= new PostHog(apiKey, {
    host: apiHost,
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
    await posthog.captureExceptionImmediate(sanitizeError(value), "server:codingchart", {
      site_id: "codingchart",
      schema_version: 1,
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
