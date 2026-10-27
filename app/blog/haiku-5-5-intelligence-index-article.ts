import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";
import type { ArtificialAnalysisIntelligenceRecord } from "@/lib/artificial-analysis-intelligence-data";
import {
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "@/lib/artificial-analysis-intelligence-v4-3-data";
import {
  CLAUDE_HAIKU_55_RELEASE_SLUG,
  GPT_6_LUNA_RELEASE_SLUG,
  anthropicFrontier,
  anthropicRows,
  familyRowsDominatedBy,
  haikuIntelligencePlacement,
  releaseRowsAgainst,
  siblingFamilyRows,
  type FamilyRow,
  type HaikuIntelligencePlacement,
} from "@/lib/claude-haiku-5-5-placement";
import { inputCostShare, reasoningShare, taskCostBreakdown } from "@/lib/claude-opus-5-5-placement";
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
import { formatFineCostMultiple, spellOrdinal, type EffortStep } from "@/lib/snapshot-placement";

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
import { effortLabel, formatSharePercent } from "./opus-5-5-intelligence-index-article";
import { spellCount } from "./real-swe-private-enterprise-benchmark-article";

export const HAIKU_55_ARTICLE_SLUG = "haiku-5-5-intelligence-index" as const;
export const HAIKU_55_ARTICLE_PUBLISHED_AT = "2026-10-12" as const;

/** Quoted claims from the primary sources, kept verbatim so tests can check every quotation. */
export const CLAUDE_HAIKU_55 = {
  anthropic: {
    announcedOn: "October 7, 2026",
    headlineClaim:
      "Introducing Claude Haiku 5.5: the cheapest, fastest, and most capable small model we’ve ever released",
    purposeClaim: "Claude Haiku 5.5 is designed for high-volume, cost-sensitive tasks",
    savingClaim: "On average, it now costs around 75% less to run",
    savingFootnote:
      "priced 90% lower than Claude Haiku 4.5 for requests up to 100,000 tokens, and 50% lower for requests over 100,000 tokens",
    effortClaim: "Haiku 5.5 is our first Haiku-class model to come with an adjustable effort setting",
    largerModelsClaim:
      "Sonnet 5.5 and Opus 5.5 remain better choices for complex agentic coding tasks like those measured by Terminal-Bench 4.0",
    promptShareClaim:
      "especially good value when used for tasks with prompts up to 100,000 tokens, which make up around 90% of requests to our previous Haiku model",
    inputPrice: "$0.10",
    outputPrice: "$0.50",
    cacheReadPrice: "$0.01",
    cacheWritePrice: "$0.125",
    longInputPrice: "$0.50",
    longOutputPrice: "$2.50",
    longCacheReadPrice: "$0.05",
    longCacheWritePrice: "$0.625",
    haiku45InputPrice: "$1.00",
    haiku45OutputPrice: "$5.00",
    haiku45CacheReadPrice: "$0.10",
    vendorGdpval: "1620",
    vendorOsworld: "72.4%",
    vendorHle: "45.9%",
    vendorTerminalBench: "39.2%",
    vendorFrontierCode: "46.4%",
    vendorChartography: "46.4%",
    comparisonModels: "Haiku 4.5, GPT-6 Luna, and Sonnet 5.5",
    sidekickClaim: "Claude Haiku 5.5 joins the sidekick lineup in Devin Fusion as an excellent option",
    modelId: "claude-haiku-5-5",
  },
  artificialAnalysis: {
    capturedOn: "October 12, 2026",
    intelligenceScore: "43",
    classRank: "#2 / 180",
    inputPrice: "$0.10",
    outputPrice: "$0.50",
    cacheDiscount: "90%",
    costPerTask: "$0.21",
    indexOutputTokens: "440M",
    outputSpeed: "235.3",
    contextWindow: "1M",
    releaseDate: "October 7, 2026",
    summaryClaim:
      "amongst the leading models in intelligence and well priced when comparing to other models of similar price",
    speedClaim: "notably fast, however very verbose",
    verbosityClaim: "very verbose in comparison to the median of 100M",
  },
} as const;

const MODEL_NAME = "Claude Haiku 5.5" as const;
const MAX_TITLE_LENGTH = 64;
const MAX_DEK_LENGTH = 200;
const HAIKU_45_RELEASE_SLUG = "claude-haiku-4-5" as const;

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

/** “108 comparable configurations”, with the noun agreeing with the count. */
function comparableCount(count: number): string {
  return `${count} comparable configuration${count === 1 ? "" : "s"}`;
}

function scoreAndCost(record: ArtificialAnalysisIntelligenceRecord): string {
  return `${formatSnapshotScore(record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(record))} per task`;
}

function costMultipleOf(record: ArtificialAnalysisIntelligenceRecord, reference: ArtificialAnalysisIntelligenceRecord): string {
  return formatFineCostMultiple(comparableTaskCost(record) / comparableTaskCost(reference));
}

/** Every coding-agent row whose model name carries Haiku 5.5, in any harness, highest AA Index first. */
export function haiku55CodingAgentRows(records: readonly CodingAgentRecord[]): readonly CodingAgentRecord[] {
  return records
    .filter(record => record.model.includes("Haiku 5.5"))
    .toSorted((left, right) => (
      (right.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY) - (left.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY)
      || left.id.localeCompare(right.id)
    ));
}

/** Anthropic-provider coding-agent rows grouped by model name, highest AA Index first within each model. */
function anthropicCodingModels(records: readonly CodingAgentRecord[]): readonly Readonly<{ model: string; rows: readonly CodingAgentRecord[] }>[] {
  const byModel = new Map<string, CodingAgentRecord[]>();
  for (const record of records.filter(candidate => candidate.providerId === "anthropic")) {
    const rows = byModel.get(record.model) ?? [];
    rows.push(record);
    byModel.set(record.model, rows);
  }
  return [...byModel.entries()]
    .map(([model, rows]) => ({
      model,
      rows: rows.toSorted((left, right) => (
        (right.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY) - (left.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY)
        || left.id.localeCompare(right.id)
      )),
    }))
    .toSorted((left, right) => (
      (right.rows[0]?.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY) - (left.rows[0]?.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY)
      || left.model.localeCompare(right.model)
    ));
}

function rankBlocks(
  placement: HaikuIntelligencePlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `The Intelligence Index snapshot retrieved ${retrievedAt} does not store a ${MODEL_NAME} max-effort row with a positive cost per task, so this note cannot rank the model or place it against the cost frontier.`,
      ),
    ];
  }
  const { cheaperCount, cheapestHigher, closestBelow, cohortSize, dominators, frontierLevels, leader, neighbors, onCostFrontier, rank, record } = placement;
  const score = formatSnapshotScore(record.intelligenceIndex);
  const cost = comparableTaskCost(record);
  const [onlyDominator] = dominators;
  const dominatorIsCheapestHigher = onlyDominator !== undefined
    && dominators.length === 1
    && cheapestHigher?.record.id === onlyDominator.id;
  const blocks: BlogBlock[] = [
    paragraph(
      `The ${score} places ${record.name} ${spellOrdinal(rank)} of the ${comparableCount(cohortSize)} in the snapshot retrieved ${retrievedAt}. `,
      rank === 1
        ? "No configuration scores higher. "
        : `Of the rest, ${pluralConfigurations(rank - 1)} score${rank - 1 === 1 ? "s" : ""} higher; the leader, ${leader.name}, is ${pointsPhrase(leader.intelligenceIndex - record.intelligenceIndex)} above it at ${formatSnapshotCostUsd(comparableTaskCost(leader))} per task. `,
      onCostFrontier
        ? "The row is on the chart’s cost frontier: no comparable configuration scores at least as high at the same or lower cost per task."
        : dominatorIsCheapestHigher
          ? `The row is not on the chart’s cost frontier, and one row keeps it off: ${onlyDominator.name} scores ${scoreAndCost(onlyDominator)}, ${pointsPhrase(onlyDominator.intelligenceIndex - record.intelligenceIndex)} higher for ${costMultipleOf(onlyDominator, record)} the cost. It is also the cheapest configuration that scores higher.`
          : `The row is not on the chart’s cost frontier: ${pluralConfigurations(dominators.length)} score${dominators.length === 1 ? "s" : ""} at least as high at the same or lower cost per task${dominators.length === 0 ? "" : `, ${joinNames(dominators.map(dominator => `${dominator.name} at ${scoreAndCost(dominator)}`))}`}.`,
      !dominatorIsCheapestHigher && cheapestHigher !== undefined
        ? ` The cheapest configuration that scores higher, ${cheapestHigher.record.name}, scores ${formatSnapshotScore(cheapestHigher.record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(cheapestHigher.record))}, ${formatFineCostMultiple(cheapestHigher.multiple)} the cost.`
        : "",
    ),
    paragraph(
      cheaperCount === 0
        ? `No comparable configuration costs less per task than the ${formatSnapshotCostUsd(cost)}. `
        : `Of the ${cohortSize}, ${cheaperCount === 1 ? "one configuration costs" : `${spellCount(cheaperCount)} cost`} less per task than the ${formatSnapshotCostUsd(cost)}. `,
      neighbors.length === 0
        ? "No other configuration scores within one index point of it."
        : `Within one index point of it ${neighbors.length === 1 ? "sits" : "sit"} ${pluralConfigurations(neighbors.length)}${neighbors.every(neighbor => comparableTaskCost(neighbor) > cost) ? `, ${neighbors.length === 1 ? "and it costs" : neighbors.length === 2 ? "and both cost" : "and all of them cost"} more` : ""}: ${joinNames(neighbors.map(neighbor => `${neighbor.name} at ${scoreAndCost(neighbor)}`))}, which is ${joinNames(neighbors.map(neighbor => costMultipleOf(neighbor, record)))} the Haiku row’s cost.`,
    ),
  ];
  if (closestBelow.length >= 2) {
    const sameRelease = closestBelow.filter(entry => entry.record.release.slug === record.release.slug);
    const cheaperBelow = closestBelow.filter(entry => entry.record.release.slug !== record.release.slug && entry.costMultiple < 1);
    blocks.push(
      paragraph(
        `The table lists the ${spellCount(closestBelow.length)} highest-scoring configurations after it, with each cost as a multiple of its ${formatSnapshotCostUsd(cost)}. `,
        sameRelease.length === 0
          ? ""
          : `${capitalize(spellCount(sameRelease.length))} of the ${spellCount(closestBelow.length)} ${sameRelease.length === 1 ? "is" : "are"} ${MODEL_NAME} at a lower effort level. `,
        cheaperBelow.length === 0
          ? "Every row from another model in the table costs more than the Haiku row."
          : `${joinNames(cheaperBelow.map(entry => `${entry.record.name} gives up ${pointsPhrase(entry.gapPoints)} for ${formatFineCostMultiple(entry.costMultiple)} the cost`))}.`,
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
  const levelCount = placement.effortLadder.length;
  if (frontierLevels.length === 0) {
    blocks.push(paragraph(
      levelCount === 1
        ? `The ${placement.record.name} row is not a vertex of the chart’s cost frontier.`
        : `None of the ${spellCount(levelCount)} ${MODEL_NAME} effort rows is a vertex of the chart’s cost frontier.`,
    ));
  } else {
    blocks.push(paragraph(
      `${capitalize(spellCount(frontierLevels.length))} of the ${spellCount(levelCount)} ${MODEL_NAME} effort rows ${frontierLevels.length === 1 ? "is a vertex" : "are vertices"} of the chart’s cost frontier, the set of rows no other row beats on both score and cost. `,
      ...frontierLevels.map(level => [
        `${level.record.name} at ${scoreAndCost(level.record)}`,
        level.above === undefined
          ? " is the top vertex"
          : ` sits below ${level.above.name} at ${scoreAndCost(level.above)}, giving up ${pointsPhrase(level.above.intelligenceIndex - level.record.intelligenceIndex)} for ${costMultipleOf(level.record, level.above)} the cost`,
        level.below === undefined
          ? " and is the lowest-cost vertex."
          : `; the next vertex down, ${level.below.name} at ${scoreAndCost(level.below)}, gives up ${pointsPhrase(level.record.intelligenceIndex - level.below.intelligenceIndex)} for ${costMultipleOf(level.below, level.record)} the Haiku row’s cost.`,
      ].join("")).join(" "),
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
  placement: HaikuIntelligencePlacement | undefined,
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
  const smallest = steps.toSorted((left, right) => (left.pointsOverCheaper ?? 0) - (right.pointsOverCheaper ?? 0))[0];
  const shares = effortLadder.map(step => reasoningShare(step.record));
  const blocks: BlogBlock[] = [
    paragraph(
      `The snapshot stores ${spellCount(effortLadder.length)} comparable ${MODEL_NAME} rows with an effort level, one per level`,
      otherModes.length === 0
        ? ", and no row without one. "
        : `, and ${joinNames(otherModes.map(mode => `${mode.name} at ${scoreAndCost(mode)}`))}, a different mode rather than an effort level, which the table leaves out. `,
      cheapest === undefined || costliest === undefined
        ? ""
        : `From ${effortLabel(cheapest.record)} to ${effortLabel(costliest.record)}, the score moves from ${formatSnapshotScore(cheapest.record.intelligenceIndex)} to ${formatSnapshotScore(costliest.record.intelligenceIndex)} index points and the cost per task from ${formatSnapshotCostUsd(comparableTaskCost(cheapest.record))} to ${formatSnapshotCostUsd(comparableTaskCost(costliest.record))}: ${pointsPhrase(costliest.record.intelligenceIndex - cheapest.record.intelligenceIndex)} for ${costMultipleOf(costliest.record, cheapest.record)} the cost. The table lists the levels cheapest first and states what each step buys over the level below it.`,
    ),
    table(
      `Comparable ${MODEL_NAME} effort levels in the snapshot retrieved ${retrievedAt}, cheapest first`,
      ["Effort level", "Intelligence Index", "Cost per task", "Output tokens per task", "Reasoning share of output tokens", "Points over the level below", "Cost multiple of the level below"],
      effortLadder.map(ladderRow),
    ),
  ];
  if (largest !== undefined && smallest !== undefined && record.effort !== null) {
    const largestCheaper = effortLadder[effortLadder.indexOf(largest) - 1];
    const smallestCheaper = effortLadder[effortLadder.indexOf(smallest) - 1];
    blocks.push(paragraph(
      largestCheaper === undefined
        ? ""
        : `The largest step is from ${effortLabel(largestCheaper.record)} to ${effortLabel(largest.record)}: ${formatPointGap(largest.pointsOverCheaper ?? 0)} points at ${formatFineCostMultiple(largest.costMultipleOverCheaper ?? 1)} the cost per task. `,
      smallestCheaper === undefined || smallest.record.id === largest.record.id
        ? ""
        : `The smallest is from ${effortLabel(smallestCheaper.record)} to ${effortLabel(smallest.record)}: ${formatPointGap(smallest.pointsOverCheaper ?? 0)} points at ${formatFineCostMultiple(smallest.costMultipleOverCheaper ?? 1)} the cost per task. `,
      `Each step multiplies the cost per task by between ${formatFineCostMultiple(Math.min(...steps.map(step => step.costMultipleOverCheaper ?? 1)))} and ${formatFineCostMultiple(Math.max(...steps.map(step => step.costMultipleOverCheaper ?? 1)))} and buys between ${formatPointGap(Math.min(...steps.map(step => step.pointsOverCheaper ?? 0)))} and ${formatPointGap(Math.max(...steps.map(step => step.pointsOverCheaper ?? 0)))} points. `,
      `At ${effortLabel(record)}, the model writes ${formatWholeTokens(record.outputTokensPerTask.total)} output tokens per task and ${formatSharePercent(reasoningShare(record))} of them are reasoning tokens; the share runs from ${formatSharePercent(Math.min(...shares))} to ${formatSharePercent(Math.max(...shares))} across the ${spellCount(effortLadder.length)} levels.`,
    ));
  }
  blocks.push(paragraph(
    "Anthropic’s ",
    { href: BLOG_SOURCES.anthropicClaudeHaiku55.url, text: "announcement" },
    " says that “",
    CLAUDE_HAIKU_55.anthropic.effortClaim,
    "” and names no default level, so this note places none. ",
    releaseDatePhrase(effortLadder),
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
  placement: HaikuIntelligencePlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `Without a ${MODEL_NAME} max-effort row in the snapshot retrieved ${retrievedAt}, this note cannot split the cost per task into its components.`,
      ),
    ];
  }
  const { cohortSize, effortLadder, rank, record } = placement;
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
        ? ` Input-side cost is ${formatSharePercent(inputCostShare(record))} of the total at ${effortLabel(record)} and stays between ${formatSharePercent(Math.min(...shares))} and ${formatSharePercent(Math.max(...shares))} across the ${spellCount(effortLadder.length)} levels, so most of what a Haiku task costs on the Index is reading context back in, not writing the answer.`
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
  blocks.push(
    paragraph(
      "Artificial Analysis’s ",
      { href: BLOG_SOURCES.artificialAnalysisClaudeHaiku55Model.url, text: "model page" },
      ", captured ",
      CLAUDE_HAIKU_55.artificialAnalysis.capturedOn,
      " UTC, lists the prices behind these figures as ",
      CLAUDE_HAIKU_55.artificialAnalysis.inputPrice,
      " per million input tokens and ",
      CLAUDE_HAIKU_55.artificialAnalysis.outputPrice,
      " per million output tokens with a ",
      CLAUDE_HAIKU_55.artificialAnalysis.cacheDiscount,
      " cache discount, and rounds the row to an index score of ",
      CLAUDE_HAIKU_55.artificialAnalysis.intelligenceScore,
      " at ",
      CLAUDE_HAIKU_55.artificialAnalysis.costPerTask,
      " per task. It records ",
      CLAUDE_HAIKU_55.artificialAnalysis.indexOutputTokens,
      " output tokens to run the whole index, which it calls “",
      CLAUDE_HAIKU_55.artificialAnalysis.verbosityClaim,
      ",” measures ",
      CLAUDE_HAIKU_55.artificialAnalysis.outputSpeed,
      " output tokens per second, lists the model as proprietary with a ",
      CLAUDE_HAIKU_55.artificialAnalysis.contextWindow,
      " token context window, released ",
      CLAUDE_HAIKU_55.artificialAnalysis.releaseDate,
      ", and sums the row up as “",
      CLAUDE_HAIKU_55.artificialAnalysis.summaryClaim,
      "” and “",
      CLAUDE_HAIKU_55.artificialAnalysis.speedClaim,
      ".”",
    ),
    paragraph(
      "The same page ranks the row ",
      CLAUDE_HAIKU_55.artificialAnalysis.classRank,
      ` on intelligence. That rank is among the models the page groups with it by price range, not across the whole index; on this chart, which ranks every configuration with a measured cost, the row is ${spellOrdinal(rank)} of ${cohortSize}. The two numbers answer different questions and neither corrects the other.`,
    ),
  );
  return blocks;
}

function familyRowCells(row: FamilyRow): InlineContent[] {
  return [
    textCell(row.record.name),
    textCell(formatSnapshotScore(row.record.intelligenceIndex)),
    textCell(formatSnapshotCostUsd(comparableTaskCost(row.record))),
    textCell(formatPointGap(row.gapPoints)),
    textCell(formatFineCostMultiple(row.costMultiple)),
    textCell(row.onFamilyFrontier ? "yes" : "no"),
  ];
}

function familyBlocks(
  placement: HaikuIntelligencePlacement | undefined,
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `Without a ${MODEL_NAME} max-effort row in the snapshot retrieved ${retrievedAt}, this note cannot measure the model against the other Anthropic rows on the chart.`,
      ),
    ];
  }
  const { record } = placement;
  const family = anthropicRows(records);
  const siblings = siblingFamilyRows(records, record);
  const dominated = familyRowsDominatedBy(records, CLAUDE_HAIKU_55_RELEASE_SLUG);
  const frontier = anthropicFrontier(records);
  const byRelease = new Map<string, number>();
  for (const row of family) byRelease.set(row.release.name, (byRelease.get(row.release.name) ?? 0) + 1);
  const releaseCounts = [...byRelease.entries()].map(([name, count]) => `${spellCount(count)} ${name}`);
  const firstHaikuVertex = frontier.findIndex(vertex => vertex.release.slug === record.release.slug);
  const aboveFirstHaiku = firstHaikuVertex > 0 ? frontier[firstHaikuVertex - 1] : undefined;
  const tailIsHaiku = firstHaikuVertex >= 0 && frontier.slice(firstHaikuVertex).every(vertex => vertex.release.slug === record.release.slug);
  const blocks: BlogBlock[] = [
    paragraph(
      `The snapshot stores ${pluralConfigurations(family.length)} from Anthropic with a measured cost per task: ${joinNames(releaseCounts)}. `,
      siblings.length === 0
        ? "It stores no comparable Claude Sonnet 5.5 or Claude Opus 5.5 row, so this note cannot price the larger models against Haiku."
        : `The table measures every Sonnet 5.5 and Opus 5.5 row against ${record.name}, and marks whether each row is a vertex of the cost frontier drawn through Anthropic rows alone.`,
    ),
  ];
  if (siblings.length > 0) {
    blocks.push(table(
      `Claude Sonnet 5.5 and Claude Opus 5.5 rows against ${record.name} in the snapshot retrieved ${retrievedAt}, highest index first`,
      ["Configuration", "Intelligence Index", "Cost per task", `Points against ${MODEL_NAME} (max)`, "Multiple of its cost", "On the Anthropic-only frontier"],
      siblings.map(familyRowCells),
    ));
  }
  if (dominated.length > 0) {
    blocks.push(paragraph(
      `A Haiku row beats ${pluralConfigurations(dominated.length)} from the other Anthropic releases on both axes: ${joinNames(dominated.map(entry => `${entry.record.name} scores ${pointsPhrase(entry.pointsBelowDominator)} below ${entry.dominator.name} at ${formatFineCostMultiple(entry.costMultipleOfDominator)} its cost`))}.`,
    ));
  } else {
    blocks.push(paragraph("No row from another Anthropic release is beaten on both score and cost by a Haiku row."));
  }
  if (frontier.length > 0) {
    blocks.push(paragraph(
      `Drawing the cost frontier through the Anthropic rows alone and walking it from the top, the vertices are ${joinNames(frontier.map(vertex => vertex.name))}. `,
      firstHaikuVertex < 0
        ? `No ${MODEL_NAME} row is a vertex of that frontier.`
        : tailIsHaiku
          ? `${aboveFirstHaiku === undefined ? `Every vertex is a ${MODEL_NAME} row.` : `Below ${aboveFirstHaiku.name} at ${formatSnapshotCostUsd(comparableTaskCost(aboveFirstHaiku))} per task, every vertex is a ${MODEL_NAME} row: within Anthropic’s range on this chart, the cheapest row that reaches any score up to the ${formatSnapshotScore(record.intelligenceIndex)} of ${record.name} is a Haiku effort level.`}`
          : `The first ${MODEL_NAME} vertex from the top is ${frontier[firstHaikuVertex]?.name ?? ""}, and rows from other Anthropic releases appear below it.`,
    ));
  }
  return blocks;
}

function anthropicBlocks(
  placement: HaikuIntelligencePlacement | undefined,
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  evaluationCount: number,
): BlogBlock[] {
  const haiku45 = records.filter(record => record.release.slug === HAIKU_45_RELEASE_SLUG && record.costUsdPerTask !== null);
  const cacheReadSentence = placement === undefined
    ? ""
    : ` In the snapshot’s ${effortLabel(placement.record)} row, cache reads are ${formatSnapshotCostUsd(taskCostBreakdown(placement.record).cacheRead)} of the ${formatSnapshotCostUsd(taskCostBreakdown(placement.record).total)} per task, so the cache-read price is the one that moves the chart’s cost column most.`;
  const luna = placement === undefined ? [] : releaseRowsAgainst(records, GPT_6_LUNA_RELEASE_SLUG, placement.record);
  const [lunaTop] = luna;
  const lunaFrontierLevel = placement?.frontierLevels.find(level => level.below?.release.slug === GPT_6_LUNA_RELEASE_SLUG);
  return [
    paragraph(
      "Anthropic’s ",
      { href: BLOG_SOURCES.anthropicClaudeHaiku55.url, text: "announcement" },
      " of ",
      CLAUDE_HAIKU_55.anthropic.announcedOn,
      " opens with “",
      CLAUDE_HAIKU_55.anthropic.headlineClaim,
      ",” and says that “",
      CLAUDE_HAIKU_55.anthropic.purposeClaim,
      ".” For prompts up to 100,000 tokens it prices the model at ",
      CLAUDE_HAIKU_55.anthropic.inputPrice,
      " per million input tokens, ",
      CLAUDE_HAIKU_55.anthropic.outputPrice,
      " per million output tokens, ",
      CLAUDE_HAIKU_55.anthropic.cacheReadPrice,
      " per million cache-read tokens, and ",
      CLAUDE_HAIKU_55.anthropic.cacheWritePrice,
      " per million cache-write tokens; over 100,000 tokens the four prices are ",
      CLAUDE_HAIKU_55.anthropic.longInputPrice,
      ", ",
      CLAUDE_HAIKU_55.anthropic.longOutputPrice,
      ", ",
      CLAUDE_HAIKU_55.anthropic.longCacheReadPrice,
      ", and ",
      CLAUDE_HAIKU_55.anthropic.longCacheWritePrice,
      ". Against Haiku 4.5 at ",
      CLAUDE_HAIKU_55.anthropic.haiku45InputPrice,
      ", ",
      CLAUDE_HAIKU_55.anthropic.haiku45OutputPrice,
      ", and ",
      CLAUDE_HAIKU_55.anthropic.haiku45CacheReadPrice,
      " for input, output, and cache reads, Anthropic writes that “",
      CLAUDE_HAIKU_55.anthropic.savingClaim,
      ",” with a footnote that the model is “",
      CLAUDE_HAIKU_55.anthropic.savingFootnote,
      ",” and calls it “",
      CLAUDE_HAIKU_55.anthropic.promptShareClaim,
      ".”",
      cacheReadSentence,
      haiku45.length === 0
        ? " The snapshot stores no Claude Haiku 4.5 row, so the 75% cannot be checked on the chart."
        : ` The snapshot stores ${pluralConfigurations(haiku45.length)} of Claude Haiku 4.5: ${joinNames(haiku45.map(row => `${row.name} at ${scoreAndCost(row)}`))}.`,
      " Developers reach the model on the Claude Platform as ",
      { text: CLAUDE_HAIKU_55.anthropic.modelId, emphasis: "em" },
      ".",
    ),
    paragraph(
      "The announcement’s benchmark table reports Anthropic’s own runs against ",
      CLAUDE_HAIKU_55.anthropic.comparisonModels,
      ": GDPval-AA v2.1 at ",
      CLAUDE_HAIKU_55.anthropic.vendorGdpval,
      ", OSWorld 2.1 at ",
      CLAUDE_HAIKU_55.anthropic.vendorOsworld,
      " on an offline subset, Humanity’s Last Exam at ",
      CLAUDE_HAIKU_55.anthropic.vendorHle,
      " without tools, Terminal-Bench 4.0 at ",
      CLAUDE_HAIKU_55.anthropic.vendorTerminalBench,
      ", FrontierCode 1.1 (Main) at ",
      CLAUDE_HAIKU_55.anthropic.vendorFrontierCode,
      ", and Chartography at ",
      CLAUDE_HAIKU_55.anthropic.vendorChartography,
      ". Those are vendor numbers; none of them appears on an aicharts chart. Anthropic adds that “",
      CLAUDE_HAIKU_55.anthropic.largerModelsClaim,
      `.” Terminal-Bench 4.0 and GDPval-AA v2.1 are also two of the ${spellCount(evaluationCount)} evaluations inside the Intelligence Index, where Artificial Analysis runs them under its own harness; the snapshot stores the composite score and not the per-evaluation results, so the `,
      CLAUDE_HAIKU_55.anthropic.vendorTerminalBench,
      " cannot be checked against it here.",
    ),
    paragraph(
      placement === undefined || lunaTop === undefined
        ? "GPT-6 Luna, the one model outside Anthropic’s range in that table, has no comparable row in the snapshot, so the chart cannot place the two side by side."
        : `GPT-6 Luna, the one model outside Anthropic’s range in that table, does have rows on the chart: ${pluralConfigurations(luna.length)} with a measured cost, from ${lunaTop.record.name} at ${scoreAndCost(lunaTop.record)} down to ${luna[luna.length - 1]?.record.name ?? ""} at ${scoreAndCost(luna[luna.length - 1]?.record ?? lunaTop.record)}. The highest Luna row scores ${pointsPhrase(-lunaTop.gapPoints)} below ${placement.record.name} at ${formatFineCostMultiple(lunaTop.costMultiple)} its cost${lunaFrontierLevel === undefined || lunaFrontierLevel.below === undefined ? "." : `, and on the chart’s cost frontier it is the vertex directly below ${lunaFrontierLevel.record.name}, ${pointsPhrase(lunaFrontierLevel.record.intelligenceIndex - lunaFrontierLevel.below.intelligenceIndex)} lower for ${costMultipleOf(lunaFrontierLevel.below, lunaFrontierLevel.record)} the cost.`}`,
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

function codingBlocks(
  haikuRows: readonly CodingAgentRecord[],
  codingRecords: readonly CodingAgentRecord[],
  codingRetrievedAt: string,
): BlogBlock[] {
  const anthropicModels = anthropicCodingModels(codingRecords);
  const blocks: BlogBlock[] = [
    paragraph(
      "The ",
      { href: "/coding", text: "coding-agent chart" },
      " is a daily snapshot of the public ",
      { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents comparison" },
      `. A row on it is a model running inside a named agent harness at one effort setting, and its AA Index averages three coding benchmarks: ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas}. Its cost is the mean API bill for one task in that harness, including every tool call and repeated context the harness sends.`,
    ),
  ];
  if (haikuRows.length === 0) {
    blocks.push(paragraph(
      `In the coding-agent snapshot retrieved ${codingRetrievedAt}, no row runs ${MODEL_NAME} in any harness, so this note has no coding-agent score for the model and does not estimate one. `,
      anthropicModels.length === 0
        ? "The snapshot stores no Anthropic row at all."
        : `The Anthropic rows it stores are ${joinNames(anthropicModels.map(entry => `${entry.rows[0]?.agent ?? ""} with ${entry.model} at ${entry.rows.length === 1 ? `${entry.rows[0]?.setting ?? ""}` : `${spellCount(entry.rows.length)} settings`}`))}. `,
      "Anthropic’s announcement quotes Cognition saying that “",
      CLAUDE_HAIKU_55.anthropic.sidekickClaim,
      ",” and a Haiku row on the coding-agent chart would be the model inside a harness like that one; the snapshot does not store one yet.",
    ));
  } else {
    blocks.push(
      paragraph(
        `The coding-agent snapshot retrieved ${codingRetrievedAt} stores ${pluralConfigurations(haikuRows.length)} that run${haikuRows.length === 1 ? "s" : ""} ${MODEL_NAME}: ${joinNames(haikuRows.map(row => `${configurationLabel(row)} at ${formatSnapshotScore(row.benchmarks.aaIndex)} on AA Index for ${formatSnapshotCostUsd(row.economics.costUsd)} per task`))}. Each of those rows is scored on three coding benchmarks inside a harness rather than on the Intelligence Index, so the two scores do not compare.`,
      ),
      table(
        `${MODEL_NAME} rows on the coding-agent chart in the snapshot retrieved ${codingRetrievedAt}, highest AA Index first`,
        ["Configuration", `Coding agents (${SNAPSHOT_COLUMN_LABELS.aaIndex})`, "Cost per task"],
        haikuRows.map(codingRowCells),
      ),
      paragraph(
        "Anthropic’s announcement quotes Cognition saying that “",
        CLAUDE_HAIKU_55.anthropic.sidekickClaim,
        ".” A Haiku row on the coding-agent chart is the model inside a named harness; the rows above are those measurements, not a Devin Fusion score.",
      ),
    );
  }
  return blocks;
}

function derivedTitle(placement: HaikuIntelligencePlacement | undefined): string {
  if (placement === undefined) return `${MODEL_NAME} on the Intelligence Index snapshot`;
  const score = formatSnapshotScore(placement.record.intelligenceIndex);
  const cost = formatSnapshotCostUsd(comparableTaskCost(placement.record));
  const frontier = placement.onCostFrontier
    ? "on the cost frontier"
    : placement.dominators.length === 1
      ? "one row off the cost frontier"
      : "off the cost frontier";
  const withFrontier = `Haiku 5.5 scores ${score} at ${cost}, ${frontier}`;
  if (withFrontier.length <= MAX_TITLE_LENGTH) return withFrontier;
  return `${MODEL_NAME} scores ${score} on the Intelligence Index`;
}

export function createHaiku55Article(
  intelligenceSnapshot: ArtificialAnalysisIntelligenceV43Snapshot = checkedIntelligenceSnapshot(),
  codingSnapshot: CodingAgentSnapshot = checkedCodingSnapshot(),
): BlogArticle {
  const intelligenceRetrievedAt = formatRetrievedAt(intelligenceSnapshot.source.retrievedAt);
  const codingRetrievedAt = formatRetrievedAt(codingSnapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    HAIKU_55_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(intelligenceSnapshot.source.retrievedAt),
    utcCalendarDate(codingSnapshot.source.retrievedAt),
  );
  const intelligence = haikuIntelligencePlacement(intelligenceSnapshot.records);
  const haikuCodingRows = haiku55CodingAgentRows(codingSnapshot.records);
  const indexVersion = intelligenceSnapshot.benchmark.version;
  const weights = intelligenceSnapshot.benchmark.categoryWeightsPercent;
  const evaluations = intelligenceSnapshot.benchmark.evaluations;

  const score = intelligence === undefined ? undefined : formatSnapshotScore(intelligence.record.intelligenceIndex);
  const cost = intelligence === undefined ? undefined : formatSnapshotCostUsd(comparableTaskCost(intelligence.record));
  const title = derivedTitle(intelligence);
  const lowerLevels = intelligence === undefined
    ? []
    : intelligence.effortLadder.filter(step => step.record.id !== intelligence.record.id).toReversed();
  const [onlyDominator] = intelligence?.dominators ?? [];
  const frontierLevelNames = intelligence === undefined
    ? []
    : intelligence.frontierLevels.map(level => effortLabel(level.record));
  const frontierPhrase = intelligence === undefined
    ? ""
    : intelligence.onCostFrontier
      ? " The row is on the chart’s cost frontier."
      : onlyDominator !== undefined && intelligence.dominators.length === 1
        ? ` One cheaper row, ${onlyDominator.name}, scores higher, so the max row is just off the cost frontier${frontierLevelNames.length === 0 ? "." : `; the ${joinNames(frontierLevelNames)} ${frontierLevelNames.length === 1 ? "row is a vertex of it" : "rows are vertices of it"}.`}`
        : ` The row is not on the chart’s cost frontier${frontierLevelNames.length === 0 ? "." : `, though the ${joinNames(frontierLevelNames)} ${frontierLevelNames.length === 1 ? "row is" : "rows are"}.`}`;
  const dekFrontierPhrase = intelligence === undefined
    ? ""
    : intelligence.onCostFrontier
      ? " The row is on the chart’s cost frontier."
      : onlyDominator !== undefined && intelligence.dominators.length === 1
        ? ` One cheaper row keeps the max row off the cost frontier${frontierLevelNames.length === 0 ? "." : `; the ${joinNames(frontierLevelNames)} ${frontierLevelNames.length === 1 ? "row is a vertex of it" : "rows are vertices of it"}.`}`
        : " The row is off the chart’s cost frontier.";
  const dekBase = intelligence === undefined || score === undefined || cost === undefined
    ? undefined
    : `${MODEL_NAME} (${effortLabel(intelligence.record)}) scores ${score} on the Intelligence Index at ${cost} per task, ${spellOrdinal(intelligence.rank)} of ${intelligence.cohortSize} configuration${intelligence.cohortSize === 1 ? "" : "s"}.`;
  const dek = dekBase === undefined
    ? `${MODEL_NAME} appears on the aicharts Intelligence Index chart as one row per effort level. This note states what each row measures and what the chart stores for the rest of Anthropic’s range.`
    : `${dekBase}${dekFrontierPhrase}`.length <= MAX_DEK_LENGTH
      ? `${dekBase}${dekFrontierPhrase}`
      : dekBase;
  const seoDescription = intelligence === undefined || score === undefined || cost === undefined
    ? `${MODEL_NAME} on the aicharts Intelligence Index chart: what each effort level’s row measures and how it places against Sonnet 5.5 and Opus 5.5.`
    : `${MODEL_NAME} (${effortLabel(intelligence.record)}) scores ${score} on the Intelligence Index at ${cost} a task, ${spellOrdinal(intelligence.rank)} of ${intelligence.cohortSize}. What each effort step buys, priced against Sonnet 5.5 and Opus 5.5.`;

  const openingPlacement = intelligence === undefined
    ? `Artificial Analysis measures it on the Intelligence Index, and the aicharts snapshot retrieved ${intelligenceRetrievedAt} stores no ${MODEL_NAME} max-effort row with a measured cost per task, so this note can describe the chart but not place the model on it.`
    : `In the Intelligence Index snapshot retrieved ${intelligenceRetrievedAt}, ${intelligence.record.name} scores ${score} at ${cost} per task, ${spellOrdinal(intelligence.rank)} of the ${comparableCount(intelligence.cohortSize)}, meaning the rows with a measured cost per task.${frontierPhrase}`;
  const cheapestLower = lowerLevels[lowerLevels.length - 1];
  const openingLadder = cheapestLower === undefined
    ? ""
    : ` The ${spellCount(lowerLevels.length)} lower effort ${lowerLevels.length === 1 ? "level" : "levels"} of the same model score${lowerLevels.length === 1 ? "s" : ""} ${joinNames(lowerLevels.map(step => formatSnapshotScore(step.record.intelligenceIndex)))}, and the cheapest of them costs ${formatSnapshotCostUsd(comparableTaskCost(cheapestLower.record))} per task.`;
  const openingCoding = haikuCodingRows.length === 0
    ? ` The coding-agent chart stores no ${MODEL_NAME} row, so this note has no coding-agent score to set beside the Index.`
    : ` The coding-agent chart stores ${pluralConfigurations(haikuCodingRows.length)} running ${MODEL_NAME}, scored on three coding benchmarks inside a harness rather than on the Intelligence Index.`;

  const rankHeading = intelligence === undefined
    ? "Rank among comparable configurations"
    : intelligence.onCostFrontier
      ? `Ranked ${spellOrdinal(intelligence.rank)} of ${intelligence.cohortSize}, on the cost frontier`
      : intelligence.dominators.length === 1
        ? `Ranked ${spellOrdinal(intelligence.rank)} of ${intelligence.cohortSize}, one row off the cost frontier`
        : `Ranked ${spellOrdinal(intelligence.rank)} of ${intelligence.cohortSize}, off the cost frontier`;
  const costHeading = cost === undefined ? "What the cost per task pays for" : `What the ${cost} pays for`;

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: HAIKU_55_ARTICLE_SLUG,
    title,
    dek,
    focusPhrase: "Claude Haiku 5.5 Intelligence Index",
    seoDescription,
    keywords: [
      "Claude Haiku 5.5",
      "Anthropic",
      "Artificial Analysis Intelligence Index",
      "effort level",
      "cost per task",
      "cost frontier",
      "Claude Sonnet 5.5",
      "Claude Opus 5.5",
      "small models",
    ],
    publishedAt: HAIKU_55_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "AI model benchmarks",
    sourceIds: [
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisClaudeHaiku55Model",
      "anthropicClaudeHaiku55",
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: [
      "opus-5-5-intelligence-index",
      "mimo-v2-6-pro-cost-frontier",
      "small-models-have-arrived",
    ],
    nextStep: {
      title: `See where ${MODEL_NAME} sits today`,
      description:
        "The chart redraws from each snapshot, so the rank, the frontier vertices, and the effort ladder above can move. The model page lists every Claude Haiku 5.5 row the site holds.",
      links: [
        { href: "/#intelligence-index", label: "Capability and cost chart" },
        { href: "/models/anthropic/claude-haiku-5-5/index", label: "Claude Haiku 5.5 model page" },
        { href: "/coding", label: "Coding-agent chart" },
      ],
    },
    body: [
      paragraph(
        "Anthropic ",
        { href: BLOG_SOURCES.anthropicClaudeHaiku55.url, text: `released ${MODEL_NAME}` },
        " on ",
        CLAUDE_HAIKU_55.anthropic.announcedOn,
        ". ",
        openingPlacement,
        openingLadder,
        openingCoding,
      ),
      heading("The evaluations behind each row"),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.artificialAnalysisIntelligenceIndex.url, text: "Artificial Analysis Intelligence Index" },
        ` runs a model through its API under one harness that is the same for every model, across ${spellCount(evaluations.length)} evaluations weighted ${weights.agents}% agents, ${weights.coding}% coding, ${weights.scientific}% scientific reasoning, and ${weights.general}% general capability, at version ${indexVersion}. The evaluations are ${joinNames([...evaluations])}. Cost per task is the weighted average API bill for one task across those evaluations, split into input-side cost (non-cached input, cache reads, and cache writes) and output-side cost (reasoning and answer tokens).`,
      ),
      paragraph(
        `A row on the chart is one configuration: the model at one effort level with the settings Artificial Analysis names in the row. `,
        intelligence === undefined || intelligence.effortLadder.length < 2
          ? `The ${MODEL_NAME} rows differ only in effort level.`
          : `The ${MODEL_NAME} rows carry nothing in their names but the effort level, ${joinNames(intelligence.effortLadder.map(step => effortLabel(step.record)).toReversed())}, so every difference between them in this note is a difference in effort.`,
      ),
      heading(rankHeading),
      ...rankBlocks(intelligence, intelligenceRetrievedAt),
      heading("What each effort step buys"),
      ...ladderBlocks(intelligence, intelligenceRetrievedAt),
      heading(costHeading),
      ...costBlocks(intelligence, intelligenceRetrievedAt),
      heading("Haiku against Sonnet 5.5 and Opus 5.5 on the same chart"),
      ...familyBlocks(intelligence, intelligenceSnapshot.records, intelligenceRetrievedAt),
      heading("Anthropic’s prices, its benchmark table, and GPT-6 Luna"),
      ...anthropicBlocks(intelligence, intelligenceSnapshot.records, evaluations.length),
      heading(haikuCodingRows.length === 0 ? "No Haiku row on the coding-agent chart yet" : `${MODEL_NAME} on the coding-agent chart`),
      ...codingBlocks(haikuCodingRows, codingSnapshot.records, codingRetrievedAt),
      callout(
        "What this note does not say",
        `Nothing here ranks ${MODEL_NAME} on coding-agent work. Its Intelligence Index rows score ${spellCount(evaluations.length)} evaluations through the API under one harness; a coding-agent score averages three coding benchmarks inside a named agent, and ${haikuCodingRows.length === 0 ? "the chart does not store one for this model" : "this note only lists the rows the chart stores"}.`,
      ),
      heading("Limits"),
      list(
        [
          `The chart scores, costs, and token counts are Artificial Analysis measurements of the ${MODEL_NAME} rows on the retrieval date under Intelligence Index version ${indexVersion}. They say nothing about other tasks, prompts, or harnesses.`,
        ],
        [
          "The rank, the frontier vertices, the nearest-score table, the effort ladder, the cost shares, and the Anthropic-only frontier are computed from the snapshot by aicharts. A new, removed, or rescored configuration moves them, and the snapshot updates on a schedule.",
        ],
        [
          haikuCodingRows.length === 0
            ? `${MODEL_NAME} inside Claude Code, Devin Fusion, or another harness is a configuration the coding-agent snapshot does not store, so this note says nothing about it.`
            : `The ${MODEL_NAME} coding-agent scores above are the ${joinNames(haikuCodingRows.map(row => configurationLabel(row)))} ${haikuCodingRows.length === 1 ? "row" : "rows"} in the snapshot. They say nothing about ${MODEL_NAME} inside a harness the snapshot does not store.`,
        ],
        [
          `The per-evaluation scores behind the composite are not stored, so no sentence here says which of the ${spellCount(evaluations.length)} evaluations an effort step helps most.`,
        ],
        [
          "The prices, the 75% saving against Haiku 4.5, and the benchmark table are Anthropic’s. aicharts did not run Claude Haiku 5.5.",
        ],
      ),
    ],
  };
}
