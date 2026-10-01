"use client";

import posthog from "posthog-js";
import { getBrowserConsent } from "@hraness/posthog/consent";

import {
  analyticsErrorFingerprint,
  createBrowserExceptionBudget,
  normalizedRequestedPath,
  referrerHost,
  sanitizeAnalyticsError,
} from "./analytics-privacy";

import { isBenchmarkAtlasId, isChartedBenchmarkAtlasId, type ChartedBenchmarkAtlasId } from "./benchmark-atlas-ids";

import type { XMetric, YMetric } from "./chart-math";
import type { IntelligenceEfficiencyMetric } from "./intelligence-efficiency";
import {
  type AnalyticsContentId,
  type AnalyticsPageKind,
  isAnalyticsRouteSegment,
  pageAnalyticsContext,
} from "./page-analytics";

export const ANALYTICS_SURFACES = [
  "site",
  "global_header",
  "global_footer",
  "home_calculator",
  "home_activity",
  "home_index_strip",
  "home_orientation",
  "home_portfolio",
  "benchmark_chart",
  "benchmark_atlas",
  "home_editorial",
  "blog_header",
  "blog_index",
  "blog_article",
  "blog_related",
  "data_document",
  "models_header",
  "models_gallery",
  "model_release_radar",
  "model_card",
  "error_recovery",
  "not_found",
] as const;

export type AnalyticsSurface = typeof ANALYTICS_SURFACES[number];
/** `link_kind` on `site link clicked`: a same-site navigation, section jump, or file. */
export type AnalyticsLinkKind = "anchor" | "download" | "internal";
/** `link_kind` on `outbound link opened`, from the portfolio vocabulary. */
export type OutboundLinkKind = "github" | "portfolio" | "social" | "other";
/** Portfolio `placement` vocabulary shared by every Hraness site. */
export type AnalyticsPlacement = "footer" | "inline" | "nav" | "not_found";
/** Where an uncaught browser error was observed. */
export type ClientErrorOrigin =
  | "global_error_boundary"
  | "route_error_boundary"
  | "unhandled_rejection"
  | "window_error";
export type AnalyticsDestinationKind =
  | "article"
  | "ask_ai"
  | "asset"
  | "dataset"
  | "hraness"
  | "model_card"
  | "repository"
  | "section"
  | "site_page"
  | "site_resource"
  | "social"
  | "source"
  | "other";

export type AnalyticsDestinationId =
  | AnalyticsContentId
  | "ask-ai:chatgpt"
  | "ask-ai:claude"
  | "ask-ai:grok"
  | "ask-ai:perplexity"
  | "asset:download"
  | "asset:model-card-png"
  | "dataset:artificial-analysis-intelligence"
  | "dataset:artificial-analysis-intelligence-v4-3"
  | "dataset:coding-agents"
  | "dataset:terminal-bench-4"
  | "dataset:terminal-bench-science-0-1"
  | "dataset:benchmark-atlas"
  | `dataset:${ChartedBenchmarkAtlasId}`
  | "external:github"
  | "external:hraness"
  | "external:other"
  | "resource:feed"
  | "resource:llms"
  | "resource:sitemap"
  | "section"
  | "social:bluesky"
  | "social:linkedin"
  | "social:x"
  | `source:${string}`;

export type ModelCardsFilteredProperties =
  | Readonly<{
    filter_dimension: "provider";
    filter_value: string;
    result_count: number;
  }>
  | Readonly<{
    filter_dimension: "sort";
    filter_value: "default" | "new";
    result_count: number;
  }>
  | Readonly<{
    filter_dimension: "top_only";
    filter_value: "disabled" | "enabled";
    result_count: number;
  }>;

export const CHART_ANALYTICS_IDS = [
  "coding_agents",
  "intelligence_efficiency",
] as const;

export type ChartAnalyticsId = typeof CHART_ANALYTICS_IDS[number];

export const BENCHMARK_ATLAS_ANALYTICS_ACTIONS = [
  "benchmark", "view", "compare", "share", "inspect", "provider", "expand", "profiles",
] as const;
export type BenchmarkAtlasAnalyticsAction = typeof BENCHMARK_ATLAS_ANALYTICS_ACTIONS[number];

export const CALCULATOR_ANALYTICS_CONTROLS = [
  "amortization_months",
  "cache_hit",
  "deepseek_window",
  "duty_cycle",
  "electricity_preset",
  "electricity_rate",
  "hardware_profile",
  "resale_value",
  "seats",
  "sol_rate_basis",
  "subsidy_multiple",
  "token_mix",
  "ultra_multiple",
  "utilization",
] as const;
export type CalculatorAnalyticsControl = typeof CALCULATOR_ANALYTICS_CONTROLS[number];

export interface AnalyticsEventMap {
  readonly "benchmark explored": Readonly<{
    benchmark_id: string;
    action: BenchmarkAtlasAnalyticsAction;
    view: "ranking" | "cost" | "table";
  }>;
  readonly "calculator adjusted": Readonly<{
    control: CalculatorAnalyticsControl;
  }>;
  readonly "chart metric selected":
    | Readonly<{ axis: "x"; chart_id: "coding_agents"; metric: XMetric }>
    | Readonly<{ axis: "y"; chart_id: "coding_agents"; metric: YMetric }>
    | Readonly<{
        axis: "x";
        chart_id: "intelligence_efficiency";
        metric: IntelligenceEfficiencyMetric;
      }>;
  readonly "chart selection pinned": Readonly<{
    chart_id: ChartAnalyticsId;
    provider_id: string;
    selection_kind: "model" | "provider";
  }>;
  readonly "chart shared": Readonly<{
    chart_id: "coding_agents";
    share_method: "copy_link" | "download_fallback" | "download_png" | "native_share" | "x";
    share_outcome: "completed" | "downloaded" | "initiated";
    x_metric: XMetric;
    y_metric: YMetric;
  }>;
  readonly "content chart opened": Readonly<{
    destination_chart: "coding_agents";
    source_kind: "blog_article" | "blog_index";
  }>;
  readonly "model card shared": Readonly<{
    model_id: string;
    profile_id: string;
    share_method: "bluesky" | "copy_link" | "download_png" | "linkedin" | "native_share" | "x";
    share_outcome: "cancelled" | "completed" | "downloaded" | "initiated";
  }>;
  readonly "model cards filtered": ModelCardsFilteredProperties;
  readonly "email signup submitted": Readonly<{
    audience: "aicharts";
    placement: "footer";
  }>;
  readonly "outbound link opened": Readonly<{
    destination_id: AnalyticsDestinationId;
    destination_kind: AnalyticsDestinationKind;
    link_kind: OutboundLinkKind;
    placement: AnalyticsPlacement;
    surface: AnalyticsSurface;
    target_host: string;
  }>;
  readonly "page not found": Readonly<{
    referrer_host: string;
    requested_path: string;
  }>;
  readonly "site link clicked": Readonly<{
    destination_id: AnalyticsDestinationId;
    destination_kind: AnalyticsDestinationKind;
    link_kind: AnalyticsLinkKind;
    surface: AnalyticsSurface;
  }>;
}

/**
 * Every custom event name the browser may send. `before_send` drops any
 * other non-built-in event. Old names are listed in
 * docs/analytics-instrumentation.md ("Event renames").
 */
export const CUSTOM_ANALYTICS_EVENTS = [
  "benchmark explored",
  "calculator adjusted",
  "chart metric selected",
  "chart selection pinned",
  "chart shared",
  "content chart opened",
  "email signup submitted",
  "model card shared",
  "model cards filtered",
  "outbound link opened",
  "page not found",
  "site link clicked",
] as const satisfies readonly (keyof AnalyticsEventMap)[];

/** Built-in PostHog events the site keeps. */
export const BUILT_IN_ANALYTICS_EVENTS = [
  "$pageview",
  "$pageleave",
  "$web_vitals",
  "$exception",
] as const;

/** Typed product event payload version; 4 is the portfolio vocabulary (analytics_schema_version 2). */
export const EVENT_SCHEMA_VERSION = 4;

export type AnalyticsEventName = keyof AnalyticsEventMap;
export type AnalyticsEventFor<Name extends AnalyticsEventName> = Readonly<{
  name: Name;
  properties: AnalyticsEventMap[Name];
}>;
export type AnalyticsEvent = {
  [Name in AnalyticsEventName]: AnalyticsEventFor<Name>;
}[AnalyticsEventName];

export type ChartAnalyticsEvent = Extract<
  AnalyticsEvent,
  Readonly<{ name: "chart metric selected" | "chart selection pinned" | "chart shared" }>
>;
export type ContentAnalyticsEvent = Extract<
  AnalyticsEvent,
  Readonly<{ name: "content chart opened" }>
>;

const allowedSurfaceSet = new Set<string>(ANALYTICS_SURFACES);
const benchmarkAtlasActions: ReadonlySet<string> = new Set(BENCHMARK_ATLAS_ANALYTICS_ACTIONS);
const calculatorControls: ReadonlySet<string> = new Set(CALCULATOR_ANALYTICS_CONTROLS);
const chartAnalyticsIds = new Set<string>(CHART_ANALYTICS_IDS);
const xMetrics = new Set<string>(["costUsd", "durationMinutes", "totalTokens"]);
const yMetrics = new Set<string>(["aaIndex", "deepSwe", "terminalBench", "sweAtlas"]);
const intelligenceEfficiencyMetrics = new Set<string>([
  "costUsdPerTask",
  "outputTokensPerTask",
]);
const chartShareMethods = new Set<string>([
  "copy_link",
  "download_fallback",
  "download_png",
  "native_share",
  "x",
]);
const chartShareOutcomes = new Set<string>(["completed", "downloaded", "initiated"]);
const modelCardShareMethods = new Set<string>([
  "bluesky",
  "copy_link",
  "download_png",
  "linkedin",
  "native_share",
  "x",
]);
const modelCardShareOutcomes = new Set<string>([
  "cancelled",
  "completed",
  "downloaded",
  "initiated",
]);
const linkKinds = new Set<string>(["anchor", "download", "internal"]);
const outboundLinkKinds = new Set<string>(["github", "portfolio", "social", "other"]);
const placements = new Set<string>(["footer", "inline", "nav", "not_found"]);
const targetHostPattern = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const requestedPathPattern = /^\/[^\s?#]{0,255}$/u;
const referrerHostPattern = /^(?:\$direct|[a-z0-9.-]{1,253})$/u;

/** Map a site surface to the portfolio `placement` vocabulary. */
export function analyticsPlacement(surface: AnalyticsSurface): AnalyticsPlacement {
  if (surface === "global_header") return "nav";
  if (surface === "global_footer") return "footer";
  if (surface === "not_found") return "not_found";
  return "inline";
}

function outboundLinkKind(kind: AnalyticsDestinationKind): OutboundLinkKind {
  if (kind === "repository") return "github";
  if (kind === "hraness") return "portfolio";
  if (kind === "social") return "social";
  return "other";
}
const canonicalHosts = new Set(["aicharts.io", "www.aicharts.io"]);
const sourceIdentifierPattern = /^source:[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/u;

export function isAnalyticsSurface(value: unknown): value is AnalyticsSurface {
  return typeof value === "string" && allowedSurfaceSet.has(value);
}

function defaultSurface(pageKind: AnalyticsPageKind): AnalyticsSurface {
  if (pageKind === "benchmark_chart") return "benchmark_chart";
  if (pageKind === "benchmark_library") return "benchmark_atlas";
  if (pageKind === "benchmark_data") return "data_document";
  if (pageKind === "blog_article") return "blog_article";
  if (pageKind === "blog_index") return "blog_index";
  if (pageKind === "model_card") return "model_card";
  if (pageKind === "model_cards") return "models_gallery";
  return "site";
}

export function analyticsSurface(
  candidate: unknown,
  pathname: unknown,
): AnalyticsSurface {
  return isAnalyticsSurface(candidate)
    ? candidate
    : defaultSurface(pageAnalyticsContext(pathname).page_kind);
}

function isCanonicalModelId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const segments = value.split("/");
  return segments.length === 2 && segments.every(isAnalyticsRouteSegment);
}

function isContentId(value: unknown): value is AnalyticsContentId {
  if (
    value === "home"
    || value === "calculator:index"
    || value === "coding:index"
    || value === "benchmarks:index"
    || value === "blog:index"
    || value === "data:index"
    || value === "models:index"
    || value === "other"
  ) return true;
  if (typeof value !== "string") return false;
  if (value.startsWith("blog:")) return isAnalyticsRouteSegment(value.slice(5));
  if (!value.startsWith("model-card:")) return false;
  const segments = value.slice("model-card:".length).split("/");
  return segments.length === 3 && segments.every(isAnalyticsRouteSegment);
}

function isDestinationId(value: unknown): value is AnalyticsDestinationId {
  if (isContentId(value)) return true;
  if (typeof value !== "string") return false;
  if (value.startsWith("dataset:") && isChartedBenchmarkAtlasId(value.slice("dataset:".length))) return true;
  return [
    "ask-ai:chatgpt",
    "ask-ai:claude",
    "ask-ai:grok",
    "ask-ai:perplexity",
    "asset:download",
    "asset:model-card-png",
    "dataset:artificial-analysis-intelligence",
    "dataset:artificial-analysis-intelligence-v4-3",
    "dataset:coding-agents",
    "dataset:terminal-bench-4",
    "dataset:terminal-bench-science-0-1",
    "dataset:benchmark-atlas",
    "external:github",
    "external:hraness",
    "external:other",
    "resource:feed",
    "resource:llms",
    "resource:sitemap",
    "section",
    "social:bluesky",
    "social:linkedin",
    "social:x",
  ].includes(value) || sourceIdentifierPattern.test(value);
}

const destinationKinds = new Set<AnalyticsDestinationKind>([
  "article",
  "ask_ai",
  "asset",
  "dataset",
  "hraness",
  "model_card",
  "repository",
  "section",
  "site_page",
  "site_resource",
  "social",
  "source",
  "other",
]);

function isDestinationKind(value: unknown): value is AnalyticsDestinationKind {
  return typeof value === "string"
    && destinationKinds.has(value as AnalyticsDestinationKind);
}

function isDestinationOverride(
  kind: unknown,
  id: unknown,
): kind is AnalyticsDestinationKind {
  if (!isDestinationKind(kind) || !isDestinationId(id)) return false;
  if (kind === "article") return id.startsWith("blog:") && id !== "blog:index";
  if (kind === "ask_ai") return id.startsWith("ask-ai:");
  if (kind === "asset") return id.startsWith("asset:");
  if (kind === "dataset") return id.startsWith("dataset:");
  if (kind === "hraness") return id === "external:hraness";
  if (kind === "model_card") return id.startsWith("model-card:");
  if (kind === "repository") return id === "external:github";
  if (kind === "section") return id === "section";
  if (kind === "site_page") {
    return ["home", "calculator:index", "coding:index", "benchmarks:index", "blog:index", "data:index", "models:index"].includes(id);
  }
  if (kind === "site_resource") return id.startsWith("resource:");
  if (kind === "social") return id.startsWith("social:");
  if (kind === "source") return id === "external:other" || id.startsWith("source:");
  return id === "other";
}

export interface AnalyticsLinkInput {
  readonly askAiProvider?: unknown;
  readonly currentUrl: string;
  readonly destinationId?: unknown;
  readonly destinationKind?: unknown;
  readonly download: boolean;
  readonly href: string;
  readonly surface?: unknown;
}

type AnalyticsLinkClassification = Readonly<{
  destination_id: AnalyticsDestinationId;
  destination_kind: AnalyticsDestinationKind;
}>;

function internalDestination(pathname: string): Pick<
  AnalyticsLinkClassification,
  "destination_id" | "destination_kind"
> {
  if (pathname === "/data/benchmark-atlas.json") {
    return { destination_id: "dataset:benchmark-atlas", destination_kind: "dataset" };
  }
  const atlasDatasetId = /^\/data\/benchmark-atlas\/([^/]+)$/u.exec(pathname)?.[1];
  if (isChartedBenchmarkAtlasId(atlasDatasetId)) {
    return { destination_id: `dataset:${atlasDatasetId}`, destination_kind: "dataset" };
  }
  if (pathname === "/data/artificial-analysis-intelligence-v4-3.json") {
    return { destination_id: "dataset:artificial-analysis-intelligence-v4-3", destination_kind: "dataset" };
  }
  if (pathname === "/data/artificial-analysis-intelligence.json") {
    return {
      destination_id: "dataset:artificial-analysis-intelligence",
      destination_kind: "dataset",
    };
  }
  if (pathname === "/data/coding-agents.json") {
    return { destination_id: "dataset:coding-agents", destination_kind: "dataset" };
  }
  if (pathname === "/data/terminal-bench-4.json") {
    return { destination_id: "dataset:terminal-bench-4", destination_kind: "dataset" };
  }
  if (pathname === "/data/terminal-bench-science-0-1.json") {
    return { destination_id: "dataset:terminal-bench-science-0-1", destination_kind: "dataset" };
  }
  if (/^\/models\/.+\/card\.png$/u.test(pathname)) {
    return { destination_id: "asset:model-card-png", destination_kind: "asset" };
  }
  if (pathname === "/llms.txt") {
    return { destination_id: "resource:llms", destination_kind: "site_resource" };
  }
  if (pathname === "/sitemap.xml") {
    return { destination_id: "resource:sitemap", destination_kind: "site_resource" };
  }
  if (pathname === "/blog/feed.xml") {
    return { destination_id: "resource:feed", destination_kind: "site_resource" };
  }
  const context = pageAnalyticsContext(pathname);
  if (context.page_kind === "blog_article") {
    return { destination_id: context.content_id, destination_kind: "article" };
  }
  if (context.page_kind === "model_card") {
    return { destination_id: context.content_id, destination_kind: "model_card" };
  }
  if (context.page_kind === "other") {
    return { destination_id: "other", destination_kind: "other" };
  }
  return { destination_id: context.content_id, destination_kind: "site_page" };
}

function outboundDestination(
  hostname: string,
  askAiProvider: unknown,
): Pick<AnalyticsLinkClassification, "destination_id" | "destination_kind"> {
  if (
    askAiProvider === "chatgpt"
    || askAiProvider === "claude"
    || askAiProvider === "grok"
    || askAiProvider === "perplexity"
  ) {
    return { destination_id: `ask-ai:${askAiProvider}`, destination_kind: "ask_ai" };
  }
  const host = hostname.toLowerCase().replace(/^www\./u, "");
  if (host === "x.com" || host === "twitter.com") {
    return { destination_id: "social:x", destination_kind: "social" };
  }
  if (host === "bsky.app") {
    return { destination_id: "social:bluesky", destination_kind: "social" };
  }
  if (host === "linkedin.com") {
    return { destination_id: "social:linkedin", destination_kind: "social" };
  }
  if (host === "github.com") {
    return { destination_id: "external:github", destination_kind: "repository" };
  }
  if (host === "hraness.com" || host.endsWith(".hraness.com")) {
    return { destination_id: "external:hraness", destination_kind: "hraness" };
  }
  return { destination_id: "external:other", destination_kind: "source" };
}

/** Classify one anchor without retaining its text, raw URL, query, or fragment. */
export function classifyAnalyticsLink(
  input: AnalyticsLinkInput,
): AnalyticsEventFor<"outbound link opened"> | AnalyticsEventFor<"site link clicked"> | null {
  if (input.href.trim().length === 0) return null;
  let current: URL;
  let destination: URL;
  try {
    current = new URL(input.currentUrl);
    destination = new URL(input.href, current);
  } catch {
    return null;
  }
  if (
    current.protocol !== "https:"
    || !canonicalHosts.has(current.hostname.toLowerCase())
    || current.username.length > 0
    || current.password.length > 0
    || !["http:", "https:"].includes(destination.protocol)
    || destination.username.length > 0
    || destination.password.length > 0
  ) return null;

  const surface = analyticsSurface(input.surface, current.pathname);
  const placement = analyticsPlacement(surface);
  const sameCanonicalSite = canonicalHosts.has(destination.hostname.toLowerCase());
  const sameDocumentSection = sameCanonicalSite
    && destination.pathname === current.pathname
    && destination.hash.length > 0;
  const override = isDestinationOverride(input.destinationKind, input.destinationId)
    ? { destination_id: input.destinationId as AnalyticsDestinationId, destination_kind: input.destinationKind }
    : null;

  if (!sameCanonicalSite) {
    const resolved = override ?? outboundDestination(destination.hostname, input.askAiProvider);
    const targetHost = destination.hostname.toLowerCase().replace(/^www\./u, "");
    if (!targetHostPattern.test(targetHost)) return null;
    return {
      name: "outbound link opened",
      properties: {
        ...resolved,
        link_kind: outboundLinkKind(resolved.destination_kind),
        placement,
        surface,
        target_host: targetHost,
      },
    };
  }

  let classification: AnalyticsEventMap["site link clicked"];
  if (sameDocumentSection) {
    classification = {
      destination_id: "section",
      destination_kind: "section",
      link_kind: "anchor",
      surface,
    };
  } else {
    const resolved = internalDestination(destination.pathname);
    const attachment = resolved.destination_kind === "asset"
      || resolved.destination_kind === "dataset";
    classification = {
      ...resolved,
      link_kind: input.download || attachment ? "download" : "internal",
      surface,
    };
  }
  if (override !== null) classification = { ...classification, ...override };
  return { name: "site link clicked", properties: classification };
}

/** The shared footer form was submitted (not a claim that the request was accepted). */
export function newsletterSignupRequestEvent(
  audience: unknown,
): AnalyticsEventFor<"email signup submitted"> | null {
  return audience === "aicharts"
    ? {
        name: "email signup submitted",
        properties: { audience, placement: "footer" },
      }
    : null;
}

/** One `page not found` for a rendered 404: normalized path and referrer host only. */
export function pageNotFoundEvent(
  requestedPath: unknown,
  referrer: unknown,
): AnalyticsEventFor<"page not found"> {
  return {
    name: "page not found",
    properties: {
      referrer_host: referrerHost(referrer),
      requested_path: normalizedRequestedPath(requestedPath),
    },
  };
}

function validCount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 100_000;
}

function controlledEventProperties(event: AnalyticsEvent): Record<string, unknown> | null {
  switch (event.name) {
    case "benchmark explored": {
      const properties = event.properties;
      if (!isBenchmarkAtlasId(properties.benchmark_id)
        || !benchmarkAtlasActions.has(properties.action)
        || !["ranking", "cost", "table"].includes(properties.view)) return null;
      return { benchmark_id: properties.benchmark_id, action: properties.action, view: properties.view };
    }
    case "calculator adjusted": {
      const properties = event.properties;
      return calculatorControls.has(properties.control)
        ? { control: properties.control }
        : null;
    }
    case "chart metric selected": {
      const properties = event.properties;
      if (
        (
          properties.chart_id === "coding_agents"
          && (
          (properties.axis === "x" && xMetrics.has(properties.metric))
          || (properties.axis === "y" && yMetrics.has(properties.metric))
          )
        )
        || (
          properties.chart_id === "intelligence_efficiency"
          && properties.axis === "x"
          && intelligenceEfficiencyMetrics.has(properties.metric)
        )
      ) {
        return {
          axis: properties.axis,
          chart_id: properties.chart_id,
          metric: properties.metric,
        };
      }
      return null;
    }
    case "chart selection pinned": {
      const properties = event.properties;
      return chartAnalyticsIds.has(properties.chart_id)
        && isAnalyticsRouteSegment(properties.provider_id)
        && (properties.selection_kind === "model" || properties.selection_kind === "provider")
        ? {
            chart_id: properties.chart_id,
            provider_id: properties.provider_id,
            selection_kind: properties.selection_kind,
          }
        : null;
    }
    case "chart shared": {
      const properties = event.properties;
      return properties.chart_id === "coding_agents"
        && chartShareMethods.has(properties.share_method)
        && chartShareOutcomes.has(properties.share_outcome)
        && xMetrics.has(properties.x_metric)
        && yMetrics.has(properties.y_metric)
        ? {
            chart_id: properties.chart_id,
            share_method: properties.share_method,
            share_outcome: properties.share_outcome,
            x_metric: properties.x_metric,
            y_metric: properties.y_metric,
          }
        : null;
    }
    case "content chart opened": {
      const properties = event.properties;
      return properties.destination_chart === "coding_agents"
        && (properties.source_kind === "blog_article" || properties.source_kind === "blog_index")
        ? {
            destination_chart: properties.destination_chart,
            source_kind: properties.source_kind,
          }
        : null;
    }
    case "model card shared": {
      const properties = event.properties;
      return isCanonicalModelId(properties.model_id)
        && isAnalyticsRouteSegment(properties.profile_id)
        && modelCardShareMethods.has(properties.share_method)
        && modelCardShareOutcomes.has(properties.share_outcome)
        ? {
            model_id: properties.model_id,
            profile_id: properties.profile_id,
            share_method: properties.share_method,
            share_outcome: properties.share_outcome,
          }
        : null;
    }
    case "model cards filtered": {
      const properties = event.properties;
      if (!validCount(properties.result_count)) return null;
      if (
        properties.filter_dimension === "provider"
        && properties.filter_value !== "all"
        && !isAnalyticsRouteSegment(properties.filter_value)
      ) return null;
      if (
        properties.filter_dimension === "sort"
        && properties.filter_value !== "default"
        && properties.filter_value !== "new"
      ) return null;
      if (
        properties.filter_dimension === "top_only"
        && properties.filter_value !== "disabled"
        && properties.filter_value !== "enabled"
      ) return null;
      if (!["provider", "sort", "top_only"].includes(properties.filter_dimension)) return null;
      return {
        filter_dimension: properties.filter_dimension,
        filter_value: properties.filter_value,
        result_count: properties.result_count,
      };
    }
    case "email signup submitted": {
      const properties = event.properties;
      return properties.audience === "aicharts" && properties.placement === "footer"
        ? { audience: properties.audience, placement: properties.placement }
        : null;
    }
    case "outbound link opened": {
      const properties = event.properties;
      if (
        !isAnalyticsSurface(properties.surface)
        || !isDestinationKind(properties.destination_kind)
        || !isDestinationId(properties.destination_id)
        || !outboundLinkKinds.has(properties.link_kind)
        || !placements.has(properties.placement)
        || typeof properties.target_host !== "string"
        || !targetHostPattern.test(properties.target_host)
      ) return null;
      return {
        destination_id: properties.destination_id,
        destination_kind: properties.destination_kind,
        link_kind: properties.link_kind,
        placement: properties.placement,
        surface: properties.surface,
        target_host: properties.target_host,
      };
    }
    case "page not found": {
      const properties = event.properties;
      return typeof properties.requested_path === "string"
        && requestedPathPattern.test(properties.requested_path)
        && typeof properties.referrer_host === "string"
        && referrerHostPattern.test(properties.referrer_host)
        ? {
            referrer_host: properties.referrer_host,
            requested_path: normalizedRequestedPath(properties.requested_path),
          }
        : null;
    }
    case "site link clicked": {
      const properties = event.properties;
      if (
        !isAnalyticsSurface(properties.surface)
        || !isDestinationKind(properties.destination_kind)
        || !isDestinationId(properties.destination_id)
        || !linkKinds.has(properties.link_kind)
      ) return null;
      return {
        destination_id: properties.destination_id,
        destination_kind: properties.destination_kind,
        link_kind: properties.link_kind,
        surface: properties.surface,
      };
    }
    default:
      return null;
  }
}

/** Build the exact allowlisted payload sent by the PostHog adapter. */
export function analyticsEventPayload(event: AnalyticsEvent): Readonly<{
  name: AnalyticsEventName;
  properties: Record<string, unknown>;
}> | null {
  const properties = controlledEventProperties(event);
  if (properties === null) return null;
  return {
    name: event.name,
    properties: {
      ...properties,
      event_schema_version: EVENT_SCHEMA_VERSION,
      site_id: "aicharts",
      $process_person_profile: false,
    },
  };
}

function analyticsEnabled(): boolean {
  if (typeof window === "undefined" || process.env.NODE_ENV !== "production") return false;
  const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  return Boolean(
    token?.startsWith("phc_")
    && canonicalHosts.has(window.location.hostname.toLowerCase())
    && getBrowserConsent()?.allowed() === true,
  );
}

export function captureAnalyticsEvent(event: AnalyticsEvent): void {
  if (!analyticsEnabled()) return;
  const payload = analyticsEventPayload(event);
  if (payload === null) return;
  posthog.capture(
    payload.name,
    payload.properties,
    event.name === "site link clicked" || event.name === "outbound link opened"
      ? { send_instantly: true, transport: "sendBeacon" }
      : undefined,
  );
}

const exceptionBudget = createBrowserExceptionBudget();

/** Properties the budgeted reporter attaches to `$exception`, or null when over budget. */
export function exceptionEventProperties(
  error: Error,
  origin: ClientErrorOrigin,
  budget = exceptionBudget,
  now = Date.now(),
): Record<string, unknown> | null {
  const fingerprint = analyticsErrorFingerprint(error);
  if (!budget.allow(fingerprint, now)) return null;
  return {
    error_fingerprint: fingerprint,
    error_origin: origin,
    error_surface: "client",
    event_schema_version: EVENT_SCHEMA_VERSION,
    site_id: "aicharts",
    $process_person_profile: false,
  };
}

/**
 * Report an uncaught browser error: scrubbed message and stack, 20 per minute
 * and 2 per fingerprint. PostHog's own exception autocapture stays off.
 */
export function captureAnalyticsException(value: unknown, origin: ClientErrorOrigin): void {
  if (!analyticsEnabled()) return;
  try {
    const error = sanitizeAnalyticsError(value);
    const properties = exceptionEventProperties(error, origin);
    if (properties === null) return;
    posthog.captureException(error, properties);
  } catch {
    // Observability must never interfere with error handling.
  }
}

export function captureChartEvent(event: ChartAnalyticsEvent): void {
  captureAnalyticsEvent(event);
}

export function captureContentEvent(event: ContentAnalyticsEvent): void {
  captureAnalyticsEvent(event);
}
