import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GptSubsidyChart } from "@/components/gpt-subsidy-chart";
import gptSubsidyData from "@/data/gpt-subsidy.json";
import {
  formatSubsidyUsd,
  gptSubsidyPageModifiedAt,
  GPT_SUBSIDY_DESCRIPTION,
  GPT_SUBSIDY_TITLE,
  parseGptSubsidySnapshot,
} from "@/lib/gpt-subsidy-data";
import { INDEXABLE_ROBOTS } from "@hraness/web-discovery";

import GptSubsidyLayout from "./layout";
import GptSubsidyPage, { metadata } from "./page";

const parsed = parseGptSubsidySnapshot(gptSubsidyData);
if (!parsed.ok) throw parsed.error;
const snapshot = parsed.value;

describe("GPT subsidy page components", () => {
  test("publishes canonical, indexable metadata", () => {
    expect(metadata).toMatchObject({
      title: GPT_SUBSIDY_TITLE + " | AI Charts",
      description: GPT_SUBSIDY_DESCRIPTION,
      alternates: { canonical: "https://aicharts.io/gpt-subsidy" },
      robots: INDEXABLE_ROBOTS,
      openGraph: {
        type: "website",
        url: "https://aicharts.io/gpt-subsidy",
      },
      twitter: { card: "summary_large_image" },
    });
  });

  test("uses one final shared appearance control in the publication header", () => {
    const markup = renderToStaticMarkup(
      createElement(
        GptSubsidyLayout,
        null,
        createElement("main", { id: "gpt-subsidy-content" }, "Subsidy"),
      ),
    );

    expect(markup).toContain(
      'class="plain-site plain-publication aicharts-gpt-subsidy"',
    );
    expect(markup).toContain('href="#gpt-subsidy-content"');
    expect(markup).toContain('aria-label="GPT subsidy navigation"');
    expect(markup).toContain('aria-current="page" href="/gpt-subsidy"');
    expect(markup).toContain('href="/gpt-subsidy">ChatGPT Subsidy Chart</a>');
    expect(markup.match(/data-presentation="menu"/gu)).toHaveLength(1);
    const navigationEnd = markup.indexOf("</nav>");
    const appearance = markup.indexOf('data-presentation="menu"');
    const headerEnd = markup.indexOf("</header>");
    expect(appearance).toBeGreaterThan(navigationEnd);
    expect(appearance).toBeLessThan(headerEnd);
  });

  test("renders an accessible SVG and equivalent semantic table", () => {
    const markup = renderToStaticMarkup(
      createElement(GptSubsidyChart, { snapshot }),
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain("<title");
    expect(markup).toContain("<desc");
    expect(markup).toContain(
      "daily observations. The line shows the",
    );
    expect(markup).toContain('viewBox="0 0 720 300"');
    expect(markup).toContain('class="gpt-subsidy-chart__dates"');
    expect(markup).toContain('gpt-subsidy-chart__point--latest');
    expect(markup).toContain("Historical points are subdued");
    expect(markup).toContain('text-anchor="start"');
    expect(markup).toContain('text-anchor="end"');
    expect(markup).toMatch(/\$[0-9.]+k/u);
    expect(markup).not.toContain("gpt-subsidy-chart__axis-title");
    expect(markup).not.toContain("Scroll horizontally");
    expect(markup).toContain("<details");
    expect(markup).toContain(
      `View all ${snapshot.observations.length} observations`,
    );
    expect(markup).toContain("<table");
    expect(markup).toContain("<caption>");
    expect(markup).toContain('scope="row"');
    expect(markup).not.toContain("data-status=");
    expect(markup).toContain("Seven complete UTC days per point");

    for (const observation of snapshot.observations) {
      expect(markup).toContain(observation.observedAt);
      expect(markup).toContain(
        formatSubsidyUsd(observation.trailingSevenDayApiEquivalentUsd),
      );
    }
  });

  test("leads with the chart and metrics while keeping methodology in static HTML", () => {
    const markup = renderToStaticMarkup(createElement(GptSubsidyPage));

    expect(markup).toContain("<h1>ChatGPT Subsidy Chart</h1>");
    expect(markup).toContain(GPT_SUBSIDY_DESCRIPTION);
    expect(markup).toContain('aria-label="Current API-equivalent values"');
    expect(markup).toContain("Trailing 7 days");
    expect(markup).toContain(`Trailing ${snapshot.periodSummary.days} days`);
    expect(markup).not.toContain('id="allowance-estimate"');
    expect(markup).toContain('id="calculation"');
    expect(markup).toContain('id="interpretation"');
    expect(markup).toContain("API-retail-equivalent value");
    expect(markup).toContain("one user&#x27;s available local logs on one machine");
    expect(markup).toContain("not a platform-wide or representative ChatGPT Pro estimate");
    expect(markup).toContain("API-key or otherwise API-billed usage");
    expect(markup).toContain("purchased ChatGPT credits");
    expect(markup).toContain("scheduled collector&#x27;s own small Codex token use");
    expect(markup).toContain("Trailing-seven-day API-retail-equivalent value");
    expect(markup).toContain("Subscription-adjusted multiple unavailable");
    expect(markup).toContain(
      "No monthly projection or one-plan normalization is applied",
    );
    expect(markup).toContain(
      "without durable account attribution",
    );
    expect(markup).toContain("prove that a weekly limit was exhausted");
    expect(markup).toContain("model-specific API-price estimates");
    expect(markup).toContain("pins the parser, adapter, rolling-window math");
    expect(markup).toContain("An unknown recorded model blocks publication");
    expect(markup).toContain("<summary>About this chart</summary>");
    expect(markup).toContain(
      `View all ${snapshot.observations.length} observations`,
    );
    expect(markup).toContain(snapshot.pricing.manifest.sourceUrl);
    expect(markup).toContain(snapshot.methodology.measurement.sourceUrl);
    expect(markup).toContain(snapshot.generatedAt);
    expect(markup).toContain(gptSubsidyPageModifiedAt(snapshot));
    expect(markup).toContain(
      snapshot.observations[0]!.periodStartedAt
      + "/"
      + snapshot.observations.at(-1)!.periodEndsAt,
    );
    expect(markup).toContain("application/ld+json");

    const summaryIndex = markup.indexOf('class="gpt-subsidy-summary');
    const chartIndex = markup.indexOf('class="gpt-subsidy-history');
    const methodologyIndex = markup.indexOf('class="gpt-subsidy-method');
    expect(summaryIndex).toBeGreaterThan(-1);
    expect(chartIndex).toBeGreaterThan(summaryIndex);
    expect(methodologyIndex).toBeGreaterThan(chartIndex);

    for (const observation of snapshot.observations) {
      expect(markup).toContain(observation.observedAt);
      expect(markup).toContain(
        formatSubsidyUsd(observation.trailingSevenDayApiEquivalentUsd),
      );
    }
    expect(markup).not.toContain("307.1×");
  });
});
