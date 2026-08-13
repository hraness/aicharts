"use client";

import posthog from "posthog-js";

export type ChartAnalyticsEvent =
  | Readonly<{
    name: "chart metric selected";
    properties: { axis: "x" | "y"; metric: string };
  }>
  | Readonly<{
    name: "chart selection pinned";
    properties: { provider_id: string; selection_kind: "model" | "provider" };
  }>
  | Readonly<{
    name: "chart shared";
    properties: {
      share_method: "copy_link" | "download_fallback" | "download_png" | "native_share" | "x";
      x_metric: string;
      y_metric: string;
    };
  }>;

function analyticsEnabled(): boolean {
  if (typeof window === "undefined" || process.env.NODE_ENV !== "production") return false;
  const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  return Boolean(
    token?.startsWith("phc_")
    && (window.location.hostname === "codingchart.com" || window.location.hostname === "www.codingchart.com"),
  );
}

export function captureChartEvent(event: ChartAnalyticsEvent): void {
  if (!analyticsEnabled()) return;
  posthog.capture(event.name, {
    ...event.properties,
    site_id: "codingchart",
    schema_version: 1,
    $process_person_profile: false,
  });
}
