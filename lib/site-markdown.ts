import {
  articleToMarkdown,
  blogArticlePath,
  blogArticles,
  blogDescription,
} from "@/app/blog/articles";
import { blogEditorialImage } from "@/app/blog/editorial-images";
import {
  homeHeading,
  homeLede,
  homeTaskLinks,
  modelCardsHeading,
  modelCardsLede,
  notFoundRecoveryLinks,
  site,
} from "@/app/site";
import artificialAnalysisIntelligenceData from "@/data/artificial-analysis-intelligence.json";
import intelligenceV43Data from "@/data/artificial-analysis-intelligence-v4-3.json";
import codingAgentData from "@/data/coding-agents.json";
import terminalBenchData from "@/data/terminal-bench.json";
import terminalBenchScienceData from "@/data/terminal-bench-science.json";

import { BENCHMARK_DATA_DESCRIPTION } from "./benchmark-portfolio";
import { ATLAS_DATASETS, ATLAS_ENTRIES } from "./benchmark-atlas-catalog";
import { selectAtlasModelProfiles, sortAtlasPoints } from "./benchmark-atlas";
import { ATLAS_CATEGORY_LABELS, formatAtlasCost, formatAtlasScore, parseAtlasView } from "./benchmark-atlas-view";
import { ATLAS_CATALOG_DOWNLOAD_PATH, atlasDatasetDownloadPath } from "./benchmark-atlas-distribution";
import {
  parseArtificialAnalysisIntelligenceSnapshot,
  type ArtificialAnalysisIntelligenceSnapshot,
} from "./artificial-analysis-intelligence-data";
import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "./coding-agent-data";
import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import {
  CODING_AGENT_BENCHMARK_DEFINITIONS,
  CODING_AGENT_DATASET_DOWNLOAD_PATH,
  CODING_AGENT_DATASET_PATH,
  codingAgentDatasetModifiedAt,
  codingAgentDatasetSummary,
  codingAgentLeadersMarkdownTable,
  currentCodingAgentBenchmarkLeaders,
} from "./coding-agent-dataset";
import {
  FIRST_PARTY_RELEASE_HIGHLIGHTS,
  FIRST_PARTY_RELEASE_SOURCE_SUMMARY,
} from "./first-party-release-collection";
import {
  FULL_SNAPSHOT_COLUMNS,
  codingAgentSnapshotRows,
  snapshotRowsMarkdownTable,
} from "./coding-agent-snapshot-rows";
import { formatRetrievedAt, formatUpdateDate } from "./coding-agent-updates";
import {
  DIRECT_DEEP_SWE_EVIDENCE,
  directDeepSweEvidenceForRelease,
} from "./deep-swe-evidence-collection";
import {
  DEEP_SWE_LEADERBOARD_URL,
  formatDeepSweEvidenceScore,
} from "./deep-swe-evidence";
import {
  MODEL_CARD_PRESENTATIONS,
  MODEL_CARD_SNAPSHOT,
  findModelCardPresentation,
  versionedModelCardImagePath,
} from "./model-card-collection";
import {
  formatModelCardReleaseDateLong,
  formatModelCardReleaseStage,
  type ModelCardPresentation,
} from "./model-card-presentation";
import { modelCardRouteStatus } from "./model-card-route-status";
import { vercelGatewayModelCatalog } from "./model-card-sources";
import {
  MODEL_RELEASES_AWAITING_BENCHMARK,
  MODEL_RELEASES_WITH_EARLY_DEEP_SWE,
  modelReleaseRadarHighlightsExcluding,
} from "./model-release-collection";
import { parseTerminalBenchSnapshot, type TerminalBenchSnapshot } from "./terminal-bench-data";
import {
  parseTerminalBenchScienceSnapshot,
  type TerminalBenchScienceSnapshot,
} from "./terminal-bench-science-data";

export const AGENT_GUIDE_PATH = "/llms.txt" as const;
export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
export const AGENT_GUIDE_CONTENT_TYPE = "text/plain; charset=utf-8";

export type MarkdownDocument = Readonly<{
  body: string;
  contentType: typeof MARKDOWN_CONTENT_TYPE | typeof AGENT_GUIDE_CONTENT_TYPE;
  found: boolean;
}>;

export type HomeDocumentLink = Readonly<{
  href: string;
  label: string;
  note: string;
}>;

export type HomeDocumentModel = Readonly<{
  heading: string;
  links: readonly HomeDocumentLink[];
  paragraphs: readonly string[];
}>;

function checkedSnapshot(): CodingAgentSnapshot {
  const parsed = parseCodingAgentSnapshot(codingAgentData);
  if (!parsed.ok) {
    throw new Error(`Checked coding-agent snapshot is invalid: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return parsed.value;
}

function checkedArtificialAnalysisIntelligenceSnapshot(): ArtificialAnalysisIntelligenceSnapshot {
  const parsed = parseArtificialAnalysisIntelligenceSnapshot(
    artificialAnalysisIntelligenceData,
  );
  if (!parsed.ok) {
    throw new Error(
      `Checked Artificial Analysis Intelligence snapshot is invalid: ${parsed.error.message}`,
      { cause: parsed.error },
    );
  }
  return parsed.value;
}

function checkedTerminalBenchSnapshot(): TerminalBenchSnapshot {
  const parsed = parseTerminalBenchSnapshot(terminalBenchData);
  if (!parsed.ok) {
    throw new Error(`Checked Terminal-Bench snapshot is invalid: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return parsed.value;
}

function checkedCurrentIntelligenceSnapshot() {
  const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceV43Data);
  if (!parsed.ok) throw new Error("Invalid checked Intelligence Index v4.3 snapshot", { cause: parsed.error });
  return parsed.value;
}

function checkedTerminalBenchScienceSnapshot(): TerminalBenchScienceSnapshot {
  const parsed = parseTerminalBenchScienceSnapshot(terminalBenchScienceData);
  if (!parsed.ok) {
    throw new Error(
      `Checked Terminal-Bench-Science snapshot is invalid: ${parsed.error.message}`,
      { cause: parsed.error },
    );
  }
  return parsed.value;
}

function absolute(path: string): string {
  return new URL(path, site.origin).toString();
}

function joinMarkdown(lines: readonly string[]): string {
  return `${lines.join("\n").trim()}\n`;
}

function editorialImageMarkdown(slug: (typeof blogArticles)[number]["slug"]): string[] {
  const image = blogEditorialImage(slug);
  return image === undefined ? [] : [
    `![${image.alt}](${absolute(image.src)})`,
    "",
    `*${image.caption} ${image.credit}*`,
    "",
  ];
}

export function homeDocumentModel(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): HomeDocumentModel {
  const summary = codingAgentDatasetSummary(snapshot);
  const intelligence = checkedCurrentIntelligenceSnapshot();
  return {
    heading: homeHeading,
    paragraphs: [
      site.description,
      `The homepage compares capability with cost or output tokens on the ${intelligence.benchmark.name} v${intelligence.benchmark.version} Pareto frontier. Both resource views use the identical ${intelligence.selection.positiveCostRecordCount}-configuration positive-cost cohort. Inspect a point to see the model, effort setting, and exact values.`,
      "Choose a task-specific comparison in the benchmark explorer, or use the separate coding-agent charts to compare cost, time, and total tokens. Each evaluation keeps its own source, version, and configuration; no universal score is calculated.",
    ],
    links: [
      {
        href: "/#intelligence-index",
        label: "Explore the Pareto frontier",
        note: "Capability versus output tokens or cost from the checked Intelligence Index cohort.",
      },
      {
        href: "/coding",
        label: "Coding agent comparisons",
        note: `${summary.recordCount} configurations with benchmark scores, cost, active time, and total tokens.`,
      },
      {
        href: "/benchmarks",
        label: "AI benchmark explorer",
        note: "Browse task-specific charts and source guides across coding, reasoning, research, memory, science, and media.",
      },
      {
        href: CODING_AGENT_DATASET_PATH,
        label: "Benchmark data and method",
        note: "Source dates, comparison rules, and checked dataset downloads.",
      },
      {
        href: "/blog",
        label: "Benchmark analysis",
        note: blogDescription,
      },
      {
        href: AGENT_GUIDE_PATH,
        label: "Machine-readable site guide",
        note: "Public pages, data routes, and Markdown access.",
      },
    ],
  };
}

export function homeDocumentText(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): string {
  const document = homeDocumentModel(snapshot);
  return [document.heading, ...document.paragraphs, ...document.links.map(link => `${link.label} ${link.note}`)]
    .join(" ");
}

function atlasMarkdownCell(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/[\r\n]+/gu, " ");
}

export function atlasCatalogMarkdownTable(): string {
  return [
    "| Task | Benchmark | Version | Coverage | Data |",
    "| --- | --- | --- | --- | --- |",
    ...ATLAS_ENTRIES.map(entry => {
      const dataset = ATLAS_DATASETS.find(candidate => candidate.benchmarkId === entry.id);
      const coverage = dataset ? `${dataset.points.length} charted results` : entry.coverage === "watchlist" ? "Emerging evaluation" : "Source guide";
      const data = dataset ? `[JSON](${absolute(atlasDatasetDownloadPath(entry.id))})` : `[Source](${entry.source.url})`;
      return `| ${ATLAS_CATEGORY_LABELS[entry.category]} | [${atlasMarkdownCell(entry.name)}](${absolute(`/benchmarks?atlas=${entry.id}#explore`)}) | ${atlasMarkdownCell(entry.version)} | ${coverage} | ${data} |`;
    }),
  ].join("\n");
}

export function atlasDefaultChartMarkdown(): string {
  const state = parseAtlasView("", ATLAS_ENTRIES, ATLAS_DATASETS);
  const entry = ATLAS_ENTRIES.find(candidate => candidate.id === state.benchmarkId);
  const dataset = ATLAS_DATASETS.find(candidate => candidate.benchmarkId === state.benchmarkId);
  if (entry === undefined || dataset === undefined) return "";
  return joinMarkdown([
    `### Benchmark library: ${entry.name} · ${entry.version}`,
    "",
    entry.question,
    "",
    dataset.comparabilityNote,
    "",
    `Source: [${dataset.source.name}](${dataset.source.url}). Retrieved ${formatRetrievedAt(dataset.source.retrievedAt)}.${dataset.observedAt ? ` Source observation date: ${formatRetrievedAt(dataset.observedAt)}.` : ""}`,
    "",
    `| Configuration | ${atlasMarkdownCell(dataset.score.label)} (${atlasMarkdownCell(dataset.score.unit)}; ${dataset.score.direction} is better) | ${atlasMarkdownCell(dataset.costLabel ?? "Cost")} |`,
    "| --- | ---: | ---: |",
    ...selectAtlasModelProfiles(sortAtlasPoints(dataset)).slice(0, 8).map(point => `| ${atlasMarkdownCell(point.label)} | ${formatAtlasScore(point.score, dataset.score.unit)} | ${formatAtlasCost(point.costUsd)} |`),
    "",
    `The default view shows up to eight systems using each system’s best-scoring configuration. [Explore all ${dataset.points.length} configurations](${absolute(`/benchmarks?atlas=${entry.id}&atlasProfiles=all&atlasAll=1#explore`)}) or [download this cohort](${absolute(atlasDatasetDownloadPath(entry.id))}). A rank is an ordering within this benchmark, not a universal model recommendation.`,
  ]);
}

function atlasGuidesMarkdown(): string {
  return ATLAS_ENTRIES.flatMap(entry => {
    const dataset = ATLAS_DATASETS.find(candidate => candidate.benchmarkId === entry.id);
    return [
      `### ${entry.name} · ${entry.version}`,
      "",
      entry.question,
      "",
      `${entry.summary} ${entry.measure}`,
      "",
      `Compare fairly: ${entry.comparisonRule}`,
      "",
      ...entry.limitations.map(limit => `- ${limit}`),
      "",
      dataset
        ? `${dataset.points.length} charted configurations. ${dataset.comparabilityNote} Source retrieved ${formatRetrievedAt(dataset.source.retrievedAt)}.${dataset.observedAt ? ` Source observation date: ${formatRetrievedAt(dataset.observedAt)}.` : ""}${dataset.source.revision ? ` Source revision: ${dataset.source.revision}.` : ""}${dataset.costLabel ? ` Cost basis: ${dataset.costLabel}.` : ""}`
        : "Source guide only; no comparable results are charted here.",
      "",
      `[Source: ${entry.source.name}](${entry.source.url})${entry.source.methodologyUrl ? ` · [Methodology](${entry.source.methodologyUrl})` : ""}${dataset ? ` · [Download this dataset](${absolute(atlasDatasetDownloadPath(entry.id))})` : ""}`,
      "",
    ];
  }).join("\n");
}

function homeMarkdown(snapshot: CodingAgentSnapshot): string {
  const document = homeDocumentModel(snapshot);
  const intelligence = checkedCurrentIntelligenceSnapshot();
  return joinMarkdown([
    `# ${document.heading}`,
    "",
    homeLede,
    "",
    `## ${intelligence.benchmark.name} v${intelligence.benchmark.version} efficiency`,
    "",
    `The Pareto chart compares the identical ${intelligence.selection.positiveCostRecordCount}-configuration positive-cost cohort from ${intelligence.records.length} complete score-and-output records. Switch between weighted output-only tokens per Index task and cost per Index task. Higher scores and lower resource use are better; the frontier marks configurations not dominated on both dimensions. Select a point to read its full configuration and exact values.`,
    "",
    `Source: [${intelligence.source.name}](${intelligence.source.url}), retrieved ${formatRetrievedAt(intelligence.source.retrievedAt)}. The ${intelligence.benchmark.evaluationCount}-evaluation Index keeps the publisher’s scores. Output tokens include answer and reasoning, not input and cache traffic. AI Charts derives the frontier within this checked cohort. Historical v4.1.1 remains separate and is never relabeled as v4.3.`,
    "",
    `[Source and method](${absolute("/data#current-intelligence-efficiency")}) · [Current v4.3 JSON](${absolute("/data/artificial-analysis-intelligence-v4-3.json")}) · [Historical v4.1.1 JSON](${absolute("/data/artificial-analysis-intelligence.json")})`,
    "",
    "## Explore by task",
    "",
    ...homeTaskLinks.map(link => `- [${link.name}](${absolute(`/benchmarks?task=${link.task}#explore`)}). ${link.description}`),
    "",
    "## More comparisons and sources",
    "",
    ...document.links.filter(link => link.href !== "/#intelligence-index")
      .map(link => `- [${link.label}](${absolute(link.href)}). ${link.note}`),
  ]);
}

function codingMarkdown(snapshot: CodingAgentSnapshot): string {
  const summary = codingAgentDatasetSummary(snapshot);
  return joinMarkdown([
    "# Coding agent comparisons",
    "",
    "Compare coding-agent benchmark scores with API cost, active time, or total token use. Each point is a model, agent harness, and effort setting—not a model in isolation.",
    "",
    `The default chart shows DeepSWE accuracy against API cost. Choose another benchmark or resource axis, inspect a point, or compare a provider’s configurations. The checked [${snapshot.source.name} coding-agents snapshot](${snapshot.source.url}) contains ${summary.recordCount} configurations across ${summary.modelCount} models and ${summary.agentCount} agent harnesses. Retrieved ${formatRetrievedAt(snapshot.source.retrievedAt)}.`,
    "",
    "## Available benchmarks",
    "",
    ...CODING_AGENT_BENCHMARK_DEFINITIONS.map(definition => `- ${definition.label}: ${definition.description}`),
    "",
    "Terminal-Bench v2.1 in this source is a legacy evaluation. Terminal-Bench 4 is the site’s current terminal-engineering standard and has a separate owner-published cohort in the benchmark explorer. Scores from the two versions are not pooled.",
    "",
    `[Terminal-Bench 4](${absolute("/benchmarks?atlas=terminal-bench-4#explore")}) · [All benchmarks](${absolute("/benchmarks")}) · [Source and method](${absolute("/data#source")}) · [Coding-agent JSON](${absolute(CODING_AGENT_DATASET_DOWNLOAD_PATH)}) · [Model cards](${absolute("/models")})`,
  ]);
}

function benchmarksMarkdown(): string {
  return joinMarkdown([
    "# Explore benchmarks",
    "",
    `Choose a task and compare results within one evaluation. The library has ${ATLAS_DATASETS.length} charted cohorts across ${ATLAS_ENTRIES.length} benchmarks covering coding, reasoning, research, memory, science, and media.`,
    "",
    "Charts contain checked observations. Source guides explain evaluations whose results are not charted here. Each cohort keeps its native score, version, system configuration, uncertainty, and source dates; no universal rank is calculated.",
    "",
    atlasDefaultChartMarkdown(),
    "",
    "## Browse benchmarks",
    "",
    atlasCatalogMarkdownTable(),
    "",
    `[Definitions and comparison limits](${absolute("/data#benchmark-atlas")}) · [Catalog JSON](${absolute(ATLAS_CATALOG_DOWNLOAD_PATH)}) · [Capability versus resources](${absolute("/")}) · [Coding agent comparisons](${absolute("/coding")})`,
  ]);
}

function datasetMarkdown(snapshot: CodingAgentSnapshot): string {
  const summary = codingAgentDatasetSummary(snapshot);
  const modifiedAt = codingAgentDatasetModifiedAt(snapshot);
  const leaders = currentCodingAgentBenchmarkLeaders(snapshot);
  const terminalBench = checkedTerminalBenchSnapshot();
  const terminalBenchScience = checkedTerminalBenchScienceSnapshot();
  const intelligence = checkedArtificialAnalysisIntelligenceSnapshot();
  const currentIntelligence = checkedCurrentIntelligenceSnapshot();
  return joinMarkdown([
    "# Benchmark data and method",
    "",
    BENCHMARK_DATA_DESCRIPTION,
    "",
    "## Benchmark atlas: charts and source guides",
    "",
    `The atlas covers ${ATLAS_ENTRIES.length} benchmarks and ${ATLAS_DATASETS.length} charted evaluation cohorts. Each chart uses one source, score definition, and version. Historical research cohorts remain labeled; a retrieval date is not an evaluation date.`,
    "",
    `[Download the catalog JSON](${absolute(ATLAS_CATALOG_DOWNLOAD_PATH)}) for all benchmark IDs, source dates, versions, coverage, and individual dataset links. The JSON for each chart retains its observations, score unit, costs, uncertainty labels, and configuration details.`,
    "",
    "AI Charts software is MIT-licensed. Third-party measurements and methodology retain their source terms; these downloads do not grant a new license to them. Cite the source and named evaluation version.",
    "",
    atlasCatalogMarkdownTable(),
    "",
    atlasGuidesMarkdown(),
    "",
    "## Terminal-Bench 4 coding standard",
    "",
    `Terminal-Bench ${terminalBench.benchmark.version} is the site’s standard agentic terminal-engineering benchmark, available in the [benchmark explorer](${absolute("/benchmarks?atlas=terminal-bench-4#explore")}). The checked owner snapshot contains ${terminalBench.records.length} configurations from the official [Harbor Framework submissions](${terminalBench.source.submissionsDirectoryUrl}) at [commit ${terminalBench.source.repositoryCommit.slice(0, 7)}](${terminalBench.source.repositoryCommitUrl}), committed on ${formatRetrievedAt(terminalBench.source.repositoryCommittedAt)}, with ${terminalBench.benchmark.taskCount} tasks and ${terminalBench.benchmark.trialsPerTask} trials per task. AI Charts retrieved it on ${formatRetrievedAt(terminalBench.source.retrievedAt)}.`,
    "",
    "Terminal-Bench 4 is a breaking exam generation. Its results remain separate from the Terminal-Bench v2.1 field in the Artificial Analysis dataset below. Every TB4 JSON row retains the model, agent, agent version, effort, accuracy, 95% confidence interval, trials, cost, tokens, duration, and pinned source files.",
    "",
    `- [Download the Terminal-Bench 4 JSON snapshot](${absolute("/data/terminal-bench-4.json")})`,
    "",
    "## Terminal-Bench-Science 0.1",
    "",
    `The checked scientific-workflow snapshot published by [${terminalBenchScience.source.name}](${terminalBenchScience.source.repositoryUrl}) contains ${terminalBenchScience.records.length} owner-published system configurations across ${terminalBenchScience.benchmark.taskCount} tasks and ${terminalBenchScience.benchmark.trialsPerTask} trials per task. It is pinned to [v0.1.0 release commit ${terminalBenchScience.source.releaseCommit.slice(0, 7)}](${terminalBenchScience.source.releaseCommitUrl}). The release has the persistent citation [${terminalBenchScience.source.releaseDoiUrl}](${terminalBenchScience.source.releaseDoiUrl}), and the owner leaderboard was updated on ${formatRetrievedAt(terminalBenchScience.source.leaderboardUpdatedAt)}. AI Charts retrieved it on ${formatRetrievedAt(terminalBenchScience.source.retrievedAt)}.`,
    "",
    "Every row keeps the model, harness, reasoning effort, resolution rate, binomial standard error, trial count, evaluation cost, token use, per-domain metrics, and owner-published source link. Terminal-Bench-Science remains separate from general terminal engineering and does not feed a composite score. Owner-published aggregate and per-domain costs are retained independently and are not forced to reconcile.",
    "",
    `- [Download the Terminal-Bench-Science 0.1 JSON snapshot](${absolute("/data/terminal-bench-science-0-1.json")})`,
    "",
    `## Current Intelligence efficiency · v${currentIntelligence.benchmark.version}`,
    "",
    `The homepage’s Pareto chart uses ${currentIntelligence.benchmark.name} v${currentIntelligence.benchmark.version}. Its output-token and cost views compare the identical ${currentIntelligence.selection.positiveCostRecordCount}-configuration positive-cost cohort from ${currentIntelligence.records.length} complete score-and-output records. Output tokens include answer and reasoning; task cost also includes input and cache traffic.`,
    "",
    `This ${currentIntelligence.benchmark.evaluationCount}-evaluation version weights agents ${currentIntelligence.benchmark.categoryWeightsPercent.agents}%, coding ${currentIntelligence.benchmark.categoryWeightsPercent.coding}%, scientific reasoning ${currentIntelligence.benchmark.categoryWeightsPercent.scientific}%, and general capability ${currentIntelligence.benchmark.categoryWeightsPercent.general}%. The source is checked every four hours. Version, evaluation roster, source identities, native measures, and retention must pass validation before an update is published. Retrieved ${formatRetrievedAt(currentIntelligence.source.retrievedAt)}.`,
    "",
    `- [Download current Intelligence v4.3 JSON](${absolute("/data/artificial-analysis-intelligence-v4-3.json")})`,
    `- [Full v4.3 comparison rules and limitations](${absolute("/data#atlas-aa-intelligence-4-3")})`,
    "",
    `## ${intelligence.benchmark.name} v${intelligence.benchmark.version} efficiency · historical frozen snapshot`,
    "",
    `This retained historical dataset pairs the owner-published Intelligence Index score with weighted output tokens and cost per Index task. It is not the current homepage dataset. The frozen snapshot retains ${intelligence.records.length} measured score-and-output configurations from ${intelligence.selection.sourceRecordCount} source configurations; all ${intelligence.selection.measuredCompleteRecordCount} have complete score, output-token, and cost-component measures. Its historical matched-resource comparison uses the identical ${intelligence.selection.positiveCostRecordCount}-configuration cohort with positive comparable cost. Keep these results separate from v4.3, whose evaluation roster and weights differ.`,
    "",
    "The nine evaluations and weights are: Agents 34% (GDPval-AA v2 20%; τ³-Banking 14%); Coding 24% (Terminal-Bench v2.1 16%; SciCode 8%); Scientific Reasoning 24% (Humanity's Last Exam 12%; GPQA Diamond 6%; CritPt 6%); and General 18% (AA-LCR 6%; AA-Omniscience 12%).",
    "",
    "Output tokens here mean answer plus reasoning tokens only, weighted by each evaluation's Index weight and divided by task count. They are not the coding-agent chart's total tokens, which also include input traffic. Cost is the owner's weighted per-task sum of input, cache, reasoning, and answer/output components. A row with a complete cost breakdown but a reported zero total is stored as unavailable, never converted to a free-model value; rows with incomplete cost are excluded. Complete zero-total rows remain in JSON but are omitted from the historical matched-resource cohort.",
    "",
    `Historical comparable-cohort rule: ${intelligence.selection.rule}. In a Pareto frontier for that cohort, a point is not dominated by another record with an equal-or-higher score and equal-or-lower output-token or positive-cost value. Artificial Analysis publishes the measurements; the frontier classification is AI Charts analysis.`,
    "",
    `This v${intelligence.benchmark.version} snapshot is frozen and is no longer refreshed by automation. The current v${currentIntelligence.benchmark.version} dataset above has a separate versioned source contract and download. Historical snapshot retrieved ${formatRetrievedAt(intelligence.source.retrievedAt)}.`,
    "",
    `- [Download historical Intelligence v4.1.1 JSON](${absolute("/data/artificial-analysis-intelligence.json")})`,
    `- [Artificial Analysis model leaderboard](${intelligence.source.url})`,
    `- [Artificial Analysis Intelligence methodology](${intelligence.source.methodologyUrl})`,
    `- [Artificial Analysis terms of use](${intelligence.source.termsUrl})`,
    `- Citation: ${intelligence.source.citation}`,
    "",
    "## Artificial Analysis coding-agent source and refresh",
    "",
    `Last retrieved ${formatRetrievedAt(snapshot.source.retrievedAt)}. Latest notable update ${formatRetrievedAt(modifiedAt)}. ${summary.recordCount} configurations, ${summary.providerCount} providers.`,
    "",
    `The source is the public [${snapshot.source.name} coding-agents comparison](${snapshot.source.url}). AI Charts retrieved this snapshot on ${formatRetrievedAt(snapshot.source.retrievedAt)}. The site checks for a new source snapshot daily. The displayed retrieval time changes only when a validated snapshot is stored.`,
    "",
    `The most recent retained model, variant, or material benchmark change was detected on ${formatRetrievedAt(modifiedAt)}. This meaningful-update time is separate from the daily retrieval check.`,
    "",
    `The checked dataset contains ${summary.recordCount} model-agent configurations across ${summary.modelCount} models, ${summary.agentCount} agent harnesses, and ${summary.providerCount} model providers. The chart and the JSON download use this same checked snapshot.`,
    "",
    "## Benchmark definitions",
    "",
    "Each benchmark is shown on the 0–100 scale stored in the snapshot. The metrics evaluate different tasks and should be interpreted separately.",
    "",
    ...CODING_AGENT_BENCHMARK_DEFINITIONS.flatMap(definition => [
      `### ${definition.label}`,
      "",
      definition.description,
      "",
    ]),
    "## Current leaders",
    "",
    "These are the highest available scores in the retrieved snapshot, one row per benchmark. They are observations of the named model, agent harness, and effort setting rather than general model ranks.",
    "",
    codingAgentLeadersMarkdownTable(leaders),
    "",
    `For AA Index versus mean API cost see [AA Index versus cost for coding agents](${absolute(blogArticlePath("aa-index-cost-coding-agents"))}). For whether classified open-weight rows sit with those leaders see [open models on coding-agent benchmarks](${absolute(blogArticlePath("open-models-coding-agent-benchmarks"))}). For how lower inference costs change frequent-use product economics see [cheaper AI models can make everyday products viable](${absolute(blogArticlePath("small-models-have-arrived"))}). For the acceptance funnel, cost, tokens, and remaining miss rate behind the leading scientific score see [what Terminal-Bench-Science’s 30% result measures](${absolute(blogArticlePath("terminal-bench-science"))}). For why a public-suite high score still needs a holdout see [why a coding-agent high score still needs a holdout](${absolute(blogArticlePath("coding-agent-score-holdouts"))}).`,
    "",
    "## All configurations",
    "",
    `Every model-agent configuration in the retrieved snapshot, with AA Index, component scores, and mean API cost per task. Retrieved ${formatRetrievedAt(snapshot.source.retrievedAt)}.`,
    "",
    snapshotRowsMarkdownTable(codingAgentSnapshotRows(snapshot.records), FULL_SNAPSHOT_COLUMNS),
    "",
    "## Normalization method",
    "",
    "The refresh job reads the source page's public data payload, validates every source row, and maps it into a versioned owned schema. Benchmark reward proportions are represented as 0–100 scores. Mean task cost stays in US dollars, mean active wall time stays in seconds, and mean total token use stays as a token count.",
    "",
    "Provider identifiers, model effort settings, stable series keys, and sort order are normalized for the chart. The refresh is rejected when duplicate records, major row loss, stable-key loss, or substantial metric-coverage regressions are detected. AI Charts does not recalculate the source benchmark outcomes.",
    "",
    "## Limitations",
    "",
    "- Artificial Analysis Intelligence is an owner-defined, primarily English-language aggregate whose weights emphasize agentic tasks. It does not establish performance for every use case.",
    "- Artificial Analysis defines and operates the upstream evaluations. AI Charts is an independent visualization and is not affiliated with Artificial Analysis or the listed providers.",
    "- Scores depend on the named model, agent harness, effort setting, task set, and evaluation version. They do not establish results for every software repository or production workflow.",
    "- Cost, duration, and token values are task-level means from the source evaluation. They are not price or latency guarantees.",
    "- The current v4.3 Intelligence snapshot is checked every four hours and the coding-agent snapshot daily; neither is a real-time mirror. The historical v4.1.1 snapshot is frozen. Use the relevant version and retrieval timestamp when citing a value.",
    "",
    "## Dataset links",
    "",
    `- [Download current Intelligence v4.3 JSON](${absolute("/data/artificial-analysis-intelligence-v4-3.json")})`,
    `- [Download historical Intelligence v4.1.1 JSON](${absolute("/data/artificial-analysis-intelligence.json")})`,
    `- [Download the coding-agent JSON snapshot](${absolute(CODING_AGENT_DATASET_DOWNLOAD_PATH)})`,
    `- [Artificial Analysis coding-agents source](${snapshot.source.url})`,
    `- [Coding agent chart](${absolute("/coding")})`,
    `- [Model capability Pareto chart](${absolute("/")})`,
  ]);
}

function blogIndexMarkdown(): string {
  return joinMarkdown([
    "# AI model and agent benchmark analysis",
    "",
    `${blogDescription} The first collection focuses on coding agents.`,
    "",
    "## Articles",
    "",
    ...blogArticles.flatMap(article => [
      `### [${article.title}](${absolute(blogArticlePath(article.slug))})`,
      "",
      ...editorialImageMarkdown(article.slug),
      article.dek,
      "",
    ]),
    "## Method",
    "",
    "Each note starts with primary or first-party evidence. Material claims link directly to those sources. Leaderboard values are paired with their observation date and named configuration. Methodology limits stay near the results they qualify.",
    "",
    `[Explore the coding-agent chart](${absolute("/")})`,
  ]);
}

function modelCardsMarkdown(): string {
  const distinctReleaseHighlights = modelReleaseRadarHighlightsExcluding(
    FIRST_PARTY_RELEASE_HIGHLIGHTS.flatMap(release => release.namedModels),
  );
  return joinMarkdown([
    `# ${modelCardsHeading}`,
    "",
    modelCardsLede,
    "",
    `${MODEL_CARD_PRESENTATIONS.length} model-and-profile benchmark cards from the current Artificial Analysis coding-agents snapshot. Cataloged cards use canonical model-and-profile routes. Newly observed identities or profile settings receive deterministic provisional routes so a data refresh can publish without manual intervention. Cards show observed ranges when multiple agent harnesses evaluated the same configuration.`,
    "",
    `[Source snapshot](${MODEL_CARD_SNAPSHOT.source.url}), retrieved ${formatRetrievedAt(MODEL_CARD_SNAPSHOT.source.retrievedAt)}.`,
    "",
    "## First-party release radar",
    "",
    `${FIRST_PARTY_RELEASE_SOURCE_SUMMARY.labCount} labs across ${FIRST_PARTY_RELEASE_SOURCE_SUMMARY.sourceCount} first-party sources supply durable announcement candidates. Previously unseen canonical URLs create candidates; mutable source timestamps are secondary change evidence, not official release dates or benchmark scores.`,
    "",
    ...FIRST_PARTY_RELEASE_HIGHLIGHTS.map(release => (
      `- [${release.namedModels.join(" and ")}](${release.canonicalUrl}). ${release.providerName}; first observed ${formatUpdateDate(release.firstSeenAt)}.`
    )),
    "",
    "## Benchmark coverage radar",
    "",
    `${MODEL_RELEASES_AWAITING_BENCHMARK.length} recent releases from established providers are awaiting a complete four-benchmark Artificial Analysis index; ${MODEL_RELEASES_WITH_EARLY_DEEP_SWE.length} already have direct DeepSWE evidence. Discovery is not a score. OpenRouter is the first-line model-identity catalog, with Artificial Analysis used only when a model is unresolved. A labeled early [DeepSWE v${DIRECT_DEEP_SWE_EVIDENCE.source.benchmarkVersion}](${DEEP_SWE_LEADERBOARD_URL}) pass@1 result, when present, comes directly from DataCurve's mini-swe-agent leaderboard and remains outside the Artificial Analysis chart and cards. Partial Artificial Analysis observations can appear there with missing metrics shown explicitly.`,
    "",
    ...distinctReleaseHighlights.map(release => {
      const earlyEvidence = directDeepSweEvidenceForRelease(release);
      const evidenceText = earlyEvidence === null
        ? ""
        : ` Early DeepSWE: ${formatDeepSweEvidenceScore(earlyEvidence.passAt1)} pass@1; ${earlyEvidence.reasoningEffort ?? "default"}; ${earlyEvidence.runs} runs; ${earlyEvidence.identity.resolver.name} model match.`;
      return `- [${release.model}](${release.modelUrl}). ${release.providerName}; first observed in the OpenRouter discovery catalog ${formatUpdateDate(release.sourceAddedAt)}.${evidenceText}`;
    }),
    "",
    "## Cards",
    "",
    ...MODEL_CARD_PRESENTATIONS.map(card => {
      const release = card.release.status === "verified"
        ? `${card.release.appliesTo?.kind === "base-model" ? `official base-model release (${card.release.appliesTo.model})` : "official release"} [${formatModelCardReleaseDateLong(card.release.releasedOn)}](${card.release.sources[0]?.url ?? absolute(card.path)})`
        : card.release.status === "pending"
          ? "official release date pending verification"
          : `official release date pending first-party review; first observed in the benchmark snapshot ${formatModelCardReleaseDateLong(card.release.observedOn)}`;
      return `- [${card.displayTitle}](${absolute(card.path)}). ${card.providerName}; ${card.classLabel}; ${release}; ${card.observationCount} ${card.observationCount === 1 ? "configuration" : "configurations"}.`;
    }),
  ]);
}

export function modelCardMarkdown(card: ModelCardPresentation): string {
  const routeStatus = modelCardRouteStatus(card);
  const markdownStatValue = (stat: ModelCardPresentation["performance"][number]) => (
    stat.available ? stat.value : "Not available"
  );
  return joinMarkdown([
    `# ${card.displayTitle}`,
    "",
    `${card.providerName} ${card.classLabel.toLowerCase()} card based on ${card.observationCount} ${card.observationCount === 1 ? "configuration" : "configurations"} in the current Artificial Analysis coding-agents snapshot. Values are observed min–max ranges; AI Charts does not average unlike agent harnesses.`,
    "",
    "## Performance",
    "",
    ...card.performance.map(stat => `- ${stat.label}: ${markdownStatValue(stat)}`),
    "",
    "## Economics",
    "",
    ...card.economics.map(stat => `- ${stat.label}: ${markdownStatValue(stat)}`),
    "",
    "## Identity",
    "",
    `- ${routeStatus.provisionalIdentity ? "Provisional" : "Canonical"} model ID: \`${card.canonicalModelId}\``,
    ...(routeStatus.isProvisional ? [`- Route status: provisional until the new upstream ${routeStatus.primaryReason} is cataloged`] : []),
    ...(card.release.status === "verified"
      ? [`- ${card.release.appliesTo?.kind === "base-model" ? `Official base-model release (${card.release.appliesTo.model})` : "Official release"}: [${formatModelCardReleaseDateLong(card.release.releasedOn)} · ${card.release.sources[0]?.title ?? "first-party source"}](${card.release.sources[0]?.url ?? absolute(card.path)}); ${formatModelCardReleaseStage(card.release.stage)}`]
      : card.release.status === "pending"
        ? [`- Official release date: pending verification; researched ${formatModelCardReleaseDateLong(card.release.researchedOn)}`]
        : [`- Official release date: pending first-party review; first observed in the benchmark snapshot ${formatModelCardReleaseDateLong(card.release.observedOn)}`]),
    `- Vercel AI Gateway ID: ${card.gatewayModelId === null ? "not available in the checked catalog" : `\`${card.gatewayModelId}\``}`,
    `- [Gateway model catalog](${vercelGatewayModelCatalog.url}), checked ${vercelGatewayModelCatalog.verifiedAt}`,
    `- Profile: \`${card.profileSlug}\``,
    `- Agent ${card.agentNames.length === 1 ? "harness" : "harnesses"}: ${card.agentNames.join(", ")}`,
    `- [Artificial Analysis source snapshot](${MODEL_CARD_SNAPSHOT.source.url}), retrieved ${formatRetrievedAt(MODEL_CARD_SNAPSHOT.source.retrievedAt)}`,
    `- [Download the branded PNG](${absolute(versionedModelCardImagePath(card.path, "card.png"))})`,
    `- [All model cards](${absolute("/models")})`,
    `- [Dataset and method](${absolute(CODING_AGENT_DATASET_PATH)})`,
  ]);
}

export function agentGuideMarkdown(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): string {
  const summary = codingAgentDatasetSummary(snapshot);
  const intelligence = checkedCurrentIntelligenceSnapshot();
  return joinMarkdown([
    `# ${site.name}`,
    "",
    `${site.description} The benchmark explorer has ${ATLAS_DATASETS.length} charted cohorts across ${ATLAS_ENTRIES.length} benchmarks. Each chart keeps its native score, source, version, and comparison cohort.`,
    "",
    "## When to use AI Charts",
    "",
    "Use AI Charts when you need a sourced comparison that keeps benchmark versions and system configurations explicit. Explore coding, reasoning, deep research, memory, scientific work, image and video generation, audio, and world-model evaluation. A chart has measured results; a source guide describes an evaluation whose results are not charted here. Some sources contain historical research cohorts rather than current products.",
    "",
    `The current Intelligence v${intelligence.benchmark.version} JSON powers the homepage’s leading Pareto chart. It retains ${intelligence.records.length} measured model configurations across ${intelligence.benchmark.evaluationCount} weighted evaluations. Both resource views use the identical ${intelligence.selection.positiveCostRecordCount}-configuration positive-cost cohort. Its output tokens are answer plus reasoning tokens, not the coding-agent dataset's total tokens. Historical v4.1.1 is frozen and must not be pooled with this version.`,
    "",
    "Use `/data` for every benchmark’s definition, comparison rules, source dates, and limitations. Start machine-readable exploration at `/data/benchmark-atlas.json`, a compact catalog with individual measured-dataset URLs. Versioned source JSON downloads retain the full Terminal-Bench 4, Terminal-Bench-Science, current and historical Artificial Analysis Intelligence, and coding-agent snapshots. Use `/models` for model-and-profile cards and `/blog` for analysis of a named benchmark.",
    "",
    `Do not treat AI Charts as a live inference API, universal ranking, or production SLA. It does not expose OAuth, GraphQL, MCP, or commerce endpoints. It does not recalculate upstream scores or merge incompatible cohorts. The older coding-agent source view covers ${summary.recordCount} configurations and is only one part of the atlas.`,
    "",
    "## Main pages",
    "",
    `- [AI model charts](${absolute("/")}). Start with capability versus cost or output tokens on the Pareto frontier. Inspect exact model configurations in one matched resource cohort.`,
    `- [Coding agent comparisons](${absolute("/coding")}). Compare benchmark scores with API cost, active time, or total tokens from the separate Artificial Analysis coding-agents source.`,
    `- [AI benchmark explorer](${absolute("/benchmarks")}). Choose a task, inspect a measured cohort, or read a source guide. Terminal-Bench 4 is the current terminal-engineering standard.`,
    `- [Atlas catalog JSON](${absolute(ATLAS_CATALOG_DOWNLOAD_PATH)}). All benchmark IDs, coverage, versions, source dates, and per-cohort JSON distribution links.`,
    `- [Model benchmark cards](${absolute("/models")}). Shareable cards for each model and benchmark profile, with canonical routes for cataloged identities.`,
    `- [Dataset and methodology](${absolute(CODING_AGENT_DATASET_PATH)}). Every atlas benchmark’s provenance, version boundaries, definitions, measured distributions, and limits.`,
    `- [Terminal-Bench 4 JSON](${absolute("/data/terminal-bench-4.json")}). Machine-readable owner snapshot for the current coding standard.`,
    `- [Terminal-Bench-Science 0.1 JSON](${absolute("/data/terminal-bench-science-0-1.json")}). Machine-readable owner snapshot for scientific workflows.`,
    `- [Current Artificial Analysis Intelligence JSON](${absolute("/data/artificial-analysis-intelligence-v4-3.json")}). Machine-readable v${intelligence.benchmark.version} model-configuration score, output-token, cost, and source records used by the homepage’s Pareto chart.`,
    `- [Historical Intelligence v4.1.1 JSON](${absolute("/data/artificial-analysis-intelligence.json")}). Frozen earlier cohort; not refreshed or comparable with the current index scale.`,
    `- [Artificial Analysis coding-agent JSON](${absolute(CODING_AGENT_DATASET_DOWNLOAD_PATH)}). Machine-readable copy of the separate coding-agent chart records.`,
    `- [Benchmark analysis](${absolute("/blog")}). Sourced notes on named evaluations.`,
    ...blogArticles.map(article => (
      `- [${article.title}](${absolute(blogArticlePath(article.slug))})`
    )),
    `- [XML sitemap](${absolute("/sitemap.xml")})`,
    `- [Robots](${absolute("/robots.txt")})`,
    "",
    "## How to read the site",
    "",
    "Request `Accept: text/markdown` on HTML page URLs. `/` Markdown describes the leading Pareto chart; `/coding` describes the coding-agent comparison; `/benchmarks` includes the default library chart and links to every benchmark; `/data` includes all benchmark definitions and source details. Query parameters select interactive views, while the canonical Markdown representation describes the default view. JSON routes stay `application/json`, including `/data/benchmark-atlas.json`, `/data/benchmark-atlas/{benchmarkId}`, and the versioned source downloads. Only charted IDs have a dataset download; unknown and source-only IDs return HTTP 404.",
    "",
    "Cite the benchmark owner, exact version, model-agent configuration, and retrieval timestamp when quoting a score. AI Charts publishes normalized snapshots; it does not create the measurements.",
  ]);
}

export function notFoundMarkdown(): string {
  return joinMarkdown([
    "# Page not found",
    "",
    "This path does not exist on AI Charts.",
    "",
    "## Where to look next",
    "",
    ...notFoundRecoveryLinks.map(link => `- [${link.label}](${absolute(link.href)})`),
  ]);
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname === "" ? "/" : pathname;
}

export function markdownForPath(pathname: string): MarkdownDocument {
  const path = normalizePathname(pathname);
  const snapshot = checkedSnapshot();

  if (path === AGENT_GUIDE_PATH) {
    return { body: agentGuideMarkdown(snapshot), contentType: AGENT_GUIDE_CONTENT_TYPE, found: true };
  }
  if (path === "/") {
    return { body: homeMarkdown(snapshot), contentType: MARKDOWN_CONTENT_TYPE, found: true };
  }
  if (path === "/coding") {
    return { body: codingMarkdown(snapshot), contentType: MARKDOWN_CONTENT_TYPE, found: true };
  }
  if (path === "/benchmarks") {
    return { body: benchmarksMarkdown(), contentType: MARKDOWN_CONTENT_TYPE, found: true };
  }
  if (path === CODING_AGENT_DATASET_PATH) {
    return { body: datasetMarkdown(snapshot), contentType: MARKDOWN_CONTENT_TYPE, found: true };
  }
  if (path === "/models") {
    return { body: modelCardsMarkdown(), contentType: MARKDOWN_CONTENT_TYPE, found: true };
  }
  if (path.startsWith("/models/")) {
    const segments = path.slice("/models/".length).split("/");
    if (segments.length === 3) {
      const [creatorSlug, modelSlug, profileSlug] = segments;
      const card = findModelCardPresentation({ creatorSlug, modelSlug, profileSlug });
      if (card !== undefined) {
        return { body: modelCardMarkdown(card), contentType: MARKDOWN_CONTENT_TYPE, found: true };
      }
    }
  }
  if (path === "/blog") {
    return { body: blogIndexMarkdown(), contentType: MARKDOWN_CONTENT_TYPE, found: true };
  }
  if (path.startsWith("/blog/")) {
    const slug = path.slice("/blog/".length);
    const article = blogArticles.find(candidate => candidate.slug === slug);
    if (article !== undefined) {
      return {
        body: articleToMarkdown(article, blogEditorialImage(article.slug)),
        contentType: MARKDOWN_CONTENT_TYPE,
        found: true,
      };
    }
  }

  return { body: notFoundMarkdown(), contentType: MARKDOWN_CONTENT_TYPE, found: false };
}
