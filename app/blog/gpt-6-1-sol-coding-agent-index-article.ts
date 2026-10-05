import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";
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
  gpt61SolCodingAgentPlacement,
  gpt61SolIntelligencePlacement,
  matchesGpt61SolCoding,
  type Gpt61SolCodingAgentPlacement,
  type Gpt61SolIntelligencePlacement,
} from "@/lib/gpt-6-1-sol-placement";
import { comparableTaskCost, formatCostMultiple, formatPointGap } from "@/lib/mimo-v2-6-pro-frontier";
import { modelAddedAt, spellOrdinal, type CostedCodingAgentRecord } from "@/lib/snapshot-placement";

import {
  BLOG_SOURCE_NOTE,
  BLOG_SOURCES,
  articleToMarkdown,
  blogArticlePath,
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

export const GPT_6_1_SOL_ARTICLE_SLUG = "gpt-6-1-sol-coding-agent-index" as const;
export const GPT_6_1_SOL_ARTICLE_PUBLISHED_AT = "2026-10-05" as const;

/** Quoted claims from the primary sources, kept verbatim so tests can check every quotation. */
export const GPT_6_1_SOL = {
  openAi: {
    announcedOn: "September 29, 2026",
    headlineClaim: "Near-Astra intelligence for a fifth of the price",
    inputPrice: "$2",
    outputPrice: "$10",
    cachedInputPrice: "$0.10",
    availability: "Plus, Pro, Business, Enterprise, and Edu users in ChatGPT Work and Codex",
    notInChat: "GPT‑6.1 Sol is not yet available in Chat",
    apiName: "gpt-6.1-sol",
    vendorDeepSwe:
      "matches GPT‑6 Astra at roughly one-fifth of the cost, while eclipsing GPT‑6 Sol’s best score by 6.4 percentage points at a lower reasoning effort and cost",
    otherVendorBenchmarks: "GDP.pdf, AutomationBench, OSWorld 2.0, and Terminal-Bench Science 0.1",
    effortLevels: "low, medium (default), high, xhigh, and max",
    contextWindow: "1,050,000",
  },
  artificialAnalysis: {
    capturedOn: "October 5, 2026",
    releaseDate: "September 29, 2026",
    intelligenceScore: "52",
    inputPrice: "$2.00",
    outputPrice: "$10.00",
    cacheDiscount: "95%",
    indexCost: "$0.72",
    indexOutputTokens: "67M",
    contextWindow: "1M",
    summaryLine:
      "amongst the leading models in intelligence and reasonably priced when comparing to other models of similar price",
  },
} as const;

const MODEL_NAME = "GPT-6.1 Sol" as const;
const SHORT_NAME = "GPT-6.1 Sol" as const;
const ROW_LABEL = "Codex · GPT-6.1 Sol" as const;
const PREDECESSOR_LABEL = "Codex · GPT-6 Sol" as const;
const OLD_NOTE_SLUG = "gpt-6-sol-coding-agent-index" as const;
const MAX_TITLE_LENGTH = 64;
const MAX_DEK_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 160;

export type Gpt61SolArticle = Omit<BlogArticle, "slug"> & Readonly<{
  slug: typeof GPT_6_1_SOL_ARTICLE_SLUG;
}>;

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

function maxSetting(placement: Gpt61SolCodingAgentPlacement): CostedCodingAgentRecord | undefined {
  return placement.settings.find(record => record.setting === "max");
}

function placedBeatsMax(placement: Gpt61SolCodingAgentPlacement): boolean {
  const max = maxSetting(placement);
  return max !== undefined
    && placement.record.setting !== "max"
    && (
      max.benchmarks.aaIndex < placement.record.benchmarks.aaIndex
      || max.economics.costUsd > placement.record.economics.costUsd
    );
}

function sameSettingPrevious(
  placement: Gpt61SolCodingAgentPlacement,
): CostedCodingAgentRecord | undefined {
  const previous = placement.previousGeneration;
  if (previous === undefined) return undefined;
  return placement.settings.find(record => record.setting === previous.setting);
}

function modelCardHref(record: Pick<CodingAgentRecord, "setting">): `/${string}` {
  return `/models/openai/gpt-6.1-sol/${record.setting}`;
}

function settingCells(record: CodingAgentRecord, frontierIds: ReadonlySet<string>): InlineContent[] {
  return [
    textCell(record.setting),
    textCell(formatSnapshotScore(record.benchmarks.aaIndex)),
    textCell(formatSnapshotCostUsd(record.economics.costUsd)),
    textCell(frontierIds.has(record.id) ? "Yes" : "No"),
  ];
}

function contrastCells(record: CodingAgentRecord): InlineContent[] {
  return [
    textCell(configurationLabel(record)),
    textCell(formatSnapshotScore(record.benchmarks.aaIndex)),
    textCell(formatSnapshotCostUsd(record.economics.costUsd)),
  ];
}

function displayedTie(left: number, right: number): boolean {
  return formatSnapshotScore(left) === formatSnapshotScore(right);
}

function belowRowCells(
  step: Gpt61SolCodingAgentPlacement["closestBelow"][number],
  placedScore: number,
): InlineContent[] {
  return [
    textCell(step.record.seriesLabel),
    textCell(step.record.setting),
    textCell(formatSnapshotScore(step.record.benchmarks.aaIndex)),
    textCell(formatSnapshotCostUsd(step.record.economics.costUsd)),
    textCell(displayedTie(placedScore, step.record.benchmarks.aaIndex) ? "Tie" : pointsPhrase(step.pointsBelow)),
    textCell(formatCostPercent(step.costMultiple)),
  ];
}

function rankBlocks(
  placement: Gpt61SolCodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `The coding-agent snapshot retrieved ${retrievedAt} does not store a ${ROW_LABEL} row with an AA Index and a cost, so this note cannot rank the row or place it on the cost frontier.`,
      ),
    ];
  }
  const { closestBelow, costRank, costedCount, higher, indexedCount, leader, rank, record } = placement;
  const score = formatSnapshotScore(record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(record.economics.costUsd);
  const blocks: BlogBlock[] = [
    paragraph(
      `The ${score} places ${configurationLabel(record)} ${spellOrdinal(rank)} of the ${indexedCount} configurations that carry an AA Index in the snapshot retrieved ${retrievedAt}. `,
      higher.length === 0
        ? "No configuration scores higher. "
        : `${capitalize(pluralConfigurations(higher.length))} score${higher.length === 1 ? "s" : ""} higher: ${joinNames(higher.map(candidate => `${configurationLabel(candidate)} at ${formatSnapshotScore(candidate.benchmarks.aaIndex)}`))}. The leader, ${configurationLabel(leader)}, is ${pointsPhrase(leader.benchmarks.aaIndex - record.benchmarks.aaIndex)} above it at ${formatSnapshotCostUsd(leader.economics.costUsd)} per task. `,
      costRank === 1
        ? `Its ${cost} per task is also the highest cost of the ${costedCount} configurations that carry a cost.`
        : `Its ${cost} per task is the ${spellOrdinal(costRank)} highest cost of the ${costedCount} configurations that carry a cost.`,
    ),
  ];
  if (closestBelow.length >= 2) {
    const [nearest] = closestBelow;
    blocks.push(
      paragraph(
        nearest === undefined
          ? ""
          : displayedTie(record.benchmarks.aaIndex, nearest.record.benchmarks.aaIndex)
            ? `${configurationLabel(nearest.record)} matches that printed score at ${formatSnapshotScore(nearest.record.benchmarks.aaIndex)} for ${costPhrase(nearest.costMultiple, `the ${SHORT_NAME} row’s cost`)}. `
            : `The nearest score below it is ${configurationLabel(nearest.record)} at ${formatSnapshotScore(nearest.record.benchmarks.aaIndex)}, ${pointsPhrase(nearest.pointsBelow)} lower for ${costPhrase(nearest.costMultiple, `the ${SHORT_NAME} row’s cost`)}. `,
        `The table lists the ${spellCount(closestBelow.length)} highest-scoring configurations after it, with each cost as a share of its ${cost}.`,
      ),
      table(
        `The ${spellCount(closestBelow.length)} highest-scoring configurations after ${configurationLabel(record)} in the snapshot retrieved ${retrievedAt}`,
        ["Configuration", "Setting", SNAPSHOT_COLUMN_LABELS.aaIndex, "Cost per task", `Points below ${SHORT_NAME}`, `Share of ${SHORT_NAME}’s cost`],
        closestBelow.map(step => belowRowCells(step, record.benchmarks.aaIndex)),
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

function settingsBlocks(
  placement: Gpt61SolCodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `Without a ${ROW_LABEL} row in the snapshot retrieved ${retrievedAt}, this note cannot list the Codex effort settings.`,
      ),
    ];
  }
  const { record, settings, settingsOnFrontier } = placement;
  const max = maxSetting(placement);
  const frontierIds = new Set(settingsOnFrontier.map(row => row.id));
  const inversion = placedBeatsMax(placement);
  const blocks: BlogBlock[] = [
    paragraph(
      `The snapshot stores ${spellCount(settings.length)} Codex setting${settings.length === 1 ? "" : "s"} for ${MODEL_NAME}: ${joinNames(settings.map(row => row.setting))}. `,
      `The placed row is ${record.setting}, the highest AA Index among those settings. `,
      max === undefined
        ? "The snapshot stores no max setting for the configuration."
        : inversion
          ? `The max setting scores ${formatSnapshotScore(max.benchmarks.aaIndex)} at ${formatSnapshotCostUsd(max.economics.costUsd)} per task, so it is neither the highest-scoring Codex row nor the cheapest.`
          : `The max setting is the placed row.`,
    ),
  ];
  if (settings.length >= 2) {
    blocks.push(
      table(
        `${ROW_LABEL} settings in the snapshot retrieved ${retrievedAt}, cheapest setting first`,
        ["Setting", SNAPSHOT_COLUMN_LABELS.aaIndex, "Cost per task", "On the cost frontier"],
        settings.map(row => settingCells(row, frontierIds)),
      ),
      paragraph(
        settingsOnFrontier.length === 0
          ? `None of the ${MODEL_NAME} settings sit on the cost frontier.`
          : settingsOnFrontier.length === settings.length
            ? "Every stored setting sits on the cost frontier."
            : `${capitalize(joinNames(settingsOnFrontier.map(row => row.setting)))} sit${settingsOnFrontier.length === 1 ? "s" : ""} on the cost frontier. ${joinNames(settings.filter(row => !frontierIds.has(row.id)).map(row => row.setting))} ${settings.filter(row => !frontierIds.has(row.id)).length === 1 ? "does" : "do"} not: another configuration costs no more and scores at least as high.`,
      ),
    );
  }
  return blocks;
}

function frontierBlocks(
  placement: Gpt61SolCodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `Without a ${ROW_LABEL} row in the snapshot retrieved ${retrievedAt}, this note cannot walk the cost frontier down from it.`,
      ),
    ];
  }
  const { contrastRows, dominators, frontierBelow, onCostFrontier, record } = placement;
  const cost = formatSnapshotCostUsd(record.economics.costUsd);
  const blocks: BlogBlock[] = [
    paragraph(
      "The chart’s cost frontier contains configurations for which no other row costs no more and scores at least as high, with a strict improvement in either measure. ",
      onCostFrontier
        ? `${configurationLabel(record)} is on it. `
        : `${configurationLabel(record)} is not on it: ${pluralConfigurations(dominators.length)} cost${dominators.length === 1 ? "s" : ""} the same or less per task and score${dominators.length === 1 ? "s" : ""} at least as high. `,
      "The question the frontier answers is what a reader gives up by stepping down from a higher score to a cheaper row that nothing dominates.",
    ),
  ];
  if (contrastRows.length >= 2) {
    const [first, second] = contrastRows;
    if (first !== undefined && second !== undefined) {
      const firstMultiple = first.economics.costUsd / record.economics.costUsd;
      const secondMultiple = second.economics.costUsd / record.economics.costUsd;
      blocks.push(paragraph(
        `The two highest Claude Code rows cost much more for a higher score: ${configurationLabel(first)} at ${formatSnapshotScore(first.benchmarks.aaIndex)} for ${formatSnapshotCostUsd(first.economics.costUsd)} per task (${formatCostMultiple(firstMultiple)} the ${SHORT_NAME} cost), and ${configurationLabel(second)} at ${formatSnapshotScore(second.benchmarks.aaIndex)} for ${formatSnapshotCostUsd(second.economics.costUsd)} (${formatCostMultiple(secondMultiple)}). Those gaps are why a reader who cares about score per dollar stays with the Codex row rather than treating the chart as a single ranking.`,
      ));
      blocks.push(table(
        `${configurationLabel(record)} against the highest Claude Code rows in the snapshot retrieved ${retrievedAt}`,
        ["Configuration", SNAPSHOT_COLUMN_LABELS.aaIndex, "Cost per task"],
        [contrastCells(record), ...contrastRows.map(contrastCells)],
      ));
    }
  }
  if (frontierBelow.length === 0) {
    blocks.push(paragraph(
      `In the snapshot retrieved ${retrievedAt}, no frontier vertex scores below ${configurationLabel(record)}, so there is no step down to describe.`,
    ));
    return blocks;
  }
  const [firstStep] = frontierBelow;
  const last = frontierBelow[frontierBelow.length - 1];
  const underHalf = frontierBelow.find(step => step.costMultiple <= 0.5);
  blocks.push(paragraph(
    firstStep === undefined
      ? ""
      : `The first step down is ${configurationLabel(firstStep.record)}: ${pointsPhrase(firstStep.pointsBelow)} lower for ${costPhrase(firstStep.costMultiple, `the ${cost}`)}. `,
    underHalf === undefined
      ? "No frontier vertex costs half as much or less. "
      : underHalf.record.id === firstStep?.record.id
        ? "That first step already halves the cost or better. "
        : `The first vertex at half the cost or less is ${configurationLabel(underHalf.record)}, which gives up ${pointsPhrase(underHalf.pointsBelow)} for ${formatCostPercent(underHalf.costMultiple)} of the cost. `,
    last === undefined || frontierBelow.length < 2
      ? ""
      : `The frontier ends at ${configurationLabel(last.record)}: ${pointsPhrase(last.pointsBelow)} lower for ${formatCostPercent(last.costMultiple)} of the cost.`,
  ));
  if (frontierBelow.length >= 2) {
    blocks.push(table(
      `Cost-frontier configurations below ${configurationLabel(record)} in the snapshot retrieved ${retrievedAt}, highest AA Index first`,
      ["Configuration", "Setting", SNAPSHOT_COLUMN_LABELS.aaIndex, "Cost per task", `Points below ${SHORT_NAME}`, `Share of ${SHORT_NAME}’s cost`],
      frontierBelow.map(step => belowRowCells(step, record.benchmarks.aaIndex)),
    ));
  }
  return blocks;
}

function componentBlocks(
  placement: Gpt61SolCodingAgentPlacement | undefined,
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
  const parts = components.map(component => (
    `on ${SNAPSHOT_COLUMN_LABELS[component.metric]} it scores ${formatSnapshotScore(component.value)}, ${spellOrdinal(component.rank)} of ${component.count}`
  ));
  const summary = parts.length === 1
    ? parts.join("")
    : `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
  const blocks: BlogBlock[] = [
    paragraph(
      `AA Index is the mean of three component benchmarks, and ${componentContrasts.length === 0 ? `no other configuration carries a component score to set against the ${SHORT_NAME} row` : led.length === componentContrasts.length ? `the ${SHORT_NAME} row leads every one of them` : `the ${SHORT_NAME} row does not lead all three`}. `,
      capitalize(summary),
      " configurations that carry each score.",
    ),
  ];
  if (componentContrasts.length > 0) {
    blocks.push(paragraph(
      led.length === 0
        ? `It leads none of the components outright; its composite position comes from placing high on all of them at once.`
        : `It leads ${joinNames(led.map(contrast => `${SNAPSHOT_COLUMN_LABELS[contrast.metric]} by ${pointsPhrase(contrast.gapPoints)} over ${configurationLabel(contrast.bestOther)}`))}.`,
      tied.length === 0
        ? ""
        : ` ${joinNames(tied.map(contrast => `${configurationLabel(contrast.bestOther)} ties it on ${SNAPSHOT_COLUMN_LABELS[contrast.metric]}`))}.`,
      trailed.length === 0
        ? ""
        : ` ${joinNames(trailed.map(contrast => `${configurationLabel(contrast.bestOther)} scores ${pointsPhrase(-contrast.gapPoints)} higher on ${SNAPSHOT_COLUMN_LABELS[contrast.metric]}`))}.`,
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

function generationBlocks(
  placement: Gpt61SolCodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  const previous = placement?.previousGeneration;
  if (placement === undefined || previous === undefined) {
    return [
      paragraph(
        `The snapshot retrieved ${retrievedAt} does not store both ${PREDECESSOR_LABEL} and ${ROW_LABEL}, so this note cannot compare the two generations.`,
      ),
    ];
  }
  const { record } = placement;
  const sameSetting = sameSettingPrevious(placement);
  const compare = record;
  const settingsMatch = compare.setting === previous.setting;
  const previousIndex = previous.benchmarks.aaIndex;
  const previousCost = previous.economics.costUsd;
  const gain = previousIndex === null ? null : compare.benchmarks.aaIndex - previousIndex;
  const costMultiple = previousCost === null || previousCost <= 0
    ? null
    : compare.economics.costUsd / previousCost;
  const changeCell = (earlier: number | null, current: number | null): string => (
    earlier === null || current === null ? "-" : `${formatPointGap(current - earlier)} points`
  );
  const multipleCell = (multiple: number | null): string => (
    multiple === null ? "-" : formatCostMultiple(multiple)
  );
  const metricRow = (label: string, earlier: string, current: string, change: string): InlineContent[] => (
    [textCell(label), textCell(earlier), textCell(current), textCell(change)]
  );
  return [
    paragraph(
      `The snapshot still stores the previous Sol generation in Codex: ${configurationLabel(previous)} at ${formatSnapshotScore(previousIndex)} for ${formatSnapshotCostUsd(previousCost)} per task. `,
      settingsMatch
        ? `The same-setting ${MODEL_NAME} row is ${configurationLabel(compare)}. `
        : `The highest-scoring ${MODEL_NAME} row is ${configurationLabel(record)}, a different setting from ${configurationLabel(previous)}, so the generation step below is not a like-for-like rerun. `,
      gain === null
        ? "The GPT-6 Sol row carries no AA Index, so the point step cannot be stated from the snapshot."
        : `${MODEL_NAME} ${gain >= 0 ? "adds" : "gives up"} ${pointsPhrase(gain)}`,
      costMultiple === null
        ? "."
        : ` at ${formatCostMultiple(costMultiple)} the mean cost per task.`,
      sameSetting !== undefined && sameSetting.id !== record.id
        ? ` At the shared max setting, ${configurationLabel(sameSetting)} scores ${formatSnapshotScore(sameSetting.benchmarks.aaIndex)} at ${formatSnapshotCostUsd(sameSetting.economics.costUsd)} per task.`
        : "",
    ),
    table(
      `${PREDECESSOR_LABEL} and ${configurationLabel(compare)} in the snapshot retrieved ${retrievedAt}`,
      ["Measure", "GPT-6 Sol", SHORT_NAME, "Change"],
      [
        metricRow(
          SNAPSHOT_COLUMN_LABELS.aaIndex,
          formatSnapshotScore(previousIndex),
          formatSnapshotScore(compare.benchmarks.aaIndex),
          changeCell(previousIndex, compare.benchmarks.aaIndex),
        ),
        metricRow(
          SNAPSHOT_COLUMN_LABELS.deepSwe,
          formatSnapshotScore(previous.benchmarks.deepSwe),
          formatSnapshotScore(compare.benchmarks.deepSwe),
          changeCell(previous.benchmarks.deepSwe, compare.benchmarks.deepSwe),
        ),
        metricRow(
          SNAPSHOT_COLUMN_LABELS.terminalBench,
          formatSnapshotScore(previous.benchmarks.terminalBench),
          formatSnapshotScore(compare.benchmarks.terminalBench),
          changeCell(previous.benchmarks.terminalBench, compare.benchmarks.terminalBench),
        ),
        metricRow(
          SNAPSHOT_COLUMN_LABELS.sweAtlas,
          formatSnapshotScore(previous.benchmarks.sweAtlas),
          formatSnapshotScore(compare.benchmarks.sweAtlas),
          changeCell(previous.benchmarks.sweAtlas, compare.benchmarks.sweAtlas),
        ),
        metricRow(
          "Mean API cost per task",
          formatSnapshotCostUsd(previousCost),
          formatSnapshotCostUsd(compare.economics.costUsd),
          multipleCell(costMultiple),
        ),
      ],
    ),
    paragraph(
      "The earlier ",
      { href: blogArticlePath(OLD_NOTE_SLUG), text: "GPT-6 Sol note" },
      " is pinned to the September 25, 2026 coding-agent snapshot and the September 23, 2026 Intelligence Index snapshot it cited. That note’s Index figures describe a roster that no longer lists GPT-6 Sol. This page reads the live coding-agent snapshot and uses the live Index only for the cost callout below.",
    ),
  ];
}

function intelligenceBlocks(
  coding: Gpt61SolCodingAgentPlacement | undefined,
  intelligence: Gpt61SolIntelligencePlacement | undefined,
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
        ? `The Intelligence Index snapshot retrieved ${intelligenceRetrievedAt} stores no comparable ${MODEL_NAME} max-effort row, so this note cannot print the two rows side by side.`
        : `In the snapshot retrieved ${intelligenceRetrievedAt}, ${intelligence.record.name} scores ${formatSnapshotScore(intelligence.record.intelligenceIndex)} at ${formatSnapshotCostUsd(comparableTaskCost(intelligence.record))} per task. That row is a different unit from the Codex AA Index: this note does not rank it with coding-agent scores or walk the Index frontier.`,
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
        ["Chart", "Configuration", "Score", "Cost per task", "Snapshot retrieved"],
        [
          [
            textCell("Coding agents (AA Index)"),
            textCell(configurationLabel(coding.record)),
            textCell(codingScore),
            textCell(codingCost),
            textCell(codingRetrievedAt),
          ],
          [
            textCell("Intelligence Index"),
            textCell(intelligence.record.name),
            textCell(indexScore),
            textCell(indexCost),
            textCell(intelligenceRetrievedAt),
          ],
        ],
      ),
      paragraph(
        `The ${codingScore} is a mean of three coding benchmarks run inside Codex, and the ${indexScore} is a weighted average of ${spellCount(evaluationCount)} evaluations run through the API. The ${codingCost} includes every tool call and every repeated read of the repository that the harness sends, ${formatMillionTokens(coding.record.usage.totalTokens)} tokens per task in this snapshot; the ${indexCost} is the average bill for one evaluation task under Artificial Analysis’s standardized harness, with ${formatWholeTokens(intelligence.record.outputTokensPerTask.total)} output tokens per task. Artificial Analysis’s `,
        { href: BLOG_SOURCES.artificialAnalysisGpt61SolModel.url, text: "model page" },
        ", captured ",
        GPT_6_1_SOL.artificialAnalysis.capturedOn,
        " UTC, lists the same list prices behind both figures, ",
        GPT_6_1_SOL.artificialAnalysis.inputPrice,
        " per million input tokens and ",
        GPT_6_1_SOL.artificialAnalysis.outputPrice,
        " per million output tokens with a ",
        GPT_6_1_SOL.artificialAnalysis.cacheDiscount,
        " cache discount, a rounded index of ",
        GPT_6_1_SOL.artificialAnalysis.intelligenceScore,
        ", and ",
        GPT_6_1_SOL.artificialAnalysis.indexOutputTokens,
        " output tokens to run the whole index. The page’s FAQ dates the release to ",
        GPT_6_1_SOL.artificialAnalysis.releaseDate,
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

function derivedTitle(placement: Gpt61SolCodingAgentPlacement | undefined): string {
  if (placement === undefined) return `${ROW_LABEL} on the coding-agent chart`;
  const score = formatSnapshotScore(placement.record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(placement.record.economics.costUsd);
  if (placedBeatsMax(placement)) {
    const withCost = `${SHORT_NAME}’s best Codex row is ${score} at ${cost} a task, not max`;
    if (withCost.length <= MAX_TITLE_LENGTH) return withCost;
    const withoutCost = `${SHORT_NAME}’s best Codex row is ${score}, not max`;
    if (withoutCost.length <= MAX_TITLE_LENGTH) return withoutCost;
  }
  const fallback = `${ROW_LABEL} scores ${score} on the coding-agent chart`;
  return fallback.length <= MAX_TITLE_LENGTH ? fallback : `${ROW_LABEL} scores ${score}`;
}

function derivedDek(placement: Gpt61SolCodingAgentPlacement | undefined): string {
  if (placement === undefined) {
    return `${MODEL_NAME} appears on the aicharts coding-agent chart as Codex rows. This note states what those rows measure and where the snapshot stops.`;
  }
  const score = formatSnapshotScore(placement.record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(placement.record.economics.costUsd);
  const first = `${configurationLabel(placement.record)} scores ${score} on AA Index at ${cost} per task, ${spellOrdinal(placement.rank)} of ${placement.indexedCount} configurations.`;
  const max = maxSetting(placement);
  const second = placedBeatsMax(placement) && max !== undefined
    ? ` Max scores ${formatSnapshotScore(max.benchmarks.aaIndex)} at ${formatSnapshotCostUsd(max.economics.costUsd)}.`
    : "";
  return first.length + second.length <= MAX_DEK_LENGTH ? `${first}${second}` : first;
}

function derivedDescription(placement: Gpt61SolCodingAgentPlacement | undefined): string {
  if (placement === undefined) {
    return `${MODEL_NAME} on the aicharts coding-agent chart: what the Codex rows measure, how the cost frontier is read, and where the snapshot stops.`;
  }
  const score = formatSnapshotScore(placement.record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(placement.record.economics.costUsd);
  const first = `${ROW_LABEL} scores ${score} on the aicharts coding-agent AA Index at ${cost} a task, ${spellOrdinal(placement.rank)} of ${placement.indexedCount} configurations.`;
  const second = placedBeatsMax(placement) ? " Max is not the highest Codex row." : "";
  return first.length + second.length <= MAX_DESCRIPTION_LENGTH ? `${first}${second}` : first;
}

export function createGpt61SolArticle(
  codingSnapshot: CodingAgentSnapshot = checkedCodingSnapshot(),
  intelligenceSnapshot: ArtificialAnalysisIntelligenceV43Snapshot = checkedIntelligenceSnapshot(),
): Gpt61SolArticle {
  const codingRetrievedAt = formatRetrievedAt(codingSnapshot.source.retrievedAt);
  const intelligenceRetrievedAt = formatRetrievedAt(intelligenceSnapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    GPT_6_1_SOL_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(codingSnapshot.source.retrievedAt),
    utcCalendarDate(intelligenceSnapshot.source.retrievedAt),
  );
  const coding = gpt61SolCodingAgentPlacement(codingSnapshot.records);
  const ownRows = codingSnapshot.records.filter(matchesGpt61SolCoding);
  const intelligence = gpt61SolIntelligencePlacement(intelligenceSnapshot.records);
  const evaluationCount = intelligenceSnapshot.benchmark.evaluationCount;
  const indexVersion = intelligenceSnapshot.benchmark.version;
  const addedAt = coding === undefined ? undefined : modelAddedAt(codingSnapshot, coding.record);
  const score = coding === undefined ? undefined : formatSnapshotScore(coding.record.benchmarks.aaIndex);
  const cost = coding === undefined ? undefined : formatSnapshotCostUsd(coding.record.economics.costUsd);
  const opening = coding === undefined || score === undefined || cost === undefined
    ? `Artificial Analysis measures coding agents by running a model inside a named harness, and the aicharts coding-agent snapshot retrieved ${codingRetrievedAt} stores no ${ROW_LABEL} row with an AA Index and a cost, so this note can describe the chart but not place the model on it.`
    : `In the aicharts coding-agent snapshot retrieved ${codingRetrievedAt}, ${configurationLabel(coding.record)} scores ${score} on AA Index at a mean API cost of ${cost} per task, ${spellOrdinal(coding.rank)} of the ${coding.indexedCount} configurations that carry an index.`;
  const openingLog = addedAt === undefined
    ? ""
    : ` The snapshot’s update log records the configuration on ${formatLongUtcDate(addedAt)}.`;
  const max = coding === undefined ? undefined : maxSetting(coding);
  const openingInversion = coding === undefined || !placedBeatsMax(coding) || max === undefined
    ? ""
    : ` The max setting scores ${formatSnapshotScore(max.benchmarks.aaIndex)} at ${formatSnapshotCostUsd(max.economics.costUsd)}, so the highest Codex row is not max.`;
  const rankHeading = coding === undefined
    ? "Rank among the configurations that carry an index"
    : `${capitalize(spellOrdinal(coding.rank))} of ${coding.indexedCount} configurations`;
  const settingsHeading = coding !== undefined && placedBeatsMax(coding)
    ? `${capitalize(spellCount(coding.settings.length))} Codex settings, and max is not the top of them`
    : "The Codex settings the snapshot stores";
  const frontierHeading = coding === undefined || coding.frontierBelow.length === 0
    ? "The cost frontier below the row"
    : "What stepping down the cost frontier gives up";
  const led = coding?.componentContrasts.filter(contrast => contrast.gapPoints > 0) ?? [];
  const componentHeading = led.length === 0 || led.length === coding?.componentContrasts.length
    ? "Where the index points come from"
    : `${joinNames(led.map(contrast => SNAPSHOT_COLUMN_LABELS[contrast.metric]))} carr${led.length === 1 ? "ies" : "y"} the lead`;

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: GPT_6_1_SOL_ARTICLE_SLUG,
    title: derivedTitle(coding),
    dek: derivedDek(coding),
    focusPhrase: "Codex GPT-6.1 Sol coding agent AA Index",
    seoDescription: derivedDescription(coding),
    keywords: [
      "GPT-6.1 Sol",
      "Codex",
      "OpenAI",
      "AA Index",
      "coding agent benchmark",
      "cost frontier",
      "Intelligence Index",
      "cost per task",
    ],
    publishedAt: GPT_6_1_SOL_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "AI model benchmarks",
    sourceIds: [
      "artificialAnalysisCodingAgents",
      "openAiGpt61Sol",
      "openAiGpt61SolDocs",
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisGpt61SolModel",
    ],
    relatedSlugs: [
      "gpt-6-sol-coding-agent-index",
      "opus-5-5-coding-agent-index",
      "aa-index-cost-coding-agents",
      "grok-4-7-coding-agent-index",
    ],
    nextStep: {
      title: "See where the row sits today",
      description:
        "The coding-agent chart redraws from each day’s snapshot, so the rank, frontier steps, and which setting leads can move. The model page lists every GPT-6.1 Sol row the site holds, and the data page serves the snapshot itself.",
      links: [
        { href: "/coding", label: "Coding-agent chart" },
        {
          href: coding === undefined ? "/models/openai/gpt-6.1-sol/xhigh" : modelCardHref(coding.record),
          label: "GPT-6.1 Sol model page",
        },
        { href: "/data", label: "Snapshot data" },
      ],
    },
    body: [
      paragraph(
        opening,
        openingInversion,
        " OpenAI ",
        { href: BLOG_SOURCES.openAiGpt61Sol.url, text: `released ${MODEL_NAME}` },
        " with the claim “",
        GPT_6_1_SOL.openAi.headlineClaim,
        ",” and Artificial Analysis added the Codex rows to its coding-agents comparison afterwards.",
        openingLog,
      ),
      heading("One model inside Codex, scored on three benchmarks"),
      paragraph(
        "The ",
        { href: "/coding", text: "coding-agent chart" },
        " is a daily snapshot of the public ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents comparison" },
        `. Each row is one configuration: a model, the agent harness that ran it, and an effort setting. Artificial Analysis runs the harness on tasks from three coding benchmarks, ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas}, and AA Index is the mean of the three scores. The cost is the mean API bill for one task in that harness at list prices, including every tool call and every repeated read of the repository the harness sends.`,
      ),
      paragraph(
        coding === undefined
          ? `${MODEL_NAME}’s row would be the model inside Codex, OpenAI’s own coding agent, at one effort setting.`
          : `${MODEL_NAME}’s placed row is the model inside Codex at the ${coding.record.setting} setting. One task in that configuration used ${formatMillionTokens(coding.record.usage.totalTokens)} tokens and took ${formatMinutes(coding.record.economics.durationSeconds)} of harness time on average. The same model at another setting is another row; the snapshot stores ${pluralConfigurations(ownRows.length)} running ${MODEL_NAME}. OpenAI’s `,
        coding === undefined
          ? ""
          : { href: BLOG_SOURCES.openAiGpt61SolDocs.url, text: "model page" },
        coding === undefined
          ? ""
          : ` lists effort levels as ${GPT_6_1_SOL.openAi.effortLevels}, with a ${GPT_6_1_SOL.openAi.contextWindow}-token context window.`,
      ),
      heading(rankHeading),
      ...rankBlocks(coding, codingRetrievedAt),
      heading(settingsHeading),
      ...settingsBlocks(coding, codingRetrievedAt),
      heading(frontierHeading),
      ...frontierBlocks(coding, codingRetrievedAt),
      heading(componentHeading),
      ...componentBlocks(coding, codingRetrievedAt),
      heading("GPT-6 Sol to GPT-6.1 Sol in Codex"),
      ...generationBlocks(coding, codingRetrievedAt),
      heading("The Intelligence Index row is a different measurement"),
      ...intelligenceBlocks(coding, intelligence, codingRetrievedAt, intelligenceRetrievedAt, evaluationCount, indexVersion),
      heading("OpenAI’s own figures"),
      paragraph(
        "OpenAI’s launch page opens with “",
        GPT_6_1_SOL.openAi.headlineClaim,
        "” and reports its own DeepSWE v1.1 run: GPT-6.1 Sol “",
        GPT_6_1_SOL.openAi.vendorDeepSwe,
        ".” It also prints vendor-run results on ",
        GPT_6_1_SOL.openAi.otherVendorBenchmarks,
        ", none of which appears on an aicharts chart. Those figures come from OpenAI’s evaluation setup, not from Codex under Artificial Analysis’s protocol. Read them as the vendor’s description of its model and read the chart for an independent measurement of one named configuration.",
      ),
      paragraph(
        "The same page prices the API at ",
        GPT_6_1_SOL.openAi.inputPrice,
        " per million input tokens, ",
        GPT_6_1_SOL.openAi.outputPrice,
        " per million output tokens, and ",
        GPT_6_1_SOL.openAi.cachedInputPrice,
        " per million cached input tokens, and makes the model available to ",
        GPT_6_1_SOL.openAi.availability,
        ". It also states that “",
        GPT_6_1_SOL.openAi.notInChat,
        ".” Developers reach it through the API as ",
        GPT_6_1_SOL.openAi.apiName,
        ". Artificial Analysis’s model page FAQ dates that release to ",
        GPT_6_1_SOL.artificialAnalysis.releaseDate,
        " and describes the model as “",
        GPT_6_1_SOL.artificialAnalysis.summaryLine,
        ".”",
      ),
      heading("Limits"),
      list(
        [
          `The chart scores, task costs, token counts, and durations are Artificial Analysis measurements of the named configuration on the retrieval date, under ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas} for the coding-agent chart and Intelligence Index version ${indexVersion} for the capability chart. None of them establishes a result on other repositories, tasks, or harnesses.`,
        ],
        [
          "The rank, cost rank, frontier steps, component gaps, and generation multiples are aicharts derivations from the snapshots named in each caption. A configuration added, removed, or rescored by Artificial Analysis moves them, and the coding-agent snapshot advances daily.",
        ],
        [
          `${MODEL_NAME} in Cursor, Devin, or any harness other than Codex is a configuration this snapshot does not store, so this note says nothing about it.`,
        ],
        [
          "The GPT-6 Sol comparison may hold the harness fixed while the settings differ. The snapshot records outcomes, not run dates or benchmark versions at run time; Artificial Analysis may have measured the two generations days apart.",
        ],
        [
          "The Intelligence Index row is a second measurement of the same model, not a second coding-agent score. GPT-6 Sol is absent from the live Index roster; the earlier Sol note keeps the September 23, 2026 Index snapshot it cited.",
        ],
        [
          "The prices, the availability statement, and the vendor-run benchmark figures belong to OpenAI. aicharts did not run GPT-6.1 Sol.",
        ],
      ),
    ],
  };
}

/** Canonical Markdown for the draft factory. Casts only the unpublished slug. */
export function gpt61SolArticleMarkdown(article: Gpt61SolArticle): string {
  return articleToMarkdown(article as unknown as BlogArticle);
}
