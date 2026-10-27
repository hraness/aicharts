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
import {
  KIMI_CREATOR_SLUG,
  kimiK31ProIntelligencePlacement,
  type CreatorBestRow,
  type KimiK31ProIntelligencePlacement,
} from "@/lib/kimi-k3-1-pro-placement";
import { comparableTaskCost, formatPointGap } from "@/lib/mimo-v2-6-pro-frontier";
import {
  costSideRows,
  creatorRowsAgainst,
  type CostSideRow,
  type RowAgainstReference,
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

export const KIMI_K3_1_PRO_ARTICLE_SLUG = "kimi-k3-1-pro-intelligence-index" as const;
export const KIMI_K3_1_PRO_ARTICLE_PUBLISHED_AT = "2026-10-27" as const;

/** Quoted claims from the primary sources, kept verbatim so tests can check every quotation. */
export const KIMI_K3_1_PRO = {
  moonshot: {
    introClaim:
      "the first model in our new K3.1 series and our most capable 3T-class open-weight model to date, with a 1-million-token context window",
    postTrainedClaim:
      "Kimi K3.1 Pro is a post-trained version of Kimi K3, with substantially larger post-training compute",
    weightsClaim: "Full model weights will be released by Nov 4, 2026",
    highspeedClaim: "delivers 2-3× the speed of K3.1 Pro for more responsive interactions",
    terminalBenchClaim:
      "K3.1 Pro scores 65.7%, ahead of GPT-6 Astra (58.2%) and narrowly behind Claude Opus 5.5 (66.4%)",
    harnessNote: "Kimi K3.1 Pro is evaluated with the Claude-Code harness",
    settingsNote:
      "all Kimi K3.1 Pro results reported below are obtained with the reasoning effort set to 'max', temperature = 1.0, and top-p = 0.95",
    effortField: "reasoning_effort",
    effortLevels: "low, high, and max",
    effortDefault: "max",
    modelId: "kimi-k3.1-pro",
    highspeedModelId: "kimi-k3.1-pro-highspeed",
  },
  artificialAnalysis: {
    capturedOn: "October 27, 2026",
    intelligenceScore: "55",
    classRank: "#4 / 221",
    speedRank: "#187 / 192",
    costRank: "#92 / 121",
    verbosityRank: "#98 / 122",
    inputPrice: "$2.00",
    outputPrice: "$10.00",
    cacheDiscount: "90%",
    costPerTask: "$2.11",
    indexOutputTokens: "150M",
    outputSpeed: "41.4",
    releaseDate: "October 2026",
    summaryClaim:
      "Kimi K3.1 Pro is amongst the leading models in intelligence and reasonably priced when comparing to other models of similar price",
    speedClaim: "It's also notably slow and very verbose",
    verbosityClaim: "very verbose in comparison to the median of 81M",
    modalityClaim: "supports text and image input, outputs text, and has a 1M tokens context window",
    reasoningNote: "This page shows the reasoning version of this model. A non-reasoning variant may also exist",
  },
  openRouter: {
    capturedOn: "October 27, 2026",
    description:
      "Kimi K3.1 Pro is Moonshot AI's flagship open-weight multimodal reasoning model and a post-trained successor to Kimi K3, with a 1M-token context window",
    inputPrice: "$2.00",
    outputPrice: "$10.00",
    cacheReadPrice: "$0.20",
    contextTokens: "1,048,576",
    releasedOn: "Oct 23, 2026",
    highspeedInputPrice: "$4.00",
    highspeedOutputPrice: "$20.00",
  },
} as const;

const MODEL_NAME = "Kimi K3.1 Pro" as const;
const COMPANY_NAME = "Moonshot AI" as const;
const CODING_PROVIDER_ID = "moonshot_ai" as const;
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

function scoreAndCost(record: ArtificialAnalysisIntelligenceRecord): string {
  return `${formatSnapshotScore(record.intelligenceIndex)} for ${formatSnapshotCostUsd(comparableTaskCost(record))} per task`;
}

/** “fourth of 114”, the rank phrase the note repeats in its title surfaces. */
function rankPhrase(placement: KimiK31ProIntelligencePlacement): string {
  return `${spellOrdinal(placement.rank)} of ${placement.cohortSize}`;
}

function ordinalRank(rank: number): string {
  return rank === 1 ? "the largest" : `the ${spellOrdinal(rank)}-largest`;
}

/** Possessive of a creator name as the snapshot stores it. */
function possessive(name: string): string {
  return name.endsWith("s") ? `${name}’` : `${name}’s`;
}

/** The one creator every row above the placed row belongs to, or undefined when none or several do. */
function soleCreatorAbove(placement: KimiK31ProIntelligencePlacement): string | undefined {
  return placement.creatorsAbove.length === 1 ? placement.creatorsAbove[0] : undefined;
}

/** Every coding-agent row whose model name carries Kimi K3.1 Pro, in any harness, highest AA Index first. */
export function kimiK31ProCodingAgentRows(records: readonly CodingAgentRecord[]): readonly CodingAgentRecord[] {
  return records
    .filter(record => record.model.includes(MODEL_NAME))
    .toSorted((left, right) => (
      (right.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY) - (left.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY)
      || left.id.localeCompare(right.id)
    ));
}

/** Moonshot-provider coding-agent rows, highest AA Index first. */
export function moonshotCodingAgentRows(records: readonly CodingAgentRecord[]): readonly CodingAgentRecord[] {
  return records
    .filter(record => record.providerId === CODING_PROVIDER_ID)
    .toSorted((left, right) => (
      (right.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY) - (left.benchmarks.aaIndex ?? Number.NEGATIVE_INFINITY)
      || left.id.localeCompare(right.id)
    ));
}

function missingRowSentence(retrievedAt: string, consequence: string): string {
  return `The Intelligence Index snapshot retrieved ${retrievedAt} stores no ${MODEL_NAME} row with a measured cost per task, so this note cannot ${consequence}.`;
}

function againstCells(row: RowAgainstReference): InlineContent[] {
  return [
    textCell(row.record.name),
    textCell(formatSnapshotScore(row.record.intelligenceIndex)),
    textCell(formatSnapshotCostUsd(comparableTaskCost(row.record))),
    textCell(formatPointGap(row.gapPoints)),
    textCell(formatFineCostMultiple(row.costMultiple)),
  ];
}

function rankBlocks(
  placement: KimiK31ProIntelligencePlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [paragraph(missingRowSentence(retrievedAt, "rank the model or place it against the cost frontier"))];
  }
  const { cheaperCount, cheapestHigher, cohortSize, costlierCount, dominators, frontier, neighbors, onCostFrontier, rank, record, rowsAbove } = placement;
  const score = formatSnapshotScore(record.intelligenceIndex);
  const creator = soleCreatorAbove(placement);
  const multiples = rowsAbove.map(row => row.costMultiple);
  const blocks: BlogBlock[] = [
    paragraph(
      `Among the ${cohortSize} comparable configurations in the snapshot retrieved ${retrievedAt}, ${record.name} ranks ${spellOrdinal(rank)} on the index at ${score}. `,
      rowsAbove.length === 0
        ? "No configuration scores higher."
        : `${capitalize(pluralConfigurations(rowsAbove.length))} score${rowsAbove.length === 1 ? "s" : ""} higher${creator === undefined ? "" : `, and every one of them is ${possessive(creator)}`}: ${joinNames(rowsAbove.map(row => `${row.record.name} at ${scoreAndCost(row.record)}, ${pointsPhrase(row.gapPoints)} higher at ${formatFineCostMultiple(row.costMultiple)} the cost`))}. `,
      rowsAbove.length < 2
        ? ""
        : `Each row above it costs between ${formatFineCostMultiple(Math.min(...multiples))} and ${formatFineCostMultiple(Math.max(...multiples))} as much per task. `,
      cheapestHigher === undefined
        ? ""
        : `The cheapest configuration that scores higher is ${cheapestHigher.record.name}, ${formatFineCostMultiple(cheapestHigher.multiple)} its cost for ${pointsPhrase(cheapestHigher.record.intelligenceIndex - record.intelligenceIndex)} more.`,
    ),
  ];
  if (rowsAbove.length >= 2) {
    blocks.push(table(
      `Comparable configurations ranked above ${record.name} in the snapshot retrieved ${retrievedAt}, highest index first`,
      ["Configuration", "Intelligence Index", "Cost per task", `Points against ${record.name}`, "Multiple of its cost"],
      rowsAbove.map(againstCells),
    ));
  }
  blocks.push(
    paragraph(
      onCostFrontier
        ? "The row is on the chart’s cost frontier: no comparable configuration scores at least as high at the same or lower cost per task. "
        : `The row is off the chart’s cost frontier. ${capitalize(pluralConfigurations(dominators.length))} score${dominators.length === 1 ? "s" : ""} at least as high for less, cheapest first: ${joinNames(dominators.map(dominator => `${dominator.name} at ${scoreAndCost(dominator)} (${formatFineCostMultiple(comparableTaskCost(dominator) / comparableTaskCost(record))} the ${MODEL_NAME} cost)`))}. `,
      frontier.up === undefined
        ? (onCostFrontier ? "No frontier vertex sits above it. " : "")
        : `Walking the frontier from the top, the vertex above it is ${frontier.up.record.name} at ${scoreAndCost(frontier.up.record)}: the step up buys ${pointsPhrase(frontier.up.gapPoints)} for ${formatFineCostMultiple(frontier.up.costMultiple)} the cost. `,
      frontier.down === undefined
        ? (onCostFrontier ? "No frontier vertex sits below it, so it is the cheapest configuration on the frontier." : "")
        : `The vertex below it is ${frontier.down.record.name} at ${scoreAndCost(frontier.down.record)}: the step down gives up ${pointsPhrase(frontier.down.gapPoints)} and pays ${formatFineCostMultiple(frontier.down.costMultiple)} the ${MODEL_NAME} cost.`,
    ),
    paragraph(
      `On cost per task the row sits in the upper part of the chart: ${cheaperCount === 0 ? "no comparable configuration costs less" : `${cheaperCount === 1 ? "one comparable configuration costs" : `${cheaperCount} of the ${cohortSize} cost`} less`}, and ${costlierCount === 0 ? "none costs more" : `${costlierCount === 1 ? "one costs" : `${spellCount(costlierCount)} cost`} more`}. `,
      neighbors.length === 0
        ? "No other configuration scores within one index point of it."
        : `Within one index point of the ${score} ${neighbors.length === 1 ? "sits" : "sit"} ${pluralConfigurations(neighbors.length)}: ${joinNames(neighbors.map(neighbor => `${neighbor.name} at ${scoreAndCost(neighbor)}`))}.`,
    ),
  );
  return blocks;
}

function creatorBestCells(row: CreatorBestRow): InlineContent[] {
  return [
    textCell(row.creatorName),
    textCell(row.record.name),
    textCell(formatSnapshotScore(row.record.intelligenceIndex)),
    textCell(formatSnapshotCostUsd(comparableTaskCost(row.record))),
    textCell(formatPointGap(row.gapPoints)),
    textCell(formatFineCostMultiple(row.costMultiple)),
    textCell(String(row.creatorRowCount)),
  ];
}

function creatorBlocks(
  placement: KimiK31ProIntelligencePlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [paragraph(missingRowSentence(retrievedAt, "set the model against the best row of each other creator"))];
  }
  const { otherCreatorBests, record } = placement;
  if (otherCreatorBests.length === 0) {
    return [paragraph(`The snapshot stores no comparable configuration from any creator other than ${record.creator.name}, so there is no other creator to set the row against.`)];
  }
  const creator = soleCreatorAbove(placement);
  const below = otherCreatorBests.filter(row => row.gapPoints < 0);
  const cheaperBelow = below.filter(row => row.costMultiple < 1);
  const [nextBelow] = below;
  return [
    paragraph(
      creator === undefined
        ? (placement.rowsAbove.length === 0
          ? `No creator’s best row scores higher than ${record.name}. `
          : `The rows above ${record.name} come from ${joinNames(placement.creatorsAbove)}. `)
        : `Because every row above it is ${possessive(creator)}, ${record.name} is the highest-scoring configuration from any creator other than ${creator}. `,
      nextBelow === undefined
        ? ""
        : `The next creator’s best row is ${nextBelow.record.name} at ${scoreAndCost(nextBelow.record)}, ${pointsPhrase(nextBelow.gapPoints)} lower at ${formatFineCostMultiple(nextBelow.costMultiple)} the cost. `,
      below.length === 0
        ? ""
        : cheaperBelow.length === 0
          ? `None of the ${spellCount(below.length)} best rows that score lower is cheaper than ${record.name}.`
          : `Of the ${spellCount(below.length)} best rows that score lower, ${cheaperBelow.length === 1 ? "one is" : `${spellCount(cheaperBelow.length)} are`} cheaper: ${joinNames(cheaperBelow.map(row => `${row.record.name} at ${formatFineCostMultiple(row.costMultiple)} the cost for ${pointsPhrase(row.gapPoints)} fewer`))}.`,
      ` The table takes the highest-scoring comparable row of each of the ${spellCount(otherCreatorBests.length)} other creators nearest the top and measures it against ${record.name}.`,
    ),
    table(
      `The highest-scoring comparable configuration of each other creator against ${record.name} in the snapshot retrieved ${retrievedAt}, highest index first`,
      ["Creator", "Configuration", "Intelligence Index", "Cost per task", `Points against ${record.name}`, "Multiple of its cost", "Creator rows on the chart"],
      otherCreatorBests.map(creatorBestCells),
    ),
  ];
}

function costSideCells(row: CostSideRow): InlineContent[] {
  return [
    textCell(row.record.name),
    textCell(formatSnapshotScore(row.record.intelligenceIndex)),
    textCell(formatSnapshotCostUsd(comparableTaskCost(row.record))),
    textCell(formatSnapshotCostUsd(row.inputCost)),
    textCell(formatSnapshotCostUsd(row.outputCost)),
    textCell(formatSharePercent(row.inputShare)),
    textCell(formatFineCostMultiple(row.costMultiple)),
  ];
}

function costBlocks(
  placement: KimiK31ProIntelligencePlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [paragraph(missingRowSentence(retrievedAt, "split the cost per task into its components"))];
  }
  const { cohortSize, partRanks, record, rowsAbove } = placement;
  const cost = taskCostBreakdown(record);
  const components = [
    { bill: "cache-read", label: "cache reads", part: "cacheRead", value: cost.cacheRead },
    { bill: "cache-write", label: "cache writes", part: "cacheWrite", value: cost.cacheWrite },
    { bill: "non-cached input", label: "non-cached input", part: "nonCacheInput", value: cost.nonCacheInput },
    { bill: "reasoning-token", label: "reasoning tokens", part: "reasoning", value: cost.reasoning },
    { bill: "answer-token", label: "answer tokens", part: "answer", value: cost.answer },
  ] as const;
  const ordered = components.toSorted((left, right) => right.value - left.value);
  const [largest] = ordered;
  const inputShare = inputCostShare(record);
  const sides = costSideRows(record, rowsAbove.map(row => row.record));
  const inputLighter = sides.filter(row => row.inputCost < cost.input);
  const blocks: BlogBlock[] = [
    paragraph(
      `Of the ${formatSnapshotCostUsd(cost.total)} per task, ${formatSnapshotCostUsd(cost.input)} is input-side cost and ${formatSnapshotCostUsd(cost.output)} is output, so input is ${formatSharePercent(inputShare)} of the bill. Largest first, the ${spellCount(ordered.length)} components are ${joinNames(ordered.map(component => `${component.label} at ${formatSnapshotCostUsd(component.value)}`))}.`,
      largest === undefined
        ? ""
        : ` ${capitalize(largest.label)} alone ${largest.label.endsWith("s") ? "are" : "is"} ${formatSharePercent(largest.value / cost.total)} of the total, and the row’s ${largest.bill} bill is ${ordinalRank(partRanks[largest.part].rank)} of the ${cohortSize} comparable configurations.`,
      ` Its input-side bill is ${ordinalRank(partRanks.input.rank)} on the chart and its output-side bill ${ordinalRank(partRanks.output.rank)}. The model writes ${formatWholeTokens(record.outputTokensPerTask.total)} output tokens per task, ${formatSharePercent(reasoningShare(record))} of them reasoning tokens.`,
    ),
  ];
  if (sides.length > 0) {
    blocks.push(
      paragraph(
        `The table splits the bill of each row ranked above ${record.name} into its two sides, cheapest first. `,
        inputLighter.length === 0
          ? `Every one of them spends more than ${record.name} on input as well as on output.`
          : `${joinNames(inputLighter.map(row => row.record.name))} ${inputLighter.length === 1 ? "spends" : "spend"} less than ${record.name} on input and still cost${inputLighter.length === 1 ? "s" : ""} more in total.`,
      ),
      table(
        `Cost per task by side for ${record.name} and the rows ranked above it in the snapshot retrieved ${retrievedAt}, cheapest first`,
        ["Configuration", "Intelligence Index", "Cost per task", "Input-side cost", "Output-side cost", "Input share of total", `Multiple of the ${MODEL_NAME} cost`],
        [
          [
            textCell(record.name),
            textCell(formatSnapshotScore(record.intelligenceIndex)),
            textCell(formatSnapshotCostUsd(cost.total)),
            textCell(formatSnapshotCostUsd(cost.input)),
            textCell(formatSnapshotCostUsd(cost.output)),
            textCell(formatSharePercent(inputShare)),
            textCell(formatFineCostMultiple(1)),
          ],
          ...sides.map(costSideCells),
        ],
      ),
    );
  }
  blocks.push(
    paragraph(
      "Artificial Analysis’s ",
      { href: BLOG_SOURCES.artificialAnalysisKimiK31ProModel.url, text: "model page" },
      ", captured ",
      KIMI_K3_1_PRO.artificialAnalysis.capturedOn,
      " UTC, lists the prices behind these figures as ",
      KIMI_K3_1_PRO.artificialAnalysis.inputPrice,
      " per million input tokens and ",
      KIMI_K3_1_PRO.artificialAnalysis.outputPrice,
      " per million output tokens with a ",
      KIMI_K3_1_PRO.artificialAnalysis.cacheDiscount,
      " cache discount, and rounds the row to an index score of ",
      KIMI_K3_1_PRO.artificialAnalysis.intelligenceScore,
      " at ",
      KIMI_K3_1_PRO.artificialAnalysis.costPerTask,
      " per task. It counts ",
      KIMI_K3_1_PRO.artificialAnalysis.indexOutputTokens,
      " output tokens to run the whole index, which it calls “",
      KIMI_K3_1_PRO.artificialAnalysis.verbosityClaim,
      ",” measures ",
      KIMI_K3_1_PRO.artificialAnalysis.outputSpeed,
      " output tokens per second, lists the model as proprietary and released ",
      KIMI_K3_1_PRO.artificialAnalysis.releaseDate,
      ", writes that it “",
      KIMI_K3_1_PRO.artificialAnalysis.modalityClaim,
      ",” and sums the row up as “",
      KIMI_K3_1_PRO.artificialAnalysis.summaryClaim,
      ".” It adds: “",
      KIMI_K3_1_PRO.artificialAnalysis.speedClaim,
      ".” The page also notes that “",
      KIMI_K3_1_PRO.artificialAnalysis.reasoningNote,
      ".”",
    ),
    paragraph(
      "The same page gives the row four ranks: ",
      KIMI_K3_1_PRO.artificialAnalysis.classRank,
      " on intelligence, ",
      KIMI_K3_1_PRO.artificialAnalysis.speedRank,
      " on speed, ",
      KIMI_K3_1_PRO.artificialAnalysis.costRank,
      " on cost, and ",
      KIMI_K3_1_PRO.artificialAnalysis.verbosityRank,
      ` on verbosity, each within the page’s own comparison group. This chart ranks only the configurations with a measured cost per task, which puts the same row ${rankPhrase(placement)}. The two ranks agree on the position and differ on the denominator because the cohorts differ, so a reader quoting either should name its cohort.`,
    ),
  );
  return blocks;
}

function weightsBlocks(
  placement: KimiK31ProIntelligencePlacement | undefined,
  records: readonly ArtificialAnalysisIntelligenceRecord[],
  retrievedAt: string,
): BlogBlock[] {
  const vendorSentences: InlineContent = [
    `${COMPANY_NAME}’s `,
    { href: BLOG_SOURCES.moonshotKimiK31Pro.url, text: "release post" },
    " calls the model “",
    KIMI_K3_1_PRO.moonshot.introClaim,
    ",” and states that “",
    KIMI_K3_1_PRO.moonshot.weightsClaim,
    ".” OpenRouter’s ",
    { href: BLOG_SOURCES.openRouterKimiK31Pro.url, text: "listing" },
    ", captured ",
    KIMI_K3_1_PRO.openRouter.capturedOn,
    " UTC, describes it the same way: “",
    KIMI_K3_1_PRO.openRouter.description,
    ".” The listing dates the release ",
    KIMI_K3_1_PRO.openRouter.releasedOn,
    ", gives a ",
    KIMI_K3_1_PRO.openRouter.contextTokens,
    " token context window, and prices ",
    COMPANY_NAME,
    "’s endpoint at ",
    KIMI_K3_1_PRO.openRouter.inputPrice,
    " per million input tokens, ",
    KIMI_K3_1_PRO.openRouter.outputPrice,
    " per million output tokens, and ",
    KIMI_K3_1_PRO.openRouter.cacheReadPrice,
    " per million cached input tokens. ",
  ];
  if (placement === undefined) {
    return [paragraph(...vendorSentences, missingRowSentence(retrievedAt, "say how the chart flags the row"))];
  }
  const { cohortSize, record, weights } = placement;
  const family = creatorRowsAgainst(records, record, KIMI_CREATOR_SLUG);
  const flagSentence = weights.open === undefined
    ? `The snapshot retrieved ${retrievedAt} carries no weights flag for the ${record.name} row.`
    : weights.open
      ? `The snapshot retrieved ${retrievedAt} flags the ${record.name} row as open weights.`
      : `The snapshot retrieved ${retrievedAt} flags the ${record.name} row as closed: Artificial Analysis lists it as proprietary, and the chart carries that flag until Artificial Analysis changes it, whatever the release post promises.`;
  const countsSentence = ` Of the ${cohortSize} comparable configurations, ${weights.openCount} ${weights.openCount === 1 ? "is" : "are"} flagged open, ${weights.closedCount} closed${weights.unclassifiedCount === 0 ? "" : `, and ${weights.unclassifiedCount} ${weights.unclassifiedCount === 1 ? "carries" : "carry"} no flag`}.`;
  const highestOpenSentence = weights.highestOpen === undefined
    ? " No comparable configuration is flagged open."
    : weights.open === true
      ? ""
      : ` The highest-scoring open-weights row is ${weights.highestOpen.record.name} at ${scoreAndCost(weights.highestOpen.record)}, ${pointsPhrase(weights.highestOpen.gapPoints)} below ${record.name} at ${formatFineCostMultiple(weights.highestOpen.costMultiple)} the cost. If the weights ship and the flag changes while nothing else on the chart moves, the row would sit ${pointsPhrase(weights.highestOpen.gapPoints)} above the highest row flagged open today; this note does not count it there yet.`;
  const familySentence = family.length === 0
    ? ` ${record.name} is the only ${record.creator.name} row on the chart with a measured cost per task.`
    : ` The snapshot stores ${pluralConfigurations(family.length)} from ${record.creator.name} besides it: ${joinNames(family.map(row => `${row.record.name} at ${scoreAndCost(row.record)}, ${pointsPhrase(row.gapPoints)} lower at ${formatFineCostMultiple(row.costMultiple)} the cost${row.record.weights === undefined ? "" : row.record.weights.open ? ", flagged open" : ", flagged closed"}, released ${formatLongUtcDate(row.record.releaseDate)}`))}.`;
  return [
    paragraph(...vendorSentences, flagSentence, countsSentence, highestOpenSentence),
    paragraph(
      familySentence.trimStart(),
      ` The release post says that “${KIMI_K3_1_PRO.moonshot.postTrainedClaim},” and the chart stores no Kimi K3 row with a measured cost per task to set beside it`,
      placement.siblings.length === 0
        ? `, nor a ${MODEL_NAME} Highspeed row: the snapshot has one ${MODEL_NAME} configuration, and every figure in this note belongs to it.`
        : `. The snapshot stores ${pluralConfigurations(placement.siblings.length)} of the same release besides it: ${joinNames(placement.siblings.map(sibling => `${sibling.name} at ${scoreAndCost(sibling)}`))}.`,
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

function vendorBlocks(
  kimiRows: readonly CodingAgentRecord[],
  codingRecords: readonly CodingAgentRecord[],
  codingRetrievedAt: string,
): BlogBlock[] {
  const moonshotRows = moonshotCodingAgentRows(codingRecords);
  const blocks: BlogBlock[] = [
    paragraph(
      "The release post reports that on Terminal-Bench 4.0 “",
      KIMI_K3_1_PRO.moonshot.terminalBenchClaim,
      ",” with a footnote that “",
      KIMI_K3_1_PRO.moonshot.harnessNote,
      "” and that “",
      KIMI_K3_1_PRO.moonshot.settingsNote,
      ".” Those are figures ",
      COMPANY_NAME,
      " reports, with the competitor scores taken from the competitors’ posts and the benchmark leaderboard, and nothing on this site confirms or contradicts them. The post also announces a second model, ",
      { text: KIMI_K3_1_PRO.moonshot.highspeedModelId, emphasis: "em" },
      ", which it says “",
      KIMI_K3_1_PRO.moonshot.highspeedClaim,
      ",” and the OpenRouter listing prices it at ",
      KIMI_K3_1_PRO.openRouter.highspeedInputPrice,
      " and ",
      KIMI_K3_1_PRO.openRouter.highspeedOutputPrice,
      " per million tokens, twice the ",
      { text: KIMI_K3_1_PRO.moonshot.modelId, emphasis: "em" },
      " prices. Kimi’s ",
      { href: BLOG_SOURCES.kimiK31ProApiGuide.url, text: "API guide" },
      ` sets reasoning effort through a ${KIMI_K3_1_PRO.moonshot.effortField} request field with three values, ${KIMI_K3_1_PRO.moonshot.effortLevels}, and a default of ${KIMI_K3_1_PRO.moonshot.effortDefault}. The Intelligence Index row carries no effort label, so the chart does not say which of the three it ran.`,
    ),
    paragraph(
      "The ",
      { href: "/coding", text: "coding-agent chart" },
      " is a daily snapshot of the public ",
      { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents comparison" },
      `. A row there is a model inside a named agent harness at one effort setting, scored on three coding benchmarks (${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas}) and costed as the mean API bill for one task in that harness. `,
      kimiRows.length === 0
        ? `In the coding-agent snapshot retrieved ${codingRetrievedAt}, no row runs ${MODEL_NAME} in any harness, so this note has no coding-agent score for the model and does not estimate one. ${moonshotRows.length === 0 ? `The snapshot stores no ${COMPANY_NAME} row at all.` : `The ${COMPANY_NAME} ${moonshotRows.length === 1 ? "row it does store is" : "rows it does store are"} ${joinNames(moonshotRows.map(row => `${configurationLabel(row)} at ${formatSnapshotScore(row.benchmarks.aaIndex)} on AA Index for ${formatSnapshotCostUsd(row.economics.costUsd)} per task`))}, a different model in a different harness from the Terminal-Bench run the release post reports, so the two do not compare.`}`
        : `The coding-agent snapshot retrieved ${codingRetrievedAt} stores ${pluralConfigurations(kimiRows.length)} that run${kimiRows.length === 1 ? "s" : ""} ${MODEL_NAME}: ${joinNames(kimiRows.map(row => `${configurationLabel(row)} at ${formatSnapshotScore(row.benchmarks.aaIndex)} on AA Index for ${formatSnapshotCostUsd(row.economics.costUsd)} per task`))}. Those rows are scored on three coding benchmarks inside a harness rather than on the Intelligence Index, so the two scores do not compare.`,
    ),
  ];
  if (kimiRows.length > 0) {
    blocks.push(table(
      `${MODEL_NAME} rows on the coding-agent chart in the snapshot retrieved ${codingRetrievedAt}, highest AA Index first`,
      ["Configuration", `Coding agents (${SNAPSHOT_COLUMN_LABELS.aaIndex})`, "Cost per task"],
      kimiRows.map(codingRowCells),
    ));
  }
  return blocks;
}

function derivedTitle(placement: KimiK31ProIntelligencePlacement | undefined): string {
  if (placement === undefined) return `${MODEL_NAME} on the Intelligence Index snapshot`;
  const score = formatSnapshotScore(placement.record.intelligenceIndex);
  const cost = formatSnapshotCostUsd(comparableTaskCost(placement.record));
  const creator = soleCreatorAbove(placement);
  if (placement.rank === 1) {
    const top = `${MODEL_NAME} tops the Intelligence Index at ${score} for ${cost}`;
    if (top.length <= MAX_TITLE_LENGTH) return top;
  } else if (creator !== undefined) {
    const sole = `Only ${creator} outranks ${MODEL_NAME}, at ${score} for ${cost} a task`;
    if (sole.length <= MAX_TITLE_LENGTH) return sole;
  }
  const ranked = `${MODEL_NAME} ranks ${rankPhrase(placement)} at ${score} for ${cost} a task`;
  if (ranked.length <= MAX_TITLE_LENGTH) return ranked;
  return `${MODEL_NAME} ranks ${rankPhrase(placement)} on the Intelligence Index`;
}

export function createKimiK31ProArticle(
  intelligenceSnapshot: ArtificialAnalysisIntelligenceV43Snapshot = checkedIntelligenceSnapshot(),
  codingSnapshot: CodingAgentSnapshot = checkedCodingSnapshot(),
): BlogArticle {
  const intelligenceRetrievedAt = formatRetrievedAt(intelligenceSnapshot.source.retrievedAt);
  const codingRetrievedAt = formatRetrievedAt(codingSnapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    KIMI_K3_1_PRO_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(intelligenceSnapshot.source.retrievedAt),
    utcCalendarDate(codingSnapshot.source.retrievedAt),
  );
  const intelligence = kimiK31ProIntelligencePlacement(intelligenceSnapshot.records);
  const kimiCodingRows = kimiK31ProCodingAgentRows(codingSnapshot.records);
  const indexVersion = intelligenceSnapshot.benchmark.version;
  const weights = intelligenceSnapshot.benchmark.categoryWeightsPercent;
  const evaluations = intelligenceSnapshot.benchmark.evaluations;

  const score = intelligence === undefined ? undefined : formatSnapshotScore(intelligence.record.intelligenceIndex);
  const cost = intelligence === undefined ? undefined : formatSnapshotCostUsd(comparableTaskCost(intelligence.record));
  const creator = intelligence === undefined ? undefined : soleCreatorAbove(intelligence);
  const multiples = intelligence?.rowsAbove.map(row => row.costMultiple) ?? [];
  const multipleRange = multiples.length === 0
    ? ""
    : multiples.length === 1
      ? formatFineCostMultiple(multiples[0] ?? 1)
      : `${formatFineCostMultiple(Math.min(...multiples))} to ${formatFineCostMultiple(Math.max(...multiples))}`;
  const title = derivedTitle(intelligence);

  const frontierPhrase = intelligence === undefined
    ? ""
    : intelligence.onCostFrontier
      ? "on the chart’s cost frontier"
      : `off the chart’s cost frontier, because ${pluralConfigurations(intelligence.dominators.length)} score${intelligence.dominators.length === 1 ? "s" : ""} at least as high for less`;
  const aboveSentence = intelligence === undefined || intelligence.rowsAbove.length === 0
    ? ""
    : creator === undefined
      ? ` The ${spellCount(intelligence.rowsAbove.length)} ${intelligence.rowsAbove.length === 1 ? "row" : "rows"} above it cost${intelligence.rowsAbove.length === 1 ? "s" : ""} ${multipleRange}.`
      : ` The ${spellCount(intelligence.rowsAbove.length)} ${intelligence.rowsAbove.length === 1 ? "row" : "rows"} above it ${intelligence.rowsAbove.length === 1 ? "is" : "are all"} ${possessive(creator)}, at ${multipleRange} the cost.`;
  const dekBase = intelligence === undefined || score === undefined || cost === undefined
    ? undefined
    : `${intelligence.record.name} scores ${score} on the Intelligence Index at ${cost} per task, ${rankPhrase(intelligence)} and ${intelligence.onCostFrontier ? "on" : "off"} the cost frontier.`;
  const dek = dekBase === undefined
    ? `${MODEL_NAME} is ${COMPANY_NAME}’s model of October 2026. This note states what its Intelligence Index row would measure and what the chart stores for the rest of the Kimi range.`
    : `${dekBase}${aboveSentence}`.length <= MAX_DEK_LENGTH
      ? `${dekBase}${aboveSentence}`
      : dekBase;
  const seoDescription = intelligence === undefined || score === undefined || cost === undefined
    ? `${MODEL_NAME} on the aicharts Intelligence Index chart: what its row measures, how the chart places it, and how the chart flags its weights.`
    : `${MODEL_NAME}: ${score} on the Intelligence Index at ${cost} a task, ${rankPhrase(intelligence)}. Who outranks it, what they pay, where the bill goes, and its weights flag.`;

  const openingPlacement = intelligence === undefined
    ? `Artificial Analysis measures it on the Intelligence Index, and the aicharts snapshot retrieved ${intelligenceRetrievedAt} stores no ${MODEL_NAME} row with a measured cost per task, so this note can describe the chart but not place the model on it.`
    : `In the Intelligence Index snapshot retrieved ${intelligenceRetrievedAt}, ${intelligence.record.name} scores ${score} at ${cost} per task, ${rankPhrase(intelligence)} comparable configurations, meaning the rows with a measured cost per task, and ${frontierPhrase}.`;
  const openingCreator = intelligence === undefined
    ? ""
    : intelligence.rowsAbove.length === 0
      ? " No configuration on the chart scores higher."
      : creator === undefined
        ? ` The ${pluralConfigurations(intelligence.rowsAbove.length)} above it come from ${joinNames(intelligence.creatorsAbove)}.`
        : ` Every row above it is ${possessive(creator)}, which makes it the highest-scoring configuration from any other creator, and the cheapest row that scores higher costs ${formatFineCostMultiple(intelligence.cheapestHigher?.multiple ?? 1)} as much.`;
  const openingCoding = kimiCodingRows.length === 0
    ? ` The coding-agent chart stores no ${MODEL_NAME} row.`
    : ` The coding-agent chart stores ${pluralConfigurations(kimiCodingRows.length)} running ${MODEL_NAME}, scored on three coding benchmarks inside a harness rather than on the Intelligence Index.`;

  const rankHeading = intelligence === undefined
    ? "Rank among comparable configurations"
    : intelligence.rowsAbove.length === 0
      ? `${capitalize(rankPhrase(intelligence))}, with no row above it`
      : creator === undefined
        ? `${capitalize(rankPhrase(intelligence))}, behind ${pluralConfigurations(intelligence.rowsAbove.length)}`
        : `${capitalize(rankPhrase(intelligence))}, behind ${spellCount(intelligence.rowsAbove.length)} ${creator} ${intelligence.rowsAbove.length === 1 ? "row" : "rows"}`;
  const creatorHeading = creator === undefined
    ? "The best row of each other creator"
    : `The highest row from outside ${creator}`;
  const costHeading = cost === undefined ? "Inside the cost per task" : `Inside the ${cost} per task`;

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: KIMI_K3_1_PRO_ARTICLE_SLUG,
    title,
    dek,
    focusPhrase: "Kimi K3.1 Pro Intelligence Index",
    seoDescription,
    keywords: [
      "Kimi K3.1 Pro",
      "Moonshot AI",
      "Kimi",
      "Artificial Analysis Intelligence Index",
      "cost per task",
      "cost frontier",
      "open weights",
      "Claude Opus 5.5",
    ],
    publishedAt: KIMI_K3_1_PRO_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "AI model benchmarks",
    sourceIds: [
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisKimiK31ProModel",
      "moonshotKimiK31Pro",
      "kimiK31ProApiGuide",
      "openRouterKimiK31Pro",
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: [
      "muse-wonder-intelligence-index",
      "opus-5-5-intelligence-index",
      "mimo-v2-6-pro-cost-frontier",
    ],
    nextStep: {
      title: `Check the ${MODEL_NAME} row now`,
      description:
        "The chart redraws from each snapshot, so the rank, the rows above it, the frontier steps, and the weights flag can move. The model page lists every Kimi K3.1 Pro row the site holds.",
      links: [
        { href: "/#intelligence-index", label: "Capability and cost chart" },
        { href: "/models/kimi/kimi-k3-1-pro/index", label: "Kimi K3.1 Pro model page" },
        { href: "/coding", label: "Coding-agent chart" },
      ],
    },
    body: [
      paragraph(
        `${COMPANY_NAME} `,
        { href: BLOG_SOURCES.moonshotKimiK31Pro.url, text: `introduced ${MODEL_NAME}` },
        intelligence === undefined
          ? " in October 2026. "
          : ` in October 2026, and Artificial Analysis dates the release ${formatLongUtcDate(intelligence.record.releaseDate)}. `,
        `Its model page and OpenRouter’s listing both price the model at ${KIMI_K3_1_PRO.artificialAnalysis.inputPrice} per million input tokens and ${KIMI_K3_1_PRO.artificialAnalysis.outputPrice} per million output tokens. `,
        openingPlacement,
        openingCreator,
        openingCoding,
      ),
      heading("One row, scored under one harness"),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.artificialAnalysisIntelligenceIndex.url, text: "Artificial Analysis Intelligence Index" },
        ` runs a model through its API under one harness shared by every model, across ${spellCount(evaluations.length)} evaluations at version ${indexVersion}: ${joinNames([...evaluations])}. The categories weigh ${weights.agents}% agents, ${weights.coding}% coding, ${weights.scientific}% scientific reasoning, and ${weights.general}% general capability. Cost per task is the weighted average API bill for one task across those evaluations, and the chart keeps its five components: non-cached input, cache reads, and cache writes on the input side; reasoning tokens and answer tokens on the output side.`,
      ),
      paragraph(
        intelligence === undefined
          ? `A row on the chart is one configuration, the model at one effort level. The snapshot stores no ${MODEL_NAME} row to describe.`
          : `A row on the chart is one configuration, the model at one effort level with the settings Artificial Analysis names in the row. The snapshot stores ${intelligence.effortLadder.length + intelligence.otherModes.length === 1 ? "one" : spellCount(intelligence.effortLadder.length + intelligence.otherModes.length)} ${MODEL_NAME} ${intelligence.effortLadder.length + intelligence.otherModes.length === 1 ? "row" : "rows"}, ${intelligence.record.name}${intelligence.record.effort === null ? ", with no effort label" : ` at ${intelligence.record.effort.label} effort`}${intelligence.effortLadder.length + intelligence.otherModes.length === 1 ? ", so every figure below is that single row" : ""}.`,
      ),
      heading(rankHeading),
      ...rankBlocks(intelligence, intelligenceRetrievedAt),
      heading(creatorHeading),
      ...creatorBlocks(intelligence, intelligenceRetrievedAt),
      heading(costHeading),
      ...costBlocks(intelligence, intelligenceRetrievedAt),
      heading("Closed on the chart, with weights promised"),
      ...weightsBlocks(intelligence, intelligenceSnapshot.records, intelligenceRetrievedAt),
      callout(
        `Why ${MODEL_NAME} costs ${cost ?? "what it costs"} a task at ${KIMI_K3_1_PRO.artificialAnalysis.inputPrice} and ${KIMI_K3_1_PRO.artificialAnalysis.outputPrice} a million`,
        intelligence === undefined
          ? `Cost per task multiplies the tokens a model consumes on each evaluation by its list prices, so two models at the same prices can land far apart. Without a ${MODEL_NAME} row, this note cannot say where its tokens went.`
          : `Cost per task multiplies the tokens the model consumed on each evaluation by its list prices, so two models at the same prices can land far apart. For ${MODEL_NAME}, ${formatSharePercent(inputCostShare(intelligence.record))} of the ${cost ?? ""} is input-side cost, most of it cache reads at the discounted rate, and the ${formatWholeTokens(intelligence.record.outputTokensPerTask.total)} output tokens per task account for the rest. The ${KIMI_K3_1_PRO.openRouter.cacheReadPrice} per million cached input tokens on OpenRouter’s listing is one tenth of the input price, which matches the ${KIMI_K3_1_PRO.artificialAnalysis.cacheDiscount} cache discount Artificial Analysis records.`,
      ),
      heading(`${COMPANY_NAME}’s own benchmarks and the coding-agent chart`),
      ...vendorBlocks(kimiCodingRows, codingSnapshot.records, codingRetrievedAt),
      heading("Limits"),
      list(
        [
          `The chart score, cost, and token counts are Artificial Analysis measurements of the ${MODEL_NAME} row on the retrieval date under Intelligence Index version ${indexVersion}. They say nothing about other tasks, prompts, harnesses, or effort settings.`,
        ],
        [
          "The rank, the rows above it, the frontier steps, the other-creator table, the cost-side table, the component ranks, and the weights counts are computed from the snapshot by aicharts. A new, removed, rescored, or reflagged configuration moves them, and the snapshot updates on a schedule.",
        ],
        [
          `The weights flag is Artificial Analysis’s classification on the retrieval date. The release post’s promise of weights by November 4, 2026 is ${COMPANY_NAME}’s, and nothing here checks whether it is kept.`,
        ],
        [
          `The per-evaluation scores behind the composite are not stored, so no sentence here says which of the ${spellCount(evaluations.length)} evaluations the row does well or badly on.`,
        ],
        [
          kimiCodingRows.length === 0
            ? `${MODEL_NAME} inside Kimi Code CLI, Claude Code, or any other harness is a configuration the coding-agent snapshot does not store, so this note says nothing about it.`
            : `The ${MODEL_NAME} coding-agent scores above are the ${joinNames(kimiCodingRows.map(row => configurationLabel(row)))} ${kimiCodingRows.length === 1 ? "row" : "rows"} in the snapshot. They say nothing about ${MODEL_NAME} inside a harness the snapshot does not store.`,
        ],
        [
          `The Terminal-Bench 4.0 figures, the Highspeed speed claim, the context window, and every sentence about the weights are ${COMPANY_NAME}’s or OpenRouter’s. aicharts did not run ${MODEL_NAME}.`,
        ],
      ),
    ],
  };
}
