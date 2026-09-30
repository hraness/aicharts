import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  COLLECTOR_ENROLL_COMMAND,
  COLLECTOR_REPORT_COMMAND,
  ChartMockup,
  MOCKUP_IDS,
  STATUS_SNAPSHOT_LINES,
  renderLaunchMockup,
} from "@/components/launch-mockups";
import { ATLAS_ENTRIES } from "@/lib/benchmark-atlas-catalog";
import { comparableIntelligenceRecords } from "@/lib/intelligence-efficiency";

import { LAUNCH_POST_URL, launchBeats, socialKit } from "./beats";
import { LAUNCH_CLI_VERSION, LAUNCH_STATUS, LAUNCH_USAGE_SOURCES, launchFacts } from "./facts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

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

  test("the CLI version is the workspace version", () => {
    const match = /\[workspace\.package\][^[]*?\nversion = "([^"]+)"/u.exec(read("Cargo.toml"));
    expect(match?.[1]).toBe(LAUNCH_CLI_VERSION);
  });

  test("the usage source count is the one the README and /usage state", () => {
    expect(read("README.md")).toContain(`the ${LAUNCH_USAGE_SOURCES} sources in the pinned Tokscale parser registry`);
    expect(read("app/usage/page.tsx")).toContain(`"${LAUNCH_USAGE_SOURCES} sources"`);
  });

  test("the status is the collector's label on /usage and in the README", () => {
    expect(LAUNCH_STATUS).toBe("In development");
    expect(read("README.md")).toContain("The collector is in development.");
  });

  test("the collector commands are the ones /usage prints", () => {
    const usage = read("app/usage/page.tsx");
    expect(usage).toContain(COLLECTOR_ENROLL_COMMAND);
    expect(usage).toContain(COLLECTOR_REPORT_COMMAND);
  });

  test("the status mockup copies the CLI golden", () => {
    const golden = read("crates/aicharts-cli/tests/fixtures/status/running.w80.txt");
    expect(golden.startsWith(`${STATUS_SNAPSHOT_LINES.join("\n")}\n`)).toBe(true);
  });
});

describe("launch beats and social kit", () => {
  test("every beat shows a mockup this site draws, and the status beat carries the status", () => {
    for (const beat of launchBeats) {
      expect(beat.visual.kind).toBe("mockup");
      if (beat.visual.kind === "mockup") expect(MOCKUP_IDS).toContain(beat.visual.id as never);
    }
    expect(launchBeats.at(-1)?.post).toContain(LAUNCH_STATUS);
  });

  test("the social kit covers X, Bluesky, Threads and LinkedIn plus the launch fact sheet", () => {
    expect(Object.keys(socialKit).sort()).toEqual(
      ["bluesky", "linkedin", "productHunt", "showHnFacts", "sources", "threads", "x"].sort(),
    );
    expect(socialKit.x).toHaveLength(launchBeats.length);
    expect(socialKit.x.at(-1)).toContain(LAUNCH_POST_URL);
    expect(JSON.stringify(socialKit)).not.toMatch(/mastodon/iu);
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

describe("social kit file", () => {
  test("kb/launch/social-kit.md matches the beats and facts (run bun run launch:kit)", async () => {
    const { renderSocialKitMarkdown } = await import("./social-kit-markdown");
    const onDisk = readFileSync(join(import.meta.dir, "../../kb/launch/social-kit.md"), "utf8");
    expect(onDisk).toBe(renderSocialKitMarkdown());
  });
});
