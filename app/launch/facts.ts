import type { LaunchFacts, LaunchStatus } from "@hraness/design-kit/launch";

import codingAgentData from "@/data/coding-agents.json";
import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import { ATLAS_ENTRIES } from "@/lib/benchmark-atlas-catalog";

/**
 * Every number the "Introducing aicharts" beats, the social kit, and the
 * launch film captions use, each typed once with the record it comes from.
 * app/launch/launch.test.ts reads those records and fails when a value here
 * drifts from them.
 */

/**
 * The usage collector's release status, from STYLE.md's labels. The charts
 * are live; the collector ships a Linux x86-64 build and is still in
 * development (app/usage/page.tsx, docs/usage-activation.md).
 */
export const LAUNCH_STATUS = "In development" satisfies LaunchStatus;

/** The workspace version in Cargo.toml, released through the cli-v0.3.0 tag. */
export const LAUNCH_CLI_VERSION = "0.3.0";

/** README.md: "the 55 sources in the pinned Tokscale parser registry", repeated on /usage. */
export const LAUNCH_USAGE_SOURCES = 55;

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
  usageSources: {
    value: String(LAUNCH_USAGE_SOURCES),
    source: "README.md and app/usage/page.tsx: the sources in the pinned Tokscale parser registry",
  },
  cliVersion: {
    value: LAUNCH_CLI_VERSION,
    source: "Cargo.toml [workspace.package] version, released through the cli-v0.3.0 tag on GitHub Releases",
  },
  status: {
    value: LAUNCH_STATUS,
    source: "app/usage/page.tsx hero note, the collector's STYLE.md status label",
  },
} as const satisfies LaunchFacts;

export type LaunchFactKey = keyof typeof launchFacts;
