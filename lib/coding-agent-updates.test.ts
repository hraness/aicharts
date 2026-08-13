import { describe, expect, test } from "bun:test";
import type { CodingAgentUpdate } from "./coding-agent-data";
import {
  formatRetrievedAt,
  formatUpdateDate,
  groupUpdatesByDetection,
  latestUpdateGroup,
} from "./coding-agent-updates";

function added(model: string, detectedAt: string): CodingAgentUpdate {
  return {
    id: `${detectedAt}:${model}`,
    agent: "Claude Code",
    benchmarks: { aaIndex: 70, deepSwe: 60, sweAtlas: 68, terminalBench: 82 },
    detectedAt,
    kind: "model-added",
    model,
    providerId: "provider",
    providerName: "Provider",
    setting: "high",
    variantCount: 1,
  };
}

describe("coding-agent update presentation", () => {
  test("formats checked and event timestamps deterministically in UTC", () => {
    expect(formatRetrievedAt("2026-07-20T12:55:28.788Z")).toBe("Jul 20, 2026, 12:55 PM UTC");
    expect(formatUpdateDate("2026-07-20T23:55:28.788-04:00")).toBe("Jul 21, 2026");
    expect(() => formatRetrievedAt("last Thursday")).toThrow(RangeError);
  });

  test("summarizes every event from the latest detection timestamp", () => {
    const latest = "2026-08-12T11:29:54.373Z";
    const group = latestUpdateGroup([
      added("Older", "2026-08-08T11:06:22.000Z"),
      added("DeepSeek V4 Flash", latest),
      added("Qwen3.8 Max", latest),
    ]);

    expect(group).toMatchObject({ detectedAt: latest, summary: "2 models added" });
    expect(group?.events.map(({ model }) => model)).toEqual(["DeepSeek V4 Flash", "Qwen3.8 Max"]);
  });

  test("groups an unsorted history newest-first without changing event order", () => {
    const older = added("Older", "2026-08-08T11:06:22.000Z");
    const newest = added("Newest", "2026-08-12T11:29:54.373Z");

    expect(groupUpdatesByDetection([older, newest]).map(({ detectedAt }) => detectedAt)).toEqual([
      newest.detectedAt,
      older.detectedAt,
    ]);
  });
});
