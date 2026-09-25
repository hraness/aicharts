import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";
import type { ArtificialAnalysisIntelligenceRecord } from "@/lib/artificial-analysis-intelligence-data";
import {
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "@/lib/artificial-analysis-intelligence-v4-3-data";
import {
  inputCostShare,
  opus5CodingAgentPlacement,
  opus5IntelligenceRows,
  opus55CodingAgentRows,
  opusIntelligencePlacement,
  reasoningShare,
  taskCostBreakdown,
  type OpusIntelligencePlacement,
} from "@/lib/claude-opus-5-5-placement";
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
import { comparableTaskCost, formatPointGap } from "@/lib/mimo-v2-6-pro-frontier";
import {
  formatFineCostMultiple,
  spellOrdinal,
  type CodingAgentPlacement,
  type EffortStep,
} from "@/lib/snapshot-placement";

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
  formatLongUtcDate,
  formatWholeTokens,
  joinNames,
  latestCalendarDate,
  pluralConfigurations,
  utcCalendarDate,
} from "./grok-4-7-coding-agent-index-article";
import { spellCount } from "./real-swe-private-enterprise-benchmark-article";

export const OPUS_55_ARTICLE_SLUG = "opus-5-5-intelligence-index" as const;
export const OPUS_55_ARTICLE_PUBLISHED_AT = "2026-09-25" as const;

/** Quoted claims from the primary sources, kept verbatim so tests can check every quotation. */
export const CLAUDE_OPUS_55 = {
  anthropic: {
    announcedOn: "September 22, 2026",
    headlineClaim:
      "It performs at the level of Claude Fable 5.1 on most work and costs 40% less to run than Opus 5",
    priceClaim: "Input and output tokens are $4 and $20 per million, 20% less than Opus 5",
    cacheReadClaim:
      "Cache reads (which make up the majority of agentic and coding work costs) are $0.20 per million tokens, 60% less than Opus 5",
    inputPrice: "$4",
    outputPrice: "$20",
    cacheReadPrice: "$0.20",
    opus5InputPrice: "$5",
    opus5OutputPrice: "$25",
    defaultEffort: "medium",
    benchmarkSettingClaim: "Unless otherwise noted, all Claude Opus 5.5 results use adaptive thinking at max effort",
    marginClaim:
      "at these levels of capability we’ve found that benchmark margins have become a less reliable guide to real-world differences",
    vendorTerminalBench: "66.4%",
    vendorTerminalBenchEffort: "xhigh",
    otherVendorBenchmarks:
      "FrontierCode v1.1 (Main), CursorBench 4.0, GDPval-AA v2.1, AutomationBench, Humanity’s Last Exam, Terminal-Bench-Science 0.1, OSWorld 2.0, and Chartography",
    safeguardFallbackClaim:
      "Opus 5.5 is the first Opus model to launch with a similar class of safeguards to Fable 5.1 on cybersecurity, biology, and distillation, all of which fall back to another model transparently",
    modelId: "claude-opus-5-5",
  },
  artificialAnalysis: {
    capturedOn: "September 25, 2026",
    intelligenceScore: "58",
    inputPrice: "$4.00",
    outputPrice: "$20.00",
    cacheDiscount: "95%",
    costPerTask: "$5.98",
    indexOutputTokens: "260M",
    contextWindow: "1M",
    releaseDate: "September 22, 2026",
    summaryClaim:
      "amongst the leading models in intelligence, but somewhat expensive when comparing to other models of similar price",
    verbosityClaim: "very verbose in comparison to the median of 88M",
  },
} as const;

const MODEL_NAME = "Claude Opus 5.5" as const;
const CODING_ROW_LABEL = "Claude Code · Opus 5 (max)" as const;
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

/** Whole-number percent for a share in the closed unit interval. */
export function formatSharePercent(share: number): string {
  if (!Number.isFinite(share) || share < 0 || share > 1) {
    throw new RangeError(`Shares must lie in the unit interval: ${share}`);
  }
  return `${Math.round(share * 100)}%`;
}

/** The effort label a row carries, or its full name when it has no effort level. */
export function effortLabel(record: ArtificialAnalysisIntelligenceRecord): string {
  return record.effort?.label ?? record.name;
}

/** “97 comparable configurations”, with the noun agreeing with the count. */
function comparableCount(count: number): string {
  return `${count} comparable configuration${count === 1 ? "" : "s"}`;
}

function scoreAndCost(record: ArtificialAnalysisIntelligenceRecord): string {
  return `${formatSnapshotScore(record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(record))} per task`;
}

function rankBlocks(
  placement: OpusIntelligencePlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `The Intelligence Index snapshot retrieved ${retrievedAt} does not store a ${MODEL_NAME} max-effort row with a positive cost per task, so this note cannot rank the model or place it on the cost frontier.`,
      ),
    ];
  }
  const { cheapestHigher, closestBelow, cohortSize, dominators, firstOtherFrontier, frontierRun, leader, neighbors, onCostFrontier, rank, record } = placement;
  const score = formatSnapshotScore(record.intelligenceIndex);
  const cost = comparableTaskCost(record);
  const blocks: BlogBlock[] = [
    paragraph(
      `The ${score} places ${record.name} ${spellOrdinal(rank)} of the ${comparableCount(cohortSize)} in the snapshot retrieved ${retrievedAt}. `,
      rank === 1
        ? "No configuration scores higher. "
        : `${capitalize(pluralConfigurations(rank - 1))} score${rank - 1 === 1 ? "s" : ""} higher; the leader, ${leader.name}, is ${pointsPhrase(leader.intelligenceIndex - record.intelligenceIndex)} above it at ${formatSnapshotCostUsd(comparableTaskCost(leader))} per task. `,
      onCostFrontier
        ? "The row is on the chart’s cost frontier: no comparable configuration scores at least as high at the same or lower cost per task."
        : `The row is not on the chart’s cost frontier: ${pluralConfigurations(dominators.length)} score${dominators.length === 1 ? "s" : ""} at least as high at the same or lower cost per task.`,
      cheapestHigher === undefined
        ? ""
        : ` The cheapest configuration that scores higher, ${cheapestHigher.record.name}, scores ${formatSnapshotScore(cheapestHigher.record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(cheapestHigher.record))}, ${formatFineCostMultiple(cheapestHigher.multiple)} the cost.`,
    ),
  ];
  if (neighbors.length === 0) {
    blocks.push(paragraph(
      `No other configuration scores within one index point of it.`,
      closestBelow[0] === undefined
        ? ""
        : ` The nearest score below is ${closestBelow[0].record.name} at ${formatSnapshotScore(closestBelow[0].record.intelligenceIndex)}, ${pointsPhrase(closestBelow[0].gapPoints)} lower for ${formatFineCostMultiple(closestBelow[0].costMultiple)} the cost per task.`,
    ));
  } else {
    blocks.push(paragraph(
      `${capitalize(pluralConfigurations(neighbors.length))} score${neighbors.length === 1 ? "s" : ""} within one index point of it: ${joinNames(neighbors.map(neighbor => `${neighbor.name} at ${scoreAndCost(neighbor)}`))}.`,
    ));
  }
  if (closestBelow.length >= 2) {
    const sameRelease = closestBelow.filter(entry => entry.record.release.slug === record.release.slug);
    const firstOtherModel = closestBelow.find(entry => entry.record.release.slug !== record.release.slug);
    blocks.push(
      paragraph(
        `The table lists the ${spellCount(closestBelow.length)} highest-scoring configurations after it, with each cost as a multiple of its ${formatSnapshotCostUsd(cost)}. `,
        sameRelease.length === 0
          ? ""
          : `${capitalize(spellCount(sameRelease.length))} of the ${spellCount(closestBelow.length)} ${sameRelease.length === 1 ? "is" : "are"} ${MODEL_NAME} at a lower effort level. `,
        firstOtherModel === undefined
          ? `Every one of them is ${MODEL_NAME} at a lower effort level.`
          : `The highest-scoring configuration from another model is ${firstOtherModel.record.name} at ${formatSnapshotScore(firstOtherModel.record.intelligenceIndex)}, ${pointsPhrase(firstOtherModel.gapPoints)} below at ${formatFineCostMultiple(firstOtherModel.costMultiple)} the cost per task.`,
      ),
      table(
        `The ${spellCount(closestBelow.length)} highest-scoring comparable configurations after ${record.name} in the snapshot retrieved ${retrievedAt}`,
        ["Configuration", "Intelligence Index", "Cost per task", `Points below ${MODEL_NAME} (max)`, "Multiple of its cost"],
        closestBelow.map(entry => [
          textCell(entry.record.name),
          textCell(formatSnapshotScore(entry.record.intelligenceIndex)),
          textCell(formatSnapshotCostUsd(comparableTaskCost(entry.record))),
          textCell(pointsPhrase(entry.gapPoints)),
          textCell(formatFineCostMultiple(entry.costMultiple)),
        ]),
      ),
    );
  }
  if (frontierRun.length === 0) {
    blocks.push(paragraph(
      firstOtherFrontier === undefined
        ? "The snapshot draws no cost frontier this note can walk."
        : `The highest-scoring point on the cost frontier belongs to another model, ${firstOtherFrontier.name} at ${scoreAndCost(firstOtherFrontier)}.`,
    ));
  } else {
    blocks.push(paragraph(
      `Walking the cost frontier down from its highest-scoring point, the first ${frontierRun.length === 1 ? `point is a ${MODEL_NAME} row` : `${spellCount(frontierRun.length)} points are ${MODEL_NAME} rows`}: ${joinNames(frontierRun.map(effortLabel))}. `,
      firstOtherFrontier === undefined
        ? `No configuration from another model is on the frontier.`
        : `The first frontier point from another model is ${firstOtherFrontier.name} at ${scoreAndCost(firstOtherFrontier)}, so every frontier point that costs more than ${formatSnapshotCostUsd(comparableTaskCost(firstOtherFrontier))} per task is a ${MODEL_NAME} row.`,
    ));
  }
  return blocks;
}

function ladderRow(step: EffortStep): InlineContent[] {
  return [
    textCell(effortLabel(step.record)),
    textCell(formatSnapshotScore(step.record.intelligenceIndex)),
    textCell(formatSnapshotCostUsd(comparableTaskCost(step.record))),
    textCell(formatWholeTokens(step.record.outputTokensPerTask.total)),
    textCell(formatSharePercent(reasoningShare(step.record))),
    textCell(step.pointsOverCheaper === null ? "-" : formatPointGap(step.pointsOverCheaper)),
    textCell(step.costMultipleOverCheaper === null ? "-" : formatFineCostMultiple(step.costMultipleOverCheaper)),
  ];
}

function releaseDatePhrase(ladder: readonly EffortStep[]): string {
  const byDate = new Map<string, string[]>();
  for (const step of ladder) {
    const labels = byDate.get(step.record.releaseDate) ?? [];
    labels.push(effortLabel(step.record));
    byDate.set(step.record.releaseDate, labels);
  }
  const groups = [...byDate.entries()].toSorted(([left], [right]) => right.localeCompare(left));
  if (groups.length === 1) {
    const [only] = groups;
    return only === undefined ? "" : `The snapshot dates every level ${formatLongUtcDate(only[0])}.`;
  }
  return `The snapshot dates ${joinNames(groups.map(([date, labels]) => (
    `the ${joinNames(labels)} ${labels.length === 1 ? "row" : "rows"} ${formatLongUtcDate(date)}`
  )))}.`;
}

function ladderBlocks(
  placement: OpusIntelligencePlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `Without a ${MODEL_NAME} max-effort row in the snapshot retrieved ${retrievedAt}, this note cannot tabulate the model’s effort levels.`,
      ),
    ];
  }
  const { effortLadder, otherModes, record } = placement;
  if (effortLadder.length < 2) {
    return [
      paragraph(
        `The snapshot stores no other comparable ${MODEL_NAME} effort level, so this note cannot show what a lower effort setting gives up.`,
        otherModes.length === 0
          ? ""
          : ` It does store ${joinNames(otherModes.map(mode => `${mode.name} at ${scoreAndCost(mode)}`))}, a different mode rather than an effort level.`,
      ),
    ];
  }
  const cheapest = effortLadder[0];
  const costliest = effortLadder[effortLadder.length - 1];
  const steps = effortLadder.filter(step => step.pointsOverCheaper !== null && step.costMultipleOverCheaper !== null);
  const largest = steps.toSorted((left, right) => (right.pointsOverCheaper ?? 0) - (left.pointsOverCheaper ?? 0))[0];
  const last = steps[steps.length - 1];
  const lastCheaper = effortLadder[effortLadder.length - 2];
  const shares = effortLadder.map(step => reasoningShare(step.record));
  const blocks: BlogBlock[] = [
    paragraph(
      `The snapshot stores ${spellCount(effortLadder.length)} comparable ${MODEL_NAME} rows with an effort level, one per level`,
      otherModes.length === 0
        ? ", and no row without one. "
        : `, and ${joinNames(otherModes.map(mode => `${mode.name} at ${scoreAndCost(mode)}`))}, a different mode rather than an effort level, which the table leaves out. `,
      cheapest === undefined || costliest === undefined
        ? ""
        : `From ${effortLabel(cheapest.record)} to ${effortLabel(costliest.record)}, the score moves from ${formatSnapshotScore(cheapest.record.intelligenceIndex)} to ${formatSnapshotScore(costliest.record.intelligenceIndex)} index points and the cost per task from ${formatSnapshotCostUsd(comparableTaskCost(cheapest.record))} to ${formatSnapshotCostUsd(comparableTaskCost(costliest.record))}. The table lists the levels cheapest first and states what each step buys over the level below it.`,
    ),
    table(
      `Comparable ${MODEL_NAME} effort levels in the snapshot retrieved ${retrievedAt}, cheapest first`,
      ["Effort level", "Intelligence Index", "Cost per task", "Output tokens per task", "Reasoning share of output tokens", "Points over the level below", "Cost multiple of the level below"],
      effortLadder.map(ladderRow),
    ),
  ];
  if (largest !== undefined && last !== undefined && lastCheaper !== undefined && record.effort !== null) {
    const largestCheaper = effortLadder[effortLadder.indexOf(largest) - 1];
    blocks.push(paragraph(
      largestCheaper === undefined
        ? ""
        : `The largest step is from ${effortLabel(largestCheaper.record)} to ${effortLabel(largest.record)}: ${formatPointGap(largest.pointsOverCheaper ?? 0)} points at ${formatFineCostMultiple(largest.costMultipleOverCheaper ?? 1)} the cost per task. `,
      largest.record.id === last.record.id
        ? ""
        : `The last step, from ${effortLabel(lastCheaper.record)} to ${effortLabel(last.record)}, adds ${pointsPhrase(last.pointsOverCheaper ?? 0)} at ${formatFineCostMultiple(last.costMultipleOverCheaper ?? 1)} the cost per task. `,
      `At ${effortLabel(record)}, the model writes ${formatWholeTokens(record.outputTokensPerTask.total)} output tokens per task and ${formatSharePercent(reasoningShare(record))} of them are reasoning tokens; the share runs from ${formatSharePercent(Math.min(...shares))} to ${formatSharePercent(Math.max(...shares))} across the ${spellCount(effortLadder.length)} levels.`,
    ));
  }
  const defaultLevel = effortLadder.find(step => step.record.effort?.slug === CLAUDE_OPUS_55.anthropic.defaultEffort);
  blocks.push(paragraph(
    "Anthropic’s ",
    { href: BLOG_SOURCES.anthropicClaudeOpus55.url, text: "announcement" },
    ` names ${CLAUDE_OPUS_55.anthropic.defaultEffort} as the default effort level. `,
    defaultLevel === undefined
      ? `The snapshot stores no ${CLAUDE_OPUS_55.anthropic.defaultEffort} row, so this note cannot place the default setting.`
      : `In the snapshot the ${effortLabel(defaultLevel.record)} row scores ${scoreAndCost(defaultLevel.record)}, ${pointsPhrase(record.intelligenceIndex - defaultLevel.record.intelligenceIndex)} below ${effortLabel(record)} at ${formatFineCostMultiple(comparableTaskCost(defaultLevel.record) / comparableTaskCost(record))} its cost.`,
    ` ${releaseDatePhrase(effortLadder)}`,
    otherModes.length === 0
      ? " The snapshot stores no Opus 5.5 row without an effort level, and Anthropic’s announcement states that the model is no longer offered with thinking switched off."
      : "",
  ));
  return blocks;
}

function costRow(step: EffortStep): InlineContent[] {
  const cost = taskCostBreakdown(step.record);
  return [
    textCell(effortLabel(step.record)),
    textCell(formatSnapshotCostUsd(cost.input)),
    textCell(formatSnapshotCostUsd(cost.cacheRead)),
    textCell(formatSnapshotCostUsd(cost.output)),
    textCell(formatSnapshotCostUsd(cost.reasoning)),
    textCell(formatSharePercent(inputCostShare(step.record))),
  ];
}

function costBlocks(
  placement: OpusIntelligencePlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `Without a ${MODEL_NAME} max-effort row in the snapshot retrieved ${retrievedAt}, this note cannot split the cost per task into its components.`,
      ),
    ];
  }
  const { effortLadder, record } = placement;
  const cost = taskCostBreakdown(record);
  const components = [
    { label: "cache reads", value: cost.cacheRead },
    { label: "cache writes", value: cost.cacheWrite },
    { label: "non-cached input", value: cost.nonCacheInput },
    { label: "reasoning tokens", value: cost.reasoning },
    { label: "answer tokens", value: cost.answer },
  ].toSorted((left, right) => right.value - left.value);
  const [largest] = components;
  const shares = effortLadder.map(step => inputCostShare(step.record));
  const blocks: BlogBlock[] = [
    paragraph(
      `Of the ${formatSnapshotCostUsd(cost.total)} per task at ${effortLabel(record)}, ${formatSnapshotCostUsd(cost.input)} is input-side cost and ${formatSnapshotCostUsd(cost.output)} is output. Largest component first, the ${spellCount(components.length)} parts are ${joinNames(components.map(component => `${component.label} at ${formatSnapshotCostUsd(component.value)}`))}.`,
      largest === undefined
        ? ""
        : ` ${capitalize(largest.label)} ${largest.label.endsWith("s") ? "are" : "is"} ${formatSharePercent(largest.value / cost.total)} of the total.`,
      effortLadder.length >= 2
        ? ` Input-side cost is ${formatSharePercent(inputCostShare(record))} of the total at ${effortLabel(record)} and stays between ${formatSharePercent(Math.min(...shares))} and ${formatSharePercent(Math.max(...shares))} across the ${spellCount(effortLadder.length)} levels, while the reasoning share of output tokens moves from ${formatSharePercent(Math.min(...effortLadder.map(step => reasoningShare(step.record))))} to ${formatSharePercent(Math.max(...effortLadder.map(step => reasoningShare(step.record))))}.`
        : "",
    ),
  ];
  if (effortLadder.length >= 2) {
    blocks.push(table(
      `Cost per task by component for each comparable ${MODEL_NAME} effort level in the snapshot retrieved ${retrievedAt}, cheapest first`,
      ["Effort level", "Input cost", "Of which cache reads", "Output cost", "Of which reasoning tokens", "Input share of total"],
      effortLadder.map(costRow),
    ));
  }
  blocks.push(paragraph(
    "Artificial Analysis’s ",
    { href: BLOG_SOURCES.artificialAnalysisClaudeOpus55Model.url, text: "model page" },
    ", captured ",
    CLAUDE_OPUS_55.artificialAnalysis.capturedOn,
    " UTC, lists the prices behind these figures as ",
    CLAUDE_OPUS_55.artificialAnalysis.inputPrice,
    " per million input tokens and ",
    CLAUDE_OPUS_55.artificialAnalysis.outputPrice,
    " per million output tokens with a ",
    CLAUDE_OPUS_55.artificialAnalysis.cacheDiscount,
    " cache discount, based on Anthropic’s API, and rounds the row to an index score of ",
    CLAUDE_OPUS_55.artificialAnalysis.intelligenceScore,
    " at ",
    CLAUDE_OPUS_55.artificialAnalysis.costPerTask,
    " per task. It records ",
    CLAUDE_OPUS_55.artificialAnalysis.indexOutputTokens,
    " output tokens to run the whole index, which it calls “",
    CLAUDE_OPUS_55.artificialAnalysis.verbosityClaim,
    ",” lists the model as proprietary with a ",
    CLAUDE_OPUS_55.artificialAnalysis.contextWindow,
    " token context window, released ",
    CLAUDE_OPUS_55.artificialAnalysis.releaseDate,
    ", and sums the row up as “",
    CLAUDE_OPUS_55.artificialAnalysis.summaryClaim,
    ".”",
  ));
  return blocks;
}

function anthropicBlocks(placement: OpusIntelligencePlacement | undefined, evaluationCount: number): BlogBlock[] {
  const cacheReadSentence = placement === undefined
    ? ""
    : ` In the snapshot’s ${effortLabel(placement.record)} row, cache reads are ${formatSnapshotCostUsd(taskCostBreakdown(placement.record).cacheRead)} of the ${formatSnapshotCostUsd(taskCostBreakdown(placement.record).total)} per task.`;
  return [
    paragraph(
      "Anthropic’s ",
      { href: BLOG_SOURCES.anthropicClaudeOpus55.url, text: "announcement" },
      " of ",
      CLAUDE_OPUS_55.anthropic.announcedOn,
      " opens with the claim that “",
      CLAUDE_OPUS_55.anthropic.headlineClaim,
      ".” It prices the model at ",
      CLAUDE_OPUS_55.anthropic.inputPrice,
      " per million input tokens and ",
      CLAUDE_OPUS_55.anthropic.outputPrice,
      " per million output tokens, against ",
      CLAUDE_OPUS_55.anthropic.opus5InputPrice,
      " and ",
      CLAUDE_OPUS_55.anthropic.opus5OutputPrice,
      " for Opus 5, and says that “",
      CLAUDE_OPUS_55.anthropic.cacheReadClaim,
      ".”",
      cacheReadSentence,
      " Developers reach the model on the Claude Platform as ",
      { text: CLAUDE_OPUS_55.anthropic.modelId, emphasis: "em" },
      ".",
    ),
    paragraph(
      "The announcement reports Anthropic’s own runs: Terminal-Bench 4.0 at ",
      CLAUDE_OPUS_55.anthropic.vendorTerminalBench,
      " at ",
      CLAUDE_OPUS_55.anthropic.vendorTerminalBenchEffort,
      " effort, plus ",
      CLAUDE_OPUS_55.anthropic.otherVendorBenchmarks,
      ". None of those figures appears on an AI Charts chart. Anthropic states that “",
      CLAUDE_OPUS_55.anthropic.benchmarkSettingClaim,
      ",” and adds that “",
      CLAUDE_OPUS_55.anthropic.marginClaim,
      `.” Terminal-Bench 4.0 and GDPval-AA v2.1 are also two of the ${spellCount(evaluationCount)} evaluations inside the Intelligence Index,`,
      " where Artificial Analysis runs them under its own harness; the snapshot stores the composite score, not the per-evaluation results, so the ",
      CLAUDE_OPUS_55.anthropic.vendorTerminalBench,
      " cannot be checked against it here.",
    ),
    paragraph(
      "Anthropic also writes that “",
      CLAUDE_OPUS_55.anthropic.safeguardFallbackClaim,
      ".” The snapshot names each Opus 5.5 row with the phrase Default Fallback and records nothing else about that setting, and the model page does not define it, so whether the two describe the same behavior is not something either source states.",
    ),
  ];
}

function codingRowCells(record: CodingAgentRecord): InlineContent[] {
  return [
    textCell(configurationLabel(record)),
    textCell(formatSnapshotScore(record.benchmarks.aaIndex)),
    textCell(formatSnapshotCostUsd(record.economics.costUsd)),
  ];
}

function codingContrastBlocks(
  intelligence: OpusIntelligencePlacement | undefined,
  opus5: CodingAgentPlacement | undefined,
  opus55Rows: readonly CodingAgentRecord[],
  opus5IndexRows: readonly ArtificialAnalysisIntelligenceRecord[],
  codingRetrievedAt: string,
  intelligenceRetrievedAt: string,
  evaluationCount: number,
): BlogBlock[] {
  const blocks: BlogBlock[] = [
    paragraph(
      "The ",
      { href: "/coding", text: "coding-agent chart" },
      " is a daily snapshot of the public ",
      { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents comparison" },
      `. A row on it is a model running inside a named agent harness at one effort setting, and its AA Index averages three coding benchmarks: ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas}. Its cost is the mean API bill for one task in that harness, including every tool call and repeated context the harness sends.`,
    ),
  ];
  if (opus55Rows.length === 0) {
    blocks.push(paragraph(
      `In the coding-agent snapshot retrieved ${codingRetrievedAt}, no row runs ${MODEL_NAME} in any harness. `,
      opus5 === undefined
        ? "The snapshot stores no Claude Code · Opus 5 row either, so this note has no Anthropic coding-agent row to contrast with the Index."
        : `The Anthropic row nearest in name is ${configurationLabel(opus5.record)}: ${formatSnapshotScore(opus5.record.benchmarks.aaIndex)} on AA Index at ${formatSnapshotCostUsd(opus5.record.economics.costUsd)} per task, ${spellOrdinal(opus5.rank)} of ${opus5.indexedCount} configurations${opus5.onCostFrontier ? ", and on the chart’s cost frontier" : opus5.dominators.length === 0 ? "" : `, and not on the chart’s cost frontier because ${joinNames(opus5.dominators.map(dominator => `${configurationLabel(dominator)} scores ${formatSnapshotScore(dominator.benchmarks.aaIndex)} at ${formatSnapshotCostUsd(dominator.economics.costUsd)} per task`))}`}. That row is Opus 5, the previous Opus generation, inside Claude Code, Anthropic’s coding agent.`,
    ));
  } else {
    blocks.push(
      paragraph(
        `The coding-agent snapshot retrieved ${codingRetrievedAt} stores ${pluralConfigurations(opus55Rows.length)} that run${opus55Rows.length === 1 ? "s" : ""} ${MODEL_NAME}: ${joinNames(opus55Rows.map(row => `${configurationLabel(row)} at ${formatSnapshotScore(row.benchmarks.aaIndex)} on AA Index for ${formatSnapshotCostUsd(row.economics.costUsd)} per task`))}. `,
        opus5 === undefined
          ? "It stores no Claude Code · Opus 5 row."
          : `It also stores the previous generation, ${configurationLabel(opus5.record)}, at ${formatSnapshotScore(opus5.record.benchmarks.aaIndex)} for ${formatSnapshotCostUsd(opus5.record.economics.costUsd)} per task.`,
      ),
    );
    if (opus55Rows.length >= 2) {
      blocks.push(table(
        `${MODEL_NAME} rows on the coding-agent chart in the snapshot retrieved ${codingRetrievedAt}, highest AA Index first`,
        ["Configuration", SNAPSHOT_COLUMN_LABELS.aaIndex, "Cost per task"],
        opus55Rows.map(codingRowCells),
      ));
    }
  }
  if (intelligence !== undefined && opus5 !== undefined) {
    blocks.push(
      table(
        "The Intelligence Index row and the coding-agent row that readers most often set side by side, each scored on its own task set with its own cost definition",
        ["Chart", "Configuration", "Model generation", "Score", "Cost per task", "Snapshot retrieved"],
        [
          [
            textCell("Intelligence Index"),
            textCell(intelligence.record.name),
            textCell(MODEL_NAME),
            textCell(formatSnapshotScore(intelligence.record.intelligenceIndex)),
            textCell(formatSnapshotCostUsd(comparableTaskCost(intelligence.record))),
            textCell(intelligenceRetrievedAt),
          ],
          [
            textCell("Coding agents (AA Index)"),
            textCell(configurationLabel(opus5.record)),
            textCell("Claude Opus 5"),
            textCell(formatSnapshotScore(opus5.record.benchmarks.aaIndex)),
            textCell(formatSnapshotCostUsd(opus5.record.economics.costUsd)),
            textCell(codingRetrievedAt),
          ],
        ],
      ),
      callout(
        "Two models, two scales",
        `The coding row’s ${formatSnapshotScore(opus5.record.benchmarks.aaIndex)} is an average of three coding benchmarks for Opus 5 inside Claude Code, and the Index row’s ${formatSnapshotScore(intelligence.record.intelligenceIndex)} is a weighted average of ${spellCount(evaluationCount)} evaluations for ${MODEL_NAME} through its API. Neither number ranks the other, and ${formatSnapshotCostUsd(opus5.record.economics.costUsd)} and ${formatSnapshotCostUsd(comparableTaskCost(intelligence.record))} are costs of different tasks.`,
      ),
    );
  }
  blocks.push(paragraph(
    opus5IndexRows.length === 0
      ? `The Intelligence Index snapshot retrieved ${intelligenceRetrievedAt} stores no Claude Opus 5 row, so the step from Opus 5 to Opus 5.5 that Anthropic describes cannot be measured on the Index from this snapshot, and the coding-agent chart stores no Opus 5.5 row to measure it there.`
      : `The Intelligence Index snapshot retrieved ${intelligenceRetrievedAt} also stores ${pluralConfigurations(opus5IndexRows.length)} of Claude Opus 5: ${joinNames(opus5IndexRows.map(row => `${row.name} at ${scoreAndCost(row)}`))}.`,
  ));
  return blocks;
}

function derivedTitle(placement: OpusIntelligencePlacement | undefined): string {
  if (placement === undefined) return `${MODEL_NAME} on the Intelligence Index snapshot`;
  const score = formatSnapshotScore(placement.record.intelligenceIndex);
  const cost = formatSnapshotCostUsd(comparableTaskCost(placement.record));
  if (placement.rank === 1) {
    const withCost = `${MODEL_NAME} leads the Intelligence Index at ${score} for ${cost}`;
    if (withCost.length <= MAX_TITLE_LENGTH) return withCost;
    return `${MODEL_NAME} leads the Intelligence Index at ${score}`;
  }
  return `${MODEL_NAME} scores ${score} on the Intelligence Index`;
}

export function createOpus55Article(
  intelligenceSnapshot: ArtificialAnalysisIntelligenceV43Snapshot = checkedIntelligenceSnapshot(),
  codingSnapshot: CodingAgentSnapshot = checkedCodingSnapshot(),
): BlogArticle {
  const intelligenceRetrievedAt = formatRetrievedAt(intelligenceSnapshot.source.retrievedAt);
  const codingRetrievedAt = formatRetrievedAt(codingSnapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    OPUS_55_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(intelligenceSnapshot.source.retrievedAt),
    utcCalendarDate(codingSnapshot.source.retrievedAt),
  );
  const intelligence = opusIntelligencePlacement(intelligenceSnapshot.records);
  const opus5 = opus5CodingAgentPlacement(codingSnapshot.records);
  const opus55Rows = opus55CodingAgentRows(codingSnapshot.records);
  const opus5IndexRows = opus5IntelligenceRows(intelligenceSnapshot.records);
  const indexVersion = intelligenceSnapshot.benchmark.version;
  const weights = intelligenceSnapshot.benchmark.categoryWeightsPercent;
  const evaluations = intelligenceSnapshot.benchmark.evaluations;

  const score = intelligence === undefined ? undefined : formatSnapshotScore(intelligence.record.intelligenceIndex);
  const cost = intelligence === undefined ? undefined : formatSnapshotCostUsd(comparableTaskCost(intelligence.record));
  const title = derivedTitle(intelligence);
  const lowerLevels = intelligence === undefined
    ? []
    : intelligence.effortLadder.filter(step => step.record.id !== intelligence.record.id).toReversed();
  const frontierRunPhrase = intelligence === undefined || intelligence.frontierRun.length < 2
    ? ""
    : ` The ${spellCount(intelligence.frontierRun.length)} highest points on the cost frontier are all its effort levels.`;
  const dek = intelligence === undefined || score === undefined || cost === undefined
    ? `${MODEL_NAME} appears on the AI Charts Intelligence Index chart as one row per effort level. This note states what each row measures and how it differs from the Claude Code · Opus 5 coding-agent row.`
    : `${MODEL_NAME} at ${effortLabel(intelligence.record)} effort scores ${score} on the Intelligence Index at ${cost} per task, ${spellOrdinal(intelligence.rank)} of ${intelligence.cohortSize} configuration${intelligence.cohortSize === 1 ? "" : "s"}.${frontierRunPhrase}`;
  const seoDescription = intelligence === undefined || score === undefined || cost === undefined
    ? `${MODEL_NAME} on the AI Charts Intelligence Index chart: what each effort level’s row measures and how it differs from the Claude Code · Opus 5 row.`
    : `${MODEL_NAME} (${effortLabel(intelligence.record)}) scores ${score} on the Intelligence Index at ${cost} a task, ${spellOrdinal(intelligence.rank)} of ${intelligence.cohortSize} configuration${intelligence.cohortSize === 1 ? "" : "s"}. See its effort levels and the Opus 5 contrast.`;

  const openingPlacement = intelligence === undefined
    ? `Artificial Analysis measures it on the Intelligence Index, and the AI Charts snapshot retrieved ${intelligenceRetrievedAt} stores no ${MODEL_NAME} max-effort row with a measured cost per task, so this note can describe the chart but not place the model on it.`
    : `In the Intelligence Index snapshot retrieved ${intelligenceRetrievedAt}, ${intelligence.record.name} scores ${score} at ${cost} per task, ${spellOrdinal(intelligence.rank)} of the ${comparableCount(intelligence.cohortSize)}, meaning the rows with a measured cost per task${intelligence.onCostFrontier ? ", and on the chart’s cost frontier" : ""}.`;
  const openingFrontier = intelligence === undefined || intelligence.frontierRun.length < 2
    ? ""
    : ` Walking the cost frontier down from the top, the first ${spellCount(intelligence.frontierRun.length)} points are all ${MODEL_NAME} rows.`;
  const openingLadder = lowerLevels.length === 0
    ? openingFrontier
    : ` The ${spellCount(lowerLevels.length)} lower effort ${lowerLevels.length === 1 ? "level" : "levels"} of the same model score${lowerLevels.length === 1 ? "s" : ""} ${joinNames(lowerLevels.map(step => formatSnapshotScore(step.record.intelligenceIndex)))}.${openingFrontier}`;
  const openingCoding = opus55Rows.length === 0
    ? ` The coding-agent chart stores no ${MODEL_NAME} row${opus5 === undefined ? "." : `; its ${CODING_ROW_LABEL} row is the previous Opus generation inside Anthropic’s coding agent, and its ${formatSnapshotScore(opus5.record.benchmarks.aaIndex)} averages three coding benchmarks rather than scoring the Intelligence Index.`}`
    : ` The coding-agent chart stores ${pluralConfigurations(opus55Rows.length)} running ${MODEL_NAME}, scored on three coding benchmarks inside a harness rather than on the Intelligence Index.`;

  const rankHeading = intelligence === undefined
    ? "Rank among comparable configurations"
    : `${capitalize(spellOrdinal(intelligence.rank))} of ${comparableCount(intelligence.cohortSize)}`;
  const ladderHeading = intelligence === undefined || intelligence.effortLadder.length < 2
    ? "The effort levels"
    : `${capitalize(spellCount(intelligence.effortLadder.length))} effort levels of one model`;
  const costHeading = cost === undefined ? "Where the cost per task goes" : `Where the ${cost} goes`;

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: OPUS_55_ARTICLE_SLUG,
    title,
    dek,
    focusPhrase: "Claude Opus 5.5 Intelligence Index",
    seoDescription,
    keywords: [
      "Claude Opus 5.5",
      "Anthropic",
      "Artificial Analysis Intelligence Index",
      "effort level",
      "cost per task",
      "cost frontier",
      "Claude Code",
      "Opus 5",
    ],
    publishedAt: OPUS_55_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "AI model benchmarks",
    sourceIds: [
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisClaudeOpus55Model",
      "anthropicClaudeOpus55",
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: [
      "gpt-6-sol-coding-agent-index",
      "mimo-v2-6-pro-cost-frontier",
    ],
    nextStep: {
      title: `See where ${MODEL_NAME} sits today`,
      description:
        "The chart redraws from each snapshot, so the rank, frontier run, and effort ladder above can move. The model page lists every Claude Opus 5.5 row the site holds.",
      links: [
        { href: "/#intelligence-index", label: "Capability and cost chart" },
        { href: "/models/anthropic/claude-opus-5-5/index", label: "Claude Opus 5.5 model page" },
        { href: "/coding", label: "Coding-agent chart" },
      ],
    },
    body: [
      paragraph(
        "Anthropic ",
        { href: BLOG_SOURCES.anthropicClaudeOpus55.url, text: `released ${MODEL_NAME}` },
        " on ",
        CLAUDE_OPUS_55.anthropic.announcedOn,
        ". ",
        openingPlacement,
        openingLadder,
        openingCoding,
      ),
      heading(`One configuration, ${spellCount(evaluations.length)} evaluations`),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.artificialAnalysisIntelligenceIndex.url, text: "Artificial Analysis Intelligence Index" },
        ` runs a model through its API under one harness that is the same for every model, across ${spellCount(evaluations.length)} evaluations weighted ${weights.agents}% agents, ${weights.coding}% coding, ${weights.scientific}% scientific reasoning, and ${weights.general}% general capability, at version ${indexVersion}. The evaluations are ${joinNames([...evaluations])}. Cost per task is the weighted average API bill for one task across those evaluations, split into input-side cost (non-cached input, cache reads, and cache writes) and output-side cost (reasoning and answer tokens).`,
      ),
      paragraph(
        `A row on the chart is one configuration: the model at one effort level with the settings Artificial Analysis names in the row. The ${MODEL_NAME} rows share the phrases Adaptive Reasoning and Default Fallback and differ in effort level. The snapshot records the effort level and does not define the other two phrases, so this note does not interpret them.`,
      ),
      heading(rankHeading),
      ...rankBlocks(intelligence, intelligenceRetrievedAt),
      heading(ladderHeading),
      ...ladderBlocks(intelligence, intelligenceRetrievedAt),
      heading(costHeading),
      ...costBlocks(intelligence, intelligenceRetrievedAt),
      heading("Anthropic’s prices and claims"),
      ...anthropicBlocks(intelligence, evaluations.length),
      heading("Claude Code · Opus 5 is a different model on a different chart"),
      ...codingContrastBlocks(intelligence, opus5, opus55Rows, opus5IndexRows, codingRetrievedAt, intelligenceRetrievedAt, evaluations.length),
      heading("Limits"),
      list(
        [
          `The scores, costs, and token counts above are Artificial Analysis measurements of the ${MODEL_NAME} rows on the retrieval date under Intelligence Index version ${indexVersion}, and of ${CODING_ROW_LABEL} under ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas}. They say nothing about other tasks, prompts, or harnesses.`,
        ],
        [
          "The rank, frontier walk, nearest-score table, effort ladder, and cost shares are computed from those snapshots by AI Charts. A new, removed, or rescored configuration moves them, and both snapshots update on a schedule.",
        ],
        [
          `${MODEL_NAME} inside Claude Code, Cursor, or another harness is a configuration the coding-agent snapshot does not store, so this note says nothing about it.`,
        ],
        [
          "The Adaptive Reasoning and Default Fallback settings in the row names are recorded by Artificial Analysis and not defined in the snapshot; the per-evaluation scores behind the composite are not stored either.",
        ],
        [
          "The prices, the 40% cost claim against Opus 5, and the benchmark table are Anthropic’s. AI Charts did not run Claude Opus 5.5.",
        ],
      ),
    ],
  };
}
