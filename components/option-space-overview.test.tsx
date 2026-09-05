import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CodingAgentRecord } from "@/lib/coding-agent-data";
import { OptionSpaceOverview } from "./option-space-overview";

function record(
  id: string,
  providerId: string,
  costUsd: number,
  aaIndex: number,
): CodingAgentRecord {
  return {
    id,
    agent: "Agent",
    model: id,
    modelLabel: id,
    providerId,
    providerName: providerId.toUpperCase(),
    seriesId: id,
    seriesLabel: id,
    setting: "default",
    settingRank: 0,
    completeIndex: true,
    benchmarks: {
      aaIndex,
      deepSwe: aaIndex - 4,
      sweAtlas: aaIndex - 8,
      terminalBench: aaIndex + 6,
    },
    economics: { costUsd, durationSeconds: costUsd * 60 },
    usage: { totalTokens: costUsd * 1_000_000 },
  };
}

test("the option-space summary keeps the current signal visible and details server-rendered", () => {
  const html = renderToStaticMarkup(
    <OptionSpaceOverview
      onPinPoint={() => undefined}
      onPinProvider={() => undefined}
      pinnedPointId="middle"
      pinnedProviderId={null}
      records={[
        record("cheap", "one", 1, 42),
        record("middle", "two", 3, 65),
        record("dominated", "two", 4, 55),
        record("peak", "three", 8, 78),
      ]}
      xMetric="costUsd"
      yMetric="aaIndex"
    />,
  );

  expect(html).toContain('aria-labelledby="option-space-title"');
  expect(html).toContain('id="option-space-title"');
  expect(html).toContain("Efficient choices beyond the scatter plot");
  expect(html).toContain("Current read.");
  expect(html).toContain("peak reaches the highest sampled frontier score at");
  expect(html).toContain("3 provider ranges are available, led by THREE");
  expect(html).toContain("<details");
  expect(html).toContain("Explore 3 frontier steps and 3 provider ranges");
  expect(html).toContain("Efficient frontier");
  expect(html).toContain("Provider ranges");
  expect(html).not.toContain("Benchmark profiles");
  expect(html).not.toContain("Select a model or provider to pin it in the scatter chart.");
  expect(html).not.toContain("See the trade-offs, not just the leaderboard");
  expect(html).not.toContain("option-space-eyebrow");
  expect(html).toContain("AA Index efficient frontier");
  expect(html).toContain("AA Index ranges by provider");
  expect(html).toContain('aria-pressed="true"');
  expect(html).not.toContain(">dominated<");
});
