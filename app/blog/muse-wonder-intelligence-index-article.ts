import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";
import type { ArtificialAnalysisIntelligenceRecord } from "@/lib/artificial-analysis-intelligence-data";
import {
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "@/lib/artificial-analysis-intelligence-v4-3-data";
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
import { comparableIntelligenceRecords } from "@/lib/intelligence-efficiency";
import { comparableTaskCost, formatPointGap } from "@/lib/mimo-v2-6-pro-frontier";
import {
  META_CREATOR_SLUG,
  MUSE_WONDER_VENDOR_COMPARISON_RELEASE_SLUGS,
  costSideRows,
  creatorFrontier,
  creatorRowsAgainst,
  museWonderIntelligencePlacement,
  vendorComparisonRows,
  type CostSideRow,
  type FamilyRow,
  type MuseWonderIntelligencePlacement,
} from "@/lib/muse-wonder-placement";
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
  formatLongUtcDate,
  formatWholeTokens,
  joinNames,
  latestCalendarDate,
  pluralConfigurations,
  utcCalendarDate,
} from "./grok-4-7-coding-agent-index-article";
import { formatSharePercent } from "./opus-5-5-intelligence-index-article";
import { spellCount } from "./real-swe-private-enterprise-benchmark-article";

export const MUSE_WONDER_ARTICLE_SLUG = "muse-wonder-intelligence-index" as const;
export const MUSE_WONDER_ARTICLE_PUBLISHED_AT = "2026-10-21" as const;

/** Quoted claims from the primary sources, kept verbatim so tests can check every quotation. */
export const MUSE_WONDER = {
  meta: {
    announcedOn: "October 12, 2026",
    launchClaim:
      "Today we’re excited to launch Muse Wonder on Muse Code and Meta Model API at $4 input / $20 output per million tokens (USD)",
    comparableClaim: "Muse Wonder brings comparable performance to Muse Wonder Full",
    fullClaim:
      "Muse Wonder Full is our most advanced model yet, bringing SOTA coding performance, long-running agents, and advanced computer-use capabilities to tackle developers’ most critical workflows",
    leaderboardClaim:
      "Muse Wonder Full tops coding benchmark leaderboards, including DeepSWE and SWE-Marathon in independent third-party runs, outperforming every other model evaluated",
    subscriptionClaim: "available exclusively by subscription in Muse Code",
    inputPrice: "$4.00",
    cachedInputPrice: "$0.20",
    outputPrice: "$20.00",
    contextWindow: "1M",
    powerPlanPrice: "$50.00/month",
    maximumPlanPrice: "$200.00/month",
    maximumPlanClaim: "80x more usage than the Everyday Usage plan",
    columnFull: "Muse Wonder Full (max)",
    columnWonder: "Muse Wonder (max)",
    columnFable: "Claude Fable 5.1 (max)",
    columnAstra: "GPT-6 Astra (max)",
    columnOpus: "Claude Opus 5.5 (max)",
    indexRowLabel: "Artificial Analysis Index",
    indexFull: "56",
    indexWonder: "52",
    indexFable: "53",
    indexAstra: "53",
    indexOpus: "58",
    modelId: "muse-wonder-1.0",
    fullModelId: "muse-wonder-full-1.0",
  },
  artificialAnalysis: {
    capturedOn: "October 21, 2026",
    intelligenceScore: "52",
    classRank: "#9 / 214",
    speedRank: "#27 / 186",
    costRank: "#104 / 113",
    verbosityRank: "#85 / 115",
    inputPrice: "$4.00",
    outputPrice: "$20.00",
    cacheDiscount: "95%",
    costPerTask: "$4.52",
    indexOutputTokens: "130M",
    outputSpeed: "152.2",
    releaseDate: "October 2026",
    summaryClaim:
      "amongst the leading models in intelligence, but somewhat expensive when comparing to other models of similar price",
    speedClaim: "notably fast, however somewhat verbose",
    verbosityClaim: "somewhat verbose in comparison to the median of 82M",
    modalityClaim: "supports text, image, speech, and video input, outputs text, and has a 1M tokens context window",
    cacheNote: "cache write and cache storage are billed separately and vary by provider",
  },
} as const;

const MODEL_NAME = "Muse Wonder" as const;
const FULL_MODEL_NAME = "Muse Wonder Full" as const;
/** The whole-number Intelligence Index figure Meta’s table prints for each API model, by chart release slug. */
const VENDOR_INDEX_BY_RELEASE: Readonly<Record<string, string>> = {
  "claude-fable-5-1": MUSE_WONDER.meta.indexFable,
  "claude-opus-5-5": MUSE_WONDER.meta.indexOpus,
  "gpt-6-astra": MUSE_WONDER.meta.indexAstra,
  "muse-wonder": MUSE_WONDER.meta.indexWonder,
};
const MAX_TITLE_LENGTH = 64;
const MAX_DEK_LENGTH = 200;

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

/** Like `pointsPhrase`, but keeps a second decimal when one decimal would print a gap as zero. */
function finePointsPhrase(points: number): string {
  return Math.abs(points) < 0.05 ? `${Math.abs(points).toFixed(2)} points` : pointsPhrase(points);
}

function scoreAndCost(record: ArtificialAnalysisIntelligenceRecord): string {
  return `${formatSnapshotScore(record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(record))} per task`;
}

function costMultipleOf(record: ArtificialAnalysisIntelligenceRecord, reference: ArtificialAnalysisIntelligenceRecord): string {
  return formatFineCostMultiple(comparableTaskCost(record) / comparableTaskCost(reference));
}

/** “ninth of 116”, the rank phrase the note repeats in its title surfaces. */
function rankPhrase(placement: MuseWonderIntelligencePlacement): string {
  return `${spellOrdinal(placement.rank)} of ${placement.cohortSize}`;
}

function ordinalRank(rank: number): string {
  return rank === 1 ? "the largest" : `the ${spellOrdinal(rank)}-largest`;
}

/** Every coding-agent row whose model name carries Muse Wonder, in any harness, highest AA Index first. */
export function museWonderCodingAgentRows(records: readonly CodingAgentRecord[]): readonly CodingAgentRecord[] {
  return records
    .filter(record => record.model.includes(MODEL_NAME))
    .toSorted((left, right) => (
      (right.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY) - (left.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY)
      || left.id.localeCompare(right.id)
    ));
}

/** Meta-provider coding-agent rows, highest AA Index first. */
function metaCodingRows(records: readonly CodingAgentRecord[]): readonly CodingAgentRecord[] {
  return records
    .filter(record => record.providerId === META_CREATOR_SLUG)
    .toSorted((left, right) => (
      (right.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY) - (left.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY)
      || left.id.localeCompare(right.id)
    ));
}

function missingRowSentence(retrievedAt: string, consequence: string): string {
  return `The Intelligence Index snapshot retrieved ${retrievedAt} stores no ${MODEL_NAME} row with a measured cost per task, so this note cannot ${consequence}.`;
}

function rankBlocks(
  placement: MuseWonderIntelligencePlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [paragraph(missingRowSentence(retrievedAt, "rank the model or place it against the cost frontier"))];
  }
  const { cheaperCount, cheapestHigher, closestBelow, cohortSize, costlierCount, dominators, leader, neighbors, onCostFrontier, rank, record, sameRoundedScore } = placement;
  const cost = comparableTaskCost(record);
  const score = formatSnapshotScore(record.intelligenceIndex);
  const blocks: BlogBlock[] = [
    paragraph(
      `Among the ${cohortSize} comparable configurations in the snapshot retrieved ${retrievedAt}, ${record.name} ranks ${spellOrdinal(rank)} on the index at ${score}. `,
      rank === 1
        ? "No configuration scores higher. "
        : `The leader, ${leader.name}, scores ${scoreAndCost(leader)}, ${pointsPhrase(leader.intelligenceIndex - record.intelligenceIndex)} higher at ${costMultipleOf(leader, record)} the cost. `,
      onCostFrontier
        ? "The row is on the chart’s cost frontier: no comparable configuration scores at least as high at the same or lower cost per task."
        : `The row is off the chart’s cost frontier. ${capitalize(pluralConfigurations(dominators.length))} score${dominators.length === 1 ? "s" : ""} at least as high for less, cheapest first: ${joinNames(dominators.map(dominator => `${dominator.name} at ${scoreAndCost(dominator)} (${costMultipleOf(dominator, record)} the Muse Wonder cost)`))}.`,
      cheapestHigher === undefined || dominators.some(dominator => dominator.id === cheapestHigher.record.id)
        ? ""
        : ` The cheapest configuration that scores higher is ${cheapestHigher.record.name} at ${scoreAndCost(cheapestHigher.record)}, ${formatFineCostMultiple(cheapestHigher.multiple)} its cost.`,
    ),
    paragraph(
      `On cost alone the row sits near the top of the chart: ${cheaperCount === 0 ? "no comparable configuration costs less per task" : `${cheaperCount === 1 ? "one comparable configuration costs" : `${cheaperCount} of the ${cohortSize} cost`} less per task`}, and ${costlierCount === 0 ? "none costs more" : `${costlierCount === 1 ? "one costs" : `${spellCount(costlierCount)} cost`} more`}. `,
      neighbors.length === 0
        ? "No other configuration scores within one index point of it."
        : `Within one index point of the ${score} ${neighbors.length === 1 ? "sits" : "sit"} ${pluralConfigurations(neighbors.length)}: ${joinNames(neighbors.map(neighbor => `${neighbor.name} at ${scoreAndCost(neighbor)}`))}.`,
    ),
  ];
  if (sameRoundedScore.length > 0) {
    blocks.push(paragraph(
      `The chart prints one decimal, and at one decimal ${joinNames(sameRoundedScore.map(row => row.record.name))} ${sameRoundedScore.length === 1 ? "shows" : "show"} the same ${score}. `,
      sameRoundedScore.map(row => (
        `At stored precision ${row.record.name} scores ${finePointsPhrase(row.gapPoints)} ${row.gapPoints < 0 ? "lower" : "higher"}, so it ${row.gapPoints < 0 ? "is not among the rows that beat Muse Wonder on both axes" : "beats Muse Wonder on the index"}; it costs ${formatSnapshotCostUsd(comparableTaskCost(row.record))} per task, ${formatFineCostMultiple(row.costMultiple)} the Muse Wonder cost, for a score that prints the same.`
      )).join(" "),
    ));
  }
  if (closestBelow.length >= 2) {
    const cheaperBelow = closestBelow.filter(entry => entry.costMultiple < 1);
    blocks.push(
      paragraph(
        `The table lists the ${spellCount(closestBelow.length)} highest-scoring configurations after it, with each cost as a multiple of the ${formatSnapshotCostUsd(cost)}. `,
        cheaperBelow.length === closestBelow.length
          ? `Every one of them is cheaper than the Muse Wonder row, and the widest gap is ${pointsPhrase(Math.max(...closestBelow.map(entry => entry.gapPoints)))}.`
          : cheaperBelow.length === 0
            ? "Every one of them costs more than the Muse Wonder row."
            : `${capitalize(spellCount(cheaperBelow.length))} of the ${spellCount(closestBelow.length)} are cheaper than the Muse Wonder row.`,
      ),
      table(
        `The ${spellCount(closestBelow.length)} highest-scoring comparable configurations after ${record.name} in the snapshot retrieved ${retrievedAt}`,
        ["Configuration", "Intelligence Index", "Cost per task", `Points below ${record.name}`, "Multiple of its cost"],
        closestBelow.map(entry => [
          textCell(entry.record.name),
          textCell(formatSnapshotScore(entry.record.intelligenceIndex)),
          textCell(formatSnapshotCostUsd(comparableTaskCost(entry.record))),
          textCell(finePointsPhrase(entry.gapPoints)),
          textCell(formatFineCostMultiple(entry.costMultiple)),
        ]),
      ),
    );
  }
  return blocks;
}

function costSideCells(row: CostSideRow): InlineContent[] {
  return [
    textCell(row.record.name),
    textCell(formatSnapshotScore(row.record.intelligenceIndex)),
    textCell(formatSnapshotCostUsd(comparableTaskCost(row.record))),
    textCell(formatSnapshotCostUsd(row.inputCost)),
    textCell(formatSnapshotCostUsd(row.cacheWriteCost)),
    textCell(formatSnapshotCostUsd(row.outputCost)),
    textCell(formatSharePercent(row.inputShare)),
    textCell(formatFineCostMultiple(row.costMultiple)),
  ];
}

function costBlocks(
  placement: MuseWonderIntelligencePlacement | undefined,
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [paragraph(missingRowSentence(retrievedAt, "split the cost per task into its components"))];
  }
  const { cohortSize, dominators, partRanks, record, sameRoundedScore } = placement;
  const cost = taskCostBreakdown(record);
  const components = [
    { bill: "cache-write", label: "cache writes", part: "cacheWrite", value: cost.cacheWrite },
    { bill: "cache-read", label: "cache reads", part: "cacheRead", value: cost.cacheRead },
    { bill: "non-cached input", label: "non-cached input", part: "nonCacheInput", value: cost.nonCacheInput },
    { bill: "reasoning-token", label: "reasoning tokens", part: "reasoning", value: cost.reasoning },
    { bill: "answer-token", label: "answer tokens", part: "answer", value: cost.answer },
  ] as const;
  const ordered = components.toSorted((left, right) => right.value - left.value);
  const [largest] = ordered;
  const inputShare = inputCostShare(record);
  const above = comparableIntelligenceRecords(records).filter(candidate => candidate.intelligenceIndex > record.intelligenceIndex);
  const aboveWithHigherShare = above.filter(candidate => inputCostShare(candidate) >= inputShare);
  const highestShareAbove = above.length === 0 ? undefined : Math.max(...above.map(inputCostShare));
  const compared = [...dominators, ...sameRoundedScore.map(row => row.record)]
    .filter((candidate, index, all) => all.findIndex(other => other.id === candidate.id) === index);
  const sides = costSideRows(record, compared);
  const outputHeavier = sides.filter(row => row.outputCost > cost.output);
  const blocks: BlogBlock[] = [
    paragraph(
      `Of the ${formatSnapshotCostUsd(cost.total)} per task, ${formatSnapshotCostUsd(cost.input)} is input-side cost and ${formatSnapshotCostUsd(cost.output)} is output. Largest first, the ${spellCount(ordered.length)} components are ${joinNames(ordered.map(component => `${component.label} at ${formatSnapshotCostUsd(component.value)}`))}.`,
      largest === undefined
        ? ""
        : ` ${capitalize(largest.label)} alone ${largest.label.endsWith("s") ? "are" : "is"} ${formatSharePercent(largest.value / cost.total)} of the bill, and the row’s ${largest.bill} bill is ${ordinalRank(partRanks[largest.part].rank)} of any of the ${cohortSize} comparable configurations${partRanks[largest.part].rank === 1 ? ": no row on the chart pays more for that line" : ""}.`,
      ` Its input-side bill is ${ordinalRank(partRanks.input.rank)} and its output-side bill ${ordinalRank(partRanks.output.rank)}, so the row is costly on both sides but far more so on input.`,
    ),
    paragraph(
      `Input-side cost is ${formatSharePercent(inputShare)} of the total. `,
      above.length === 0
        ? "No configuration scores higher, so there is no higher-ranked row to compare that share with."
        : aboveWithHigherShare.length === 0
          ? `Every configuration ranked above it spends a smaller share of its bill on input; the highest share among the ${pluralConfigurations(above.length)} above it is ${formatSharePercent(highestShareAbove ?? 0)}.`
          : `${capitalize(pluralConfigurations(aboveWithHigherShare.length))} ranked above it ${aboveWithHigherShare.length === 1 ? "spends" : "spend"} at least as large a share on input: ${joinNames(aboveWithHigherShare.map(candidate => `${candidate.name} at ${formatSharePercent(inputCostShare(candidate))}`))}.`,
      ` The model writes ${formatWholeTokens(record.outputTokensPerTask.total)} output tokens per task, ${formatSharePercent(reasoningShare(record))} of them reasoning tokens, so the output side is not where the ${formatSnapshotCostUsd(cost.total)} comes from.`,
    ),
  ];
  if (sides.length > 0) {
    blocks.push(
      paragraph(
        `The table splits the bill of each row that beats Muse Wonder on both axes${sameRoundedScore.length === 0 ? "" : ", plus the row that prints the same score,"} into its two sides, cheapest first. `,
        outputHeavier.length === 0
          ? "Each of them spends less than Muse Wonder on both sides."
          : `${joinNames(outputHeavier.map(row => row.record.name))} ${outputHeavier.length === 1 ? "spends" : "spend"} more than Muse Wonder on output and still cost${outputHeavier.length === 1 ? "s" : ""} less in total, because the input side is where the gap is: ${joinNames(outputHeavier.map(row => `${formatSnapshotCostUsd(row.inputCost)} against ${formatSnapshotCostUsd(cost.input)} for ${row.record.name}`))}.`,
      ),
      table(
        `Cost per task by side for ${record.name} and the rows that beat it on both axes in the snapshot retrieved ${retrievedAt}, cheapest first`,
        ["Configuration", "Intelligence Index", "Cost per task", "Input-side cost", "Of which cache writes", "Output-side cost", "Input share of total", "Multiple of the Muse Wonder cost"],
        [
          ...sides.map(costSideCells),
          [
            textCell(record.name),
            textCell(formatSnapshotScore(record.intelligenceIndex)),
            textCell(formatSnapshotCostUsd(cost.total)),
            textCell(formatSnapshotCostUsd(cost.input)),
            textCell(formatSnapshotCostUsd(cost.cacheWrite)),
            textCell(formatSnapshotCostUsd(cost.output)),
            textCell(formatSharePercent(inputShare)),
            textCell(formatFineCostMultiple(1)),
          ],
        ],
      ),
    );
  }
  blocks.push(
    paragraph(
      "Artificial Analysis’s ",
      { href: BLOG_SOURCES.artificialAnalysisMuseWonderModel.url, text: "model page" },
      ", captured ",
      MUSE_WONDER.artificialAnalysis.capturedOn,
      " UTC, lists the prices behind these figures as ",
      MUSE_WONDER.artificialAnalysis.inputPrice,
      " per million input tokens and ",
      MUSE_WONDER.artificialAnalysis.outputPrice,
      " per million output tokens with a ",
      MUSE_WONDER.artificialAnalysis.cacheDiscount,
      " cache discount, and rounds the row to an index score of ",
      MUSE_WONDER.artificialAnalysis.intelligenceScore,
      " at ",
      MUSE_WONDER.artificialAnalysis.costPerTask,
      " per task. It counts ",
      MUSE_WONDER.artificialAnalysis.indexOutputTokens,
      " output tokens to run the whole index, which it calls “",
      MUSE_WONDER.artificialAnalysis.verbosityClaim,
      ",” measures ",
      MUSE_WONDER.artificialAnalysis.outputSpeed,
      " output tokens per second, lists the model as proprietary and released ",
      MUSE_WONDER.artificialAnalysis.releaseDate,
      ", writes that it “",
      MUSE_WONDER.artificialAnalysis.modalityClaim,
      ",” and sums the row up as “",
      MUSE_WONDER.artificialAnalysis.summaryClaim,
      "” and “",
      MUSE_WONDER.artificialAnalysis.speedClaim,
      ".” The page’s pricing notes add that “",
      MUSE_WONDER.artificialAnalysis.cacheNote,
      `.” Meta’s pricing page lists no cache-write price, so the ${formatSnapshotCostUsd(cost.cacheWrite)} cache-write line is taken from the snapshot as Artificial Analysis measured it and is not derived here from a list price.`,
    ),
    paragraph(
      "The same page gives the row four ranks: ",
      MUSE_WONDER.artificialAnalysis.classRank,
      " on intelligence, ",
      MUSE_WONDER.artificialAnalysis.speedRank,
      " on speed, ",
      MUSE_WONDER.artificialAnalysis.costRank,
      " on cost, and ",
      MUSE_WONDER.artificialAnalysis.verbosityRank,
      ` on verbosity, each computed within the page’s own comparison group rather than across the whole index. This chart ranks every configuration with a measured cost per task, which puts the same row ${rankPhrase(placement)} on the index. The denominators differ because the cohorts differ, and a reader should quote the rank with its cohort.`,
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
  placement: MuseWonderIntelligencePlacement | undefined,
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [paragraph(missingRowSentence(retrievedAt, "measure the model against the other Meta rows on the chart"))];
  }
  const { record } = placement;
  const others = creatorRowsAgainst(records, record);
  if (others.length === 0) {
    return [paragraph(`The snapshot stores no other Meta configuration with a measured cost per task, so ${record.name} is the only Meta row on the chart and there is no Meta-only frontier to draw.`)];
  }
  const frontier = creatorFrontier(records);
  const wonderIndex = frontier.findIndex(vertex => vertex.id === record.id);
  const nextDown = wonderIndex >= 0 ? frontier[wonderIndex + 1] : undefined;
  const [highestOther] = others;
  const newerRows = others.filter(row => row.record.releaseDate > record.releaseDate);
  return [
    paragraph(
      `The snapshot stores ${pluralConfigurations(others.length + 1)} from Meta with a measured cost per task. ${record.name} is the highest-scoring of them`,
      highestOther === undefined
        ? "."
        : `; the next, ${highestOther.record.name}, scores ${pointsPhrase(highestOther.gapPoints)} lower at ${formatFineCostMultiple(highestOther.costMultiple)} the cost. The table measures every other Meta row against ${record.name} and marks whether each is a vertex of the cost frontier drawn through Meta rows alone.`,
    ),
    table(
      `Meta rows against ${record.name} in the snapshot retrieved ${retrievedAt}, highest index first`,
      ["Configuration", "Intelligence Index", "Cost per task", `Points against ${record.name}`, "Multiple of its cost", "On the Meta-only frontier"],
      others.map(familyRowCells),
    ),
    paragraph(
      `Walking the Meta-only frontier from the top, the vertices are ${joinNames(frontier.map(vertex => vertex.name))}. `,
      wonderIndex < 0
        ? `${record.name} is not a vertex of it: another Meta row scores at least as high for less.`
        : wonderIndex === 0
          ? `${record.name} is the top vertex${nextDown === undefined ? "." : `, and the step up to it from ${nextDown.name} at ${scoreAndCost(nextDown)} buys ${pointsPhrase(record.intelligenceIndex - nextDown.intelligenceIndex)} for ${costMultipleOf(record, nextDown)} the cost. Within Meta’s range on this chart, that is the price of the last ${pointsPhrase(record.intelligenceIndex - nextDown.intelligenceIndex)}.`}`
          : `${record.name} is a vertex below ${frontier[wonderIndex - 1]?.name ?? ""}.`,
      newerRows.length === 0
        ? ""
        : ` The snapshot dates ${joinNames(newerRows.map(row => `${row.record.name} ${formatLongUtcDate(row.record.releaseDate)}`))}, after ${record.name}, so the Meta range on the chart has already moved since the launch.`,
    ),
  ];
}

function metaBlocks(
  placement: MuseWonderIntelligencePlacement | undefined,
  records: readonly ArtificialAnalysisIntelligenceRecord[],
): BlogBlock[] {
  const vendorRows = vendorComparisonRows(records, MUSE_WONDER_VENDOR_COMPARISON_RELEASE_SLUGS);
  const present = vendorRows.flatMap(row => (row.record === undefined ? [] : [row.record]));
  const charted = placement === undefined ? present : [placement.record, ...present];
  const disagreeing = charted.filter(row => String(Math.round(row.intelligenceIndex)) !== VENDOR_INDEX_BY_RELEASE[row.release.slug]);
  return [
    paragraph(
      "Meta’s ",
      { href: BLOG_SOURCES.metaMuseWonder.url, text: "launch post" },
      " of ",
      MUSE_WONDER.meta.announcedOn,
      " opens with “",
      MUSE_WONDER.meta.launchClaim,
      ".” Its ",
      { href: BLOG_SOURCES.metaMuseWonderModel.url, text: "model page" },
      " prices the API model at ",
      MUSE_WONDER.meta.inputPrice,
      " per million input tokens, ",
      MUSE_WONDER.meta.cachedInputPrice,
      " per million cached input tokens, and ",
      MUSE_WONDER.meta.outputPrice,
      " per million output tokens, with a ",
      MUSE_WONDER.meta.contextWindow,
      " token context window, and names it ",
      { text: MUSE_WONDER.meta.modelId, emphasis: "em" },
      ". The same page lists a second model, ",
      { text: MUSE_WONDER.meta.fullModelId, emphasis: "em" },
      ", with no API prices: ",
      FULL_MODEL_NAME,
      " is “",
      MUSE_WONDER.meta.subscriptionClaim,
      ",” on the Power Usage plan at ",
      MUSE_WONDER.meta.powerPlanPrice,
      " and the Maximum Usage plan at ",
      MUSE_WONDER.meta.maximumPlanPrice,
      ", which Meta describes as “",
      MUSE_WONDER.meta.maximumPlanClaim,
      ".” Meta calls the API model’s performance comparable to the subscription model (“",
      MUSE_WONDER.meta.comparableClaim,
      "”) and says that “",
      MUSE_WONDER.meta.fullClaim,
      ".”",
    ),
    paragraph(
      "The launch post’s benchmark table has five columns, ",
      MUSE_WONDER.meta.columnFull,
      ", ",
      MUSE_WONDER.meta.columnWonder,
      ", ",
      MUSE_WONDER.meta.columnFable,
      ", ",
      MUSE_WONDER.meta.columnAstra,
      ", and ",
      MUSE_WONDER.meta.columnOpus,
      ", and its last row is labelled ",
      MUSE_WONDER.meta.indexRowLabel,
      ", reading ",
      MUSE_WONDER.meta.indexFull,
      ", ",
      MUSE_WONDER.meta.indexWonder,
      ", ",
      MUSE_WONDER.meta.indexFable,
      ", ",
      MUSE_WONDER.meta.indexAstra,
      ", and ",
      MUSE_WONDER.meta.indexOpus,
      ". ",
      placement === undefined || present.length === 0
        ? "The chart cannot check those figures without the corresponding rows."
        : `${capitalize(spellCount(charted.length))} of those five columns are API models with a max-effort row on this chart: ${joinNames(charted.map(row => `${row.name} at ${formatSnapshotScore(row.intelligenceIndex)}`))}. ${disagreeing.length === 0 ? "Each rounds to the whole number in Meta’s row, so on the Intelligence Index line Meta’s table and this chart agree." : `${joinNames(disagreeing.map(row => row.name))} no longer ${disagreeing.length === 1 ? "rounds" : "round"} to the figure in Meta’s row, so the chart has moved since Meta published the table.`} The rest of the table, including Meta’s sentence that “${MUSE_WONDER.meta.leaderboardClaim},” reports vendor-selected runs that this site does not chart, and the ${FULL_MODEL_NAME} column has no counterpart on any aicharts chart because the model has no public API for Artificial Analysis to run.`,
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
  wonderRows: readonly CodingAgentRecord[],
  codingRecords: readonly CodingAgentRecord[],
  codingRetrievedAt: string,
): BlogBlock[] {
  const metaRows = metaCodingRows(codingRecords);
  const blocks: BlogBlock[] = [
    paragraph(
      "The ",
      { href: "/coding", text: "coding-agent chart" },
      " is a daily snapshot of the public ",
      { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents comparison" },
      `. A row there is a model inside a named agent harness at one effort setting, scored on three coding benchmarks (${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas}) and costed as the mean API bill for one task in that harness.`,
    ),
  ];
  if (wonderRows.length === 0) {
    blocks.push(paragraph(
      `In the coding-agent snapshot retrieved ${codingRetrievedAt}, no row runs ${MODEL_NAME} in any harness, so this note has no coding-agent score for the model and does not estimate one. `,
      metaRows.length === 0
        ? "The snapshot stores no Meta row at all."
        : `The Meta rows it does store are ${joinNames(metaRows.map(row => `${configurationLabel(row)} at ${formatSnapshotScore(row.benchmarks.aaIndex)} on AA Index for ${formatSnapshotCostUsd(row.economics.costUsd)} per task`))}. `,
      `DeepSWE appears in Meta’s table as a vendor-reported row and on the coding-agent chart as one of the three benchmarks Artificial Analysis runs inside a harness; the two are different measurements, and this note carries neither across to the other.`,
    ));
  } else {
    blocks.push(
      paragraph(
        `The coding-agent snapshot retrieved ${codingRetrievedAt} stores ${pluralConfigurations(wonderRows.length)} that run${wonderRows.length === 1 ? "s" : ""} ${MODEL_NAME}: ${joinNames(wonderRows.map(row => `${configurationLabel(row)} at ${formatSnapshotScore(row.benchmarks.aaIndex)} on AA Index for ${formatSnapshotCostUsd(row.economics.costUsd)} per task`))}. Those rows are scored on three coding benchmarks inside a harness rather than on the Intelligence Index, so the two scores do not compare.`,
      ),
      table(
        `${MODEL_NAME} rows on the coding-agent chart in the snapshot retrieved ${codingRetrievedAt}, highest AA Index first`,
        ["Configuration", `Coding agents (${SNAPSHOT_COLUMN_LABELS.aaIndex})`, "Cost per task"],
        wonderRows.map(codingRowCells),
      ),
    );
  }
  return blocks;
}

function derivedTitle(placement: MuseWonderIntelligencePlacement | undefined): string {
  if (placement === undefined) return `${MODEL_NAME} on the Intelligence Index snapshot`;
  const score = formatSnapshotScore(placement.record.intelligenceIndex);
  const cost = formatSnapshotCostUsd(comparableTaskCost(placement.record));
  const input = formatSnapshotCostUsd(taskCostBreakdown(placement.record).input);
  const withInput = `${MODEL_NAME}: ${score} at ${cost}, with ${input} of it on the input side`;
  if (withInput.length <= MAX_TITLE_LENGTH) return withInput;
  return `${MODEL_NAME} scores ${score} on the Intelligence Index`;
}

export function createMuseWonderArticle(
  intelligenceSnapshot: ArtificialAnalysisIntelligenceV43Snapshot = checkedIntelligenceSnapshot(),
  codingSnapshot: CodingAgentSnapshot = checkedCodingSnapshot(),
): BlogArticle {
  const intelligenceRetrievedAt = formatRetrievedAt(intelligenceSnapshot.source.retrievedAt);
  const codingRetrievedAt = formatRetrievedAt(codingSnapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    MUSE_WONDER_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(intelligenceSnapshot.source.retrievedAt),
    utcCalendarDate(codingSnapshot.source.retrievedAt),
  );
  const intelligence = museWonderIntelligencePlacement(intelligenceSnapshot.records);
  const wonderCodingRows = museWonderCodingAgentRows(codingSnapshot.records);
  const fullCodingRows = wonderCodingRows.filter(row => row.model.includes(FULL_MODEL_NAME));
  const indexVersion = intelligenceSnapshot.benchmark.version;
  const weights = intelligenceSnapshot.benchmark.categoryWeightsPercent;
  const evaluations = intelligenceSnapshot.benchmark.evaluations;

  const score = intelligence === undefined ? undefined : formatSnapshotScore(intelligence.record.intelligenceIndex);
  const cost = intelligence === undefined ? undefined : formatSnapshotCostUsd(comparableTaskCost(intelligence.record));
  const breakdown = intelligence === undefined ? undefined : taskCostBreakdown(intelligence.record);
  const title = derivedTitle(intelligence);

  const frontierPhrase = intelligence === undefined
    ? ""
    : intelligence.onCostFrontier
      ? "The row is on the chart’s cost frontier."
      : `${capitalize(pluralConfigurations(intelligence.dominators.length))} score${intelligence.dominators.length === 1 ? "s" : ""} at least as high for less, so the row is off the cost frontier.`;
  const dekFrontier = intelligence === undefined
    ? ""
    : intelligence.onCostFrontier
      ? " The row is on the cost frontier."
      : ` ${capitalize(pluralConfigurations(intelligence.dominators.length))} beat${intelligence.dominators.length === 1 ? "s" : ""} it on both axes.`;
  const dekBase = intelligence === undefined || score === undefined || cost === undefined
    ? undefined
    : `Meta’s ${intelligence.record.name} scores ${score} on the Intelligence Index at ${cost} per task, ${rankPhrase(intelligence)} configurations.${dekFrontier}`;
  const dekShare = intelligence === undefined || breakdown === undefined
    ? ""
    : ` Input-side cost is ${formatSharePercent(inputCostShare(intelligence.record))} of the bill.`;
  const dek = dekBase === undefined
    ? `${MODEL_NAME} is Meta’s API model of October 2026. This note states what its Intelligence Index row would measure and what the chart stores for the rest of Meta’s range.`
    : `${dekBase}${dekShare}`.length <= MAX_DEK_LENGTH
      ? `${dekBase}${dekShare}`
      : dekBase;
  const seoDescription = intelligence === undefined || score === undefined || cost === undefined
    ? `${MODEL_NAME} on the aicharts Intelligence Index chart: what its row measures, how the chart places it, and how it sits against the other Meta rows.`
    : `${intelligence.record.name}: ${score} on the Intelligence Index at ${cost} a task, ${rankPhrase(intelligence)}. Where the bill goes, which rows beat it on both axes, and the other Meta rows.`;

  const openingPlacement = intelligence === undefined
    ? `Artificial Analysis measures it on the Intelligence Index, and the aicharts snapshot retrieved ${intelligenceRetrievedAt} stores no ${MODEL_NAME} row with a measured cost per task, so this note can describe the chart but not place the model on it.`
    : `In the Intelligence Index snapshot retrieved ${intelligenceRetrievedAt}, ${intelligence.record.name} scores ${score} at ${cost} per task, ${rankPhrase(intelligence)} comparable configurations, meaning the rows with a measured cost per task. ${frontierPhrase}`;
  const openingCost = intelligence === undefined || breakdown === undefined
    ? ""
    : ` Input-side cost is ${formatSharePercent(inputCostShare(intelligence.record))} of the ${cost}${intelligence.partRanks.cacheWrite.rank === 1 ? ", and the row’s cache-write line is the largest of any row on the chart" : ""}.`;
  const openingCoding = wonderCodingRows.length === 0
    ? ` The coding-agent chart stores no ${MODEL_NAME} row, so this note has no coding-agent score to set beside the Index.`
    : ` The coding-agent chart stores ${pluralConfigurations(wonderCodingRows.length)} running ${MODEL_NAME}, scored on three coding benchmarks inside a harness rather than on the Intelligence Index.`;

  const rankHeading = intelligence === undefined
    ? "Rank among comparable configurations"
    : `Ranked ${rankPhrase(intelligence)}, ${intelligence.onCostFrontier ? "on" : "off"} the cost frontier`;
  const costHeading = cost === undefined ? "Where the cost per task goes" : `Where the ${cost} goes`;

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: MUSE_WONDER_ARTICLE_SLUG,
    title,
    dek,
    focusPhrase: "Muse Wonder Intelligence Index",
    seoDescription,
    keywords: [
      "Muse Wonder",
      "Meta",
      "Artificial Analysis Intelligence Index",
      "cost per task",
      "cost frontier",
      "cache writes",
      "input-side cost",
      "Muse Spark 1.3",
      "Muse Wonder Full",
    ],
    publishedAt: MUSE_WONDER_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "AI model benchmarks",
    sourceIds: [
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisMuseWonderModel",
      "metaMuseWonder",
      "metaMuseWonderModel",
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: [
      "opus-5-5-intelligence-index",
      "haiku-5-5-intelligence-index",
      "mimo-v2-6-pro-cost-frontier",
    ],
    nextStep: {
      title: `See where ${MODEL_NAME} sits today`,
      description:
        "The chart redraws from each snapshot, so the rank, the rows that beat it, and the Meta-only frontier above can move. The model page lists every Muse Wonder row the site holds.",
      links: [
        { href: "/#intelligence-index", label: "Capability and cost chart" },
        { href: "/models/meta/muse-wonder/index", label: "Muse Wonder model page" },
        { href: "/coding", label: "Coding-agent chart" },
      ],
    },
    body: [
      paragraph(
        "Meta ",
        { href: BLOG_SOURCES.metaMuseWonder.url, text: `released ${MODEL_NAME}` },
        " on ",
        MUSE_WONDER.meta.announcedOn,
        ` at ${MUSE_WONDER.meta.inputPrice} per million input tokens and ${MUSE_WONDER.meta.outputPrice} per million output tokens, beside a subscription-only ${FULL_MODEL_NAME} that has no API price. `,
        openingPlacement,
        openingCost,
        openingCoding,
      ),
      heading("The evaluations behind the row"),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.artificialAnalysisIntelligenceIndex.url, text: "Artificial Analysis Intelligence Index" },
        ` scores a model through its API under one harness shared by every model, across ${spellCount(evaluations.length)} evaluations at version ${indexVersion}: ${joinNames([...evaluations])}. The categories weigh ${weights.agents}% agents, ${weights.coding}% coding, ${weights.scientific}% scientific reasoning, and ${weights.general}% general capability. Cost per task is the weighted average API bill for one task across those evaluations. The chart keeps five components of it: non-cached input, cache reads, and cache writes on the input side; reasoning tokens and answer tokens on the output side.`,
      ),
      paragraph(
        intelligence === undefined
          ? `A row on the chart is one configuration, the model at one effort level. The snapshot stores no ${MODEL_NAME} row to describe.`
          : `A row on the chart is one configuration, the model at one effort level with the settings Artificial Analysis names in the row. The snapshot stores ${intelligence.effortLadder.length === 1 && intelligence.otherModes.length === 0 ? "one" : spellCount(intelligence.effortLadder.length + intelligence.otherModes.length)} ${MODEL_NAME} ${intelligence.effortLadder.length + intelligence.otherModes.length === 1 ? "row" : "rows"}, ${intelligence.record.name}${intelligence.effortLadder.length === 1 && intelligence.otherModes.length === 0 ? ", so unlike the Claude Opus 5.5 and Claude Haiku 5.5 notes on this site, there is no effort ladder to tabulate; every figure below is that single row" : ""}.`,
      ),
      heading(rankHeading),
      ...rankBlocks(intelligence, intelligenceRetrievedAt),
      heading(costHeading),
      ...costBlocks(intelligence, intelligenceSnapshot.records, intelligenceRetrievedAt),
      heading(`${MODEL_NAME} against the other Meta rows`),
      ...familyBlocks(intelligence, intelligenceSnapshot.records, intelligenceRetrievedAt),
      heading("Meta’s prices and its benchmark table"),
      ...metaBlocks(intelligence, intelligenceSnapshot.records),
      callout(
        fullCodingRows.length === 0
          ? `${FULL_MODEL_NAME} is on no chart here`
          : `${FULL_MODEL_NAME} has no Intelligence Index row`,
        fullCodingRows.length === 0
          ? `Meta sells ${FULL_MODEL_NAME} only inside Muse Code subscriptions and publishes no per-token price for it. Artificial Analysis costs a row from API prices, so the model has no Intelligence Index row, and nothing in this note scores it. The ${MODEL_NAME} row is the API model, and every number above belongs to it alone.`
          : `Meta sells ${FULL_MODEL_NAME} only inside Muse Code subscriptions and publishes no per-token price for it. Artificial Analysis costs a row from API prices, so the model has no Intelligence Index row, and none of the Index figures above belong to it. The coding-agent chart stores ${pluralConfigurations(fullCodingRows.length)} for ${FULL_MODEL_NAME}; that score is a harness measurement, not an Index score. The ${MODEL_NAME} row is the API model, and every Index number above belongs to it alone.`,
      ),
      heading(wonderCodingRows.length === 0 ? `No ${MODEL_NAME} row on the coding-agent chart` : `${MODEL_NAME} on the coding-agent chart`),
      ...codingBlocks(wonderCodingRows, codingSnapshot.records, codingRetrievedAt),
      heading("Limits"),
      list(
        [
          `The chart score, cost, and token counts are Artificial Analysis measurements of the ${MODEL_NAME} row on the retrieval date under Intelligence Index version ${indexVersion}. They say nothing about other tasks, prompts, or harnesses.`,
        ],
        [
          "The rank, the rows that beat it on both axes, the nearest-score table, the component ranks, the input shares, and the Meta-only frontier are computed from the snapshot by aicharts. A new, removed, or rescored configuration moves them, and the snapshot updates on a schedule.",
        ],
        [
          `The cache-write line depends on how much context the harness writes to cache and on a price Meta does not publish on its pricing page. It is reported here as measured, not explained.`,
        ],
        [
          `The per-evaluation scores behind the composite are not stored, so no sentence here says which of the ${spellCount(evaluations.length)} evaluations the row does well or badly on.`,
        ],
        [
          wonderCodingRows.length === 0
            ? `${MODEL_NAME} inside Muse Code or another harness is a configuration the coding-agent snapshot does not store, so this note says nothing about it.`
            : `The ${MODEL_NAME} coding-agent scores above are the ${joinNames(wonderCodingRows.map(row => configurationLabel(row)))} ${wonderCodingRows.length === 1 ? "row" : "rows"} in the snapshot. They say nothing about ${MODEL_NAME} inside a harness the snapshot does not store.`,
        ],
        [
          `The prices, the subscription plans, the benchmark table, and every sentence about ${FULL_MODEL_NAME} are Meta’s. aicharts did not run ${MODEL_NAME}.`,
        ],
      ),
    ],
  };
}
