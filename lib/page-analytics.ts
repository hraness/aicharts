export type AnalyticsPageKind =
  | "benchmark_chart"
  | "benchmark_data"
  | "blog_article"
  | "blog_index"
  | "gpt_subsidy"
  | "model_card"
  | "model_cards"
  | "other";

export interface PageAnalyticsContext {
  readonly analytics_schema_version: 2;
  readonly canonical_domain: "aicharts.io";
  readonly canonical_path:
    | "/"
    | "/blog"
    | "/blog/[article]"
    | "/data"
    | "/gpt-subsidy"
    | "/models"
    | "/models/[model]/[profile]"
    | "/[other]";
  readonly content_group: "ai_comparison" | "benchmark_research" | "site";
  readonly page_kind: AnalyticsPageKind;
  readonly site_id: "aicharts";
}

function pathnameFrom(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;

  try {
    const pathname = new URL(value, "https://aicharts.io").pathname;
    return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  } catch {
    return null;
  }
}

export function pageAnalyticsContext(value: unknown): PageAnalyticsContext {
  const pathname = pathnameFrom(value);
  const shared = {
    analytics_schema_version: 2,
    canonical_domain: "aicharts.io",
    site_id: "aicharts",
  } as const;

  if (pathname === "/") {
    return {
      ...shared,
      canonical_path: "/",
      content_group: "ai_comparison",
      page_kind: "benchmark_chart",
    };
  }

  if (pathname === "/blog") {
    return {
      ...shared,
      canonical_path: "/blog",
      content_group: "benchmark_research",
      page_kind: "blog_index",
    };
  }

  if (pathname?.startsWith("/blog/") === true) {
    return {
      ...shared,
      canonical_path: "/blog/[article]",
      content_group: "benchmark_research",
      page_kind: "blog_article",
    };
  }

  if (pathname === "/data") {
    return {
      ...shared,
      canonical_path: "/data",
      content_group: "ai_comparison",
      page_kind: "benchmark_data",
    };
  }

  if (pathname === "/gpt-subsidy") {
    return {
      ...shared,
      canonical_path: "/gpt-subsidy",
      content_group: "ai_comparison",
      page_kind: "gpt_subsidy",
    };
  }

  if (pathname === "/models") {
    return {
      ...shared,
      canonical_path: "/models",
      content_group: "ai_comparison",
      page_kind: "model_cards",
    };
  }

  if (pathname?.startsWith("/models/") === true) {
    return {
      ...shared,
      canonical_path: "/models/[model]/[profile]",
      content_group: "ai_comparison",
      page_kind: "model_card",
    };
  }

  return {
    ...shared,
    canonical_path: "/[other]",
    content_group: "site",
    page_kind: "other",
  };
}
