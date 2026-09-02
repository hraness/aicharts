import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  codingAgentDatasetModifiedAt,
  codingAgentDatasetSummary,
} from "@/lib/coding-agent-dataset";
import {
  aaIndexCostEfficiencyRows,
  aaIndexCostFrontier,
  codingAgentSnapshotRows,
  formatSnapshotCostUsd,
  formatSnapshotScore,
} from "@/lib/coding-agent-snapshot-rows";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";

import {
  BLOG_SOURCES,
  callout,
  heading,
  list,
  paragraph,
  table,
  type BlogArticle,
  type InlineContent,
} from "./articles";

export const AA_INDEX_COST_ARTICLE_SLUG = "aa-index-cost-coding-agents" as const;
export const AA_INDEX_COST_ARTICLE_PUBLISHED_AT = "2026-08-22" as const;
const AA_INDEX_LEADER_LIMIT = 10;
const AA_INDEX_EFFICIENCY_LIMIT = 10;

function checkedSnapshot(): CodingAgentSnapshot {
  const parsed = parseCodingAgentSnapshot(codingAgentData);
  if (!parsed.ok) {
    throw new Error(`Checked coding-agent snapshot is invalid: ${parsed.error.message}`, {
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

function textCell(value: string): InlineContent {
  return [value];
}

function take<T>(items: readonly T[], limit: number): T[] {
  return items.slice(0, limit);
}

export function createAaIndexCostArticle(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): BlogArticle {
  const summary = codingAgentDatasetSummary(snapshot);
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const rows = codingAgentSnapshotRows(snapshot.records);
  const leaders = take(rows.filter(row => row.aaIndex !== null), AA_INDEX_LEADER_LIMIT);
  const frontier = aaIndexCostFrontier(snapshot.records);
  const efficiency = take(aaIndexCostEfficiencyRows(snapshot.records), AA_INDEX_EFFICIENCY_LIMIT);
  const top = leaders[0];
  const firstFrontierJump = frontier.find(point => point.yValue >= 50);
  if (top === undefined || top.aaIndex === null) {
    throw new Error("Checked snapshot has no AA Index values for the cost analysis article.");
  }

  const comparableCount = snapshot.records.filter(record => (
    record.benchmarks.aaIndex !== null && record.economics.costUsd !== null
  )).length;
  const updatedAt = latestCalendarDate(
    AA_INDEX_COST_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(snapshot.source.retrievedAt),
    utcCalendarDate(codingAgentDatasetModifiedAt(snapshot)),
  );

  return {
    slug: AA_INDEX_COST_ARTICLE_SLUG,
    title: "AA Index versus cost for coding agents",
    dek:
      "The checked Artificial Analysis snapshot shows which coding-agent configurations lead on AA Index and how those scores trade off against mean API cost per task.",
    focusPhrase: "coding agent AA Index vs cost",
    seoDescription:
      "Checked Artificial Analysis snapshot: coding-agent AA Index leaders, mean API cost, the cost/performance frontier, and the limits of those scores.",
    keywords: [
      "AA Index",
      "coding agent cost",
      "Artificial Analysis",
      "API cost per task",
      "coding agent benchmark",
      "performance versus cost",
    ],
    publishedAt: AA_INDEX_COST_ARTICLE_PUBLISHED_AT,
    updatedAt,
    sourceIds: ["artificialAnalysisCodingAgents"],
    relatedSlugs: ["mirrorcode-coding-agent-benchmark"],
    body: [
      paragraph(
        "The current AI Charts coding-agent comparison is a checked snapshot of the public ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents page" },
        ". This note answers one question from that snapshot: which named model, agent harness, and effort settings lead on AA Index, and what mean API cost per task those configurations report.",
      ),
      paragraph(
        `AI Charts retrieved the snapshot on ${retrievedAt}. The dataset contains ${summary.recordCount} model-agent configurations across ${summary.modelCount} models, ${summary.agentCount} agent harnesses, and ${summary.providerCount} providers. ${comparableCount} of those configurations report both an AA Index and a mean API cost. The values below are copied from that snapshot. AI Charts does not recalculate Artificial Analysis scores.`,
      ),
      heading("What this snapshot measures"),
      paragraph(
        "AA Index is the snapshot's overall 0–100 score across code changes, terminal work, and repository understanding. Artificial Analysis also reports DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA as separate metrics. Those component scores are not combined here. This note uses AA Index because it is the composite the source publishes for the same configuration that also carries a task-level cost.",
      ),
      paragraph(
        "API cost is the mean API cost in US dollars for the evaluated task configuration. It is not a subscription price, a latency guarantee, or a production invoice. Active time and total token use exist in the same records and are left for the ",
        { href: "/", text: "comparison chart" },
        ".",
      ),
      paragraph(
        "Each row is a specific combination of model, agent harness, and effort setting. A model name without the harness and setting is an incomplete citation. Two rows that share a model and differ only in setting are different observations.",
      ),
      heading("Highest AA Index configurations"),
      paragraph(
        `The highest AA Index in this snapshot is ${formatSnapshotScore(top.aaIndex)} for ${top.model} on ${top.agent} at the ${top.setting} setting, with a mean API cost of ${formatSnapshotCostUsd(top.costUsd)} per task.`,
      ),
      table(
        `Highest AA Index configurations in the ${snapshot.source.name} snapshot retrieved ${retrievedAt}`,
        ["Model", "Agent", "Setting", "AA Index", "Cost"],
        leaders.map(row => [
          textCell(row.model),
          textCell(row.agent),
          textCell(row.setting),
          textCell(formatSnapshotScore(row.aaIndex)),
          textCell(formatSnapshotCostUsd(row.costUsd)),
        ]),
      ),
      paragraph(
        "These are the highest stored AA Index scores, not a claim that the same systems lead on DeepSWE, Terminal-Bench v2.1, or SWE-Atlas-QnA. The ",
        { href: "/data", text: "dataset page" },
        " lists the highest available score for each of those metrics separately and includes every configuration in the snapshot.",
      ),
      heading("Cost and AA Index on the frontier"),
      paragraph(
        "A higher AA Index usually comes with a higher mean task cost in this snapshot, but not every expensive configuration is on the useful edge. The cost/performance frontier keeps a configuration only when no other configuration is both cheaper and at least as strong on AA Index.",
      ),
      table(
        `AA Index versus cost frontier in the ${snapshot.source.name} snapshot retrieved ${retrievedAt}`,
        ["Model", "Agent", "Setting", "AA Index", "Cost"],
        frontier.map(point => [
          textCell(point.record.model),
          textCell(point.record.agent),
          textCell(point.record.setting),
          textCell(formatSnapshotScore(point.yValue)),
          textCell(formatSnapshotCostUsd(point.xValue)),
        ]),
      ),
      paragraph(
        `The frontier in this snapshot has ${frontier.length} configurations. The cheapest points are low-cost, lower-score runs.`,
        firstFrontierJump === undefined
          ? " After that, later points buy higher AA Index at higher mean task cost."
          : ` ${firstFrontierJump.record.model} on ${firstFrontierJump.record.agent} at the ${firstFrontierJump.record.setting} setting is the first large AA Index increase that remains inexpensive. After that, each step buys a smaller AA Index gain at a higher mean task cost, ending at ${top.model} on ${top.agent}.`,
      ),
      paragraph(
        "That sequence is AI Charts analysis of the stored pairs. Artificial Analysis does not publish a frontier ranking. The frontier can change when the next validated snapshot adds, removes, or reprices a configuration.",
      ),
      heading("AA Index per dollar is a derived view"),
      paragraph(
        "Dividing AA Index by mean API cost produces a derived ratio. It is not an Artificial Analysis metric. The ratio favors cheap configurations and can rank a low score above a stronger but more expensive run.",
      ),
      table(
        `Highest derived AA Index per dollar in the ${snapshot.source.name} snapshot retrieved ${retrievedAt}`,
        ["Model", "Agent", "Setting", "AA Index", "Cost", "AA Index / $"],
        efficiency.map(row => [
          textCell(row.record.model),
          textCell(row.record.agent),
          textCell(row.record.setting),
          textCell(formatSnapshotScore(row.aaIndex)),
          textCell(formatSnapshotCostUsd(row.costUsd)),
          textCell(row.aaIndexPerUsd.toFixed(1)),
        ]),
      ),
      paragraph(
        "Use the ratio only to find inexpensive configurations that still have a recorded AA Index. Use the frontier when the question is which configurations are not strictly worse on both cost and score.",
      ),
      callout(
        "Derived, not sourced",
        "AA Index per dollar and the frontier are AI Charts views of the checked snapshot. Cite Artificial Analysis for the underlying score and cost, and cite this page only for the derived comparison.",
      ),
      heading("How to use these numbers"),
      paragraph(
        "Use this note when you need a sourced answer to a cost and quality question on the current coding-agent snapshot. Open the ",
        { href: "/", text: "comparison chart" },
        " to change axes, pin a model, or inspect provider ranges. Open the ",
        { href: "/data", text: "dataset page" },
        " for provenance, benchmark definitions, and the full configuration table.",
      ),
      heading("Limits of the comparison"),
      list(
        [
          "Artificial Analysis defines and operates the evaluations. AI Charts is an independent visualization and is not affiliated with Artificial Analysis or the listed providers.",
        ],
        [
          "Scores and costs belong to the named model, harness, setting, task set, and evaluation version on the retrieval date. They do not establish results for every repository or production workflow.",
        ],
        [
          "Mean task cost is not a price quote. Prompt mix, retry policy, caching, and live API prices can differ from the evaluation.",
        ],
        [
          "AA Index is a composite. A configuration can lead on the index and trail on a component benchmark.",
        ],
        [
          "This is a checked snapshot, not a live mirror. Cite the retrieval timestamp when quoting a value.",
        ],
      ),
    ],
  };
}
