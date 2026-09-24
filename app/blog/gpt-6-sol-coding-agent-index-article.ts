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
  solCodingAgentPlacement,
  solIntelligencePlacement,
  type SolCodingAgentPlacement,
  type SolIntelligencePlacement,
} from "@/lib/gpt-6-sol-placement";
import { comparableTaskCost, formatCostMultiple, formatPointGap } from "@/lib/mimo-v2-6-pro-frontier";
import { formatFineCostMultiple, spellOrdinal } from "@/lib/snapshot-placement";

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
import {
  capitalize,
  configurationLabel,
  formatMillionTokens,
  formatMinutes,
  formatWholeTokens,
  joinNames,
  latestCalendarDate,
  pluralConfigurations,
  utcCalendarDate,
} from "./grok-4-7-coding-agent-index-article";
import { spellCount } from "./real-swe-private-enterprise-benchmark-article";

export const GPT_6_SOL_ARTICLE_SLUG = "gpt-6-sol-coding-agent-index" as const;
export const GPT_6_SOL_ARTICLE_PUBLISHED_AT = "2026-09-24" as const;

/** Quoted claims from the primary sources, kept verbatim so tests can check every quotation. */
export const GPT_6_SOL = {
  openAi: {
    announcedOn: "September 22, 2026",
    previousInputPrice: "$4",
    previousOutputPrice: "$20",
    inputPrice: "$2",
    outputPrice: "$10",
    priceCutClaim: "reducing API prices for Sol and Luna by 50% compared with their GPT‑5.6 promotional pricing",
    vendorDeepSwe: "68.8%",
    otherVendorBenchmarks: "FrontierCode 1.1 Main, AutomationBench 1.0.6, Agents’ Last Exam V1, and OSWorld 2.0",
    availability: "ChatGPT Work and Codex",
  },
  artificialAnalysis: {
    launchNoteOn: "September 22, 2026",
    capturedOn: "September 24, 2026",
    headline:
      "Intelligence Index and Coding Agent Index scores remain level with GPT-5.6, with progress in some evaluations and regressions in others",
    codingIndexScore: "57",
    codingIndexGain: "up 2 points from GPT-5.6 Sol (max)",
    codingComponentGains: "gains in Terminal-Bench 4.0 (43% vs 37%) and SWE-Atlas-QnA (58% vs 54%)",
    codingFrontierClaim: "sits on the Pareto frontier of Coding Agent Index vs Cost per Task",
    codingCostClaim: "At $2.99 per task it costs ~50% less than GPT-5.6 Sol (max)",
    indexCostClaim:
      "GPT-6 Sol (max) costs $1.06 per task to run the Artificial Analysis Intelligence Index, ~50% less than GPT-5.6 Sol (max) at $1.99",
    indexCostDriver: "This is driven by the price cut, as both models use slightly more output tokens per task",
    indexTokensClaim: "31k vs 29k for Sol",
    gdpvalRegression: "Sol drops ~100 Elo points",
    hallucinationClaim: "GPT-6 Sol (max) cuts its hallucination rate from 92% to 60%",
    attemptRateClaim: "it attempts 83% of questions vs 99% for GPT-5.6 Sol (max)",
    intelligenceScore: "48",
    inputPrice: "$2.00",
    outputPrice: "$10.00",
    cacheDiscount: "90%",
    outputSpeed: "115.9",
    indexOutputTokens: "77M",
    contextWindow: "872k",
    releaseDate: "September 22, 2026",
  },
} as const;

const CODING_CHART_LABEL = "Codex · GPT-6 Sol (max)" as const;
const INDEX_ROW_LABEL = "GPT-6 Sol (max)" as const;
const MAX_TITLE_LENGTH = 64;

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

function textCell(value: string): InlineContent {
  return [value];
}

function pointsPhrase(points: number): string {
  const magnitude = Math.abs(points).toFixed(1);
  return `${magnitude} ${magnitude === "1.0" ? "point" : "points"}`;
}

function changeCell(previous: number | null, current: number | null): string {
  if (previous === null || current === null) return "-";
  return `${formatPointGap(current - previous)} points`;
}

function multipleCell(previous: number | null, current: number | null): string {
  if (previous === null || previous <= 0 || current === null) return "-";
  return formatCostMultiple(current / previous);
}

function codingRowCells(record: CodingAgentRecord): InlineContent[] {
  return [
    textCell(record.seriesLabel),
    textCell(record.setting),
    textCell(formatSnapshotScore(record.benchmarks.aaIndex)),
    textCell(formatSnapshotCostUsd(record.economics.costUsd)),
  ];
}

function overviewBlocks(
  coding: SolCodingAgentPlacement | undefined,
  intelligence: SolIntelligencePlacement | undefined,
  codingRetrievedAt: string,
  intelligenceRetrievedAt: string,
): BlogBlock[] {
  if (coding === undefined || intelligence === undefined) {
    return [
      paragraph(
        coding === undefined
          ? `The coding-agent snapshot retrieved ${codingRetrievedAt} does not store a Codex · GPT-6 Sol row with an AA Index and a cost, so this note cannot place the coding-agent row. `
          : "",
        intelligence === undefined
          ? `The Intelligence Index snapshot retrieved ${intelligenceRetrievedAt} does not store a ${INDEX_ROW_LABEL} row with a positive cost per task, so this note cannot place the Intelligence Index row.`
          : "",
      ),
    ];
  }
  return [
    table(
      "GPT-6 Sol at max effort in the two AI Charts snapshots. Each score belongs to its own chart, task set, and cost definition.",
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
  placement: SolCodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `The coding-agent snapshot retrieved ${retrievedAt} does not store a Codex · GPT-6 Sol row with an AA Index and a cost, so this section has nothing to place.`,
      ),
    ];
  }
  const { cheapestHigher, dominators, higher, indexedCount, leader, neighbors, onCostFrontier, rank, record } = placement;
  const index = record.benchmarks.aaIndex;
  const cost = record.economics.costUsd;
  const blocks: BlogBlock[] = [
    paragraph(
      `${configurationLabel(record)} scores ${formatSnapshotScore(index)} on AA Index at a mean API cost of ${formatSnapshotCostUsd(cost)} per task in the snapshot retrieved ${retrievedAt}, ${spellOrdinal(rank)} of the ${indexedCount} configurations that carry an index. `,
      higher.length === 0
        ? "No configuration scores higher."
        : `${capitalize(pluralConfigurations(higher.length))} score${higher.length === 1 ? "s" : ""} higher: ${joinNames(higher.map(candidate => `${configurationLabel(candidate)} at ${formatSnapshotScore(candidate.benchmarks.aaIndex)}`))}. The leader, ${configurationLabel(leader)}, is ${pointsPhrase(leader.benchmarks.aaIndex - index)} above it at ${formatSnapshotCostUsd(leader.economics.costUsd)} per task.`,
    ),
  ];
  if (onCostFrontier) {
    blocks.push(paragraph(
      "The row is on the chart’s cost frontier: no configuration costs less per task and scores at least as high.",
      cheapestHigher === undefined
        ? ""
        : ` The cheapest configuration that scores higher, ${configurationLabel(cheapestHigher.record)}, scores ${formatSnapshotScore(cheapestHigher.record.benchmarks.aaIndex)} at ${formatSnapshotCostUsd(cheapestHigher.record.economics.costUsd)} per task, ${formatFineCostMultiple(cheapestHigher.multiple)} the cost.`,
    ));
  } else if (dominators.length >= 2) {
    blocks.push(
      paragraph(
        `The row is not on the chart’s cost frontier. ${capitalize(pluralConfigurations(dominators.length))} cost the same or less per task and score at least as high, so the chart draws its frontier past the GPT-6 Sol row. The table lists them cheapest first.`,
      ),
      table(
        `Configurations that cost no more than ${CODING_CHART_LABEL} and score at least as high on AA Index, in the snapshot retrieved ${retrievedAt}`,
        ["Configuration", "Setting", SNAPSHOT_COLUMN_LABELS.aaIndex, "Cost per task"],
        dominators.map(codingRowCells),
      ),
    );
  } else {
    blocks.push(paragraph(
      `The row is not on the chart’s cost frontier: ${joinNames(dominators.map(candidate => `${configurationLabel(candidate)} scores ${formatSnapshotScore(candidate.benchmarks.aaIndex)} at ${formatSnapshotCostUsd(candidate.economics.costUsd)} per task`))}, so the chart draws its frontier past the GPT-6 Sol row.`,
    ));
  }
  if (neighbors.length >= 2) {
    blocks.push(
      paragraph(
        `${capitalize(spellCount(neighbors.length))} other configurations score within one AA Index point of it. The table lists them cheapest first, with each cost as a multiple of its ${formatSnapshotCostUsd(cost)}.`,
      ),
      table(
        `Configurations within one AA Index point of ${CODING_CHART_LABEL} in the snapshot retrieved ${retrievedAt}`,
        ["Configuration", "Setting", SNAPSHOT_COLUMN_LABELS.aaIndex, "Cost per task", "Multiple of GPT-6 Sol’s cost"],
        neighbors.map(neighbor => [
          ...codingRowCells(neighbor),
          textCell(formatFineCostMultiple(neighbor.economics.costUsd / cost)),
        ]),
      ),
    );
  } else if (neighbors.length === 1) {
    const [neighbor] = neighbors;
    if (neighbor !== undefined) {
      const gap = index - neighbor.benchmarks.aaIndex;
      blocks.push(paragraph(
        `One other configuration scores within one AA Index point of it: ${configurationLabel(neighbor)} at ${formatSnapshotScore(neighbor.benchmarks.aaIndex)} for ${formatSnapshotCostUsd(neighbor.economics.costUsd)} per task, `,
        gap === 0
          ? "the same score"
          : `${pointsPhrase(gap)} ${gap > 0 ? "lower" : "higher"}`,
        ` at ${formatFineCostMultiple(neighbor.economics.costUsd / cost)} the cost.`,
      ));
    }
  } else {
    blocks.push(paragraph(
      "No other configuration scores within one AA Index point of it.",
    ));
  }
  blocks.push(paragraph(
    "Artificial Analysis’s ",
    { href: BLOG_SOURCES.artificialAnalysisGpt6Sol.url, text: "launch note" },
    " of ",
    GPT_6_SOL.artificialAnalysis.launchNoteOn,
    " reports the same row at ",
    GPT_6_SOL.artificialAnalysis.codingIndexScore,
    " and says it “",
    GPT_6_SOL.artificialAnalysis.codingFrontierClaim,
    ".” ",
    onCostFrontier
      ? "The snapshot agrees. "
      : "In this snapshot a cheaper row has since scored at least as high. ",
    "Rankings on this chart move whenever Artificial Analysis publishes a new configuration, and the chart counts every harness, including multi-model pairings.",
  ));
  return blocks;
}

function componentBlocks(
  placement: SolCodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `Without a Codex · GPT-6 Sol row in the snapshot retrieved ${retrievedAt}, this note cannot split the index into its components.`,
      ),
    ];
  }
  const { components, lowerIndexHigherTerminal, record } = placement;
  if (components.length === 0) {
    return [
      paragraph(
        `The Codex · GPT-6 Sol row in the snapshot retrieved ${retrievedAt} carries an AA Index but no component scores, so this note cannot split the index.`,
      ),
    ];
  }
  const parts = components.map(component => (
    `on ${SNAPSHOT_COLUMN_LABELS[component.metric]} it scores ${formatSnapshotScore(component.value)}, ${spellOrdinal(component.rank)} of ${component.count}`
  ));
  const summary = parts.length === 1
    ? parts.join("")
    : `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
  const ranks = components.map(component => component.rank);
  const spread = Math.max(...ranks) - Math.min(...ranks);
  const blocks: BlogBlock[] = [
    paragraph(
      "AA Index averages three component benchmarks, and GPT-6 Sol does not sit in the same place on each. ",
      capitalize(summary),
      " configurations that carry each score.",
      spread >= 2
        ? ` Its best and worst component ranks are ${spellCount(spread)} places apart.`
        : "",
    ),
  ];
  if (components.length >= 2) {
    blocks.push(table(
      `${CODING_CHART_LABEL} on each AA Index component in the snapshot retrieved ${retrievedAt}. Rank counts every configuration that carries the component.`,
      ["Component", "GPT-6 Sol score", "Rank", "Leader"],
      components.map(component => [
        textCell(SNAPSHOT_COLUMN_LABELS[component.metric]),
        textCell(formatSnapshotScore(component.value)),
        textCell(`${component.rank} of ${component.count}`),
        textCell(
          component.leader.id === record.id
            ? "GPT-6 Sol leads"
            : `${configurationLabel(component.leader)} at ${formatSnapshotScore(component.leader.benchmarks[component.metric])}`,
        ),
      ]),
    ));
  }
  if (record.benchmarks.terminalBench !== null) {
    blocks.push(paragraph(
      lowerIndexHigherTerminal.length === 0
        ? "No configuration with a lower AA Index scores higher on Terminal-Bench 4, so on this snapshot the composite and the terminal component order GPT-6 Sol the same way against the rows below it."
        : `${capitalize(pluralConfigurations(lowerIndexHigherTerminal.length))} with a lower AA Index score${lowerIndexHigherTerminal.length === 1 ? "s" : ""} higher on Terminal-Bench 4: ${joinNames(lowerIndexHigherTerminal.map(candidate => `${configurationLabel(candidate)} at ${formatSnapshotScore(candidate.benchmarks.terminalBench)}`))}. A reader who cares about terminal work would order these rows differently from the composite.`,
    ));
  }
  return blocks;
}

function generationBlocks(
  placement: SolCodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  const predecessor = placement?.predecessor;
  if (placement === undefined || predecessor === undefined) {
    return [
      paragraph(
        `The snapshot retrieved ${retrievedAt} does not store both Codex · GPT-5.6 Sol and Codex · GPT-6 Sol at the same setting, so this note cannot compare the two generations in one harness. Artificial Analysis’s launch note reports the step as “`,
        GPT_6_SOL.artificialAnalysis.codingIndexGain,
        "” on the Coding Agent Index.",
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
  const componentMoves = (["deepSwe", "terminalBench", "sweAtlas"] as const).flatMap((metric) => {
    const previous = predecessor.benchmarks[metric];
    const current = record.benchmarks[metric];
    if (previous === null || current === null || current === previous) return [];
    return [{ label: SNAPSHOT_COLUMN_LABELS[metric], points: current - previous }];
  });
  const rose = componentMoves.filter(move => move.points > 0);
  const fell = componentMoves.filter(move => move.points < 0);
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
        : `GPT-6 Sol ${gain >= 0 ? "adds" : "gives up"} ${pointsPhrase(gain)}`,
      costMultiple === null
        ? "."
        : ` at ${formatCostMultiple(costMultiple)} the mean cost per task`,
      tokenMultiple === null
        ? ""
        : ` and ${formatCostMultiple(tokenMultiple)} the total tokens per task`,
      ".",
      rose.length === 0 && fell.length === 0
        ? ""
        : ` ${joinNames(rose.map(move => `${move.label} rose ${pointsPhrase(move.points)}`))}${rose.length > 0 && fell.length > 0 ? ", while " : ""}${joinNames(fell.map(move => `${move.label} fell ${pointsPhrase(move.points)}`))}.`,
    ),
    table(
      `Codex · GPT-5.6 Sol and Codex · GPT-6 Sol at the ${record.setting} setting in the snapshot retrieved ${retrievedAt}`,
      ["Measure", "GPT-5.6 Sol", "GPT-6 Sol", "Change"],
      [
        metricRow(
          SNAPSHOT_COLUMN_LABELS.aaIndex,
          formatSnapshotScore(previousIndex),
          formatSnapshotScore(record.benchmarks.aaIndex),
          changeCell(previousIndex, record.benchmarks.aaIndex),
        ),
        metricRow(
          SNAPSHOT_COLUMN_LABELS.deepSwe,
          formatSnapshotScore(predecessor.benchmarks.deepSwe),
          formatSnapshotScore(record.benchmarks.deepSwe),
          changeCell(predecessor.benchmarks.deepSwe, record.benchmarks.deepSwe),
        ),
        metricRow(
          SNAPSHOT_COLUMN_LABELS.terminalBench,
          formatSnapshotScore(predecessor.benchmarks.terminalBench),
          formatSnapshotScore(record.benchmarks.terminalBench),
          changeCell(predecessor.benchmarks.terminalBench, record.benchmarks.terminalBench),
        ),
        metricRow(
          SNAPSHOT_COLUMN_LABELS.sweAtlas,
          formatSnapshotScore(predecessor.benchmarks.sweAtlas),
          formatSnapshotScore(record.benchmarks.sweAtlas),
          changeCell(predecessor.benchmarks.sweAtlas, record.benchmarks.sweAtlas),
        ),
        metricRow(
          "Mean API cost per task",
          formatSnapshotCostUsd(previousCost),
          formatSnapshotCostUsd(record.economics.costUsd),
          multipleCell(previousCost, record.economics.costUsd),
        ),
        metricRow(
          "Total tokens per task",
          formatMillionTokens(predecessor.usage.totalTokens),
          formatMillionTokens(record.usage.totalTokens),
          multipleCell(predecessor.usage.totalTokens, record.usage.totalTokens),
        ),
        metricRow(
          "Mean active time per task",
          formatMinutes(predecessor.economics.durationSeconds),
          formatMinutes(record.economics.durationSeconds),
          multipleCell(predecessor.economics.durationSeconds, record.economics.durationSeconds),
        ),
      ],
    ),
    paragraph(
      "OpenAI’s ",
      { href: BLOG_SOURCES.openAiGpt6SolLuna.url, text: "launch page" },
      " prices GPT-6 Sol at ",
      GPT_6_SOL.openAi.inputPrice,
      " per million input tokens and ",
      GPT_6_SOL.openAi.outputPrice,
      " per million output tokens, against ",
      GPT_6_SOL.openAi.previousInputPrice,
      " and ",
      GPT_6_SOL.openAi.previousOutputPrice,
      " for GPT-5.6 Sol, and describes the change as “",
      GPT_6_SOL.openAi.priceCutClaim,
      ".” ",
      tokenMultiple !== null && Math.abs(tokenMultiple - 1) <= 0.1
        ? "With total tokens per task within a tenth of the earlier row, the lower cost per task in the snapshot is the price cut, not a shorter run."
        : "The snapshot records both a price change and a change in tokens per task, so the cost step mixes the two.",
      " Artificial Analysis’s launch note reports the same step: “",
      GPT_6_SOL.artificialAnalysis.codingIndexGain,
      ", with ",
      GPT_6_SOL.artificialAnalysis.codingComponentGains,
      ",” and “",
      GPT_6_SOL.artificialAnalysis.codingCostClaim,
      ".”",
    ),
  ];
}

function intelligenceRowCells(record: ArtificialAnalysisIntelligenceRecord): InlineContent[] {
  return [
    textCell(record.name),
    textCell(formatSnapshotScore(record.intelligenceIndex)),
    textCell(formatSnapshotCostUsd(comparableTaskCost(record))),
  ];
}

function intelligenceBlocks(
  placement: SolIntelligencePlacement | undefined,
  retrievedAt: string,
  indexVersion: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `The Intelligence Index snapshot retrieved ${retrievedAt} does not store a ${INDEX_ROW_LABEL} row with a positive cost per task, so this note cannot place the model on the capability and cost chart.`,
      ),
    ];
  }
  const { cheapestHigher, cohortSize, dominators, effortLadder, leader, neighbors, onCostFrontier, rank, record } = placement;
  const cost = comparableTaskCost(record);
  const blocks: BlogBlock[] = [
    paragraph(
      `${record.name} scores ${formatSnapshotScore(record.intelligenceIndex)} on the Intelligence Index at ${formatSnapshotCostUsd(cost)} per task in the snapshot retrieved ${retrievedAt}, with ${formatWholeTokens(record.outputTokensPerTask.total)} output tokens per task under index version ${indexVersion}. That is ${spellOrdinal(rank)} of the ${cohortSize} comparable configurations and ${pointsPhrase(leader.intelligenceIndex - record.intelligenceIndex)} below the leader, ${leader.name} at ${formatSnapshotScore(leader.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(leader))}.`,
    ),
  ];
  if (onCostFrontier) {
    blocks.push(paragraph(
      "The row is on this chart’s cost frontier as well: no comparable configuration scores higher at the same or lower cost per task.",
      cheapestHigher === undefined
        ? " No configuration scores higher."
        : ` The cheapest configuration that scores higher, ${cheapestHigher.record.name}, scores ${formatSnapshotScore(cheapestHigher.record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(cheapestHigher.record))}, ${formatFineCostMultiple(cheapestHigher.multiple)} the cost.`,
    ));
  } else {
    blocks.push(paragraph(
      `The row is not on this chart’s cost frontier: ${pluralConfigurations(dominators.length)} score${dominators.length === 1 ? "s" : ""} at least as high at the same or lower cost per task.`,
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
        ["Configuration", "Intelligence Index", "Cost per task", "Multiple of GPT-6 Sol’s cost", "Output tokens per task"],
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
  if (effortLadder.length >= 2) {
    const cheapest = effortLadder[0];
    const costliest = effortLadder[effortLadder.length - 1];
    blocks.push(
      paragraph(
        `The snapshot stores ${spellCount(effortLadder.length)} comparable GPT-6 Sol rows, one per reasoning setting. `,
        cheapest === undefined || costliest === undefined
          ? ""
          : `From ${cheapest.record.name} to ${costliest.record.name}, the score moves from ${formatSnapshotScore(cheapest.record.intelligenceIndex)} to ${formatSnapshotScore(costliest.record.intelligenceIndex)} index points and the cost per task from ${formatSnapshotCostUsd(comparableTaskCost(cheapest.record))} to ${formatSnapshotCostUsd(comparableTaskCost(costliest.record))}. The table lists the rows cheapest first and states what each step buys over the row above it.`,
      ),
      table(
        `Comparable GPT-6 Sol rows by effort level in the snapshot retrieved ${retrievedAt}, cheapest first`,
        ["Configuration", "Intelligence Index", "Cost per task", "Output tokens per task", "Points over the cheaper row", "Cost multiple of the cheaper row"],
        effortLadder.map(step => [
          ...intelligenceRowCells(step.record),
          textCell(formatWholeTokens(step.record.outputTokensPerTask.total)),
          textCell(step.pointsOverCheaper === null ? "-" : formatPointGap(step.pointsOverCheaper)),
          textCell(step.costMultipleOverCheaper === null ? "-" : formatFineCostMultiple(step.costMultipleOverCheaper)),
        ]),
      ),
    );
  } else {
    blocks.push(paragraph(
      `The snapshot stores no other comparable GPT-6 Sol effort level, so this note cannot show what a lower effort setting gives up.`,
    ));
  }
  return blocks;
}

function costBlocks(
  coding: SolCodingAgentPlacement | undefined,
  intelligence: SolIntelligencePlacement | undefined,
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
      `The two snapshots print two costs for the same model at the same effort setting: ${codingCost} per task on the coding-agent chart and ${indexCost} per task on the Intelligence Index. Both are evaluation averages at list prices, and Artificial Analysis records the same prices behind both, ${GPT_6_SOL.artificialAnalysis.inputPrice} per million input tokens and ${GPT_6_SOL.artificialAnalysis.outputPrice} per million output tokens with a ${GPT_6_SOL.artificialAnalysis.cacheDiscount} cache discount. What differs is the task each average covers.`,
    ),
    paragraph(
      `The coding-agent figure is the mean API cost of one task in Codex across the three coding benchmarks, including every tool call and repeated context the harness sends: ${formatMillionTokens(coding.record.usage.totalTokens)} total tokens per task in this snapshot. The Intelligence Index figure is a weighted average across ${spellCount(evaluationCount)} evaluations under a standardized harness, with ${formatWholeTokens(intelligence.record.outputTokensPerTask.total)} output tokens per task.`,
    ),
    callout(
      "How to compare the two costs",
      `Compare ${codingCost} with other rows on the coding-agent chart and ${indexCost} with other rows on the Intelligence Index chart. The two figures measure different tasks under different harnesses, and neither is the cost of running GPT-6 Sol on your own work.`,
    ),
  ];
}

function derivedTitle(codingScore: string | undefined, codingCost: string | undefined): string {
  if (codingScore === undefined) return "GPT-6 Sol on the AI Charts snapshots";
  const withCost = codingCost === undefined
    ? undefined
    : `GPT-6 Sol scores ${codingScore} on the coding-agent chart at ${codingCost} a task`;
  if (withCost !== undefined && withCost.length <= MAX_TITLE_LENGTH) return withCost;
  return `GPT-6 Sol scores ${codingScore} on the coding-agent AA Index`;
}

export function createGpt6SolArticle(
  codingSnapshot: CodingAgentSnapshot = checkedCodingSnapshot(),
  intelligenceSnapshot: ArtificialAnalysisIntelligenceV43Snapshot = checkedIntelligenceSnapshot(),
): BlogArticle {
  const codingRetrievedAt = formatRetrievedAt(codingSnapshot.source.retrievedAt);
  const intelligenceRetrievedAt = formatRetrievedAt(intelligenceSnapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    GPT_6_SOL_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(codingSnapshot.source.retrievedAt),
    utcCalendarDate(intelligenceSnapshot.source.retrievedAt),
  );
  const coding = solCodingAgentPlacement(codingSnapshot.records);
  const intelligence = solIntelligencePlacement(intelligenceSnapshot.records);
  const indexVersion = intelligenceSnapshot.benchmark.version;
  const weights = intelligenceSnapshot.benchmark.categoryWeightsPercent;

  const codingScore = coding === undefined ? undefined : formatSnapshotScore(coding.record.benchmarks.aaIndex);
  const codingCost = coding === undefined ? undefined : formatSnapshotCostUsd(coding.record.economics.costUsd);
  const intelligenceScore = intelligence === undefined
    ? undefined
    : formatSnapshotScore(intelligence.record.intelligenceIndex);
  const intelligenceCost = intelligence === undefined
    ? undefined
    : formatSnapshotCostUsd(comparableTaskCost(intelligence.record));
  const title = derivedTitle(codingScore, codingCost);
  const frontierPhrase = coding === undefined || intelligence === undefined
    ? ""
    : coding.onCostFrontier && intelligence.onCostFrontier
      ? "Both rows sit on their chart’s cost frontier."
      : coding.onCostFrontier
        ? "The coding-agent row sits on its chart’s cost frontier; on the Intelligence Index a cheaper configuration scores at least as high."
        : intelligence.onCostFrontier
          ? "The Intelligence Index row sits on its chart’s cost frontier; on the coding-agent chart a cheaper configuration scores at least as high."
          : "On both charts a cheaper configuration scores at least as high.";
  const dek = coding === undefined || intelligence === undefined || codingScore === undefined || intelligenceScore === undefined
    ? "GPT-6 Sol appears on the AI Charts coding-agent chart and the Intelligence Index chart as two different measurements. This note states what each score measures and where the evidence stops."
    : `Codex · GPT-6 Sol (max) scores ${codingScore} on the coding-agent AA Index at ${codingCost} per task, ${spellOrdinal(coding.rank)} of ${coding.indexedCount} configurations, and GPT-6 Sol (max) scores ${intelligenceScore} on the Intelligence Index at ${intelligenceCost} per task. ${frontierPhrase}`;
  const seoDescription = codingScore === undefined || intelligenceScore === undefined
    ? "GPT-6 Sol appears on the AI Charts coding-agent chart and the Intelligence Index chart. See what each score measures and where the evidence stops."
    : `GPT-6 Sol scores ${codingScore} on the AI Charts coding-agent AA Index in Codex at ${codingCost} per task and ${intelligenceScore} on the Intelligence Index at ${intelligenceCost}. See what each measures.`;
  const openingPlacement = coding === undefined
    ? "Artificial Analysis measured it the same day, and AI Charts stores GPT-6 Sol in two snapshots: the coding-agent chart and the Intelligence Index chart."
    : `Artificial Analysis measured it the same day. In the coding-agent snapshot retrieved ${codingRetrievedAt}, ${configurationLabel(coding.record)} scores ${codingScore} on AA Index at a mean API cost of ${codingCost} per task, ${spellOrdinal(coding.rank)} of ${coding.indexedCount} configurations${coding.onCostFrontier ? " and on the chart’s cost frontier" : ""}.`;
  const openingIndex = intelligence === undefined
    ? ""
    : ` In the Intelligence Index snapshot retrieved ${intelligenceRetrievedAt}, ${intelligence.record.name} scores ${intelligenceScore} at ${intelligenceCost} per task, ${spellOrdinal(intelligence.rank)} of ${intelligence.cohortSize} comparable configurations${intelligence.onCostFrontier ? " and on that chart’s cost frontier" : ""}.`;

  const codingHeading = coding === undefined
    ? "On the coding-agent chart"
    : `On the coding-agent chart, ${spellOrdinal(coding.rank)} of ${coding.indexedCount} rows`;
  const intelligenceHeading = intelligence === undefined
    ? "On the Intelligence Index"
    : `On the Intelligence Index, ${spellOrdinal(intelligence.rank)} of ${intelligence.cohortSize} comparable rows`;

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: GPT_6_SOL_ARTICLE_SLUG,
    title,
    dek,
    focusPhrase: "GPT-6 Sol coding agent AA Index",
    seoDescription,
    keywords: [
      "GPT-6 Sol",
      "Codex",
      "OpenAI",
      "AA Index",
      "coding agent benchmark",
      "Artificial Analysis Intelligence Index",
      "Terminal-Bench 4",
      "DeepSWE v1.1",
      "cost per task",
    ],
    publishedAt: GPT_6_SOL_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "AI model benchmarks",
    sourceIds: [
      "artificialAnalysisCodingAgents",
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisGpt6Sol",
      "artificialAnalysisGpt6SolModel",
      "openAiGpt6SolLuna",
    ],
    relatedSlugs: [
      "grok-4-7-coding-agent-index",
      "aa-index-cost-coding-agents",
    ],
    nextStep: {
      title: "Compare GPT-6 Sol on both charts",
      description:
        "The coding-agent chart plots every model, harness, and setting configuration in the current snapshot with its cost frontier. The capability and cost chart plots the comparable Intelligence Index cohort. The model page collects GPT-6 Sol’s rows from both.",
      links: [
        { href: "/coding", label: "Coding-agent chart" },
        { href: "/#intelligence-index", label: "Capability and cost chart" },
        { href: "/models/openai/gpt-6-sol/index", label: "GPT-6 Sol model page" },
      ],
    },
    body: [
      paragraph(
        "OpenAI ",
        { href: BLOG_SOURCES.openAiGpt6SolLuna.url, text: "released GPT-6 Sol" },
        " on ",
        GPT_6_SOL.openAi.announcedOn,
        " in ",
        GPT_6_SOL.openAi.availability,
        ", at half the list price of GPT-5.6 Sol. ",
        openingPlacement,
        openingIndex,
      ),
      heading("One model, two charts"),
      paragraph(
        "The ",
        { href: "/coding", text: "coding-agent chart" },
        " is a daily snapshot of the public ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents comparison" },
        `. Each row is one configuration: a model, the agent harness that ran it, and an effort setting, scored on ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas}. AA Index is the composite of those three, and cost is the mean API cost of one task in that harness. GPT-6 Sol’s row is Codex · GPT-6 Sol at the max setting, with Codex being OpenAI’s own coding agent.`,
      ),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.artificialAnalysisIntelligenceIndex.url, text: "Artificial Analysis Intelligence Index" },
        ` measures a model behind an API under one standardized harness across ${spellCount(intelligenceSnapshot.benchmark.evaluationCount)} evaluations, weighted ${weights.agents}% agents, ${weights.coding}% coding, ${weights.scientific}% scientific reasoning, and ${weights.general}% general capability, at version ${indexVersion}. Its headline GPT-6 Sol row is GPT-6 Sol (max), the same effort setting as the coding-agent row, and the snapshot also stores the model’s lower effort levels as separate rows.`,
      ),
      ...overviewBlocks(coding, intelligence, codingRetrievedAt, intelligenceRetrievedAt),
      heading(codingHeading),
      ...codingPlacementBlocks(coding, codingRetrievedAt),
      heading("From GPT-5.6 Sol to GPT-6 Sol in Codex"),
      ...generationBlocks(coding, codingRetrievedAt),
      heading("Three components, three different ranks"),
      ...componentBlocks(coding, codingRetrievedAt),
      heading(intelligenceHeading),
      ...intelligenceBlocks(intelligence, intelligenceRetrievedAt, indexVersion),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.artificialAnalysisGpt6SolModel.url, text: "Artificial Analysis model page" },
        ", captured ",
        GPT_6_SOL.artificialAnalysis.capturedOn,
        " UTC, lists the model as proprietary, released ",
        GPT_6_SOL.artificialAnalysis.releaseDate,
        ", with an index score of ",
        GPT_6_SOL.artificialAnalysis.intelligenceScore,
        ", an ",
        GPT_6_SOL.artificialAnalysis.contextWindow,
        " token context window, an output speed of ",
        GPT_6_SOL.artificialAnalysis.outputSpeed,
        " tokens per second on OpenAI’s API, and ",
        GPT_6_SOL.artificialAnalysis.indexOutputTokens,
        " output tokens generated to run the whole index.",
      ),
      paragraph(
        "The launch note’s headline puts the generation step this way: “",
        GPT_6_SOL.artificialAnalysis.headline,
        ".” It reports that “",
        GPT_6_SOL.artificialAnalysis.indexCostClaim,
        ",” and adds: “",
        GPT_6_SOL.artificialAnalysis.indexCostDriver,
        "” (“",
        GPT_6_SOL.artificialAnalysis.indexTokensClaim,
        "”). Inside the index it records a knowledge-work regression, GDPval-AA v2.1, where “",
        GPT_6_SOL.artificialAnalysis.gdpvalRegression,
        ",” and a change in answering behavior on AA-Omniscience: “",
        GPT_6_SOL.artificialAnalysis.hallucinationClaim,
        "” because “",
        GPT_6_SOL.artificialAnalysis.attemptRateClaim,
        ".” The Intelligence Index snapshot does not store a GPT-5.6 Sol row, so the generation comparison on this chart rests on Artificial Analysis’s note alone.",
      ),
      heading("Two costs for one model"),
      ...costBlocks(coding, intelligence, intelligenceSnapshot.benchmark.evaluationCount),
      heading("OpenAI’s own figures"),
      paragraph(
        "OpenAI’s launch page reports its own run of ",
        SNAPSHOT_COLUMN_LABELS.deepSwe,
        " at ",
        GPT_6_SOL.openAi.vendorDeepSwe,
        " for GPT-6 Sol at max effort, plus vendor-run results on ",
        GPT_6_SOL.openAi.otherVendorBenchmarks,
        ", none of which appears on an AI Charts chart. Those figures come from OpenAI’s evaluation setup, not from Codex under Artificial Analysis’s protocol, and OpenAI states that competitor figures in its tables were taken from public reports. Read them as the vendor’s description of its model and read the charts for independent measurements of one named configuration.",
      ),
      heading("Limits"),
      list(
        [
          `Every score and cost in this note is an Artificial Analysis measurement of the named configuration on the retrieval date, under ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas} for the coding-agent chart and Intelligence Index version ${indexVersion} for the capability chart. Neither establishes results on other tasks, repositories, or harnesses.`,
        ],
        [
          "Ranks, frontier positions, neighbors, component ranks, and generation multiples are AI Charts derivations from the snapshots named in each caption. They change when Artificial Analysis adds, removes, or rescores a configuration, and the checked snapshots advance daily.",
        ],
        [
          "The coding-agent row measures GPT-6 Sol inside Codex at the max setting. The same model in another harness or at another effort level is a different configuration that this snapshot does not store.",
        ],
        [
          "The GPT-5.6 Sol comparison holds the harness and setting fixed, but Artificial Analysis may have run the two generations weeks apart under evolving benchmark versions; the snapshot records outcomes, not run dates.",
        ],
        [
          "OpenAI’s prices, availability, and benchmark figures belong to OpenAI. AI Charts did not run GPT-6 Sol and did not verify the vendor figures.",
        ],
      ),
    ],
  };
}
