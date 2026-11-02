import type { LaunchFacts } from "@hraness/design-kit/launch";

import codingAgentData from "@/data/coding-agents.json";
import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import { ATLAS_ENTRIES } from "@/lib/benchmark-atlas-catalog";

/**
 * Every number the "Introducing aicharts" beats use, each typed once with
 * the record it comes from.
 * app/launch/launch.test.ts reads those records and fails when a value here
 * drifts from them.
 */

export const launchFacts = {
  intelligenceConfigs: {
    value: String(intelligenceData.selection.positiveCostRecordCount),
    source:
      "data/artificial-analysis-intelligence-v4-3.json selection.positiveCostRecordCount, the configurations with a task cost above zero that the homepage chart plots (comparableIntelligenceRecords)",
  },
  intelligenceVersion: {
    value: `v${intelligenceData.benchmark.version}`,
    source: "data/artificial-analysis-intelligence-v4-3.json benchmark.version",
  },
  codingConfigs: {
    value: String(codingAgentData.records.length),
    source:
      "data/coding-agents.json records.length, the model, harness, and effort configurations on the /coding chart",
  },
  libraryEntries: {
    value: String(ATLAS_ENTRIES.length),
    source: "lib/benchmark-atlas-catalog.ts ATLAS_ENTRIES.length, the entries in the /benchmarks library",
  },
} as const satisfies LaunchFacts;

export type LaunchFactKey = keyof typeof launchFacts;
