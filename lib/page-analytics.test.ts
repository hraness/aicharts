import { describe, expect, test } from "bun:test";

import { MODEL_CARD_PRESENTATIONS } from "./model-card-collection";
import { PUBLIC_MODEL_CARD_PATHS } from "./public-analytics-routes";
import {
  normalizedPageAnalyticsProperties,
  pageAnalyticsContext,
} from "./page-analytics";

describe("page analytics context", () => {
  test("classifies the comparison chart and blog collection", () => {
    expect(pageAnalyticsContext("/")).toMatchObject({
      canonical_path: "/",
      content_group: "ai_comparison",
      content_id: "home",
      page_kind: "benchmark_chart",
    });
    expect(pageAnalyticsContext("/blog/?source=test")).toMatchObject({
      canonical_path: "/blog",
      content_group: "benchmark_research",
      content_id: "blog:index",
      page_kind: "blog_index",
    });
  });

  test("groups admitted article slugs without sending raw paths or query strings", () => {
    const context = pageAnalyticsContext(
      "/blog/terminal-bench-science?campaign=uncontrolled#results",
    );

    expect(context).toMatchObject({
      canonical_path: "/blog/[article]",
      content_group: "benchmark_research",
      content_id: "blog:terminal-bench-science",
      page_kind: "blog_article",
    });
    expect(context.canonical_path).not.toContain("terminal-bench-science");
    expect(JSON.stringify(context)).not.toContain("campaign");
  });

  test("classifies the crawlable benchmark dataset separately", () => {
    expect(pageAnalyticsContext("/data?download=false")).toMatchObject({
      canonical_path: "/data",
      content_group: "ai_comparison",
      content_id: "data:index",
      page_kind: "benchmark_data",
    });
  });

  test("classifies the model-card gallery and hides individual card slugs", () => {
    expect(pageAnalyticsContext("/models")).toMatchObject({
      canonical_path: "/models",
      content_group: "ai_comparison",
      content_id: "models:index",
      page_kind: "model_cards",
    });
    const detail = pageAnalyticsContext("/models/openai/gpt-5.6-sol/max?source=private");
    expect(detail).toMatchObject({
      canonical_path: "/models/[creator]/[model]/[profile]",
      content_group: "ai_comparison",
      content_id: "model-card:openai/gpt-5.6-sol/max",
      page_kind: "model_card",
    });
    expect(detail.canonical_path).not.toContain("gpt-5.6-sol");
  });

  test("maps foreign and unknown routes to one controlled fallback", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "/not-found",
      "/blog/private-draft-name",
      "/models/openai/private-model/private-profile",
      "https://example.com/blog/terminal-bench-science",
    ]) {
      expect(pageAnalyticsContext(value)).toMatchObject({
        canonical_path: "/[other]",
        content_group: "site",
        content_id: "other",
        page_kind: "other",
      });
    }
  });

  test("attaches stable site identity and schema properties", () => {
    expect(pageAnalyticsContext("/")).toMatchObject({
      canonical_domain: "aicharts.io",
      context_schema_version: 3,
      site_id: "aicharts",
    });
  });

  test("rejects malformed and non-page dynamic route segments", () => {
    for (const value of [
      "/blog/feed.xml",
      "/blog/two/segments",
      "/blog/%40private",
      "/models/openai/model",
      "/models/openai/model/profile/asset",
    ]) {
      expect(pageAnalyticsContext(value)).toMatchObject({
        canonical_path: "/[other]",
        content_id: "other",
        page_kind: "other",
      });
    }
  });

  test("keeps the client-safe model route allowlist aligned with published cards", () => {
    expect(PUBLIC_MODEL_CARD_PATHS.join("\n")).toBe(
      MODEL_CARD_PRESENTATIONS.map(card => card.path).join("\n"),
    );
  });
});

describe("page analytics property normalization", () => {
  test("keeps public content identity while removing raw paths, queries, and hashes", () => {
    const properties = normalizedPageAnalyticsProperties(
      "/blog/terminal-bench-science?email=private@example.com#results",
      {
        $current_url: "https://aicharts.io/blog/terminal-bench-science?email=private@example.com#results",
        $host: "www.aicharts.io",
        $pathname: "/blog/terminal-bench-science",
        $prev_pageview_pathname: "/models/openai/gpt-5.6-sol/max",
        $session_entry_url: "https://aicharts.io/models/openai/gpt-5.6-sol/max?provider=private",
        event_schema_version: 2,
      },
    );

    expect(properties).toMatchObject({
      $current_url: "https://aicharts.io/blog/[article]",
      $host: "aicharts.io",
      $pathname: "/blog/[article]",
      $prev_pageview_pathname: "/models/[creator]/[model]/[profile]",
      $session_entry_url: "https://aicharts.io/models/[creator]/[model]/[profile]",
      canonical_path: "/blog/[article]",
      content_id: "blog:terminal-bench-science",
      context_schema_version: 3,
      event_schema_version: 2,
    });
    expect(JSON.stringify(properties)).not.toContain("private@example.com");
    expect(JSON.stringify(properties)).not.toContain("?provider=");
    expect(JSON.stringify(properties)).not.toContain("#results");
  });

  test("reduces referrers to origins while retaining acquisition domains", () => {
    const properties = normalizedPageAnalyticsProperties("/", {
      $initial_referrer_info: {
        $referrer: "https://www.google.com/search?q=private",
        $referring_domain: "www.google.com",
      },
      $referrer: "https://www.google.com/search?q=private",
      $referring_domain: "www.google.com",
      $session_entry_referrer: "https://news.ycombinator.com/item?id=private",
    });

    expect(properties).toMatchObject({
      $initial_referrer_info: {
        $referrer: "https://www.google.com",
        $referring_domain: "www.google.com",
      },
      $referrer: "https://www.google.com",
      $referring_domain: "www.google.com",
      $session_entry_referrer: "https://news.ycombinator.com",
    });
    expect(JSON.stringify(properties)).not.toContain("search?");
    expect(JSON.stringify(properties)).not.toContain("item?");
  });

  test("rewrites www entry URLs and removes query-derived campaign values", () => {
    const properties = normalizedPageAnalyticsProperties("/models", {
      $initial_current_url: "https://www.aicharts.io/blog/terminal-bench-science?utm_campaign=private",
      $initial_referring_domain: "WWW.GOOGLE.COM",
      $initial_utm_campaign: "private",
      $initial_utm_source: "private",
      $initial__kx: "private",
      $initial_ph_keyword: "private search",
      $referring_domain: "www.google.com",
      $session_entry_fbclid: "private",
      $session_entry_pathname: "/blog/private-draft-name",
      $session_entry_ph_keyword: "private search",
      $session_entry_utm_campaign: "private",
      $session_entry_utm_source: "private",
      _kx: "private",
      fbclid: "private",
      ph_keyword: "private search",
      utm_campaign: "private",
      utm_source: "private",
    });

    expect(properties).toMatchObject({
      $initial_current_url: "https://aicharts.io/blog/[article]",
      $initial_referring_domain: "www.google.com",
      $referring_domain: "www.google.com",
      $session_entry_pathname: "/[other]",
    });
    expect(properties.utm_campaign).toBeUndefined();
    expect(properties.utm_source).toBeUndefined();
    expect(properties.$initial_utm_campaign).toBeUndefined();
    expect(properties.$initial_utm_source).toBeUndefined();
    expect(properties.fbclid).toBeUndefined();
    expect(properties._kx).toBeUndefined();
    expect(properties.$initial__kx).toBeUndefined();
    expect(properties.ph_keyword).toBeUndefined();
    expect(properties.$initial_ph_keyword).toBeUndefined();
    expect(properties.$session_entry_ph_keyword).toBeUndefined();
    expect(properties.$session_entry_fbclid).toBeUndefined();
    expect(properties.$session_entry_utm_campaign).toBeUndefined();
    expect(properties.$session_entry_utm_source).toBeUndefined();
  });

  test("keeps scalar Web Vitals while removing nested URL-bearing detail", () => {
    const properties = normalizedPageAnalyticsProperties("/", {
      $$client_ingestion_warning_message:
        "posthog-js client rate limited on /private-draft-name",
      $web_vitals_LCP_event: {
        $current_url: "https://aicharts.io/?email=private@example.com",
        navigationURL: "https://aicharts.io/?email=private@example.com",
        value: 1234,
      },
      $web_vitals_LCP_value: 1234,
    });

    expect(properties.$web_vitals_LCP_value).toBe(1234);
    expect(properties.$web_vitals_LCP_event).toBeUndefined();
    expect(properties.$$client_ingestion_warning_message).toBeUndefined();
    expect(JSON.stringify(properties)).not.toContain("private@example.com");
    expect(JSON.stringify(properties)).not.toContain("private-draft-name");
  });

  test("removes invalid referrers, raw external-click URLs, and unknown schema versions", () => {
    const properties = normalizedPageAnalyticsProperties("/data", {
      $external_click_url: "https://example.com/private?q=secret",
      $initial_referrer_info: "private free-form value",
      $referrer: "not a URL",
      $referring_domain: "example.com/private?secret=true",
      event_schema_version: 999,
    });

    expect(properties.$external_click_url).toBeUndefined();
    expect(properties.$initial_referrer_info).toBeUndefined();
    expect(properties.$referrer).toBeUndefined();
    expect(properties.$referring_domain).toBeUndefined();
    expect(properties.event_schema_version).toBe(1);
  });
});
