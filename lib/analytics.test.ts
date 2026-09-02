import { describe, expect, test } from "bun:test";

import {
  type AnalyticsEvent,
  analyticsEventPayload,
  classifyAnalyticsLink,
  newsletterSignupRequestEvent,
} from "./analytics";

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
      href: "/llms.txt",
    })?.properties.destination_id).toBe("resource:llms");
    expect(classifyAnalyticsLink({
      currentUrl,
      download: false,
      href: "/models/openai/gpt-5.6-sol/max/card.png",
    })?.properties.link_kind).toBe("download");
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
        event_schema_version: 2,
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
        share_method: "x",
        share_outcome: "initiated",
        x_metric: "costUsd",
        y_metric: "aaIndex",
      },
    })).toMatchObject({
      name: "chart shared",
      properties: {
        share_method: "x",
        share_outcome: "initiated",
      },
    });
  });

  test("rejects invalid runtime enums, identifiers, and counts", () => {
    const invalidEvents = [
      {
        name: "chart shared",
        properties: { share_method: "email", x_metric: "costUsd", y_metric: "aaIndex" },
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
