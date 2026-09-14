import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CodingAgentUpdate } from "@/lib/coding-agent-data";
import { ModelUpdateTimeline } from "./model-update-timeline";

const benchmarks = {
  aaIndex: 70,
  deepSwe: 66,
  sweAtlas: 56,
  terminalBench: 88,
} as const;

const updates: readonly CodingAgentUpdate[] = [
  {
    agent: "Current Agent",
    benchmarks,
    detectedAt: "2026-09-03T12:00:00.000Z",
    id: "current",
    kind: "model-added",
    model: "Current Model",
    providerId: "current-provider",
    providerName: "Current Provider",
    setting: "max",
    variantCount: 1,
  },
  {
    agent: "Earlier Agent",
    benchmarks,
    changes: [{ current: 66, metric: "deepSwe", previous: 64 }],
    detectedAt: "2026-09-01T12:00:00.000Z",
    id: "earlier",
    kind: "benchmark-changed",
    model: "Earlier Model",
    providerId: "earlier-provider",
    providerName: "Earlier Provider",
    setting: "high",
  },
];

test("keeps the latest update visible while the complete history remains in SSR", () => {
  const html = renderToStaticMarkup(createElement(ModelUpdateTimeline, {
    retrievedAt: "2026-09-04T12:00:00.000Z",
    updates,
  }));

  expect(html).toContain('id="model-updates"');
  expect(html).toContain("New: Current Model");
  expect(html).toContain("Current Model");
  expect(html).toContain("View all 2 detailed updates across 2 snapshots");
  expect(html).toContain("<details");
  expect(html).toContain("Earlier Model");
  expect(html).toContain("64.0");
  expect(html).toContain("66.0");
});

test("renders one literal timeline with checked source time and benchmark evidence", async () => {
  const source = await Bun.file(new URL("./model-update-timeline.tsx", import.meta.url)).text();

  expect(source).toContain('id="model-updates"');
  expect(source).toContain("Model updates");
  expect(source).toContain("Daily snapshot diff");
  expect(source).toContain("New model");
  expect(source).toContain("New setting");
  expect(source).toContain("Benchmark change");
  expect(source).toContain("model-update-timeline__current");
  expect(source).toContain("model-update-timeline__history");
  expect(source).toContain("<UpdateMetrics update={update} />");
  expect(source).not.toContain("game-changing");
  expect(source).not.toContain("frontier is moving");
});
