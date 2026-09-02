import {
  isPublicBlogSlug,
  isPublicModelCardPath,
} from "./public-analytics-routes";

export type AnalyticsPageKind =
  | "benchmark_chart"
  | "benchmark_data"
  | "blog_article"
  | "blog_index"
  | "gpt_subsidy"
  | "model_card"
  | "model_cards"
  | "other";

export type AnalyticsCanonicalPath =
  | "/"
  | "/blog"
  | "/blog/[article]"
  | "/data"
  | "/gpt-subsidy"
  | "/models"
  | "/models/[creator]/[model]/[profile]"
  | "/[other]";

export type AnalyticsContentId =
  | "blog:index"
  | `blog:${string}`
  | "data:index"
  | "gpt-subsidy"
  | "home"
  | `model-card:${string}/${string}/${string}`
  | "models:index"
  | "other";

export interface PageAnalyticsContext {
  readonly canonical_domain: "aicharts.io";
  readonly canonical_path: AnalyticsCanonicalPath;
  readonly content_group: "ai_comparison" | "benchmark_research" | "site";
  readonly content_id: AnalyticsContentId;
  readonly context_schema_version: 3;
  readonly page_kind: AnalyticsPageKind;
  readonly site_id: "aicharts";
}

const CANONICAL_ORIGIN = "https://aicharts.io" as const;
const canonicalHostnames = new Set(["aicharts.io", "www.aicharts.io"]);
const routeSegmentPattern = /^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/u;

export function isAnalyticsRouteSegment(value: unknown): value is string {
  return typeof value === "string" && routeSegmentPattern.test(value);
}

function pathnameFrom(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;

  try {
    const parsed = new URL(value, CANONICAL_ORIGIN);
    if (parsed.protocol !== "https:" || !canonicalHostnames.has(parsed.hostname.toLowerCase())) {
      return null;
    }
    const pathname = parsed.pathname;
    return pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
  } catch {
    return null;
  }
}

function pathSegments(pathname: string | null): readonly string[] {
  if (pathname === null) return [];
  return pathname.split("/").filter(Boolean);
}

export function pageAnalyticsContext(value: unknown): PageAnalyticsContext {
  const pathname = pathnameFrom(value);
  const segments = pathSegments(pathname);
  const shared = {
    canonical_domain: "aicharts.io",
    context_schema_version: 3,
    site_id: "aicharts",
  } as const;

  if (pathname === "/") {
    return {
      ...shared,
      canonical_path: "/",
      content_group: "ai_comparison",
      content_id: "home",
      page_kind: "benchmark_chart",
    };
  }

  if (pathname === "/blog") {
    return {
      ...shared,
      canonical_path: "/blog",
      content_group: "benchmark_research",
      content_id: "blog:index",
      page_kind: "blog_index",
    };
  }

  if (
    segments.length === 2
    && segments[0] === "blog"
    && isPublicBlogSlug(segments[1])
  ) {
    return {
      ...shared,
      canonical_path: "/blog/[article]",
      content_group: "benchmark_research",
      content_id: `blog:${segments[1]}`,
      page_kind: "blog_article",
    };
  }

  if (pathname === "/data") {
    return {
      ...shared,
      canonical_path: "/data",
      content_group: "ai_comparison",
      content_id: "data:index",
      page_kind: "benchmark_data",
    };
  }

  if (pathname === "/gpt-subsidy") {
    return {
      ...shared,
      canonical_path: "/gpt-subsidy",
      content_group: "ai_comparison",
      content_id: "gpt-subsidy",
      page_kind: "gpt_subsidy",
    };
  }

  if (pathname === "/models") {
    return {
      ...shared,
      canonical_path: "/models",
      content_group: "ai_comparison",
      content_id: "models:index",
      page_kind: "model_cards",
    };
  }

  if (
    segments.length === 4
    && segments[0] === "models"
    && segments.slice(1).every(isAnalyticsRouteSegment)
    && isPublicModelCardPath(pathname)
  ) {
    const creator = segments[1];
    const model = segments[2];
    const profile = segments[3];
    if (creator !== undefined && model !== undefined && profile !== undefined) {
      return {
        ...shared,
        canonical_path: "/models/[creator]/[model]/[profile]",
        content_group: "ai_comparison",
        content_id: `model-card:${creator}/${model}/${profile}`,
        page_kind: "model_card",
      };
    }
  }

  return {
    ...shared,
    canonical_path: "/[other]",
    content_group: "site",
    content_id: "other",
    page_kind: "other",
  };
}

type AnalyticsProperties = Record<string, unknown>;

const pageUrlProperties = [
  "$current_url",
  "$initial_current_url",
  "$prev_pageview_url",
  "$session_entry_current_url",
  "$session_entry_url",
] as const;
const pagePathProperties = [
  "$initial_pathname",
  "$pathname",
  "$prev_pageview_pathname",
  "$session_entry_pathname",
] as const;
const referrerProperties = [
  "$initial_referrer",
  "$referrer",
  "$session_entry_referrer",
] as const;
const referringDomainProperties = [
  "$initial_referring_domain",
  "$referring_domain",
  "$session_entry_referring_domain",
] as const;
const campaignProperties = [
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
  "dclid",
  "epik",
  "fbclid",
  "gad_source",
  "gbraid",
  "gclid",
  "gclsrc",
  "igshid",
  "irclid",
  "li_fat_id",
  "mc_cid",
  "msclkid",
  "qclid",
  "rdt_cid",
  "sccid",
  "ttclid",
  "twclid",
  "wbraid",
  "_kx",
  "ph_keyword",
] as const;
const webVitalDetailPropertyPattern = /^\$web_vitals_[A-Z0-9_]+_event$/u;

function canonicalAnalyticsUrl(value: unknown): string {
  if (typeof value !== "string") return `${CANONICAL_ORIGIN}/[other]`;
  try {
    const parsed = new URL(value, CANONICAL_ORIGIN);
    if (parsed.protocol !== "https:" || !canonicalHostnames.has(parsed.hostname.toLowerCase())) {
      return `${CANONICAL_ORIGIN}/[other]`;
    }
    return `${CANONICAL_ORIGIN}${pageAnalyticsContext(parsed.pathname).canonical_path}`;
  } catch {
    return `${CANONICAL_ORIGIN}/[other]`;
  }
}

function canonicalAnalyticsPath(value: unknown): AnalyticsCanonicalPath {
  return pageAnalyticsContext(value).canonical_path;
}

function referrerOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function referringDomain(value: unknown): string | null {
  if (value === "$direct" || value === "direct") return value;
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = new URL(`https://${value.toLowerCase()}`);
    if (
      parsed.username.length > 0
      || parsed.password.length > 0
      || parsed.pathname !== "/"
      || parsed.search.length > 0
      || parsed.hash.length > 0
    ) return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

function normalizeInitialReferrerInfo(value: unknown): AnalyticsProperties | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as AnalyticsProperties;
  const normalized: AnalyticsProperties = {};
  const origin = referrerOrigin(source.$referrer);
  if (origin !== null) normalized.$referrer = origin;
  const domain = referringDomain(source.$referring_domain);
  if (domain !== null) normalized.$referring_domain = domain;
  return normalized;
}

/**
 * Replace SDK URL fields with controlled route groups before an event leaves the browser.
 * Specific public content remains available through `content_id`; queries, hashes, and
 * referrer paths never do.
 */
export function normalizedPageAnalyticsProperties(
  pathname: unknown,
  properties: Readonly<AnalyticsProperties> | undefined,
): AnalyticsProperties {
  const context = pageAnalyticsContext(pathname);
  const normalized: AnalyticsProperties = { ...(properties ?? {}) };

  for (const property of pageUrlProperties) {
    if (property === "$current_url" || property in normalized) {
      normalized[property] = property === "$current_url"
        ? `${CANONICAL_ORIGIN}${context.canonical_path}`
        : canonicalAnalyticsUrl(normalized[property]);
    }
  }
  for (const property of pagePathProperties) {
    if (property === "$pathname" || property in normalized) {
      normalized[property] = property === "$pathname"
        ? context.canonical_path
        : canonicalAnalyticsPath(normalized[property]);
    }
  }
  for (const property of referrerProperties) {
    if (!(property in normalized)) continue;
    const origin = referrerOrigin(normalized[property]);
    if (origin === null) delete normalized[property];
    else normalized[property] = origin;
  }
  for (const property of referringDomainProperties) {
    if (!(property in normalized)) continue;
    const domain = referringDomain(normalized[property]);
    if (domain === null) delete normalized[property];
    else normalized[property] = domain;
  }
  if ("$initial_referrer_info" in normalized) {
    const referrerInfo = normalizeInitialReferrerInfo(
      normalized.$initial_referrer_info,
    );
    if (referrerInfo === null) delete normalized.$initial_referrer_info;
    else normalized.$initial_referrer_info = referrerInfo;
  }

  for (const property of campaignProperties) {
    delete normalized[property];
    delete normalized[`$initial_${property}`];
    delete normalized[`$session_entry_${property}`];
  }
  delete normalized.$initial_campaign_params;
  delete normalized.$external_click_url;
  delete normalized.$$client_ingestion_warning_message;
  for (const property of Object.keys(normalized)) {
    // The scalar `$web_vitals_*_value` fields are sufficient for aggregate
    // reporting. SDK detail objects duplicate a raw navigation URL.
    if (webVitalDetailPropertyPattern.test(property)) delete normalized[property];
  }
  normalized.$host = context.canonical_domain;
  normalized.event_schema_version = normalized.event_schema_version === 2 ? 2 : 1;
  return { ...normalized, ...context };
}
