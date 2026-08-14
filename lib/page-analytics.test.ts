import { describe, expect, test } from "bun:test";

import { pageAnalyticsContext } from "./page-analytics";

describe("page analytics context", () => {
  test("classifies the comparison chart and blog collection", () => {
    expect(pageAnalyticsContext("/")).toMatchObject({
      canonical_path: "/",
      content_group: "ai_comparison",
      page_kind: "benchmark_chart",
    });
    expect(pageAnalyticsContext("/blog/?source=test")).toMatchObject({
      canonical_path: "/blog",
      content_group: "benchmark_research",
      page_kind: "blog_index",
    });
  });

  test("groups article slugs without sending raw paths or query strings", () => {
    const context = pageAnalyticsContext(
      "/blog/private-draft-name?campaign=uncontrolled#results",
    );

    expect(context).toMatchObject({
      canonical_path: "/blog/[article]",
      content_group: "benchmark_research",
      page_kind: "blog_article",
    });
    expect(JSON.stringify(context)).not.toContain("private-draft-name");
    expect(JSON.stringify(context)).not.toContain("campaign");
  });

  test("maps foreign and unknown routes to one controlled fallback", () => {
    for (const value of [undefined, null, 42, "", "/not-found"]) {
      expect(pageAnalyticsContext(value)).toMatchObject({
        canonical_path: "/[other]",
        content_group: "site",
        page_kind: "other",
      });
    }
  });

  test("attaches stable site identity and schema properties", () => {
    expect(pageAnalyticsContext("/")).toMatchObject({
      analytics_schema_version: 2,
      canonical_domain: "aicharts.io",
      site_id: "aicharts",
    });
  });
});
