import { describe, expect, test } from "bun:test";

import {
  BENCHMARK_ATLAS_ANALYTICS_ACTIONS,
  type AnalyticsEvent,
  analyticsEventPayload,
  classifyAnalyticsLink,
  newsletterSignupRequestEvent,
} from "./analytics";
import { BENCHMARK_ATLAS_IDS, CHARTED_BENCHMARK_ATLAS_IDS } from "./benchmark-atlas-ids";

const currentUrl = "https://aicharts.io/models";

describe("delegated link classification", () => {
  test("classifies public article and model routes without retaining URL details", () => {
    const article = classifyAnalyticsLink({
      currentUrl,
      download: false,
      href: "/blog/terminal-bench-science?email=private@example.com#results",
      surface: "home_editorial",
    });
    const model = classifyAnalyticsLink({
      currentUrl,
      download: false,
      href: "/models/openai/gpt-5.6-sol/max?campaign=private#card",
      surface: "models_gallery",
    });

    expect(article).toEqual({
      name: "site link clicked",
      properties: {
        destination_id: "blog:terminal-bench-science",
        destination_kind: "article",
        link_kind: "internal",
        surface: "home_editorial",
      },
    });
    expect(model?.properties).toEqual({
      destination_id: "model-card:openai/gpt-5.6-sol/max",
      destination_kind: "model_card",
      link_kind: "internal",
      surface: "models_gallery",
    });
    expect(JSON.stringify([article, model])).not.toContain("private");
    expect(JSON.stringify([article, model])).not.toContain("#");
  });

  test("classifies sections, downloads, resources, and canonical www links", () => {
    expect(classifyAnalyticsLink({
      currentUrl: "https://www.aicharts.io/data",
      download: false,
      href: "#method",
      surface: "data_document",
    })?.properties).toEqual({
      destination_id: "section",
      destination_kind: "section",
      link_kind: "anchor",
      surface: "data_document",
    });
    expect(classifyAnalyticsLink({
      currentUrl,
      download: false,
      href: "https://www.aicharts.io/data/terminal-bench-4.json?raw=true",
    })?.properties).toEqual({
      destination_id: "dataset:terminal-bench-4",
      destination_kind: "dataset",
      link_kind: "download",
      surface: "models_gallery",
    });
    expect(classifyAnalyticsLink({
      currentUrl,
      download: false,
      href: "/data/artificial-analysis-intelligence.json?raw=true",
    })?.properties).toEqual({
      destination_id: "dataset:artificial-analysis-intelligence",
      destination_kind: "dataset",
      link_kind: "download",
      surface: "models_gallery",
    });
    expect(classifyAnalyticsLink({
      currentUrl,
      download: false,
      href: "/llms.txt",
    })?.properties.destination_id).toBe("resource:llms");
    expect(classifyAnalyticsLink({
      currentUrl,
      download: false,
      href: "/models/openai/gpt-5.6-sol/max/card.png",
    })?.properties.link_kind).toBe("download");
  });

  test("classifies the atlas catalog and each real cohort download without retaining URL state", () => {
    const cases = [
      ["/data/benchmark-atlas.json", "dataset:benchmark-atlas"],
      ...CHARTED_BENCHMARK_ATLAS_IDS.map(id => [`/data/benchmark-atlas/${id}`, `dataset:${id}`] as const),
    ] as const;
    for (const [path, destinationId] of cases) {
      const classified = classifyAnalyticsLink({
        currentUrl: "https://aicharts.io/data?email=private@example.com",
        href: `https://www.aicharts.io${path}?query=private-search#private-point`,
        download: false,
        surface: "data_document",
      });
      expect(classified?.properties).toEqual({ destination_id: destinationId, destination_kind: "dataset", link_kind: "download", surface: "data_document" });
      expect(analyticsEventPayload(classified!)).not.toBeNull();
      expect(JSON.stringify(classified)).not.toContain("private");
    }
  });

  test("source guides, unknown cohorts, and invented .json routes cannot become dataset destinations", () => {
    for (const href of [
      "/data/benchmark-atlas/private-project",
      "/data/benchmark-atlas/open-asr",
      "/data/benchmark-atlas/wise-verified.json",
      "/data/benchmark-atlas/wise-verified/extra",
      "/data/benchmark-atlas/%77ise-verified",
    ]) {
      expect(classifyAnalyticsLink({ currentUrl, href, download: false })?.properties).toMatchObject({ destination_id: "other", destination_kind: "other", link_kind: "internal" });
    }
    for (const destinationId of ["dataset:private-project", "dataset:open-asr", "dataset:wise-verified.json"]) {
      const classified = classifyAnalyticsLink({ currentUrl, href: "https://example.com/private", download: false, destinationId, destinationKind: "dataset" });
      expect(classified?.properties).toMatchObject({ destination_id: "external:other", destination_kind: "source" });
      expect(analyticsEventPayload({
        name: "site link clicked",
        properties: { destination_id: destinationId, destination_kind: "dataset", link_kind: "download", surface: "data_document" },
      } as unknown as AnalyticsEvent)).toBeNull();
    }
  });

  test("accepts controlled atlas dataset overrides, including the catalog", () => {
    for (const destinationId of ["dataset:benchmark-atlas", "dataset:wise-verified", "dataset:arc-agi-3-standard"] as const) {
      expect(classifyAnalyticsLink({
        currentUrl, href: "/data", download: true, destinationId, destinationKind: "dataset", surface: "benchmark_atlas",
      })?.properties).toEqual({ destination_id: destinationId, destination_kind: "dataset", link_kind: "download", surface: "benchmark_atlas" });
    }
  });

  test("classifies outbound destinations into a bounded taxonomy", () => {
    const cases = [
      ["https://github.com/hraness/aicharts/issues?q=private", undefined, "repository", "external:github"],
      ["https://bsky.app/intent/compose?text=private", undefined, "social", "social:bluesky"],
      ["https://account.hraness.com/private", undefined, "hraness", "external:hraness"],
      ["https://chatgpt.com/?q=private", "chatgpt", "ask_ai", "ask-ai:chatgpt"],
      ["https://example.com/private?q=private", undefined, "source", "external:other"],
    ] as const;

    for (const [href, askAiProvider, destinationKind, destinationId] of cases) {
      expect(classifyAnalyticsLink({
        askAiProvider,
        currentUrl,
        download: false,
        href,
        surface: "model_card",
      })?.properties).toEqual({
        destination_id: destinationId,
        destination_kind: destinationKind,
        link_kind: "outbound",
        surface: "model_card",
      });
    }
  });

  test("accepts only compatible controlled destination overrides", () => {
    const source = classifyAnalyticsLink({
      currentUrl,
      destinationId: "source:terminal-bench",
      destinationKind: "source",
      download: false,
      href: "https://www.tbench.ai/leaderboard?private=true",
      surface: "home_portfolio",
    });
    const mismatched = classifyAnalyticsLink({
      currentUrl,
      destinationId: "blog:terminal-bench-science",
      destinationKind: "social",
      download: false,
      href: "https://example.com/",
    });

    expect(source?.properties).toMatchObject({
      destination_id: "source:terminal-bench",
      destination_kind: "source",
    });
    expect(mismatched?.properties).toMatchObject({
      destination_id: "external:other",
      destination_kind: "source",
    });
  });

  test("rejects non-web, credentialed, and non-canonical-page inputs", () => {
    for (const [page, href] of [
      [currentUrl, "mailto:private@example.com"],
      [currentUrl, "https://user:password@example.com/private"],
      ["http://aicharts.io/", "https://example.com/"],
      ["https://example.com/", "https://aicharts.io/"],
    ]) {
      expect(classifyAnalyticsLink({
        currentUrl: page,
        download: false,
        href,
      })).toBeNull();
    }
  });
});

describe("typed event payloads", () => {
  test("accepts only published benchmark IDs, including guides, and valid exploration actions", () => {
    for (const benchmarkId of BENCHMARK_ATLAS_IDS) {
      expect(analyticsEventPayload({ name: "benchmark explored", properties: { benchmark_id: benchmarkId, action: "benchmark", view: "ranking" } })).not.toBeNull();
    }
    for (const action of BENCHMARK_ATLAS_ANALYTICS_ACTIONS) {
      for (const view of ["ranking", "cost", "table"] as const) {
        expect(analyticsEventPayload({ name: "benchmark explored", properties: { benchmark_id: "terminal-bench-4", action, view } })?.properties).toMatchObject({ benchmark_id: "terminal-bench-4", action, view });
      }
    }
  });

  test("atlas event reconstruction discards searches, selected points, URLs, and unknown runtime keys", () => {
    const payload = analyticsEventPayload({
      name: "benchmark explored",
      properties: {
        benchmark_id: "wise-verified", action: "profiles", view: "ranking",
        query: "private-search", point_id: "private-point", profile_value: "private-value",
        raw_href: "https://aicharts.io/?query=private#private", model_label: "private-label",
      },
    } as unknown as AnalyticsEvent);
    expect(payload).toEqual({
      name: "benchmark explored",
      properties: { benchmark_id: "wise-verified", action: "profiles", view: "ranking", event_schema_version: 3, site_id: "aicharts", $process_person_profile: false },
    });
    expect(JSON.stringify(payload)).not.toContain("private");
  });

  test("rejects valid-looking unpublished benchmark IDs and unregistered exploration controls", () => {
    for (const benchmarkId of ["private-project", "wise-verified.json", "WISE-VERIFIED", "wise-verified?query=private", "__proto__", "", null, 123, {}]) {
      expect(analyticsEventPayload({ name: "benchmark explored", properties: { benchmark_id: benchmarkId, action: "inspect", view: "ranking" } } as unknown as AnalyticsEvent)).toBeNull();
    }
    for (const action of ["search", "hover", "profiles-private", null]) {
      expect(analyticsEventPayload({ name: "benchmark explored", properties: { benchmark_id: "wise-verified", action, view: "ranking" } } as unknown as AnalyticsEvent)).toBeNull();
    }
    expect(analyticsEventPayload({ name: "benchmark explored", properties: { benchmark_id: "wise-verified", action: "view", view: "private-layout" } } as unknown as AnalyticsEvent)).toBeNull();
  });

  test("names newsletter intent truthfully and accepts only the product audience", () => {
    expect(newsletterSignupRequestEvent("aicharts")).toEqual({
      name: "newsletter signup request submitted",
      properties: { audience: "aicharts", surface: "global_footer" },
    });
    expect(newsletterSignupRequestEvent("another-product")).toBeNull();
    expect(newsletterSignupRequestEvent("private@example.com")).toBeNull();
  });

  test("reconstructs exact allowlisted properties and drops runtime extras", () => {
    const event = {
      name: "model card shared",
      properties: {
        model_id: "openai/gpt-5.6-sol",
        profile_id: "max",
        raw_href: "https://aicharts.io/private?email=private@example.com",
        share_method: "copy_link",
        share_outcome: "completed",
      },
    } as unknown as AnalyticsEvent;

    expect(analyticsEventPayload(event)).toEqual({
      name: "model card shared",
      properties: {
        $process_person_profile: false,
        event_schema_version: 3,
        model_id: "openai/gpt-5.6-sol",
        profile_id: "max",
        share_method: "copy_link",
        share_outcome: "completed",
        site_id: "aicharts",
      },
    });
  });

  test("requires a truthful chart share outcome", () => {
    expect(analyticsEventPayload({
      name: "chart shared",
      properties: {
        chart_id: "coding_agents",
        share_method: "x",
        share_outcome: "initiated",
        x_metric: "costUsd",
        y_metric: "aaIndex",
      },
    })).toMatchObject({
      name: "chart shared",
      properties: {
        chart_id: "coding_agents",
        share_method: "x",
        share_outcome: "initiated",
      },
    });
  });

  test("keeps metric vocabularies specific to each chart", () => {
    expect(analyticsEventPayload({
      name: "chart metric selected",
      properties: {
        axis: "x",
        chart_id: "intelligence_efficiency",
        metric: "costUsdPerTask",
      },
    })).toMatchObject({
      name: "chart metric selected",
      properties: {
        axis: "x",
        chart_id: "intelligence_efficiency",
        metric: "costUsdPerTask",
      },
    });
    expect(analyticsEventPayload({
      name: "chart metric selected",
      properties: {
        axis: "x",
        chart_id: "coding_agents",
        metric: "costUsd",
      },
    })).not.toBeNull();
    expect(analyticsEventPayload({
      name: "chart metric selected",
      properties: {
        axis: "x",
        chart_id: "intelligence_efficiency",
        metric: "costUsd",
      },
    } as unknown as AnalyticsEvent)).toBeNull();
  });

  test("rejects invalid runtime enums, identifiers, and counts", () => {
    const invalidEvents = [
      {
        name: "chart shared",
        properties: {
          chart_id: "coding_agents",
          share_method: "email",
          x_metric: "costUsd",
          y_metric: "aaIndex",
        },
      },
      {
        name: "chart metric selected",
        properties: { axis: "x", chart_id: "private", metric: "costUsd" },
      },
      {
        name: "content chart opened",
        properties: { destination_chart: "private", source_kind: "blog_article" },
      },
      {
        name: "model card shared",
        properties: {
          model_id: "OpenAI/private",
          profile_id: "max",
          share_method: "copy_link",
          share_outcome: "completed",
        },
      },
      {
        name: "model card shared",
        properties: {
          model_id: "openai/gpt-5.6-sol",
          profile_id: "max",
          share_method: "email",
          share_outcome: "completed",
        },
      },
      {
        name: "model cards filtered",
        properties: { filter_dimension: "sort", filter_value: "enabled", result_count: 4 },
      },
      {
        name: "model cards filtered",
        properties: { filter_dimension: "provider", filter_value: "openai", result_count: -1 },
      },
      {
        name: "unregistered event",
        properties: { raw_href: "https://aicharts.io/private?email=private@example.com" },
      },
    ] as const;

    for (const event of invalidEvents) {
      expect(analyticsEventPayload(event as unknown as AnalyticsEvent)).toBeNull();
    }
  });
});
