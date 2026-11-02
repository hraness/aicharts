import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  assertFakeHandles,
  assertNoHeadings,
  assertRoleImgWithLabel,
  renderMatrix,
} from "@hraness/design-kit/testing";

import codingAgentData from "@/data/coding-agents.json";
import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import {
  CHART_VIEWS,
  ChartMockup,
  MOCKUP_IDS,
  renderLaunchMockup,
} from "@/components/launch-mockups";
import { ATLAS_ENTRIES } from "@/lib/benchmark-atlas-catalog";
import { comparableIntelligenceRecords } from "@/lib/intelligence-efficiency";

import { launchBeats } from "./beats";
import { launchFacts } from "./facts";

describe("launch facts match their records", () => {
  test("chart counts come from the checked snapshots the charts plot", () => {
    expect(launchFacts.intelligenceConfigs.value).toBe(
      String(intelligenceData.selection.positiveCostRecordCount),
    );
    expect(Number(launchFacts.intelligenceConfigs.value)).toBe(
      comparableIntelligenceRecords(intelligenceData.records as never).length,
    );
    expect(launchFacts.intelligenceVersion.value).toBe(`v${intelligenceData.benchmark.version}`);
    expect(launchFacts.codingConfigs.value).toBe(String(codingAgentData.records.length));
    expect(launchFacts.libraryEntries.value).toBe(String(ATLAS_ENTRIES.length));
  });
});

describe("benchmark introduction", () => {
  test("every beat shows a public benchmark view this site draws", () => {
    for (const beat of launchBeats) {
      expect(beat.visual.kind).toBe("mockup");
      if (beat.visual.kind === "mockup") expect(MOCKUP_IDS).toContain(beat.visual.id as never);
      expect(beat.detailHref).not.toMatch(/^\/(?:usage|dashboard|leaderboard)(?:\/|$)/u);
    }
  });
});

describe("launch mockups", () => {
  test("each mockup is one labelled image with no headings and no real handles", () => {
    for (const id of MOCKUP_IDS) {
      const html = renderToStaticMarkup(renderLaunchMockup(id, {}) as never);
      assertRoleImgWithLabel(html, id);
      assertNoHeadings(html, id);
      assertFakeHandles(html, [], id);
      expect(html).toMatch(/Illustration/u);
    }
  });

  test("each chart view draws a different picture", () => {
    renderMatrix(
      (view: (typeof CHART_VIEWS)[number]) => renderToStaticMarkup(createElement(ChartMockup, { view })),
      Object.fromEntries(CHART_VIEWS.map((view) => [view, view])),
    );
  });

  test("an unknown mockup id fails loudly", () => {
    expect(() => renderLaunchMockup("menubar", {})).toThrow();
  });
});
