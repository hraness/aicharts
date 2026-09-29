import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";
import {
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "@/lib/artificial-analysis-intelligence-v4-3-data";
import {
  opus55CodingAgentPlacement,
  opus55CodingAgentRows,
  opusIntelligencePlacement,
  type CodingRowBelow,
  type Opus55CodingAgentPlacement,
  type OpusIntelligencePlacement,
} from "@/lib/claude-opus-5-5-placement";
import {
  parseCodingAgentSnapshot,
  type CodingAgentSnapshot,
} from "@/lib/coding-agent-data";
import {
  SNAPSHOT_COLUMN_LABELS,
  formatSnapshotCostUsd,
  formatSnapshotScore,
} from "@/lib/coding-agent-snapshot-rows";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
import { comparableTaskCost, formatCostMultiple, formatPointGap } from "@/lib/mimo-v2-6-pro-frontier";
import { modelAddedAt, spellOrdinal } from "@/lib/snapshot-placement";

import {
  BLOG_SOURCE_NOTE,
  BLOG_SOURCES,
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
import { CLAUDE_OPUS_55 } from "./opus-5-5-intelligence-index-article";
import { spellCount } from "./real-swe-private-enterprise-benchmark-article";

export const OPUS_55_CODING_ARTICLE_SLUG = "opus-5-5-coding-agent-index" as const;
export const OPUS_55_CODING_ARTICLE_PUBLISHED_AT = "2026-09-28" as const;

const MODEL_NAME = "Claude Opus 5.5" as const;
const SHORT_NAME = "Opus 5.5" as const;
const ROW_LABEL = "Claude Code · Opus 5.5" as const;
const PREDECESSOR_LABEL = "Claude Code · Opus 5" as const;
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

/** “3.8 points”, with the noun agreeing with a magnitude of exactly one. */
export function pointsPhrase(points: number): string {
  if (!Number.isFinite(points)) throw new RangeError(`Point gaps must be finite: ${points}`);
  const magnitude = Math.abs(points).toFixed(1);
  return `${magnitude} ${magnitude === "1.0" ? "point" : "points"}`;
}

/**
 * A cost multiple below one as a percentage of the placed row’s cost: “95%”,
 * or one decimal under ten percent so a very cheap row does not print as 0%.
 */
export function formatCostPercent(multiple: number): string {
  if (!Number.isFinite(multiple) || multiple <= 0) {
    throw new RangeError(`Cost multiples must be positive: ${multiple}`);
  }
  const percent = multiple * 100;
  return percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
}

/** “1.2x as much” above one, “95% of” at or below one; reads as a share of the placed row’s cost. */
function costPhrase(multiple: number, subject: string): string {
  return multiple > 1
    ? `${formatCostMultiple(multiple)} as much as ${subject}`
    : `${formatCostPercent(multiple)} of ${subject}`;
}

function belowRowCells(step: CodingRowBelow): InlineContent[] {
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
  placement: Opus55CodingAgentPlacement | undefined,
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
        ? `Its ${cost} per task is also the highest cost of the ${costedCount} configurations that carry a cost, so the row sits at the top right of the chart as both the highest-scoring configuration and the most expensive to run one task through.`
        : `Its ${cost} per task is the ${spellOrdinal(costRank)} highest cost of the ${costedCount} configurations that carry a cost.`,
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

function frontierBlocks(
  placement: Opus55CodingAgentPlacement | undefined,
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
      "The chart’s cost frontier is the set of configurations that no other configuration beats on both axes: nothing scores at least as high for the same or less money. ",
      onCostFrontier
        ? `${configurationLabel(record)} is on it${placement.rank === 1 ? ", and as the highest-scoring row it is the frontier’s top vertex by definition: any row with the top score and a cost is on the frontier whatever it costs" : ""}. `
        : `${configurationLabel(record)} is not on it: ${pluralConfigurations(dominators.length)} cost${dominators.length === 1 ? "s" : ""} the same or less per task and score${dominators.length === 1 ? "s" : ""} at least as high. `,
      "The question the frontier answers is what a reader gives up by stepping down from the top score to a cheaper row that nothing dominates.",
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
    underHalf === undefined
      ? "No frontier vertex costs half as much or less. "
      : underHalf.record.id === first?.record.id
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
      frontierBelow.map(belowRowCells),
    ));
  }
  return blocks;
}

function componentBlocks(
  placement: Opus55CodingAgentPlacement | undefined,
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
      led.length > 0 && trailed.length > 0 && placement.rank === 1
        ? ` The composite lead is a ${joinNames(led.map(contrast => SNAPSHOT_COLUMN_LABELS[contrast.metric]))} lead that the ${joinNames(trailed.map(contrast => SNAPSHOT_COLUMN_LABELS[contrast.metric]))} gap does not cancel.`
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

function generationBlocks(
  placement: Opus55CodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  const predecessor = placement?.predecessor;
  if (placement === undefined || predecessor === undefined) {
    return [
      paragraph(
        `The snapshot retrieved ${retrievedAt} does not store both ${PREDECESSOR_LABEL} and ${ROW_LABEL} at the same setting, so this note cannot compare the two generations in one harness.`,
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
  const timeMultiple = predecessor.economics.durationSeconds === null
    || predecessor.economics.durationSeconds <= 0
    || record.economics.durationSeconds === null
    ? null
    : record.economics.durationSeconds / predecessor.economics.durationSeconds;
  const changeCell = (previous: number | null, current: number | null): string => (
    previous === null || current === null ? "-" : `${formatPointGap(current - previous)} points`
  );
  const multipleCell = (multiple: number | null): string => (
    multiple === null ? "-" : formatCostMultiple(multiple)
  );
  const metricRow = (label: string, previous: string, current: string, change: string): InlineContent[] => (
    [textCell(label), textCell(previous), textCell(current), textCell(change)]
  );
  const blocks: BlogBlock[] = [
    paragraph(
      `The snapshot stores the previous Opus generation in the same harness at the same setting: ${configurationLabel(predecessor)} at ${formatSnapshotScore(previousIndex)} for ${formatSnapshotCostUsd(previousCost)} per task. `,
      gain === null
        ? "The Opus 5 row carries no AA Index, so the point step cannot be stated from the snapshot."
        : `${SHORT_NAME} ${gain >= 0 ? "adds" : "gives up"} ${pointsPhrase(gain)}`,
      costMultiple === null
        ? "."
        : ` at ${formatCostMultiple(costMultiple)} the mean cost per task`,
      tokenMultiple === null
        ? ""
        : `, ${formatCostMultiple(tokenMultiple)} the total tokens per task`,
      timeMultiple === null
        ? "."
        : `, and ${formatCostMultiple(timeMultiple)} the mean time per task.`,
    ),
    table(
      `${PREDECESSOR_LABEL} and ${ROW_LABEL} at the ${record.setting} setting in the snapshot retrieved ${retrievedAt}`,
      ["Measure", "Opus 5", SHORT_NAME, "Change"],
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
          multipleCell(costMultiple),
        ),
        metricRow(
          "Total tokens per task",
          formatMillionTokens(predecessor.usage.totalTokens),
          formatMillionTokens(record.usage.totalTokens),
          multipleCell(tokenMultiple),
        ),
        metricRow(
          "Mean time per task",
          formatMinutes(predecessor.economics.durationSeconds),
          formatMinutes(record.economics.durationSeconds),
          multipleCell(timeMultiple),
        ),
      ],
    ),
    paragraph(
      "Anthropic’s ",
      { href: BLOG_SOURCES.anthropicClaudeOpus55.url, text: "announcement" },
      ` prices ${MODEL_NAME} at `,
      CLAUDE_OPUS_55.anthropic.inputPrice,
      " per million input tokens and ",
      CLAUDE_OPUS_55.anthropic.outputPrice,
      " per million output tokens, against ",
      CLAUDE_OPUS_55.anthropic.opus5InputPrice,
      " and ",
      CLAUDE_OPUS_55.anthropic.opus5OutputPrice,
      " for Opus 5, and opens with the claim that “",
      CLAUDE_OPUS_55.anthropic.headlineClaim,
      ".” ",
      costMultiple !== null && costMultiple > 1 && tokenMultiple !== null && tokenMultiple > 1
        ? `The Claude Code row moved the other way: a task cost ${formatCostMultiple(costMultiple)} as much because the run used ${formatCostMultiple(tokenMultiple)} the tokens, and the volume increase outran the lower price per token. Anthropic’s figure describes the price of a token, and the harness figure describes the tokens one task consumed; both can be true at once.`
        : costMultiple !== null && costMultiple <= 1
          ? "The Claude Code row moved the same way: a task cost no more than it did with Opus 5 at the lower price per token."
          : "The snapshot records outcomes rather than prices, so the two statements cannot be reconciled from it.",
    ),
  ];
  return blocks;
}

function intelligenceBlocks(
  coding: Opus55CodingAgentPlacement | undefined,
  intelligence: OpusIntelligencePlacement | undefined,
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
        : `In the snapshot retrieved ${intelligenceRetrievedAt}, ${intelligence.record.name} scores ${formatSnapshotScore(intelligence.record.intelligenceIndex)} at ${formatSnapshotCostUsd(comparableTaskCost(intelligence.record))} per task, ${spellOrdinal(intelligence.rank)} of ${intelligence.cohortSize} configurations with a measured cost. The `,
      intelligence === undefined
        ? ""
        : { href: blogArticlePath("opus-5-5-intelligence-index"), text: "Intelligence Index note" },
      intelligence === undefined
        ? ""
        : " walks that chart’s frontier and the model’s effort levels.",
    ),
  ];
  if (coding !== undefined && intelligence !== undefined) {
    const codingScore = formatSnapshotScore(coding.record.benchmarks.aaIndex);
    const codingCost = formatSnapshotCostUsd(coding.record.economics.costUsd);
    const indexScore = formatSnapshotScore(intelligence.record.intelligenceIndex);
    const indexCost = formatSnapshotCostUsd(comparableTaskCost(intelligence.record));
    blocks.push(
      table(
        `${MODEL_NAME} at max effort in the two aicharts snapshots, each on its own task set with its own cost definition`,
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
        `The ${codingScore} is a mean of three coding benchmarks run inside Claude Code, and the ${indexScore} is a weighted average of ${spellCount(evaluationCount)} evaluations run through the API. The ${codingCost} includes every tool call and every repeated read of the repository that the harness sends, ${formatMillionTokens(coding.record.usage.totalTokens)} tokens per task in this snapshot; the ${indexCost} is the average bill for one evaluation task under Artificial Analysis’s standardized harness, with ${formatWholeTokens(intelligence.record.outputTokensPerTask.total)} output tokens per task. Artificial Analysis’s `,
        { href: BLOG_SOURCES.artificialAnalysisClaudeOpus55Model.url, text: "model page" },
        ", captured ",
        CLAUDE_OPUS_55.artificialAnalysis.capturedOn,
        " UTC, lists the same list prices behind both figures, ",
        CLAUDE_OPUS_55.artificialAnalysis.inputPrice,
        " per million input tokens and ",
        CLAUDE_OPUS_55.artificialAnalysis.outputPrice,
        " per million output tokens with a ",
        CLAUDE_OPUS_55.artificialAnalysis.cacheDiscount,
        " cache discount.",
      ),
      callout(
        "Two charts, two units",
        `Compare ${codingScore} and ${codingCost} with the other rows on the coding-agent chart, and ${indexScore} and ${indexCost} with the other rows on the Intelligence Index chart. Adding, averaging, or ranking the two scores together produces a number neither chart measures.`,
      ),
    );
  }
  return blocks;
}

function anthropicBlocks(placement: Opus55CodingAgentPlacement | undefined): BlogBlock[] {
  const measured = placement?.record.benchmarks.terminalBench ?? null;
  return [
    paragraph(
      "Anthropic’s announcement reports its own Terminal-Bench 4.0 run at ",
      CLAUDE_OPUS_55.anthropic.vendorTerminalBench,
      " at ",
      CLAUDE_OPUS_55.anthropic.vendorTerminalBenchEffort,
      " effort, alongside ",
      CLAUDE_OPUS_55.anthropic.otherVendorBenchmarks,
      ", none of which appears on an aicharts chart. ",
      measured === null
        ? "The snapshot stores no Terminal-Bench 4 score for the Claude Code row to set beside it."
        : `The ${formatSnapshotScore(measured)} that Artificial Analysis measured for ${placement === undefined ? ROW_LABEL : configurationLabel(placement.record)} comes from a different run, a different effort setting, and Artificial Analysis’s protocol inside Claude Code, so the two figures describe two evaluations of the model rather than one result reported twice.`,
      " Anthropic also writes that “",
      CLAUDE_OPUS_55.anthropic.marginClaim,
      ".”",
    ),
  ];
}

function derivedTitle(placement: Opus55CodingAgentPlacement | undefined): string {
  if (placement === undefined) return `${ROW_LABEL} on the coding-agent chart`;
  const score = formatSnapshotScore(placement.record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(placement.record.economics.costUsd);
  if (placement.rank === 1) {
    const withCost = `${SHORT_NAME} tops the coding-agent chart at ${score} and ${cost} a task`;
    if (withCost.length <= MAX_TITLE_LENGTH) return withCost;
    return `${SHORT_NAME} tops the coding-agent chart at ${score}`;
  }
  return `${ROW_LABEL} scores ${score} on the coding-agent chart`;
}

function derivedDek(placement: Opus55CodingAgentPlacement | undefined): string {
  if (placement === undefined) {
    return `${MODEL_NAME} appears on the aicharts coding-agent chart as one row inside Claude Code. This note states what that row measures and where the snapshot stops.`;
  }
  const score = formatSnapshotScore(placement.record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(placement.record.economics.costUsd);
  const rankClause = `${spellOrdinal(placement.rank)} of ${placement.indexedCount} configuration${placement.indexedCount === 1 ? "" : "s"}`;
  const costClause = placement.costRank === 1 ? " and the costliest row" : "";
  const first = `${configurationLabel(placement.record)} scores ${score} on AA Index at ${cost} per task, ${rankClause}${costClause}.`;
  const [step] = placement.frontierBelow;
  if (step === undefined) return first;
  const second = ` The next frontier point down gives up ${pointsPhrase(step.pointsBelow)} for ${formatCostPercent(step.costMultiple)} of the cost.`;
  return first.length + second.length <= MAX_DEK_LENGTH ? `${first}${second}` : first;
}

function derivedDescription(placement: Opus55CodingAgentPlacement | undefined): string {
  if (placement === undefined) {
    return `${MODEL_NAME} on the aicharts coding-agent chart: what the Claude Code row measures, how the cost frontier is read, and where the snapshot stops.`;
  }
  const score = formatSnapshotScore(placement.record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(placement.record.economics.costUsd);
  const first = `${ROW_LABEL} scores ${score} on the aicharts coding-agent AA Index at ${cost} a task, ${spellOrdinal(placement.rank)} of ${placement.indexedCount} configurations.`;
  const second = " See what the lead costs on the frontier.";
  return first.length + second.length <= MAX_DESCRIPTION_LENGTH ? `${first}${second}` : first;
}

export function createOpus55CodingArticle(
  codingSnapshot: CodingAgentSnapshot = checkedCodingSnapshot(),
  intelligenceSnapshot: ArtificialAnalysisIntelligenceV43Snapshot = checkedIntelligenceSnapshot(),
): BlogArticle {
  const codingRetrievedAt = formatRetrievedAt(codingSnapshot.source.retrievedAt);
  const intelligenceRetrievedAt = formatRetrievedAt(intelligenceSnapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    OPUS_55_CODING_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(codingSnapshot.source.retrievedAt),
    utcCalendarDate(intelligenceSnapshot.source.retrievedAt),
  );
  const coding = opus55CodingAgentPlacement(codingSnapshot.records);
  const opus55Rows = opus55CodingAgentRows(codingSnapshot.records);
  const intelligence = opusIntelligencePlacement(intelligenceSnapshot.records);
  const evaluationCount = intelligenceSnapshot.benchmark.evaluationCount;
  const indexVersion = intelligenceSnapshot.benchmark.version;
  const addedAt = coding === undefined ? undefined : modelAddedAt(codingSnapshot, coding.record);

  const score = coding === undefined ? undefined : formatSnapshotScore(coding.record.benchmarks.aaIndex);
  const cost = coding === undefined ? undefined : formatSnapshotCostUsd(coding.record.economics.costUsd);
  const opening = coding === undefined || score === undefined || cost === undefined
    ? `Artificial Analysis measures coding agents by running a model inside a named harness, and the aicharts coding-agent snapshot retrieved ${codingRetrievedAt} stores no ${ROW_LABEL} row with an AA Index and a cost, so this note can describe the chart but not place the model on it.`
    : `In the aicharts coding-agent snapshot retrieved ${codingRetrievedAt}, ${configurationLabel(coding.record)} scores ${score} on AA Index at a mean API cost of ${cost} per task, ${spellOrdinal(coding.rank)} of the ${coding.indexedCount} configurations that carry an index${coding.costRank === 1 ? " and the highest cost per task on the chart" : ""}.`;
  const openingLog = addedAt === undefined
    ? ""
    : ` The snapshot’s update log records the row on ${formatLongUtcDate(addedAt)}.`;
  const [firstStep] = coding?.frontierBelow ?? [];
  const openingFrontier = coding === undefined || firstStep === undefined
    ? ""
    : ` The nearest cost-frontier configuration below it, ${configurationLabel(firstStep.record)}, gives up ${pointsPhrase(firstStep.pointsBelow)} for ${formatCostPercent(firstStep.costMultiple)} of the cost.`;

  const rankHeading = coding === undefined
    ? "Rank among the configurations that carry an index"
    : coding.costRank === 1
      ? `${capitalize(spellOrdinal(coding.rank))} of ${coding.indexedCount} configurations, at the chart’s highest cost`
      : `${capitalize(spellOrdinal(coding.rank))} of ${coding.indexedCount} configurations`;
  const frontierHeading = coding === undefined || coding.frontierBelow.length === 0
    ? "The cost frontier below the row"
    : `What stepping down the cost frontier gives up`;
  const led = coding?.componentContrasts.filter(contrast => contrast.gapPoints > 0) ?? [];
  const componentHeading = led.length === 0 || led.length === coding?.componentContrasts.length
    ? "Where the index points come from"
    : `${joinNames(led.map(contrast => SNAPSHOT_COLUMN_LABELS[contrast.metric]))} carr${led.length === 1 ? "ies" : "y"} the lead`;

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: OPUS_55_CODING_ARTICLE_SLUG,
    title: derivedTitle(coding),
    dek: derivedDek(coding),
    focusPhrase: "Claude Code Opus 5.5 coding agent AA Index",
    seoDescription: derivedDescription(coding),
    keywords: [
      "Claude Opus 5.5",
      "Claude Code",
      "Anthropic",
      "AA Index",
      "coding agent benchmark",
      "cost frontier",
      "Terminal-Bench 4",
      "DeepSWE v1.1",
      "cost per task",
    ],
    publishedAt: OPUS_55_CODING_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "AI model benchmarks",
    sourceIds: [
      "artificialAnalysisCodingAgents",
      "anthropicClaudeOpus55",
      "artificialAnalysisIntelligenceIndex",
      "artificialAnalysisClaudeOpus55Model",
    ],
    relatedSlugs: [
      "opus-5-5-intelligence-index",
      "aa-index-cost-coding-agents",
    ],
    nextStep: {
      title: "See where the row sits today",
      description:
        "The coding-agent chart redraws from each day’s snapshot, so the rank, cost rank, and frontier steps above can move. The model page lists every Claude Opus 5.5 row the site holds, and the data page serves the snapshot itself.",
      links: [
        { href: "/coding", label: "Coding-agent chart" },
        { href: "/models/anthropic/claude-opus-5.5/max", label: "Claude Opus 5.5 model page" },
        { href: "/data", label: "Snapshot data" },
      ],
    },
    body: [
      paragraph(
        opening,
        openingFrontier,
        " Anthropic ",
        { href: BLOG_SOURCES.anthropicClaudeOpus55.url, text: `released ${MODEL_NAME}` },
        " on ",
        CLAUDE_OPUS_55.anthropic.announcedOn,
        ", and Artificial Analysis added the Claude Code row to its coding-agents comparison afterwards.",
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
          ? `${MODEL_NAME}’s row would be the model inside Claude Code, Anthropic’s own coding agent, at one effort setting.`
          : `${MODEL_NAME}’s row is the model inside Claude Code, Anthropic’s own coding agent, at the ${coding.record.setting} setting. One task in that configuration used ${formatMillionTokens(coding.record.usage.totalTokens)} tokens and took ${formatMinutes(coding.record.economics.durationSeconds)} of harness time on average. The same model in another harness, or at another setting, would be another row; the snapshot stores ${pluralConfigurations(opus55Rows.length)} running ${MODEL_NAME}${opus55Rows.length <= 1 ? "" : `: ${joinNames(opus55Rows.map(configurationLabel))}`}.`,
      ),
      heading(rankHeading),
      ...rankBlocks(coding, codingRetrievedAt),
      heading(frontierHeading),
      ...frontierBlocks(coding, codingRetrievedAt),
      heading(componentHeading),
      ...componentBlocks(coding, codingRetrievedAt),
      heading("Opus 5 to Opus 5.5 at the same setting"),
      ...generationBlocks(coding, codingRetrievedAt),
      heading("The Intelligence Index row is a different measurement"),
      ...intelligenceBlocks(coding, intelligence, codingRetrievedAt, intelligenceRetrievedAt, evaluationCount, indexVersion),
      heading("Anthropic’s own Terminal-Bench figure"),
      ...anthropicBlocks(coding),
      heading("Limits"),
      list(
        [
          `Every score, cost, token count, and duration above is an Artificial Analysis measurement of the named configuration on the retrieval date, under ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas} for the coding-agent chart and Intelligence Index version ${indexVersion} for the capability chart. None of them establishes a result on other repositories, tasks, or harnesses.`,
        ],
        [
          "The rank, cost rank, frontier steps, component gaps, and Opus 5 multiples are aicharts derivations from the snapshots named in each caption. A configuration added, removed, or rescored by Artificial Analysis moves them, and the coding-agent snapshot advances daily.",
        ],
        [
          `${MODEL_NAME} in Cursor, Devin, or any harness other than Claude Code, or at a setting other than max, is a configuration this snapshot does not store, so this note says nothing about it.`,
        ],
        [
          "The Opus 5 comparison holds the harness and setting fixed, but the snapshot records outcomes, not run dates or benchmark versions at run time; Artificial Analysis may have measured the two generations weeks apart.",
        ],
        [
          "The prices, the cost claim against Opus 5, and the vendor-run benchmark figures belong to Anthropic. aicharts did not run Claude Opus 5.5.",
        ],
      ),
    ],
  };
}