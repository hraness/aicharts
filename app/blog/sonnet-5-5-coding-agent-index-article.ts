import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";
import {
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "@/lib/artificial-analysis-intelligence-v4-3-data";
import {
  sonnet55CodingAgentPlacement,
  sonnet55CodingAgentRows,
  sonnet55IntelligencePlacement,
  type CodingEffortStep,
  type Sonnet55CodingAgentPlacement,
} from "@/lib/claude-sonnet-5-5-placement";
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
import type { IntelligencePlacement } from "@/lib/snapshot-placement";
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
import { formatCostPercent, pointsPhrase } from "./opus-5-5-coding-agent-index-article";
import { spellCount } from "./real-swe-private-enterprise-benchmark-article";

export const SONNET_55_CODING_ARTICLE_SLUG = "sonnet-5-5-coding-agent-index" as const;
export const SONNET_55_CODING_ARTICLE_PUBLISHED_AT = "2026-10-05" as const;

const MODEL_NAME = "Claude Sonnet 5.5" as const;
const SHORT_NAME = "Sonnet 5.5" as const;
const ROW_LABEL = "Claude Code · Sonnet 5.5" as const;
const OPUS_LABEL = "Claude Code · Opus 5.5" as const;
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
  step: { costMultiple: number; pointsBelow: number; record: Sonnet55CodingAgentPlacement["record"] },
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
  placement: Sonnet55CodingAgentPlacement | undefined,
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

function effortBlocks(
  placement: Sonnet55CodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  if (placement === undefined) {
    return [
      paragraph(
        `Without a ${ROW_LABEL} row in the snapshot retrieved ${retrievedAt}, this note cannot list the Claude Code settings for ${MODEL_NAME}.`,
      ),
    ];
  }
  const { effortLadder, record } = placement;
  if (effortLadder.length === 0) {
    return [
      paragraph(
        `The snapshot retrieved ${retrievedAt} stores no costed ${ROW_LABEL} setting, so this note cannot describe an effort ladder.`,
      ),
    ];
  }
  if (effortLadder.length === 1) {
    return [
      paragraph(
        `The snapshot retrieved ${retrievedAt} stores one Claude Code setting for ${MODEL_NAME}: ${configurationLabel(record)} at ${formatSnapshotScore(record.benchmarks.aaIndex)} for ${formatSnapshotCostUsd(record.economics.costUsd)} per task. A ladder needs at least two settings.`,
      ),
    ];
  }
  const last = effortLadder[effortLadder.length - 1];
  const previous = effortLadder[effortLadder.length - 2];
  const blocks: BlogBlock[] = [
    paragraph(
      `The snapshot stores ${spellCount(effortLadder.length)} Claude Code settings for ${MODEL_NAME}, from ${effortLadder[0]?.record.setting} at ${formatSnapshotCostUsd(effortLadder[0]?.record.economics.costUsd ?? null)} to ${record.setting} at ${formatSnapshotCostUsd(record.economics.costUsd)}. `,
      last === undefined || previous === undefined || last.pointsOverCheaper === null || last.costMultipleOverCheaper === null
        ? "Each step up the ladder is another configuration: the same harness and model at a higher listed cost."
        : `The last step, from ${previous.record.setting} to ${last.record.setting}, adds ${pointsPhrase(last.pointsOverCheaper)} at ${formatCostMultiple(last.costMultipleOverCheaper)} the cost of the setting below it.`,
    ),
    table(
      `${ROW_LABEL} settings in the snapshot retrieved ${retrievedAt}, cheapest first`,
      ["Setting", SNAPSHOT_COLUMN_LABELS.aaIndex, "Cost per task", "Points over cheaper setting", "Cost multiple over cheaper setting"],
      effortLadder.map((step: CodingEffortStep) => [
        textCell(step.record.setting),
        textCell(formatSnapshotScore(step.record.benchmarks.aaIndex)),
        textCell(formatSnapshotCostUsd(step.record.economics.costUsd)),
        textCell(step.pointsOverCheaper === null ? "-" : pointsPhrase(step.pointsOverCheaper)),
        textCell(step.costMultipleOverCheaper === null ? "-" : formatCostMultiple(step.costMultipleOverCheaper)),
      ]),
    ),
  ];
  return blocks;
}

function frontierBlocks(
  placement: Sonnet55CodingAgentPlacement | undefined,
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
        ? `${configurationLabel(record)} is on it${placement.rank === 1 ? ", at the frontier’s highest score. When configurations tie for that score, a cheaper tied row dominates a more expensive one" : ""}. `
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

function sameHarnessBlocks(
  placement: Sonnet55CodingAgentPlacement | undefined,
  retrievedAt: string,
): BlogBlock[] {
  const other = placement?.sameHarnessOpus;
  if (placement === undefined || other === undefined) {
    return [
      paragraph(
        `The snapshot retrieved ${retrievedAt} does not store both ${OPUS_LABEL} and ${ROW_LABEL} at the same setting, so this note cannot compare the two models in one harness.`,
      ),
    ];
  }
  const { record } = placement;
  const otherIndex = other.benchmarks.aaIndex;
  const otherCost = other.economics.costUsd;
  const gain = otherIndex === null ? null : record.benchmarks.aaIndex - otherIndex;
  const costMultiple = otherCost === null || otherCost <= 0
    ? null
    : record.economics.costUsd / otherCost;
  const tokenMultiple = other.usage.totalTokens === null
    || other.usage.totalTokens <= 0
    || record.usage.totalTokens === null
    ? null
    : record.usage.totalTokens / other.usage.totalTokens;
  const timeMultiple = other.economics.durationSeconds === null
    || other.economics.durationSeconds <= 0
    || record.economics.durationSeconds === null
    ? null
    : record.economics.durationSeconds / other.economics.durationSeconds;
  const changeCell = (previous: number | null, current: number | null): string => (
    previous === null || current === null ? "-" : `${formatPointGap(current - previous)} points`
  );
  const multipleCell = (multiple: number | null): string => (
    multiple === null ? "-" : formatCostMultiple(multiple)
  );
  const metricRow = (label: string, previous: string, current: string, change: string): InlineContent[] => (
    [textCell(label), textCell(previous), textCell(current), textCell(change)]
  );
  return [
    paragraph(
      `The snapshot stores both models in Claude Code at the ${record.setting} setting. ${configurationLabel(other)} scores ${formatSnapshotScore(otherIndex)} at ${formatSnapshotCostUsd(otherCost)} per task. `,
      gain === null
        ? "The Opus 5.5 row carries no AA Index, so the point step cannot be stated from the snapshot."
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
      " The ",
      { href: blogArticlePath("opus-5-5-coding-agent-index"), text: "Claude Code · Opus 5.5 note" },
      " places that row and compares it with Claude Code · Opus 5.",
    ),
    table(
      `${ROW_LABEL} and ${OPUS_LABEL} at the ${record.setting} setting in the snapshot retrieved ${retrievedAt}`,
      ["Measure", SHORT_NAME, "Opus 5.5", "Change"],
      [
        metricRow(
          SNAPSHOT_COLUMN_LABELS.aaIndex,
          formatSnapshotScore(record.benchmarks.aaIndex),
          formatSnapshotScore(otherIndex),
          changeCell(otherIndex, record.benchmarks.aaIndex),
        ),
        metricRow(
          SNAPSHOT_COLUMN_LABELS.deepSwe,
          formatSnapshotScore(record.benchmarks.deepSwe),
          formatSnapshotScore(other.benchmarks.deepSwe),
          changeCell(other.benchmarks.deepSwe, record.benchmarks.deepSwe),
        ),
        metricRow(
          SNAPSHOT_COLUMN_LABELS.terminalBench,
          formatSnapshotScore(record.benchmarks.terminalBench),
          formatSnapshotScore(other.benchmarks.terminalBench),
          changeCell(other.benchmarks.terminalBench, record.benchmarks.terminalBench),
        ),
        metricRow(
          SNAPSHOT_COLUMN_LABELS.sweAtlas,
          formatSnapshotScore(record.benchmarks.sweAtlas),
          formatSnapshotScore(other.benchmarks.sweAtlas),
          changeCell(other.benchmarks.sweAtlas, record.benchmarks.sweAtlas),
        ),
        metricRow(
          "Mean API cost per task",
          formatSnapshotCostUsd(record.economics.costUsd),
          formatSnapshotCostUsd(otherCost),
          multipleCell(costMultiple),
        ),
        metricRow(
          "Total tokens per task",
          formatMillionTokens(record.usage.totalTokens),
          formatMillionTokens(other.usage.totalTokens),
          multipleCell(tokenMultiple),
        ),
        metricRow(
          "Mean time per task",
          formatMinutes(record.economics.durationSeconds),
          formatMinutes(other.economics.durationSeconds),
          multipleCell(timeMultiple),
        ),
      ],
    ),
  ];
}

function componentBlocks(
  placement: Sonnet55CodingAgentPlacement | undefined,
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

function intelligenceBlocks(
  coding: Sonnet55CodingAgentPlacement | undefined,
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
        ? `The Intelligence Index snapshot retrieved ${intelligenceRetrievedAt} stores no comparable ${MODEL_NAME} max-effort row, so this note cannot print the two rows side by side.`
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
        `The ${codingScore} is a mean of three coding benchmarks run inside Claude Code, and the ${indexScore} is a weighted average of ${spellCount(evaluationCount)} evaluations run through the API. The ${codingCost} includes every tool call and every repeated read of the repository that the harness sends, ${formatMillionTokens(coding.record.usage.totalTokens)} tokens per task in this snapshot; the ${indexCost} is the average bill for one evaluation task under Artificial Analysis’s standardized harness, with ${formatWholeTokens(intelligence.record.outputTokensPerTask.total)} output tokens per task.`,
      ),
      callout(
        "Two charts, two units",
        `Compare ${codingScore} and ${codingCost} with the other rows on the coding-agent chart, and ${indexScore} and ${indexCost} with the other rows on the Intelligence Index chart. Adding, averaging, or ranking the two scores together produces a number neither chart measures.`,
      ),
    );
  }
  return blocks;
}

function derivedTitle(placement: Sonnet55CodingAgentPlacement | undefined): string {
  if (placement === undefined) return `${ROW_LABEL} on the coding-agent chart`;
  const score = formatSnapshotScore(placement.record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(placement.record.economics.costUsd);
  if (placement.rank === 1) {
    const withCost = `${SHORT_NAME} is first on the coding-agent chart at ${score}, ${cost}`;
    if (withCost.length <= MAX_TITLE_LENGTH) return withCost;
    return `${SHORT_NAME} is first on the coding-agent chart at ${score}`;
  }
  return `${ROW_LABEL} scores ${score} on the coding-agent chart`;
}

function derivedDek(placement: Sonnet55CodingAgentPlacement | undefined): string {
  if (placement === undefined) {
    return `${MODEL_NAME} appears on the aicharts coding-agent chart as Claude Code rows at more than one effort setting. This note states what those rows measure and where the snapshot stops.`;
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

function derivedDescription(placement: Sonnet55CodingAgentPlacement | undefined): string {
  if (placement === undefined) {
    return `${MODEL_NAME} on the aicharts coding-agent chart: what the Claude Code rows measure, how the cost frontier is read, and where the snapshot stops.`;
  }
  const score = formatSnapshotScore(placement.record.benchmarks.aaIndex);
  const cost = formatSnapshotCostUsd(placement.record.economics.costUsd);
  const first = `${ROW_LABEL} scores ${score} on the aicharts coding-agent AA Index at ${cost} a task, ${spellOrdinal(placement.rank)} of ${placement.indexedCount} configurations.`;
  const settingCount = placement.effortLadder.length;
  const second = settingCount >= 2
    ? ` See the ${spellCount(settingCount)} settings and the frontier.`
    : " See what the lead costs on the frontier.";
  return first.length + second.length <= MAX_DESCRIPTION_LENGTH ? `${first}${second}` : first;
}

function effortHeading(placement: Sonnet55CodingAgentPlacement | undefined): string {
  if (placement === undefined || placement.effortLadder.length < 2) {
    return "The Claude Code settings the snapshot stores";
  }
  return `What each of the ${spellCount(placement.effortLadder.length)} Claude Code settings buys`;
}

function frontierHeading(placement: Sonnet55CodingAgentPlacement | undefined): string {
  const [first] = placement?.frontierBelow ?? [];
  if (first !== undefined && first.record.agent === "Claude Code" && first.record.model === "Opus 5.5") {
    return "The first cheaper frontier row is Opus 5.5";
  }
  if (placement === undefined || placement.frontierBelow.length === 0) {
    return "The cost frontier below the row";
  }
  return "Cheaper frontier rows below this score";
}

function componentHeading(placement: Sonnet55CodingAgentPlacement | undefined): string {
  const trailed = placement?.componentContrasts.filter(contrast => contrast.gapPoints < 0) ?? [];
  if (trailed.length === 1 && trailed[0] !== undefined) {
    return `${SNAPSHOT_COLUMN_LABELS[trailed[0].metric]} is the component it does not lead`;
  }
  const led = placement?.componentContrasts.filter(contrast => contrast.gapPoints > 0) ?? [];
  if (led.length === 0 || led.length === placement?.componentContrasts.length) {
    return "Where the index points come from";
  }
  return `${joinNames(led.map(contrast => SNAPSHOT_COLUMN_LABELS[contrast.metric]))} carr${led.length === 1 ? "ies" : "y"} the lead`;
}

export function createSonnet55CodingArticle(
  codingSnapshot: CodingAgentSnapshot = checkedCodingSnapshot(),
  intelligenceSnapshot: ArtificialAnalysisIntelligenceV43Snapshot = checkedIntelligenceSnapshot(),
): BlogArticle {
  const codingRetrievedAt = formatRetrievedAt(codingSnapshot.source.retrievedAt);
  const intelligenceRetrievedAt = formatRetrievedAt(intelligenceSnapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    SONNET_55_CODING_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(codingSnapshot.source.retrievedAt),
    utcCalendarDate(intelligenceSnapshot.source.retrievedAt),
  );
  const coding = sonnet55CodingAgentPlacement(codingSnapshot.records);
  const sonnetRows = sonnet55CodingAgentRows(codingSnapshot.records);
  const intelligence = sonnet55IntelligencePlacement(intelligenceSnapshot.records);
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
  const settingCount = coding?.effortLadder.length ?? 0;
  const openingLadder = settingCount < 2
    ? ""
    : ` The same harness stores ${spellCount(settingCount)} ${SHORT_NAME} settings; the headline row is the highest of them.`;

  const rankHeading = coding === undefined
    ? "Rank among the configurations that carry an index"
    : coding.costRank === 1
      ? `${capitalize(spellOrdinal(coding.rank))} of ${coding.indexedCount} configurations, at the chart’s highest cost`
      : `${capitalize(spellOrdinal(coding.rank))} of ${coding.indexedCount} configurations`;

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: SONNET_55_CODING_ARTICLE_SLUG,
    title: derivedTitle(coding),
    dek: derivedDek(coding),
    focusPhrase: "Claude Code Sonnet 5.5 coding agent AA Index",
    seoDescription: derivedDescription(coding),
    keywords: [
      "Claude Sonnet 5.5",
      "Claude Code",
      "Anthropic",
      "AA Index",
      "coding agent benchmark",
      "cost frontier",
      "Terminal-Bench 4",
      "DeepSWE v1.1",
      "cost per task",
    ],
    publishedAt: SONNET_55_CODING_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "AI model benchmarks",
    sourceIds: [
      "artificialAnalysisCodingAgents",
      "artificialAnalysisIntelligenceIndex",
    ],
    relatedSlugs: [
      "opus-5-5-coding-agent-index",
      "aa-index-cost-coding-agents",
    ],
    nextStep: {
      title: "See where the row sits today",
      description:
        "The coding-agent chart redraws from each day’s snapshot, so the rank, cost rank, settings, and frontier steps above can move. The model page lists every Claude Sonnet 5.5 row the site holds, and the data page serves the snapshot itself.",
      links: [
        { href: "/coding", label: "Coding-agent chart" },
        { href: "/models/anthropic/claude-sonnet-5.5/max", label: "Claude Sonnet 5.5 model page" },
        { href: "/data", label: "Snapshot data" },
      ],
    },
    body: [
      paragraph(
        opening,
        openingFrontier,
        openingLadder,
        openingLog,
      ),
      heading(
        settingCount >= 2
          ? `One model, ${spellCount(settingCount)} settings in one harness`
          : "One model inside one harness, scored on three benchmarks",
      ),
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
          : `${MODEL_NAME}’s headline row is the model inside Claude Code, Anthropic’s own coding agent, at the ${coding.record.setting} setting. One task in that configuration used ${formatMillionTokens(coding.record.usage.totalTokens)} tokens and took ${formatMinutes(coding.record.economics.durationSeconds)} of harness time on average. The same model at another setting, or in another harness, is another row; the snapshot stores ${pluralConfigurations(sonnetRows.length)} running ${MODEL_NAME}${sonnetRows.length <= 1 ? "" : `: ${joinNames(sonnetRows.map(configurationLabel))}`}.`,
      ),
      heading(rankHeading),
      ...rankBlocks(coding, codingRetrievedAt),
      heading(effortHeading(coding)),
      ...effortBlocks(coding, codingRetrievedAt),
      heading(frontierHeading(coding)),
      ...frontierBlocks(coding, codingRetrievedAt),
      heading("Beside Claude Code · Opus 5.5 at the same setting"),
      ...sameHarnessBlocks(coding, codingRetrievedAt),
      heading(componentHeading(coding)),
      ...componentBlocks(coding, codingRetrievedAt),
      heading("The Index score is a different unit"),
      ...intelligenceBlocks(coding, intelligence, codingRetrievedAt, intelligenceRetrievedAt, evaluationCount, indexVersion),
      heading("Limits"),
      list(
        [
          `The chart scores, task costs, token counts, and durations are Artificial Analysis measurements of the named configuration on the retrieval date, under ${SNAPSHOT_COLUMN_LABELS.deepSwe}, ${SNAPSHOT_COLUMN_LABELS.terminalBench}, and ${SNAPSHOT_COLUMN_LABELS.sweAtlas} for the coding-agent chart and Intelligence Index version ${indexVersion} for the capability chart. None of them establishes a result on other repositories, tasks, or harnesses.`,
        ],
        [
          "The rank, cost rank, frontier steps, setting multiples, component gaps, and same-harness multiples are aicharts derivations from the snapshots named in each caption. A configuration added, removed, or rescored by Artificial Analysis moves them, and the coding-agent snapshot advances daily.",
        ],
        [
          `${MODEL_NAME} in Cursor, Devin, or any harness other than Claude Code is a configuration this snapshot does not store unless a row appears above, so this note says nothing about a missing harness.`,
        ],
        [
          "The Opus 5.5 comparison holds the harness and setting fixed, but the snapshot records outcomes, not run dates or benchmark versions at run time; Artificial Analysis may have measured the two models days apart.",
        ],
        [
          "The two charts use different task sets and different cost definitions. Their scores are not one ranking.",
        ],
      ),
    ],
  };
}
