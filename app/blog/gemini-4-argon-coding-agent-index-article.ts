import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";
import {
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "@/lib/artificial-analysis-intelligence-v4-3-data";
import type { ComponentContrast } from "@/lib/claude-opus-5-5-placement";
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
  gemini4ArgonCodingAgentPlacement,
  gemini4ArgonIntelligencePlacement,
  matchesGemini4ArgonCoding,
  type Gemini4ArgonCodingAgentPlacement,
} from "@/lib/gemini-4-argon-placement";
import { comparableTaskCost, formatCostMultiple, formatPointGap } from "@/lib/mimo-v2-6-pro-frontier";
import { modelAddedAt, spellOrdinal, type IntelligencePlacement } from "@/lib/snapshot-placement";

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
  formatMillionTokens,
  formatMinutes,
  formatWholeTokens,
  joinNames,
  latestCalendarDate,
  pluralConfigurations,
  utcCalendarDate,
} from "./grok-4-7-coding-agent-index-article";
import { formatCostPercent, pointsPhrase } from "./opus-5-5-coding-agent-index-article";
import { spellCount } from "./real-swe-private-enterprise-benchmark-article";

export const GEMINI_4_ARGON_ARTICLE_SLUG = "gemini-4-argon-coding-agent-index" as const;
export const GEMINI_4_ARGON_ARTICLE_PUBLISHED_AT = "2026-10-06" as const;

/** Quoted claims from the primary sources, kept verbatim so tests can check every quotation. */
export const GEMINI_4_ARGON = {
  google: {
    announcedOn: "September 30, 2026",
    headline: "Gemini 4 Argon: our next era of frontier intelligence",
    rollout: "rolling out to a set of trusted cyber defenders through our Fairwind Program",
    phased: "Safely releasing frontier capabilities at this level requires a phased approach",
    beforeGeneral:
      "before making Argon available to developers, enterprises, and consumers as soon as possible",
    firstCustomers: "starting with paid API customers and Google AI Ultra subscribers",
    introInputPrice: "$2 per million input tokens",
    introOutputPrice: "$10 per million output tokens",
    cacheDiscount: "cached input tokens priced at 95% off input token price",
    laterPrice: "the price of $4 per 1M input tokens and $20 per 1M output tokens will apply",
    outputLimit: "an industry-leading 1M tokens, up from the previous 64K tokens",
    vendorDeepSwe: "It sets a new state of the art on DeepSWE v1.1 (77.9%)",
    otherVendorBenchmarks: "the Vals Index, AutomationBench, CWE-bench v1, and LVBench",
    noGuardrails:
      "For trusted defenders and our own internal teams at Google, we’ll be releasing Argon without cyber guardrails",
  },
  artificialAnalysis: {
    capturedOn: "October 6, 2026",
    releaseDate: "September 30, 2026",
    availability: "Not publicly available",
    apiAccess: "available via API through 1 provider",
    intelligenceScore: "53",
    intelligenceRank: "#8 of 225",
    inputPrice: "$2.00",
    outputPrice: "$10.00",
    cacheDiscount: "95%",
    indexCost: "$1.99",
    indexOutputTokens: "110M",
    contextWindow: "1M",
    summaryLine:
      "amongst the leading models in intelligence and reasonably priced when comparing to other models of similar price",
  },
} as const;

const MODEL_NAME = "Gemini 4 Argon" as const;
const SHORT_NAME = "Argon" as const;
const HARNESS = "Antigravity CLI" as const;
const ROW_LABEL = "Antigravity CLI · Gemini 4 Argon" as const;
const MODEL_CARD_HREF = "/models/google/gemini-4-argon/default" as const;
/** Benchmark families Google quotes in `GEMINI_4_ARGON.google.otherVendorBenchmarks`, matched against Index evaluation names. */
const VENDOR_BENCHMARK_FAMILIES = ["Vals Index", "AutomationBench", "CWE-bench", "LVBench"] as const;
const MAX_TITLE_LENGTH = 64;
const MAX_DEK_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 160;

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

function costPhrase(multiple: number, subject: string): string {
  return multiple > 1
    ? `${formatCostMultiple(multiple)} as much as ${subject}`
    : `${formatCostPercent(multiple)} of ${subject}`;
}

function belowRowCells(
  step: { costMultiple: number; pointsBelow: number; record: Gemini4ArgonCodingAgentPlacement["record"] },
): InlineContent[] {
  return [
    textCell(step.record.seriesLabel),
    textCell(step.record.setting),
    textCell(formatSnapshotScore(step.record.benchmarks.aaIndex)),
    textCell(formatSnapshotCostUsd(step.record.economics.costUsd)),
    textCell(pointsPhrase(step.pointsBelow)),
    textCell(formatCostPercent(step.costMultiple)),
  ];
}

function rankBlocks(
  placement: Gemini4ArgonCodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `The coding-agent snapshot retrieved ${retrievedAt} does not store a ${ROW_LABEL} row with an AA Index and a cost, so this note cannot rank the row or place it on the cost frontier.`,
      ),
    ];
  }
  const { closestBelow, costRank, costedCount, higher, higherCostShares, indexedCount, leader, rank, record } = placement;
  const score = formatSnapshotScore(record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(record.economics.costUsd);
  const costlierHigher = higherCostShares.filter(share => share.costShare < 1).length;
  const costlierLower = costRank - 1 - costlierHigher;
  const blocks: BlogBlock[] = [
    paragraph(
      `The ${score} places ${configurationLabel(record)} ${spellOrdinal(rank)} of the ${indexedCount} configurations that carry an AA Index. `,
      higher.length === 0
        ? "No configuration scores higher. "
        : `${capitalize(pluralConfigurations(higher.length))} score${higher.length === 1 ? "s" : ""} higher: ${joinNames(higher.map(candidate => `${configurationLabel(candidate)} at ${formatSnapshotScore(candidate.benchmarks.aaIndex)}`))}. The leader, ${configurationLabel(leader)}, is ${pointsPhrase(leader.benchmarks.aaIndex - record.benchmarks.aaIndex)} above it at ${formatSnapshotCostUsd(leader.economics.costUsd)} per task. `,
      costedCount === 1
        ? `At ${cost} per task it is the only configuration that carries a cost.`
        : costRank === 1
        ? `Its ${cost} per task is also the highest cost of the ${costedCount} configurations that carry a cost.`
        : `Its ${cost} per task is the ${spellOrdinal(costRank)} highest cost of the ${costedCount} configurations that carry a cost${costlierLower <= 0 ? "." : `; ${pluralConfigurations(costlierLower)} that score${costlierLower === 1 ? "s" : ""} lower cost${costlierLower === 1 ? "s" : ""} more per task.`}`,
    ),
  ];
  if (closestBelow.length >= 2) {
    const [nearest] = closestBelow;
    blocks.push(
      paragraph(
        nearest === undefined
          ? ""
          : `The nearest score below it is ${configurationLabel(nearest.record)} at ${formatSnapshotScore(nearest.record.benchmarks.aaIndex)}, ${pointsPhrase(nearest.pointsBelow)} lower for ${costPhrase(nearest.costMultiple, `the ${SHORT_NAME} row’s cost`)}. `,
        `The table lists the ${spellCount(closestBelow.length)} highest-scoring configurations after it, with each cost as a share of its ${cost}.`,
      ),
      table(
        `The ${spellCount(closestBelow.length)} highest-scoring configurations after ${configurationLabel(record)} in the snapshot retrieved ${retrievedAt}`,
        ["Configuration", "Setting", SNAPSHOT_COLUMN_LABELS.aaIndex, "Cost per task", `Points below ${SHORT_NAME}`, `Share of ${SHORT_NAME}’s cost`],
        closestBelow.map(belowRowCells),
      ),
    );
  } else if (closestBelow.length === 1) {
    const [only] = closestBelow;
    if (only !== undefined) {
      blocks.push(paragraph(
        `The only other configuration with a cost, ${configurationLabel(only.record)}, scores ${formatSnapshotScore(only.record.benchmarks.aaIndex)}, ${pointsPhrase(only.pointsBelow)} lower for ${costPhrase(only.costMultiple, `the ${SHORT_NAME} row’s cost`)}.`,
      ));
    }
  } else {
    blocks.push(paragraph(
      "No other configuration in the snapshot carries both an AA Index at or below it and a cost, so this note has nothing to list beneath it.",
    ));
  }
  return blocks;
}

function shareBlocks(
  placement: Gemini4ArgonCodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `Without a ${ROW_LABEL} row in the snapshot retrieved ${retrievedAt}, this note cannot state what the rows above it cost.`,
      ),
    ];
  }
  const { cheapestHigher, higherCostShares, record } = placement;
  const cost = formatSnapshotCostUsd(record.economics.costUsd);
  if (higherCostShares.length === 0) {
    return [
      paragraph(
        `No costed configuration scores above ${configurationLabel(record)} in the snapshot retrieved ${retrievedAt}, so there is no higher row to price its score against.`,
      ),
    ];
  }
  const allCheaper = higherCostShares.every(share => share.costShare < 1);
  const maxShare = Math.max(...higherCostShares.map(share => share.costShare));
  const blocks: BlogBlock[] = [
    paragraph(
      `The chart’s horizontal axis is cost per task, so the question for a row that is not first is what the rows above it charge for their extra points. `,
      allCheaper
        ? `Every configuration that scores above ${SHORT_NAME} costs more per task. `
        : "",
      ...higherCostShares.map(share => (
        `${configurationLabel(share.record)} charges ${formatSnapshotCostUsd(share.record.economics.costUsd)} for ${pointsPhrase(share.pointsAbove)} more, so the ${cost} is ${costPhrase(share.costShare, "its cost")}. `
      )),
      cheapestHigher === undefined
        ? ""
        : `The cheapest way to buy a higher score on this snapshot is ${configurationLabel(cheapestHigher.record)} at ${formatCostMultiple(cheapestHigher.multiple)} the ${SHORT_NAME} row’s cost.`,
    ),
  ];
  if (higherCostShares.length >= 2) {
    blocks.push(table(
      `Configurations above ${configurationLabel(record)} in the snapshot retrieved ${retrievedAt}, highest AA Index first`,
      ["Configuration", "Setting", SNAPSHOT_COLUMN_LABELS.aaIndex, "Cost per task", `Points above ${SHORT_NAME}`, `${SHORT_NAME}’s cost as a share of theirs`],
      higherCostShares.map(share => [
        textCell(share.record.seriesLabel),
        textCell(share.record.setting),
        textCell(formatSnapshotScore(share.record.benchmarks.aaIndex)),
        textCell(formatSnapshotCostUsd(share.record.economics.costUsd)),
        textCell(pointsPhrase(share.pointsAbove)),
        textCell(formatCostPercent(share.costShare)),
      ]),
    ));
  }
  if (allCheaper && maxShare <= 0.5) {
    blocks.push(paragraph(
      `A reader who wants a score above ${formatSnapshotScore(record.benchmarks.aaIndex)} on this snapshot pays at least ${formatCostMultiple(1 / maxShare)} the ${SHORT_NAME} row’s cost per task to get it. That is the row’s position in one sentence: not the highest score, and at most half the cost of any row that scores above it.`,
    ));
  }
  return blocks;
}

function frontierBlocks(
  placement: Gemini4ArgonCodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `Without a ${ROW_LABEL} row in the snapshot retrieved ${retrievedAt}, this note cannot walk the cost frontier down from it.`,
      ),
    ];
  }
  const { dominators, frontierBelow, onCostFrontier, record } = placement;
  const cost = formatSnapshotCostUsd(record.economics.costUsd);
  const blocks: BlogBlock[] = [
    paragraph(
      "The chart’s cost frontier contains configurations for which no other row costs no more and scores at least as high, with a strict improvement in either measure. ",
      onCostFrontier
        ? `${configurationLabel(record)} is on it${placement.rank === 1 ? ", at the frontier’s highest score" : ""}: nothing on the snapshot scores as high for the same money or less. `
        : `${configurationLabel(record)} is not on it: ${pluralConfigurations(dominators.length)} cost${dominators.length === 1 ? "s" : ""} the same or less per task and score${dominators.length === 1 ? "s" : ""} at least as high. `,
      "The question the frontier answers is what a reader gives up by stepping down from this score to a cheaper row that nothing dominates.",
    ),
  ];
  if (frontierBelow.length === 0) {
    blocks.push(paragraph(
      `In the snapshot retrieved ${retrievedAt}, no frontier vertex scores below ${configurationLabel(record)}, so there is no step down to describe.`,
    ));
    return blocks;
  }
  const [first] = frontierBelow;
  const last = frontierBelow[frontierBelow.length - 1];
  const underHalf = frontierBelow.find(step => step.costMultiple <= 0.5);
  blocks.push(paragraph(
    first === undefined
      ? ""
      : `The first step down is ${configurationLabel(first.record)}: ${pointsPhrase(first.pointsBelow)} lower for ${costPhrase(first.costMultiple, `the ${cost}`)}. `,
    first !== undefined && first.pointsBelow < 1 && first.costMultiple <= 0.25
      ? `That is the step a cost-minded reader will notice: less than a point of index for less than a quarter of the cost. The ${SHORT_NAME} row’s claim on the frontier is the score itself, not a cost advantage over the row beneath it. `
      : "",
    underHalf === undefined
      ? "No frontier vertex costs half as much or less. "
      : underHalf.record.id === first?.record.id
        ? ""
        : `The first vertex at half the cost or less is ${configurationLabel(underHalf.record)}, which gives up ${pointsPhrase(underHalf.pointsBelow)} for ${formatCostPercent(underHalf.costMultiple)} of the cost. `,
    last === undefined || frontierBelow.length < 2
      ? ""
      : `The frontier ends at ${configurationLabel(last.record)}: ${pointsPhrase(last.pointsBelow)} lower for ${formatCostPercent(last.costMultiple)} of the cost.`,
  ));
  if (frontierBelow.length >= 2) {
    blocks.push(table(
      `Cost-frontier configurations below ${configurationLabel(record)} in the snapshot retrieved ${retrievedAt}, highest AA Index first`,
      ["Configuration", "Setting", SNAPSHOT_COLUMN_LABELS.aaIndex, "Cost per task", `Points below ${SHORT_NAME}`, `Share of ${SHORT_NAME}’s cost`],
      frontierBelow.map(belowRowCells),
    ));
  }
  return blocks;
}

/** Other rows that carry exactly `bestOther`’s value on `metric`, so a shared second place is named in full. */
function tiedWithBestOther(
  records: readonly CodingAgentRecord[],
  placed: CodingAgentRecord,
  contrast: ComponentContrast,
): readonly CodingAgentRecord[] {
  const bestValue = contrast.bestOther.benchmarks[contrast.metric];
  return records.filter(candidate => (
    candidate.id !== placed.id
    && candidate.id !== contrast.bestOther.id
    && candidate.benchmarks[contrast.metric] === bestValue
  ));
}

function bestOtherLabel(
  records: readonly CodingAgentRecord[],
  placed: CodingAgentRecord,
  contrast: ComponentContrast,
): string {
  const peers = tiedWithBestOther(records, placed, contrast);
  const names = [contrast.bestOther, ...peers].map(configurationLabel);
  return peers.length === 0
    ? names[0] ?? configurationLabel(contrast.bestOther)
    : `${joinNames(names)}, tied`;
}

/** Other rows that carry exactly the placed row’s value on `metric`, so a shared rank is named in full. */
function tiedWithPlaced(
  records: readonly CodingAgentRecord[],
  placed: CodingAgentRecord,
  metric: ComponentContrast["metric"],
): readonly CodingAgentRecord[] {
  const value = placed.benchmarks[metric];
  if (value === null) return [];
  return records.filter(candidate => candidate.id !== placed.id && candidate.benchmarks[metric] === value);
}

/** Contrasts grouped by the row that leads them, in first-appearance order, so one row is named once. */
function groupByBestOther(
  contrasts: readonly ComponentContrast[],
): readonly { bestOther: CodingAgentRecord; contrasts: readonly ComponentContrast[] }[] {
  const groups: { bestOther: CodingAgentRecord; contrasts: ComponentContrast[] }[] = [];
  for (const contrast of contrasts) {
    const group = groups.find(candidate => candidate.bestOther.id === contrast.bestOther.id);
    if (group === undefined) {
      groups.push({ bestOther: contrast.bestOther, contrasts: [contrast] });
    } else {
      group.contrasts.push(contrast);
    }
  }
  return groups;
}

function componentBlocks(
  placement: Gemini4ArgonCodingAgentPlacement | undefined,
  records: readonly CodingAgentRecord[],
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `Without a ${ROW_LABEL} row in the snapshot retrieved ${retrievedAt}, this note cannot split the index into its components.`,
      ),
    ];
  }
  const { componentContrasts, components, lowerIndexHigherTerminal, record } = placement;
  if (components.length === 0) {
    return [
      paragraph(
        `The ${ROW_LABEL} row in the snapshot retrieved ${retrievedAt} carries an AA Index but no component scores, so this note cannot split the index.`,
      ),
    ];
  }
  const led = componentContrasts.filter(contrast => contrast.gapPoints > 0);
  const tied = componentContrasts.filter(contrast => contrast.gapPoints === 0);
  const trailed = componentContrasts.filter(contrast => contrast.gapPoints < 0);
  const parts = components.map((component) => {
    const ties = tiedWithPlaced(records, record, component.metric);
    const tieClause = ties.length === 0 ? "" : `, tied with ${joinNames(ties.map(configurationLabel))}`;
    return `on ${SNAPSHOT_COLUMN_LABELS[component.metric]} it scores ${formatSnapshotScore(component.value)}, ${spellOrdinal(component.rank)} of ${component.count}${tieClause}`;
  });
  const summary = parts.length === 1
    ? parts.join("")
    : `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
  const blocks: BlogBlock[] = [
    paragraph(
      `AA Index is the mean of three component benchmarks, each ranked here among the configurations that carry it, and ${componentContrasts.length === 0 ? `no other configuration carries a component score to set against the ${SHORT_NAME} row` : led.length === componentContrasts.length ? `the ${SHORT_NAME} row leads every one of them` : led.length === 0 ? `the ${SHORT_NAME} row leads none of them` : `the ${SHORT_NAME} row leads ${led.length === 1 ? "one" : spellCount(led.length)} of them`}. `,
      capitalize(summary),
      ".",
    ),
  ];
  if (componentContrasts.length > 0) {
    const notLed = components.filter(component => (
      !led.some(contrast => contrast.metric === component.metric)
    ));
    blocks.push(paragraph(
      led.length === 0
        ? "It leads none of the components outright; its composite position comes from placing high on all of them at once."
        : `It leads ${joinNames(led.map(contrast => `${SNAPSHOT_COLUMN_LABELS[contrast.metric]} by ${pointsPhrase(contrast.gapPoints)} over ${bestOtherLabel(records, record, contrast)}`))}.`,
      tied.length === 0
        ? ""
        : ` ${joinNames(tied.map(contrast => `${bestOtherLabel(records, record, contrast)} ${tiedWithBestOther(records, record, contrast).length === 0 ? "ties" : "tie"} it on ${SNAPSHOT_COLUMN_LABELS[contrast.metric]}`))}.`,
      trailed.length === 0
        ? ""
        : ` ${joinNames(groupByBestOther(trailed).map(group => (
          `${configurationLabel(group.bestOther)} scores ${joinNames(group.contrasts.map(contrast => `${pointsPhrase(-contrast.gapPoints)} higher on ${SNAPSHOT_COLUMN_LABELS[contrast.metric]}`))}`
        )))}.`,
      led.length > 0 && notLed.length > 0
        ? ` The ${spellOrdinal(placement.rank)} place is a ${joinNames(led.map(contrast => SNAPSHOT_COLUMN_LABELS[contrast.metric]))} result: the row is ${joinNames(notLed.map(component => `${spellOrdinal(component.rank)} of ${component.count} on ${SNAPSHOT_COLUMN_LABELS[component.metric]}`))}, and the composite rests on the component it leads.`
        : "",
    ));
  }
  if (componentContrasts.length >= 2) {
    blocks.push(table(
      `${configurationLabel(record)} on each AA Index component in the snapshot retrieved ${retrievedAt}, against the best other configuration that carries the component`,
      ["Component", `${SHORT_NAME} score`, "Rank", "Best other configuration", "Gap"],
      componentContrasts.map((contrast) => {
        const component = components.find(candidate => candidate.metric === contrast.metric);
        return [
          textCell(SNAPSHOT_COLUMN_LABELS[contrast.metric]),
          textCell(formatSnapshotScore(contrast.value)),
          textCell(component === undefined ? "-" : `${component.rank} of ${component.count}`),
          textCell(`${configurationLabel(contrast.bestOther)} at ${formatSnapshotScore(contrast.bestOther.benchmarks[contrast.metric])}`),
          textCell(contrast.gapPoints === 0 ? "Tie" : `${formatPointGap(contrast.gapPoints)} points`),
        ];
      }),
    ));
  }
  if (record.benchmarks.terminalBench !== null) {
    blocks.push(paragraph(
      lowerIndexHigherTerminal.length === 0
        ? `Every configuration with a lower AA Index also scores lower on ${SNAPSHOT_COLUMN_LABELS.terminalBench}, so a reader who cares only about terminal work orders the top of this chart the same way the composite does.`
        : `${capitalize(pluralConfigurations(lowerIndexHigherTerminal.length))} with a lower AA Index score${lowerIndexHigherTerminal.length === 1 ? "s" : ""} higher on ${SNAPSHOT_COLUMN_LABELS.terminalBench}: ${joinNames(lowerIndexHigherTerminal.map(candidate => `${configurationLabel(candidate)} at ${formatSnapshotScore(candidate.benchmarks.terminalBench)}`))}. A reader who cares only about terminal work would order these rows differently from the composite.`,
    ));
  }
  return blocks;
}

function intelligenceBlocks(
  coding: Gemini4ArgonCodingAgentPlacement | undefined,
  intelligence: IntelligencePlacement | undefined,
  codingRetrievedAt: string,
  intelligenceRetrievedAt: string,
  evaluationCount: number,
  indexVersion: string,
): BlogBlock[] {
  const blocks: BlogBlock[] = [
    paragraph(
      "The ",
      { href: BLOG_SOURCES.artificialAnalysisIntelligenceIndex.url, text: "Artificial Analysis Intelligence Index" },
      ` runs the model through its API under one harness that is the same for every model, across ${spellCount(evaluationCount)} evaluations at version ${indexVersion}, and its cost per task is the average bill for one of those evaluation tasks. `,
      intelligence === undefined
        ? `The Intelligence Index snapshot retrieved ${intelligenceRetrievedAt} stores no comparable ${MODEL_NAME} row, so this note cannot print the two rows side by side.`
        : `In the snapshot retrieved ${intelligenceRetrievedAt}, ${intelligence.record.name} scores ${formatSnapshotScore(intelligence.record.intelligenceIndex)} at ${formatSnapshotCostUsd(comparableTaskCost(intelligence.record))} per task, ${spellOrdinal(intelligence.rank)} of ${intelligence.cohortSize} configurations with a measured cost.`,
    ),
  ];
  if (coding !== undefined && intelligence !== undefined) {
    const codingScore = formatSnapshotScore(coding.record.benchmarks.aaIndex);
    const codingCost = formatSnapshotCostUsd(coding.record.economics.costUsd);
    const indexScore = formatSnapshotScore(intelligence.record.intelligenceIndex);
    const indexCost = formatSnapshotCostUsd(comparableTaskCost(intelligence.record));
    blocks.push(
      table(
        `${MODEL_NAME} in the two aicharts snapshots, each on its own task set with its own cost definition`,
        ["Chart", "Configuration", "Score", "Rank", "Cost per task", "Snapshot retrieved"],
        [
          [
            textCell("Coding agents (AA Index)"),
            textCell(configurationLabel(coding.record)),
            textCell(codingScore),
            textCell(`${coding.rank} of ${coding.indexedCount}`),
            textCell(codingCost),
            textCell(codingRetrievedAt),
          ],
          [
            textCell("Intelligence Index"),
            textCell(intelligence.record.name),
            textCell(indexScore),
            textCell(`${intelligence.rank} of ${intelligence.cohortSize}`),
            textCell(indexCost),
            textCell(intelligenceRetrievedAt),
          ],
        ],
      ),
      paragraph(
        `The ${codingScore} is a mean of three coding benchmarks run inside ${HARNESS}, and the ${indexScore} is a weighted average of ${spellCount(evaluationCount)} evaluations run through the API. The ${codingCost} is the harness’s full bill for one task, ${formatMillionTokens(coding.record.usage.totalTokens)} tokens per task in this snapshot; the ${indexCost} is the average bill for one evaluation task under Artificial Analysis’s standardized harness, with ${formatWholeTokens(intelligence.record.outputTokensPerTask.total)} output tokens per task. `,
        `The model places ${spellOrdinal(coding.rank)} on the coding-agent chart and ${spellOrdinal(intelligence.rank)} on the Index. The two ranks come from different task sets, different cohorts, and different cost definitions. Neither rank corrects the other. `,
        "Artificial Analysis’s ",
        { href: BLOG_SOURCES.artificialAnalysisGemini4ArgonModel.url, text: "model page" },
        ", captured ",
        GEMINI_4_ARGON.artificialAnalysis.capturedOn,
        " UTC, lists the list prices behind both figures, ",
        GEMINI_4_ARGON.artificialAnalysis.inputPrice,
        " per million input tokens and ",
        GEMINI_4_ARGON.artificialAnalysis.outputPrice,
        " per million output tokens with a ",
        GEMINI_4_ARGON.artificialAnalysis.cacheDiscount,
        " cache discount, a rounded index of ",
        GEMINI_4_ARGON.artificialAnalysis.intelligenceScore,
        " (",
        GEMINI_4_ARGON.artificialAnalysis.intelligenceRank,
        " models), and ",
        GEMINI_4_ARGON.artificialAnalysis.indexOutputTokens,
        " output tokens to run the whole index. The page’s FAQ dates the release to ",
        GEMINI_4_ARGON.artificialAnalysis.releaseDate,
        ".",
      ),
      callout(
        "Two charts, two units",
        `Compare ${codingScore} and ${codingCost} with the other rows on the coding-agent chart, and ${indexScore} and ${indexCost} with the other rows on the Intelligence Index chart. Adding, averaging, or ranking the two scores together produces a number neither chart measures.`,
      ),
    );
  }
  return blocks;
}

function derivedTitle(placement: Gemini4ArgonCodingAgentPlacement | undefined): string {
  if (placement === undefined) return `${ROW_LABEL} on the coding-agent chart`;
  const score = formatSnapshotScore(placement.record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(placement.record.economics.costUsd);
  const maxShare = placement.higherCostShares.length === 0
    ? undefined
    : Math.max(...placement.higherCostShares.map(share => share.costShare));
  const candidates = [
    maxShare !== undefined && maxShare < 1
      ? `${MODEL_NAME} at ${score}: every higher row costs at least ${formatCostMultiple(1 / maxShare)}`
      : undefined,
    `${ROW_LABEL}: ${score} at ${cost} a task`,
    `${ROW_LABEL} scores ${score}`,
  ];
  return candidates.find(candidate => candidate !== undefined && candidate.length <= MAX_TITLE_LENGTH)
    ?? `${SHORT_NAME} scores ${score}`;
}

function derivedDek(placement: Gemini4ArgonCodingAgentPlacement | undefined): string {
  if (placement === undefined) {
    return `${MODEL_NAME} appears on the aicharts coding-agent chart as an ${HARNESS} row. This note states what that row measures and where the snapshot stops.`;
  }
  const score = formatSnapshotScore(placement.record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(placement.record.economics.costUsd);
  const rankClause = `${spellOrdinal(placement.rank)} of ${placement.indexedCount} configuration${placement.indexedCount === 1 ? "" : "s"}`;
  const first = `${configurationLabel(placement.record)} scores ${score} on AA Index at ${cost} per task, ${rankClause}.`;
  const maxShare = placement.higherCostShares.length === 0
    ? undefined
    : Math.max(...placement.higherCostShares.map(share => share.costShare));
  const second = maxShare === undefined
    ? ""
    : maxShare < 1
      ? ` Every row above it costs at least ${formatCostMultiple(1 / maxShare)} as much.`
      : "";
  return first.length + second.length <= MAX_DEK_LENGTH ? `${first}${second}` : first;
}

function derivedDescription(placement: Gemini4ArgonCodingAgentPlacement | undefined): string {
  if (placement === undefined) {
    return `${MODEL_NAME} on the aicharts coding-agent chart: what the ${HARNESS} row measures, how the cost frontier is read, and where the snapshot stops.`;
  }
  const score = formatSnapshotScore(placement.record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(placement.record.economics.costUsd);
  const first = `${ROW_LABEL} scores ${score} on the aicharts coding-agent AA Index at ${cost} a task, ${spellOrdinal(placement.rank)} of ${placement.indexedCount} configurations.`;
  const second = " See what the rows above it cost.";
  return first.length + second.length <= MAX_DESCRIPTION_LENGTH ? `${first}${second}` : first;
}

function shareHeading(placement: Gemini4ArgonCodingAgentPlacement | undefined): string {
  if (placement === undefined || placement.higherCostShares.length === 0) {
    return "What the rows above it cost";
  }
  const maxShare = Math.max(...placement.higherCostShares.map(share => share.costShare));
  if (maxShare <= 0.5) return "Every higher row costs at least twice as much";
  if (maxShare < 1) return "Every higher row costs more";
  return "What the rows above it cost";
}

function frontierHeading(placement: Gemini4ArgonCodingAgentPlacement | undefined): string {
  const [first] = placement?.frontierBelow ?? [];
  if (first !== undefined && first.pointsBelow < 1 && first.costMultiple <= 0.25) {
    return "The frontier row beneath it gives up less than a point";
  }
  if (placement === undefined || placement.frontierBelow.length === 0) {
    return "The cost frontier below the row";
  }
  return "What stepping down the cost frontier gives up";
}

function componentHeading(placement: Gemini4ArgonCodingAgentPlacement | undefined): string {
  const led = placement?.componentContrasts.filter(contrast => contrast.gapPoints > 0) ?? [];
  if (led.length === 0 || led.length === placement?.componentContrasts.length) {
    return "Where the index points come from";
  }
  return `${joinNames(led.map(contrast => SNAPSHOT_COLUMN_LABELS[contrast.metric]))} carr${led.length === 1 ? "ies" : "y"} the composite`;
}

export function createGemini4ArgonCodingArticle(
  codingSnapshot: CodingAgentSnapshot = checkedCodingSnapshot(),
  intelligenceSnapshot: ArtificialAnalysisIntelligenceV43Snapshot = checkedIntelligenceSnapshot(),
): BlogArticle {
  const codingRetrievedAt = formatRetrievedAt(codingSnapshot.source.retrievedAt);
  const intelligenceRetrievedAt = formatRetrievedAt(intelligenceSnapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    GEMINI_4_ARGON_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(codingSnapshot.source.retrievedAt),
    utcCalendarDate(intelligenceSnapshot.source.retrievedAt),
  );
  const coding = gemini4ArgonCodingAgentPlacement(codingSnapshot.records);
  const ownRows = codingSnapshot.records.filter(matchesGemini4ArgonCoding);
  const intelligence = gemini4ArgonIntelligencePlacement(intelligenceSnapshot.records);
  const evaluationCount = intelligenceSnapshot.benchmark.evaluationCount;
  const indexVersion = intelligenceSnapshot.benchmark.version;
  const indexVariants = intelligenceSnapshot.benchmark.evaluations.filter(evaluation => (
    VENDOR_BENCHMARK_FAMILIES.some(family => evaluation.toLowerCase().startsWith(family.toLowerCase()))
  ));
  const addedAt = coding === undefined ? undefined : modelAddedAt(codingSnapshot, coding.record);

  const score = coding === undefined ? undefined : formatSnapshotScore(coding.record.benchmarks.aaIndex);
  const cost = coding === undefined ? undefined : formatSnapshotCostUsd(coding.record.economics.costUsd);
  const opening = coding === undefined || score === undefined || cost === undefined
    ? `Artificial Analysis measures coding agents by running a model inside a named harness, and the aicharts coding-agent snapshot retrieved ${codingRetrievedAt} stores no ${ROW_LABEL} row with an AA Index and a cost, so this note can describe the chart but not place the model on it.`
    : `In the aicharts coding-agent snapshot retrieved ${codingRetrievedAt}, ${configurationLabel(coding.record)} scores ${score} on AA Index at a mean API cost of ${cost} per task, ${spellOrdinal(coding.rank)} of the ${coding.indexedCount} configurations that carry an index.`;
  const maxShare = coding === undefined || coding.higherCostShares.length === 0
    ? undefined
    : Math.max(...coding.higherCostShares.map(share => share.costShare));
  const openingShare = coding === undefined || maxShare === undefined || maxShare >= 1
    ? ""
    : ` ${capitalize(pluralConfigurations(coding.higherCostShares.length))} score${coding.higherCostShares.length === 1 ? "s" : ""} higher, and ${coding.higherCostShares.length === 1 ? "it costs" : "the cheaper of them costs"} ${formatCostMultiple(1 / maxShare)} as much per task.`;
  const openingLog = addedAt === undefined
    ? ""
    : ` The snapshot’s update log records the row on ${formatLongUtcDate(addedAt)}.`;
  const rankHeading = coding === undefined
    ? "Rank among the configurations that carry an index"
    : `${capitalize(spellOrdinal(coding.rank))} of ${coding.indexedCount} configurations`;
  const otherRows = coding?.otherProviderRows ?? [];

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: GEMINI_4_ARGON_ARTICLE_SLUG,
    title: derivedTitle(coding),
    dek: derivedDek(coding),
    focusPhrase: "Gemini 4 Argon coding agent AA Index",
    seoDescription: derivedDescription(coding),
    keywords: [
      "Gemini 4 Argon",
      "Antigravity CLI",
      "Google",
      "AA Index",
      "coding agent benchmark",
      "cost frontier",
      "DeepSWE v1.1",
      "Fairwind Program",
      "cost per task",
    ],
    publishedAt: GEMINI_4_ARGON_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "AI model benchmarks",
    sourceIds: [
      "artificialAnalysisCodingAgents",
      "googleGemini4Argon",
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisGemini4ArgonModel",
    ],
    relatedSlugs: [
      "sonnet-5-5-coding-agent-index",
      "opus-5-5-coding-agent-index",
      "gpt-6-1-sol-coding-agent-index",
      "aa-index-cost-coding-agents",
    ],
    nextStep: {
      title: "See where the row sits today",
      description:
        "The coding-agent chart redraws from each day’s snapshot, so the rank, cost rank, cost shares, and frontier steps above can move. The model page lists every Gemini 4 Argon row the site holds, and the data page serves the snapshot itself.",
      links: [
        { href: "/coding", label: "Coding-agent chart" },
        { href: MODEL_CARD_HREF, label: "Gemini 4 Argon model page" },
        { href: "/data", label: "Snapshot data" },
      ],
    },
    body: [
      paragraph(
        opening,
        openingShare,
        " Google ",
        { href: BLOG_SOURCES.googleGemini4Argon.url, text: `announced ${MODEL_NAME}` },
        " on ",
        GEMINI_4_ARGON.google.announcedOn,
        " as a model “",
        GEMINI_4_ARGON.google.rollout,
        ",” not as a general release. The post describes access in terms of those defenders, trusted testers, Google’s own internal teams, and the U.S. government’s voluntary pre-release process, gives no date for wider access, and Artificial Analysis’s model page marks the model “",
        GEMINI_4_ARGON.artificialAnalysis.availability,
        "” on its charts. The chart row this note reads is an independent measurement of a model most readers cannot yet buy.",
        openingLog,
      ),
      heading("One model inside one harness, scored on three benchmarks"),
      paragraph(
        "The ",
        { href: "/coding", text: "coding-agent chart" },
        " is a daily snapshot of the public ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents comparison" },
        `. Each row is one configuration: a model, the agent harness that ran it, and an effort setting. Artificial Analysis runs the harness on tasks from three coding benchmarks, ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas}, and AA Index is the mean of the three scores. The cost is the mean API bill for one task in that harness at list prices, including every tool call and every repeated read of the repository the harness sends.`,
      ),
      paragraph(
        coding === undefined
          ? `${MODEL_NAME}’s row would be the model inside ${HARNESS}, Google’s coding agent, at one effort setting.`
          : `${MODEL_NAME}’s row is the model inside ${HARNESS}, Google’s coding agent, at the ${coding.record.setting} setting. One task in that configuration used ${formatMillionTokens(coding.record.usage.totalTokens)} tokens and took ${formatMinutes(coding.record.economics.durationSeconds)} of harness time on average. The snapshot stores ${pluralConfigurations(ownRows.length)} running ${MODEL_NAME}, so there is no effort ladder to climb and no second harness to compare; the same model at another setting or in another harness would be another row. `,
        coding === undefined
          ? ""
          : otherRows.length === 0
            ? "No other Google model carries a costed row on the snapshot."
            : `The other costed Google ${otherRows.length === 1 ? "row" : "rows"} on the snapshot ${otherRows.length === 1 ? "is" : "are"} ${joinNames(otherRows.map(row => `${configurationLabel(row)} at ${formatSnapshotScore(row.benchmarks.aaIndex)} for ${formatSnapshotCostUsd(row.economics.costUsd)}`))}: a different model in a different harness, so the snapshot offers no same-harness predecessor for ${SHORT_NAME}.`,
      ),
      heading(rankHeading),
      ...rankBlocks(coding, codingRetrievedAt),
      heading(shareHeading(coding)),
      ...shareBlocks(coding, codingRetrievedAt),
      heading(frontierHeading(coding)),
      ...frontierBlocks(coding, codingRetrievedAt),
      heading(componentHeading(coding)),
      ...componentBlocks(coding, codingSnapshot.records, codingRetrievedAt),
      heading("The Index row is a different unit"),
      ...intelligenceBlocks(coding, intelligence, codingRetrievedAt, intelligenceRetrievedAt, evaluationCount, indexVersion),
      heading("Who can run the model, and at what price"),
      paragraph(
        "Google’s announcement, titled “",
        GEMINI_4_ARGON.google.headline,
        ",” describes a model “",
        GEMINI_4_ARGON.google.rollout,
        ".” It states that “",
        GEMINI_4_ARGON.google.phased,
        "” and that Google will keep gathering feedback from early testers “",
        GEMINI_4_ARGON.google.beforeGeneral,
        ",” with that wider release “",
        GEMINI_4_ARGON.google.firstCustomers,
        ".” No date is given. The same page says that “",
        GEMINI_4_ARGON.google.noGuardrails,
        ".” A reader of the chart should hold both facts at once: the score is an independent measurement, and the configuration it measures is one that Artificial Analysis could reach and most readers cannot.",
      ),
      paragraph(
        "The announcement sets an introductory price of ",
        GEMINI_4_ARGON.google.introInputPrice,
        " and ",
        GEMINI_4_ARGON.google.introOutputPrice,
        ", with “",
        GEMINI_4_ARGON.google.cacheDiscount,
        ",” and its footnote states that after the introductory period “",
        GEMINI_4_ARGON.google.laterPrice,
        ".” The chart’s cost column is computed at list prices, so a list-price change moves the row horizontally while the score stays where it is. The same page raises the output token limit to “",
        GEMINI_4_ARGON.google.outputLimit,
        ".” Artificial Analysis’s model page describes the model as “",
        GEMINI_4_ARGON.artificialAnalysis.summaryLine,
        "” with a ",
        GEMINI_4_ARGON.artificialAnalysis.contextWindow,
        "-token context window. The same page marks the model “",
        GEMINI_4_ARGON.artificialAnalysis.availability,
        "” on its charts while its FAQ says the model is “",
        GEMINI_4_ARGON.artificialAnalysis.apiAccess,
        ".” The two lines describe one situation: an API exists, Artificial Analysis measured the model through it, and Google’s post says who may use it.",
      ),
      heading("Google’s own figures"),
      paragraph(
        "Google reports its own DeepSWE v1.1 run: “",
        GEMINI_4_ARGON.google.vendorDeepSwe,
        ".” Google does not say which harness, task sample, or date produced that figure, so it and the chart’s score are not one measurement taken twice. ",
        coding === undefined || coding.record.benchmarks.deepSwe === null
          ? ""
          : `The chart’s ${SNAPSHOT_COLUMN_LABELS.deepSwe} score for the ${HARNESS} row is ${formatSnapshotScore(coding.record.benchmarks.deepSwe)}, measured by Artificial Analysis inside ${HARNESS} on the retrieval date. `,
        "The announcement also prints vendor-run results on ",
        GEMINI_4_ARGON.google.otherVendorBenchmarks,
        ", none of which appears on the coding-agent chart. ",
        indexVariants.length === 0
          ? ""
          : `${joinNames(indexVariants)} ${indexVariants.length === 1 ? "is Artificial Analysis’s own variant of one of them and counts" : "are Artificial Analysis’s own variants of them and count"} toward the Index row above, not toward the coding-agent row. `,
        "Read Google’s figures as the vendor’s description of its model and read the chart for an independent measurement of one named configuration.",
      ),
      heading("Limits"),
      list(
        [
          `The chart scores, task costs, token counts, and durations are Artificial Analysis measurements of the named configuration on the retrieval date, under ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas} for the coding-agent chart and Intelligence Index version ${indexVersion} for the capability chart. None of them establishes a result on other repositories, tasks, or harnesses.`,
        ],
        [
          "The rank, cost rank, cost shares, frontier steps, and component gaps are aicharts derivations from the snapshots named in each caption. A configuration added, removed, or rescored by Artificial Analysis moves them, and the coding-agent snapshot advances daily.",
        ],
        [
          `${MODEL_NAME} in Cursor, Codex, Claude Code, or any harness other than ${HARNESS} is a configuration this snapshot does not store, so this note says nothing about it. The snapshot also stores no earlier Google model in ${HARNESS}, so there is no same-harness generation step to report.`,
        ],
        [
          "Access to the model is limited to the groups Google describes, and Google has published no general release date. A reader outside that group cannot reproduce the row’s cost or score today, and the introductory list price behind the cost column is one Google has already said will rise.",
        ],
        [
          "The two charts use different task sets and different cost definitions. Their scores are not one ranking.",
        ],
        [
          "The prices, the access statements, and the vendor-run benchmark figures belong to Google. aicharts did not run Gemini 4 Argon.",
        ],
      ),
    ],
  };
}
