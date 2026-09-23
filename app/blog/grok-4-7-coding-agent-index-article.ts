import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";
import type { ArtificialAnalysisIntelligenceRecord } from "@/lib/artificial-analysis-intelligence-data";
import {
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "@/lib/artificial-analysis-intelligence-v4-3-data";
import {
  parseCodingAgentSnapshot,
  type CodingAgentRecord,
  type CodingAgentSnapshot,
} from "@/lib/coding-agent-data";
import {
  SNAPSHOT_COLUMN_LABELS,
  formatSnapshotCostUsd,
  formatSnapshotScore,
} from "@/lib/coding-agent-snapshot-rows";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
import {
  formatFineCostMultiple,
  grokCodingAgentPlacement,
  grokIntelligencePlacement,
  modelAddedAt,
  spellOrdinal,
  type GrokCodingAgentPlacement,
  type GrokIntelligencePlacement,
} from "@/lib/grok-4-7-placement";
import { comparableTaskCost, formatCostMultiple, formatPointGap } from "@/lib/mimo-v2-6-pro-frontier";
import { spellCount } from "./real-swe-private-enterprise-benchmark-article";

import {
  BLOG_SOURCE_NOTE,
  BLOG_SOURCES,
  callout,
  heading,
  list,
  paragraph,
  table,
  type BlogArticle,
  type BlogBlock,
  type InlineContent,
} from "./articles";

export const GROK_47_ARTICLE_SLUG = "grok-4-7-coding-agent-index" as const;
export const GROK_47_ARTICLE_PUBLISHED_AT = "2026-09-23" as const;

/** Quoted claims from the primary sources, kept verbatim so tests can check every quotation. */
export const GROK_47 = {
  xai: {
    announcedOn: "September 21, 2026",
    listedAs: "SpaceXAI",
    capabilityClaim: "our most capable model for coding and knowledge work",
    inputPrice: "$2",
    outputPrice: "$6",
    availability: "Cursor and Grok Build",
    samePriceClaim: "Served at the same price and speed as Grok 4.6",
    vendorDeepSwe: "71.0%",
    vendorDeepSweEffort: "high",
    vendorTerminalBench: "37.6%",
    otherVendorBenchmarks: "CursorBench 4.0, EEBench, the Harvey Legal Agent Benchmark, and HealthBench Professional",
  },
  artificialAnalysis: {
    launchNoteOn: "September 21, 2026",
    capturedOn: "September 23, 2026",
    codingIndexScore: "56",
    codingIndexGain: "+9",
    previousCodingIndexScore: "47",
    nativeHarnessRank: "4th, behind only Claude Fable 5.1, GPT-6 Astra, and Claude Opus 5",
    overtaken: "GPT-5.6 Sol",
    componentGains: "DeepSWE v1.1 rises from 65% to 73%, Terminal-Bench 4.0 from 18% to 33%, and SWE-Atlas-QnA from 58% to 63%",
    separateHarnesses:
      "They are separate from the Intelligence Index results, which standardize the evaluation harness used across models.",
    intelligenceScore: "46",
    intelligenceGain: "+2",
    outputTokensPerTask: "81k",
    previousOutputTokensPerTask: "36k",
    minutesPerTask: "7.1",
    inputPrice: "$2.00",
    outputPrice: "$6.00",
    cacheDiscount: "75%",
    outputSpeed: "39.3",
    indexOutputTokens: "240M",
    contextWindow: "500k",
    releaseDate: "September 21, 2026",
  },
} as const;

/** Rows added to the checked snapshot on or after this UTC date postdate Artificial Analysis's launch note. */
const LAUNCH_NOTE_DATE = "2026-09-21" as const;

const CODING_CHART_LABEL = "Grok Build · Grok 4.7 (xhigh)" as const;

function checkedCodingSnapshot(): CodingAgentSnapshot {
  const parsed = parseCodingAgentSnapshot(codingAgentData);
  if (!parsed.ok) {
    throw new Error(`Checked coding-agent snapshot is invalid: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return parsed.value;
}

function checkedIntelligenceSnapshot(): ArtificialAnalysisIntelligenceV43Snapshot {
  const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
  if (!parsed.ok) {
    throw new Error(`Checked Intelligence Index snapshot is invalid: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return parsed.value;
}

function utcCalendarDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.valueOf())) {
    throw new RangeError(`Invalid snapshot timestamp: ${timestamp}`);
  }
  return date.toISOString().slice(0, 10);
}

function latestCalendarDate(...dates: readonly string[]): string {
  const [first, ...rest] = dates;
  if (first === undefined) throw new Error("At least one calendar date is required.");
  return rest.reduce((latest, current) => current > latest ? current : latest, first);
}

const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

/** “September 23, 2026” for a snapshot timestamp, in UTC. */
export function formatLongUtcDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.valueOf())) {
    throw new RangeError(`Invalid snapshot timestamp: ${timestamp}`);
  }
  return LONG_DATE.format(date);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function textCell(value: string): InlineContent {
  return [value];
}

function configurationLabel(record: CodingAgentRecord): string {
  return `${record.seriesLabel} (${record.setting})`;
}

export function formatMillionTokens(value: number | null): string {
  if (value === null) return "-";
  return `${(value / 1_000_000).toFixed(1)} million`;
}

export function formatMinutes(seconds: number | null): string {
  if (seconds === null) return "-";
  const minutes = Math.round(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function formatWholeTokens(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function roundedScore(value: number): string {
  return String(Math.round(value));
}

function pluralConfigurations(count: number): string {
  return count === 1 ? "one configuration" : `${spellCount(count)} configurations`;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function codingRowCells(record: CodingAgentRecord): InlineContent[] {
  return [
    textCell(record.seriesLabel),
    textCell(record.setting),
    textCell(formatSnapshotScore(record.benchmarks.aaIndex)),
    textCell(formatSnapshotCostUsd(record.economics.costUsd)),
  ];
}

function intelligenceRowCells(record: ArtificialAnalysisIntelligenceRecord): InlineContent[] {
  return [
    textCell(record.name),
    textCell(formatSnapshotScore(record.intelligenceIndex)),
    textCell(formatSnapshotCostUsd(comparableTaskCost(record))),
  ];
}

function overviewBlocks(
  coding: GrokCodingAgentPlacement | undefined,
  intelligence: GrokIntelligencePlacement | undefined,
  codingRetrievedAt: string,
  intelligenceRetrievedAt: string,
): BlogBlock[] {
  if (coding === undefined || intelligence === undefined) {
    return [
      paragraph(
        coding === undefined
          ? `The coding-agent snapshot retrieved ${codingRetrievedAt} does not store a Grok Build · Grok 4.7 row with an AA Index and a cost, so this note cannot place the coding-agent row yet. `
          : "",
        intelligence === undefined
          ? `The Intelligence Index snapshot retrieved ${intelligenceRetrievedAt} does not store a comparable Grok 4.7 (xhigh) row, so this note cannot place the Intelligence Index row yet.`
          : "",
      ),
    ];
  }
  return [
    table(
      "Grok 4.7 in the two AI Charts snapshots. Each score belongs to its own chart, task set, and cost definition.",
      ["Chart", "Configuration", "Score", "Cost per task", "Snapshot retrieved"],
      [
        [
          textCell("Coding agents (AA Index)"),
          textCell(configurationLabel(coding.record)),
          textCell(formatSnapshotScore(coding.record.benchmarks.aaIndex)),
          textCell(formatSnapshotCostUsd(coding.record.economics.costUsd)),
          textCell(codingRetrievedAt),
        ],
        [
          textCell("Intelligence Index"),
          textCell(intelligence.record.name),
          textCell(formatSnapshotScore(intelligence.record.intelligenceIndex)),
          textCell(formatSnapshotCostUsd(comparableTaskCost(intelligence.record))),
          textCell(intelligenceRetrievedAt),
        ],
      ],
    ),
  ];
}

function codingPlacementBlocks(
  placement: GrokCodingAgentPlacement | undefined,
  snapshot: CodingAgentSnapshot,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `The coding-agent snapshot retrieved ${retrievedAt} does not store a Grok Build · Grok 4.7 row with an AA Index and a cost, so this section has nothing to place.`,
      ),
    ];
  }
  const { record, higher, indexedCount, leader, dominators, onCostFrontier, rank } = placement;
  const blocks: BlogBlock[] = [
    paragraph(
      `In the coding-agent snapshot retrieved ${retrievedAt}, ${configurationLabel(record)} scores ${formatSnapshotScore(record.benchmarks.aaIndex)} on AA Index at a mean API cost of ${formatSnapshotCostUsd(record.economics.costUsd)} per task. That is ${spellOrdinal(rank)} of the ${indexedCount} configurations that carry an index. `,
      higher.length === 0
        ? "No configuration scores higher."
        : `${capitalize(pluralConfigurations(higher.length))} score${higher.length === 1 ? "s" : ""} higher: ${joinNames(higher.map(candidate => `${configurationLabel(candidate)} at ${formatSnapshotScore(candidate.benchmarks.aaIndex)}`))}. The leader, ${configurationLabel(leader)}, is ${(leader.benchmarks.aaIndex - record.benchmarks.aaIndex).toFixed(1)} points above it at ${formatSnapshotCostUsd(leader.economics.costUsd)} per task.`,
    ),
  ];
  if (onCostFrontier) {
    blocks.push(paragraph(
      "It is on the chart’s cost frontier: no configuration in the snapshot costs less per task and scores at least as high on AA Index.",
    ));
  } else if (dominators.length >= 2) {
    blocks.push(
      paragraph(
        `It is not on the chart’s cost frontier. ${capitalize(pluralConfigurations(dominators.length))} cost the same or less per task and score at least as high, so the chart draws its frontier past the Grok 4.7 row. The table lists them cheapest first.`,
      ),
      table(
        `Configurations that cost no more than ${CODING_CHART_LABEL} and score at least as high on AA Index, in the snapshot retrieved ${retrievedAt}`,
        ["Configuration", "Setting", SNAPSHOT_COLUMN_LABELS.aaIndex, "Cost per task"],
        dominators.map(codingRowCells),
      ),
    );
  } else {
    blocks.push(paragraph(
      `It is not on the chart’s cost frontier: ${joinNames(dominators.map(candidate => `${configurationLabel(candidate)} scores ${formatSnapshotScore(candidate.benchmarks.aaIndex)} at ${formatSnapshotCostUsd(candidate.economics.costUsd)} per task`))}, so the chart draws its frontier past the Grok 4.7 row.`,
    ));
  }
  const addedAfterLaunch = higher.flatMap((candidate) => {
    const detectedAt = modelAddedAt(snapshot, candidate);
    if (detectedAt === undefined || utcCalendarDate(detectedAt) <= LAUNCH_NOTE_DATE) return [];
    return [{ candidate, detectedAt }];
  });
  blocks.push(paragraph(
    "Artificial Analysis’s ",
    { href: BLOG_SOURCES.artificialAnalysisGrok47.url, text: "launch note" },
    " of ",
    GROK_47.artificialAnalysis.launchNoteOn,
    " placed Grok Build with Grok 4.7 “",
    GROK_47.artificialAnalysis.nativeHarnessRank,
    "” among models run in their own harnesses, and said it had overtaken ",
    GROK_47.artificialAnalysis.overtaken,
    ". ",
    addedAfterLaunch.length === 0
      ? "The snapshot’s bounded update log records no higher-scoring configuration added after that note, so the difference between its rank there and its rank here comes from rows the log no longer holds or from the chart counting every harness, including multi-model pairings."
      : `The snapshot’s update log records ${joinNames(addedAfterLaunch.map(({ candidate, detectedAt }) => `${configurationLabel(candidate)} added on ${formatLongUtcDate(detectedAt)}`))}, after that note. Rankings on this chart move whenever Artificial Analysis publishes a new configuration, and the chart counts every harness, including multi-model pairings.`,
  ));
  return blocks;
}

function componentBlocks(
  placement: GrokCodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `Without a Grok Build · Grok 4.7 row in the snapshot retrieved ${retrievedAt}, this note cannot split the index into its components.`,
      ),
    ];
  }
  const { components, lowerIndexHigherTerminal, record } = placement;
  if (components.length === 0) {
    return [
      paragraph(
        `The Grok Build · Grok 4.7 row in the snapshot retrieved ${retrievedAt} carries an AA Index but no component scores, so this note cannot split the index.`,
      ),
    ];
  }
  const parts = components.map(component => (
    `on ${SNAPSHOT_COLUMN_LABELS[component.metric]} it scores ${formatSnapshotScore(component.value)}, ${spellOrdinal(component.rank)} of ${component.count}`
  ));
  const summary = parts.length === 1
    ? parts.join("")
    : `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
  const blocks: BlogBlock[] = [
    paragraph(
      "AA Index averages three component benchmarks, and the average hides how differently Grok 4.7 does on them. ",
      capitalize(summary),
      " configurations that carry each score.",
    ),
  ];
  if (components.length >= 2) {
    blocks.push(table(
      `${CODING_CHART_LABEL} on each AA Index component in the snapshot retrieved ${retrievedAt}. Rank counts every configuration that carries the component.`,
      ["Component", "Grok 4.7 score", "Rank", "Leader"],
      components.map(component => [
        textCell(SNAPSHOT_COLUMN_LABELS[component.metric]),
        textCell(formatSnapshotScore(component.value)),
        textCell(`${component.rank} of ${component.count}`),
        textCell(
          component.leader.id === record.id
            ? "Grok 4.7 leads"
            : `${configurationLabel(component.leader)} at ${formatSnapshotScore(component.leader.benchmarks[component.metric])}`,
        ),
      ]),
    ));
  }
  if (record.benchmarks.terminalBench !== null) {
    blocks.push(paragraph(
      lowerIndexHigherTerminal.length === 0
        ? "No configuration with a lower AA Index scores higher on Terminal-Bench 4, so on this snapshot the composite and the terminal component order Grok 4.7 the same way."
        : `${capitalize(pluralConfigurations(lowerIndexHigherTerminal.length))} with a lower AA Index score${lowerIndexHigherTerminal.length === 1 ? "s" : ""} higher on Terminal-Bench 4: ${joinNames(lowerIndexHigherTerminal.map(candidate => `${configurationLabel(candidate)} at ${formatSnapshotScore(candidate.benchmarks.terminalBench)}`))}. A reader who cares about terminal work would order these rows differently from the composite.`,
    ));
  }
  blocks.push(paragraph(
    "Artificial Analysis’s launch note reports the same shape for the generation step: “",
    GROK_47.artificialAnalysis.componentGains,
    ".” Terminal-Bench 4 moved the most in points and remains the lowest of the three.",
  ));
  return blocks;
}

function generationBlocks(
  placement: GrokCodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  const predecessor = placement?.predecessor;
  if (placement === undefined || predecessor === undefined) {
    return [
      paragraph(
        `The snapshot retrieved ${retrievedAt} does not store both Grok Build · Grok 4.6 and Grok Build · Grok 4.7 at the same setting, so this note cannot compare the two generations in one harness. Artificial Analysis’s launch note reports the step as ${GROK_47.artificialAnalysis.previousCodingIndexScore} to ${GROK_47.artificialAnalysis.codingIndexScore} on the Coding Agent Index.`,
      ),
    ];
  }
  const { record } = placement;
  const previousIndex = predecessor.benchmarks.aaIndex;
  const previousCost = predecessor.economics.costUsd;
  const gain = previousIndex === null ? null : record.benchmarks.aaIndex - previousIndex;
  const costMultiple = previousCost === null || previousCost <= 0
    ? null
    : record.economics.costUsd / previousCost;
  const tokenMultiple = predecessor.usage.totalTokens === null
    || predecessor.usage.totalTokens <= 0
    || record.usage.totalTokens === null
    ? null
    : record.usage.totalTokens / predecessor.usage.totalTokens;
  const metricRow = (
    label: string,
    previous: string,
    current: string,
    change: string,
  ): InlineContent[] => [textCell(label), textCell(previous), textCell(current), textCell(change)];
  return [
    paragraph(
      `The snapshot stores the previous generation in the same harness at the same setting: ${configurationLabel(predecessor)} at ${formatSnapshotScore(previousIndex)} for ${formatSnapshotCostUsd(previousCost)} per task. `,
      gain === null
        ? "The predecessor row carries no AA Index, so the point gain cannot be stated from the snapshot."
        : `Grok 4.7 adds ${gain.toFixed(1)} index points`,
      costMultiple === null
        ? "."
        : ` at ${formatCostMultiple(costMultiple)} the mean cost per task`,
      tokenMultiple === null
        ? ""
        : ` and ${formatCostMultiple(tokenMultiple)} the total tokens per task`,
      ".",
    ),
    table(
      `Grok Build · Grok 4.6 and Grok Build · Grok 4.7 at the ${record.setting} setting in the snapshot retrieved ${retrievedAt}`,
      ["Measure", "Grok 4.6", "Grok 4.7", "Change"],
      [
        metricRow(
          SNAPSHOT_COLUMN_LABELS.aaIndex,
          formatSnapshotScore(previousIndex),
          formatSnapshotScore(record.benchmarks.aaIndex),
          gain === null ? "-" : `${formatPointGap(gain)} points`,
        ),
        metricRow(
          SNAPSHOT_COLUMN_LABELS.deepSwe,
          formatSnapshotScore(predecessor.benchmarks.deepSwe),
          formatSnapshotScore(record.benchmarks.deepSwe),
          predecessor.benchmarks.deepSwe === null || record.benchmarks.deepSwe === null
            ? "-"
            : `${formatPointGap(record.benchmarks.deepSwe - predecessor.benchmarks.deepSwe)} points`,
        ),
        metricRow(
          SNAPSHOT_COLUMN_LABELS.terminalBench,
          formatSnapshotScore(predecessor.benchmarks.terminalBench),
          formatSnapshotScore(record.benchmarks.terminalBench),
          predecessor.benchmarks.terminalBench === null || record.benchmarks.terminalBench === null
            ? "-"
            : `${formatPointGap(record.benchmarks.terminalBench - predecessor.benchmarks.terminalBench)} points`,
        ),
        metricRow(
          SNAPSHOT_COLUMN_LABELS.sweAtlas,
          formatSnapshotScore(predecessor.benchmarks.sweAtlas),
          formatSnapshotScore(record.benchmarks.sweAtlas),
          predecessor.benchmarks.sweAtlas === null || record.benchmarks.sweAtlas === null
            ? "-"
            : `${formatPointGap(record.benchmarks.sweAtlas - predecessor.benchmarks.sweAtlas)} points`,
        ),
        metricRow(
          "Mean API cost per task",
          formatSnapshotCostUsd(previousCost),
          formatSnapshotCostUsd(record.economics.costUsd),
          costMultiple === null ? "-" : formatCostMultiple(costMultiple),
        ),
        metricRow(
          "Total tokens per task",
          formatMillionTokens(predecessor.usage.totalTokens),
          formatMillionTokens(record.usage.totalTokens),
          tokenMultiple === null ? "-" : formatCostMultiple(tokenMultiple),
        ),
        metricRow(
          "Mean active time per task",
          formatMinutes(predecessor.economics.durationSeconds),
          formatMinutes(record.economics.durationSeconds),
          predecessor.economics.durationSeconds === null
            || predecessor.economics.durationSeconds <= 0
            || record.economics.durationSeconds === null
            ? "-"
            : formatCostMultiple(record.economics.durationSeconds / predecessor.economics.durationSeconds),
        ),
      ],
    ),
    paragraph(
      "xAI’s launch page says the model is “",
      GROK_47.xai.samePriceClaim,
      ",” and Artificial Analysis records the same ",
      GROK_47.artificialAnalysis.inputPrice,
      " and ",
      GROK_47.artificialAnalysis.outputPrice,
      " per million token prices for both generations. ",
      costMultiple !== null && costMultiple > 1
        ? "The higher cost per task in the snapshot is therefore token volume, not price: the harness run with Grok 4.7 processed more tokens per task than the run with Grok 4.6."
        : "Any cost difference between the two rows in the snapshot is therefore token volume, not price.",
    ),
  ];
}

function intelligenceBlocks(
  placement: GrokIntelligencePlacement | undefined,
  retrievedAt: string,
  indexVersion: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `The Intelligence Index snapshot retrieved ${retrievedAt} does not store a Grok 4.7 (xhigh) row that meets the comparable-cohort rule, so this note cannot place the model on the capability and cost chart yet.`,
      ),
    ];
  }
  const { cheapestHigher, cohortSize, dominators, high, leader, neighbors, onCostFrontier, rank, record } = placement;
  const cost = comparableTaskCost(record);
  const blocks: BlogBlock[] = [
    paragraph(
      `In the Intelligence Index snapshot retrieved ${retrievedAt}, ${record.name} scores ${formatSnapshotScore(record.intelligenceIndex)} at ${formatSnapshotCostUsd(cost)} per task and used ${formatWholeTokens(record.outputTokensPerTask.total)} output tokens per task, under index version ${indexVersion}. That is ${spellOrdinal(rank)} of the ${cohortSize} comparable configurations, and ${(leader.intelligenceIndex - record.intelligenceIndex).toFixed(1)} points below the leader, ${leader.name} at ${formatSnapshotScore(leader.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(leader))}.`,
    ),
  ];
  if (onCostFrontier) {
    blocks.push(paragraph(
      "It is on the cost frontier: no configuration in the comparable cohort scores higher at the same or lower cost per task.",
      cheapestHigher === undefined
        ? " No configuration scores higher."
        : ` The cheapest configuration that scores higher, ${cheapestHigher.record.name}, costs ${formatCostMultiple(cheapestHigher.multiple)} as much per task.`,
    ));
  } else {
    blocks.push(paragraph(
      `It is not on the cost frontier: ${pluralConfigurations(dominators.length)} score${dominators.length === 1 ? "s" : ""} at least as high at the same or lower cost per task.`,
      cheapestHigher === undefined
        ? ""
        : ` The cheapest configuration that scores higher, ${cheapestHigher.record.name}, scores ${formatSnapshotScore(cheapestHigher.record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(cheapestHigher.record))}, ${formatFineCostMultiple(cheapestHigher.multiple)} the cost.`,
    ));
  }
  if (neighbors.length >= 2) {
    blocks.push(
      paragraph(
        `${capitalize(spellCount(neighbors.length))} other configurations score within one index point of ${record.name}. The table lists them cheapest first, with each cost as a multiple of its ${formatSnapshotCostUsd(cost)}.`,
      ),
      table(
        `Configurations within one Intelligence Index point of ${record.name} in the snapshot retrieved ${retrievedAt}`,
        ["Configuration", "Intelligence Index", "Cost per task", "Multiple of Grok 4.7’s cost", "Output tokens per task"],
        neighbors.map(neighbor => [
          ...intelligenceRowCells(neighbor),
          textCell(formatFineCostMultiple(comparableTaskCost(neighbor) / cost)),
          textCell(formatWholeTokens(neighbor.outputTokensPerTask.total)),
        ]),
      ),
    );
  } else {
    blocks.push(paragraph(
      `The snapshot stores ${spellCount(neighbors.length)} other configuration${neighbors.length === 1 ? "" : "s"} within one index point of ${record.name}, so this note does not tabulate same-score neighbors.`,
    ));
  }
  blocks.push(paragraph(
    high === undefined
      ? "The snapshot does not store a comparable Grok 4.7 (high) row, so the effort levels cannot be compared here. "
      : `The snapshot also stores ${high.name} at ${formatSnapshotScore(high.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(high))} per task, so the xhigh setting buys ${formatPointGap(record.intelligenceIndex - high.intelligenceIndex)} points for ${formatCostMultiple(cost / comparableTaskCost(high))} the cost. `,
    "Artificial Analysis evaluated the model at xhigh for its headline score and notes that the gains “come with higher token usage”: about ",
    GROK_47.artificialAnalysis.outputTokensPerTask,
    " output tokens per Intelligence Index task against ",
    GROK_47.artificialAnalysis.previousOutputTokensPerTask,
    " for Grok 4.6 (high), and about ",
    GROK_47.artificialAnalysis.minutesPerTask,
    " minutes per task.",
  ));
  return blocks;
}

function costBlocks(
  coding: GrokCodingAgentPlacement | undefined,
  intelligence: GrokIntelligencePlacement | undefined,
  evaluationCount: number,
): BlogBlock[] {
  if (coding === undefined || intelligence === undefined) {
    return [
      paragraph(
        "Cost per task on the coding-agent chart and cost per task on the Intelligence Index are different measurements, and with one of the two rows absent this note cannot print both side by side.",
      ),
    ];
  }
  const codingCost = formatSnapshotCostUsd(coding.record.economics.costUsd);
  const indexCost = formatSnapshotCostUsd(comparableTaskCost(intelligence.record));
  return [
    paragraph(
      `The two snapshots print two costs for the same model at the same effort: ${codingCost} per task on the coding-agent chart and ${indexCost} per task on the Intelligence Index. Both are evaluation averages at list prices, and Artificial Analysis records the same list prices behind both, ${GROK_47.artificialAnalysis.inputPrice} per million input tokens and ${GROK_47.artificialAnalysis.outputPrice} per million output tokens with a ${GROK_47.artificialAnalysis.cacheDiscount} cache discount. The difference is the task.`,
    ),
    paragraph(
      `The coding-agent figure is the mean API cost of one task in Grok Build across the three coding benchmarks, including every tool call and repeated context the harness sends: ${formatMillionTokens(coding.record.usage.totalTokens)} total tokens per task in this snapshot. The Intelligence Index figure is a weighted average across ${spellCount(evaluationCount)} evaluations under a standardized harness, with ${formatWholeTokens(intelligence.record.outputTokensPerTask.total)} output tokens per task. Neither is a subscription price, a Cursor plan, or an invoice for a workload.`,
    ),
    callout(
      "How to compare costs",
      `Compare ${codingCost} with other rows on the coding-agent chart and ${indexCost} with other rows on the Intelligence Index chart. Do not compare the two with each other, and do not read either as the price of running Grok 4.7 on your own tasks.`,
    ),
  ];
}

export function createGrok47Article(
  codingSnapshot: CodingAgentSnapshot = checkedCodingSnapshot(),
  intelligenceSnapshot: ArtificialAnalysisIntelligenceV43Snapshot = checkedIntelligenceSnapshot(),
): BlogArticle {
  const codingRetrievedAt = formatRetrievedAt(codingSnapshot.source.retrievedAt);
  const intelligenceRetrievedAt = formatRetrievedAt(intelligenceSnapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    GROK_47_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(codingSnapshot.source.retrievedAt),
    utcCalendarDate(intelligenceSnapshot.source.retrievedAt),
  );
  const coding = grokCodingAgentPlacement(codingSnapshot.records);
  const intelligence = grokIntelligencePlacement(intelligenceSnapshot.records);
  const indexVersion = intelligenceSnapshot.benchmark.version;
  const weights = intelligenceSnapshot.benchmark.categoryWeightsPercent;

  const codingScore = coding === undefined ? undefined : roundedScore(coding.record.benchmarks.aaIndex);
  const intelligenceScore = intelligence === undefined
    ? undefined
    : roundedScore(intelligence.record.intelligenceIndex);
  const title = codingScore === undefined
    ? "Where Grok 4.7 lands on the AI Charts snapshots"
    : `What Grok 4.7’s ${codingScore} on the coding-agent chart measures`;
  const frontierPhrase = coding === undefined || intelligence === undefined
    ? ""
    : coding.onCostFrontier && intelligence.onCostFrontier
      ? "the Grok 4.7 row is on the cost frontier of both charts"
      : coding.onCostFrontier
        ? "a cheaper configuration scores higher on the Intelligence Index"
        : intelligence.onCostFrontier
          ? "a cheaper configuration scores higher on the coding-agent chart"
          : "cheaper configurations score higher on both charts";
  const dek = codingScore === undefined || intelligenceScore === undefined
    ? "Grok 4.7 appears on the AI Charts coding-agent chart and the Intelligence Index chart as two different measurements. This note states what each score measures and where the evidence stops."
    : `On the ${formatLongUtcDate(codingSnapshot.source.retrievedAt)} snapshots, Grok Build · Grok 4.7 (xhigh) scores ${codingScore} on the coding-agent AA Index and Grok 4.7 (xhigh) scores ${intelligenceScore} on the Intelligence Index. Different harnesses, task sets, and costs sit behind the two numbers, and ${frontierPhrase}.`;
  const seoDescription = codingScore === undefined || intelligenceScore === undefined
    ? "Grok 4.7 appears on the AI Charts coding-agent chart and the Intelligence Index chart. See what each score measures and where the evidence stops."
    : `Grok 4.7 scores ${codingScore} on the AI Charts coding-agent AA Index with Grok Build and ${intelligenceScore} on the Intelligence Index. See what each measures and where each sits on cost.`;

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: GROK_47_ARTICLE_SLUG,
    title,
    dek,
    focusPhrase: "Grok 4.7 coding agent AA Index",
    seoDescription,
    keywords: [
      "Grok 4.7",
      "Grok Build",
      "xAI",
      "AA Index",
      "coding agent benchmark",
      "Artificial Analysis Intelligence Index",
      "Terminal-Bench 4",
      "DeepSWE v1.1",
    ],
    publishedAt: GROK_47_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "AI model benchmarks",
    sourceIds: [
      "artificialAnalysisCodingAgents",
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisGrok47",
      "artificialAnalysisGrok47Model",
      "xaiGrok47Announcement",
    ],
    relatedSlugs: [
      "aa-index-cost-coding-agents",
      "mimo-v2-6-pro-cost-frontier",
    ],
    nextStep: {
      title: "Compare Grok 4.7 on both charts",
      description:
        "The coding-agent chart plots every model, harness, and setting configuration in the current snapshot with its cost frontier. The capability and cost chart plots the comparable Intelligence Index cohort. The model page collects Grok 4.7’s rows from both.",
      links: [
        { href: "/coding", label: "Coding-agent chart" },
        { href: "/#intelligence-index", label: "Capability and cost chart" },
        { href: "/models/xai/grok-4-7/index", label: "Grok 4.7 model page" },
      ],
    },
    body: [
      paragraph(
        "xAI, which its own launch page and Artificial Analysis now call ",
        GROK_47.xai.listedAs,
        ", ",
        { href: BLOG_SOURCES.xaiGrok47Announcement.url, text: "announced Grok 4.7" },
        " on ",
        GROK_47.xai.announcedOn,
        " as “",
        GROK_47.xai.capabilityClaim,
        ",” priced at ",
        GROK_47.xai.inputPrice,
        " per million input tokens and ",
        GROK_47.xai.outputPrice,
        " per million output tokens, and available the same day in ",
        GROK_47.xai.availability,
        ", its own coding agent. Artificial Analysis published its independent measurements the same day, and AI Charts now stores Grok 4.7 in two checked snapshots: the coding-agent chart and the Intelligence Index chart.",
      ),
      paragraph(
        "This note answers three questions from those snapshots: where each Grok 4.7 row lands, what each score and cost measures, and where the evidence stops. Every score, cost, rank, and frontier statement below is derived from the snapshot named in its caption or from Artificial Analysis’s published pages. xAI’s own benchmark table is described in its own section and is not charted.",
      ),
      heading("Two charts, two measurements"),
      paragraph(
        "The ",
        { href: "/coding", text: "coding-agent chart" },
        " is a checked snapshot of the public ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents comparison" },
        `. Each row is one configuration: a model, the agent harness that ran it, and an effort setting, scored on ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas}. AA Index is the composite of those three, and cost is the mean API cost of one task in that harness. Grok 4.7’s row is Grok Build · Grok 4.7 at the xhigh setting, with Grok Build being xAI’s first-party coding agent.`,
      ),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.artificialAnalysisIntelligenceIndex.url, text: "Artificial Analysis Intelligence Index" },
        ` measures a model behind an API under one standardized harness across ${spellCount(intelligenceSnapshot.benchmark.evaluationCount)} evaluations, weighted ${weights.agents}% agents, ${weights.coding}% coding, ${weights.scientific}% scientific reasoning, and ${weights.general}% general capability, at version ${indexVersion}. Its Grok 4.7 row is Grok 4.7 (xhigh), the effort Artificial Analysis chose for its headline evaluation. Its launch note draws the boundary itself: “`,
        GROK_47.artificialAnalysis.separateHarnesses,
        "”",
      ),
      ...overviewBlocks(coding, intelligence, codingRetrievedAt, intelligenceRetrievedAt),
      heading("Where the coding-agent row lands"),
      ...codingPlacementBlocks(coding, codingSnapshot, codingRetrievedAt),
      heading("The index hides a split between its components"),
      ...componentBlocks(coding, codingRetrievedAt),
      heading("From Grok 4.6 to Grok 4.7 in the same harness"),
      ...generationBlocks(coding, codingRetrievedAt),
      heading("Where the Intelligence Index row lands"),
      ...intelligenceBlocks(intelligence, intelligenceRetrievedAt, indexVersion),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.artificialAnalysisGrok47Model.url, text: "Artificial Analysis model page" },
        ", captured ",
        GROK_47.artificialAnalysis.capturedOn,
        " UTC, lists the model as proprietary, released ",
        GROK_47.artificialAnalysis.releaseDate,
        ", with an index score of ",
        GROK_47.artificialAnalysis.intelligenceScore,
        ", a ",
        GROK_47.artificialAnalysis.contextWindow,
        " token context window, an output speed of ",
        GROK_47.artificialAnalysis.outputSpeed,
        " tokens per second on xAI’s API, and ",
        GROK_47.artificialAnalysis.indexOutputTokens,
        " output tokens generated to run the whole index, which the page calls very verbose for its class. The launch note puts the generation step at ",
        GROK_47.artificialAnalysis.intelligenceGain,
        " points over Grok 4.6, led by agentic knowledge-work tasks, with the other index tasks broadly matching Grok 4.6 (high).",
      ),
      heading("Two costs that are not one unit"),
      ...costBlocks(coding, intelligence, intelligenceSnapshot.benchmark.evaluationCount),
      heading("What xAI’s own table adds"),
      paragraph(
        "xAI’s launch page prints a vendor-run table for Grok 4.7 at xhigh against Grok 4.6, GPT-5.6 Sol, and Claude Fable 5.1 on ",
        GROK_47.xai.otherVendorBenchmarks,
        ", none of which appears on an AI Charts chart, plus its own runs of ",
        SNAPSHOT_COLUMN_LABELS.deepSwe,
        " (",
        GROK_47.xai.vendorDeepSwe,
        ", marked as ",
        GROK_47.xai.vendorDeepSweEffort,
        " effort) and Terminal-Bench 4.0 (",
        GROK_47.xai.vendorTerminalBench,
        "). Those figures come from xAI’s evaluation setup, not from Grok Build under Artificial Analysis’s protocol, and they do not match the Grok Build row in the snapshot. Read them as the vendor’s description of its model and read the charts for independent measurements of one named configuration.",
      ),
      heading("Limits"),
      list(
        [
          `Every score and cost in this note is an Artificial Analysis measurement of the named configuration on the retrieval date, under ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas} for the coding-agent chart and Intelligence Index version ${indexVersion} for the capability chart. Neither establishes results on other tasks, repositories, or harnesses.`,
        ],
        [
          "Ranks, frontier positions, dominators, neighbors, and generation multiples are AI Charts derivations from the snapshots named in each caption. They change when Artificial Analysis adds, removes, or rescores a configuration, and the checked snapshots advance daily.",
        ],
        [
          "The coding-agent row measures Grok 4.7 inside Grok Build. The same model in another harness, including Cursor, is a different configuration that this snapshot does not store.",
        ],
        [
          "The Grok 4.6 comparison holds the harness and setting fixed, but Artificial Analysis may have run the two generations weeks apart under evolving benchmark versions and prices; the snapshot records outcomes, not run dates.",
        ],
        [
          "xAI’s table, price statements, and capability claims belong to xAI. AI Charts did not run Grok 4.7 and did not verify the vendor figures.",
        ],
      ),
    ],
  };
}
