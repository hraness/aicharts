import posthog from "posthog-js";
import type { PostHogConfig } from "posthog-js";

import { normalizedPageAnalyticsProperties } from "@/lib/page-analytics";
import { approvedPostHogEndpoint } from "@/lib/posthog-endpoint";

const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const endpoint = approvedPostHogEndpoint(process.env.NEXT_PUBLIC_POSTHOG_HOST);
const allowedHost = window.location.hostname === "aicharts.io"
  || window.location.hostname === "www.aicharts.io";

const privacyConfig = {
  api_host: endpoint?.apiHost ?? "https://us.i.posthog.com",
  ui_host: endpoint?.uiHost ?? "https://us.posthog.com",
  before_send(event) {
    if (event === null) return null;
    if (event.event === "$$client_ingestion_warning") return null;
    const eventLocation = event.properties?.$current_url
      ?? window.location.pathname;
    return {
      ...event,
      properties: normalizedPageAnalyticsProperties(
        eventLocation,
        event.properties,
      ),
    };
  },
  defaults: "2026-05-30",
  autocapture: false,
  capture_pageview: "history_change",
  capture_pageleave: true,
  capture_performance: {
    network_timing: false,
    web_vitals: true,
    web_vitals_allowed_metrics: ["LCP", "CLS", "FCP", "INP"],
    web_vitals_attribution: false,
  },
  capture_exceptions: false,
  capture_heatmaps: false,
  capture_dead_clicks: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_surveys_automatic_display: true,
  disable_product_tours: true,
  disable_conversations: true,
  advanced_disable_flags: true,
  advanced_disable_feature_flags: true,
  advanced_disable_feature_flags_on_first_load: true,
  person_profiles: "never",
  persistence: "memory",
  cookieless_mode: "always",
  respect_dnt: true,
  cross_subdomain_cookie: false,
  disableDeviceModel: true,
  disable_capture_url_hashes: true,
  mask_all_text: true,
  mask_all_element_attributes: true,
  mask_personal_data_properties: true,
  properties_string_max_length: 2_048,
  rate_limiting: { events_per_second: 2, events_burst_limit: 12 },
} satisfies Partial<PostHogConfig>;

if (
  process.env.NODE_ENV === "production"
  && allowedHost
  && endpoint !== null
  && token?.startsWith("phc_")
) {
  posthog.init(token, privacyConfig);
}
