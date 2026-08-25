import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GptSubsidyChart } from "@/components/gpt-subsidy-chart";
import gptSubsidyData from "@/data/gpt-subsidy.json";
import {
  formatSubsidyMultiple,
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
    expect(markup).toContain("<table");
    expect(markup).toContain("<caption>");
    expect(markup).toContain('scope="row"');
    expect(markup).not.toContain("data-status=");
    expect(markup).toContain("Each point covers seven complete UTC days");

    for (const observation of snapshot.observations) {
      expect(markup).toContain(observation.observedAt);
      expect(markup).toContain(
        formatSubsidyMultiple(observation.planPriceMultiple),
      );
    }
  });

  test("renders the checked history, calculation, and limits in static HTML", () => {
    const markup = renderToStaticMarkup(createElement(GptSubsidyPage));

    expect(markup).toContain("<h1>" + GPT_SUBSIDY_TITLE + "</h1>");
    expect(markup).toContain(GPT_SUBSIDY_DESCRIPTION);
    expect(markup).toContain('id="latest-subsidy-observation"');
    expect(markup).toContain('id="subsidy-history"');
    expect(markup).not.toContain('id="allowance-estimate"');
    expect(markup).toContain("No per-refill projection is published");
    expect(markup).toContain('id="calculation"');
    expect(markup).toContain('id="interpretation"');
    expect(markup).toContain("API-retail-equivalent value");
    expect(markup).toContain("One user&#x27;s available local logs on one machine");
    expect(markup).toContain("not a platform-wide or representative ChatGPT Pro estimate");
    expect(markup).toContain("API-key or otherwise API-billed usage");
    expect(markup).toContain("purchased ChatGPT credits");
    expect(markup).toContain("scheduled collector&#x27;s own small Codex token use");
    expect(markup).toContain("Monthly plan-price multiple");
    expect(markup).toContain("model-specific API-price estimate");
    expect(markup).toContain("pins the parser, adapter, rolling-window math");
    expect(markup).toContain("An unknown recorded model blocks publication");
    expect(markup).toContain(snapshot.pricing.manifest.sourceUrl);
    expect(markup).toContain(snapshot.methodology.measurement.sourceUrl);
    expect(markup).toContain(snapshot.generatedAt);
    expect(markup).toContain(
      snapshot.observations[0]!.periodStartedAt
      + "/"
      + snapshot.observations.at(-1)!.periodEndsAt,
    );
    expect(markup).toContain("application/ld+json");

    for (const observation of snapshot.observations) {
      expect(markup).toContain(observation.observedAt);
      expect(markup).toContain(
        formatSubsidyMultiple(observation.planPriceMultiple),
      );
    }
  });
});
