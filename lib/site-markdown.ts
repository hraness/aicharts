import {
  articleToMarkdown,
  blogArticlePath,
  blogArticles,
  blogDescription,
} from "@/app/blog/articles";
import { homeHeading, notFoundRecoveryLinks, site } from "@/app/site";
import codingAgentData from "@/data/coding-agents.json";
import gptSubsidyData from "@/data/gpt-subsidy.json";

import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "./coding-agent-data";
import {
  CODING_AGENT_BENCHMARK_DEFINITIONS,
  CODING_AGENT_DATASET_DESCRIPTION,
  CODING_AGENT_DATASET_DOWNLOAD_PATH,
  CODING_AGENT_DATASET_PATH,
  codingAgentDatasetModifiedAt,
  codingAgentDatasetSummary,
  codingAgentLeadersMarkdownTable,
  currentCodingAgentBenchmarkLeaders,
  currentCodingAgentLeadersHeading,
  homeLeadersParagraphs,
} from "./coding-agent-dataset";
import {
  FULL_SNAPSHOT_COLUMNS,
  codingAgentSnapshotRows,
  snapshotRowsMarkdownTable,
} from "./coding-agent-snapshot-rows";
import { formatRetrievedAt } from "./coding-agent-updates";
import {
  GPT_SUBSIDY_DESCRIPTION,
  formatSubsidyDate,
  formatSubsidyMultiple,
  formatSubsidyTokens,
  formatSubsidyUsd,
  latestGptSubsidyObservation,
  parseGptSubsidySnapshot,
  type GptSubsidySnapshot,
} from "./gpt-subsidy-data";

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

function checkedGptSubsidySnapshot(): GptSubsidySnapshot {
  const parsed = parseGptSubsidySnapshot(gptSubsidyData);
  if (!parsed.ok) {
    throw new Error(`Checked GPT subsidy snapshot is invalid: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return parsed.value;
}

function absolute(path: string): string {
  return new URL(path, site.origin).toString();
}

function joinMarkdown(lines: readonly string[]): string {
  return `${lines.join("\n").trim()}\n`;
}

export function homeDocumentModel(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): HomeDocumentModel {
  const summary = codingAgentDatasetSummary(snapshot);
  const modifiedAt = codingAgentDatasetModifiedAt(snapshot);
  const benchmarks = CODING_AGENT_BENCHMARK_DEFINITIONS
    .map(definition => definition.label)
    .join(", ");
  return {
    heading: homeHeading,
    paragraphs: [
      site.description,
      `The current chart is a coding-agent comparison. It is the first published chart in AI Charts, not a claim that every AI model or agent domain is covered yet.`,
      `The checked snapshot contains ${summary.recordCount} model-agent configurations across ${summary.modelCount} models, ${summary.agentCount} agent harnesses, and ${summary.providerCount} providers. AI Charts retrieved it from the ${snapshot.source.name} coding-agents comparison on ${formatRetrievedAt(snapshot.source.retrievedAt)}. The latest notable model, variant, or benchmark change in the retained history was detected on ${formatRetrievedAt(modifiedAt)}.`,
      `The chart plots ${benchmarks} against API cost, active time, or total token use. Scores stay on the 0–100 scale stored in the snapshot. Cost stays in US dollars, time stays in seconds in the dataset and minutes on the chart, and token use stays as a token count.`,
      `Pin a model to see nearby scores, or pin a provider to inspect its range. The option-space panels show the cost/performance frontier and per-provider ranges for the selected axes. Values are observations of the named model, agent harness, and effort setting. They are not general ranks or production guarantees.`,
      `AI Charts is an independent visualization. It does not recalculate upstream benchmark outcomes and is not affiliated with Artificial Analysis or the listed providers.`,
    ],
    links: [
      {
        href: "/gpt-subsidy",
        label: "ChatGPT Pro API-equivalent value",
        note: "Historical estimates from measured Codex token usage, the checked August 25, 2026 API price basis, and the $200 monthly subscription price.",
      },
      {
        href: CODING_AGENT_DATASET_PATH,
        label: "Coding-agent benchmark dataset",
        note: "Provenance, benchmark definitions, the full configuration table, leaders, method, and limits for the checked snapshot.",
      },
      {
        href: blogArticlePath("aa-index-cost-coding-agents"),
        label: "AA Index versus cost",
        note: "Leaders, the cost/performance frontier, and limits from the same checked snapshot.",
      },
      {
        href: CODING_AGENT_DATASET_DOWNLOAD_PATH,
        label: "JSON snapshot",
        note: "The same versioned records the production chart uses.",
      },
      {
        href: "/blog",
        label: "Benchmark analysis",
        note: blogDescription,
      },
      {
        href: AGENT_GUIDE_PATH,
        label: "Machine-readable site guide",
        note: "When to use AI Charts, the public pages, and how to request Markdown.",
      },
      {
        href: "/sitemap.xml",
        label: "XML sitemap",
        note: "Every public canonical route.",
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

function homeMarkdown(snapshot: CodingAgentSnapshot): string {
  const document = homeDocumentModel(snapshot);
  const leaders = currentCodingAgentBenchmarkLeaders(snapshot);
  return joinMarkdown([
    `# ${document.heading}`,
    "",
    `## ${currentCodingAgentLeadersHeading(snapshot.source.retrievedAt)}`,
    "",
    ...homeLeadersParagraphs(snapshot).flatMap(paragraph => [paragraph, ""]),
    codingAgentLeadersMarkdownTable(leaders),
    "",
    ...document.paragraphs.flatMap(paragraph => [paragraph, ""]),
    "## Pages",
    "",
    ...document.links.map(link => `- [${link.label}](${absolute(link.href)}). ${link.note}`),
  ]);
}

function datasetMarkdown(snapshot: CodingAgentSnapshot): string {
  const summary = codingAgentDatasetSummary(snapshot);
  const modifiedAt = codingAgentDatasetModifiedAt(snapshot);
  const leaders = currentCodingAgentBenchmarkLeaders(snapshot);
  return joinMarkdown([
    "# Coding-agent benchmark dataset",
    "",
    CODING_AGENT_DATASET_DESCRIPTION,
    "",
    `Last retrieved ${formatRetrievedAt(snapshot.source.retrievedAt)}. Latest notable update ${formatRetrievedAt(modifiedAt)}. ${summary.recordCount} configurations, ${summary.providerCount} providers.`,
    "",
    "## Source and refresh",
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
    "- Artificial Analysis defines and operates the upstream evaluations. AI Charts is an independent visualization and is not affiliated with Artificial Analysis or the listed providers.",
    "- Scores depend on the named model, agent harness, effort setting, task set, and evaluation version. They do not establish results for every software repository or production workflow.",
    "- Cost, duration, and token values are task-level means from the source evaluation. They are not price or latency guarantees.",
    "- This is a daily checked snapshot, not a real-time mirror. Use the retrieval timestamp when citing a value.",
    "",
    "## Dataset links",
    "",
    `- [Download the current JSON snapshot](${absolute(CODING_AGENT_DATASET_DOWNLOAD_PATH)})`,
    `- [Artificial Analysis coding-agents source](${snapshot.source.url})`,
    `- [Comparison chart](${absolute("/")})`,
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
      article.dek,
      "",
    ]),
    "## Method",
    "",
    "Each note starts with the benchmark paper or maintained source page. Material claims link to those primary sources. Leaderboard values are paired with their observation date and named configuration. Methodology limits stay near the results they qualify.",
    "",
    `[Explore the coding-agent chart](${absolute("/")})`,
  ]);
}

export function gptSubsidyMarkdown(
  snapshot: GptSubsidySnapshot = checkedGptSubsidySnapshot(),
): string {
  const latest = latestGptSubsidyObservation(snapshot);
  const rows = snapshot.observations.map(observation => [
    formatSubsidyDate(observation.observedAt),
    `${formatSubsidyDate(observation.periodStartedAt)}–${formatSubsidyDate(observation.periodEndsAt)}`,
    formatSubsidyTokens(observation.tokens.total),
    formatSubsidyUsd(observation.monthlyApiEquivalentUsd),
    formatSubsidyMultiple(observation.planPriceMultiple),
  ]);
  const table = [
    "| Observed | Period | Tokens | Monthly API-value pace | Multiple |",
    "| --- | --- | ---: | ---: | ---: |",
    ...rows.map(row => `| ${row.join(" | ")} |`),
  ].join("\n");

  return joinMarkdown([
    `# ${snapshot.title}`,
    "",
    GPT_SUBSIDY_DESCRIPTION,
    "",
    `The latest monthly plan-price multiple is ${formatSubsidyMultiple(latest.planPriceMultiple)}, derived from seven settled UTC days. That equals ${formatSubsidyUsd(latest.monthlyApiEquivalentUsd)} in monthly API-retail-equivalent usage divided by one ${formatSubsidyUsd(snapshot.plan.monthlyPriceUsd)} plan-price unit.`,
    "",
    `Across the measured ${snapshot.periodSummary.days}-day period, local Codex usage has an estimated API value of ${formatSubsidyUsd(snapshot.periodSummary.apiEquivalentUsd)}, or ${formatSubsidyMultiple(snapshot.periodSummary.planPriceMultiple)} of one $200 plan-price unit.`,
    "",
    "This is one user's available local Codex logs on one machine. It is not a platform-wide or representative ChatGPT Pro estimate. The logs do not retain a durable account ID or billing mode and cannot distinguish plan allowance from API-key or otherwise API-billed usage, purchased ChatGPT credits, free or reset credits, or temporary promotions. Historical account switches and usage across multiple subscriptions cannot be excluded.",
    "",
    "## History",
    "",
    table,
    "",
    "No per-refill projection is published because active-account quota telemetry cannot be joined reliably to historical session usage across authentication, subscription, or credit-source changes.",
    "",
    "## Calculation",
    "",
    snapshot.methodology.formula,
    "",
    "The collector reads all canonical local Codex task logs, including child agents. The pinned Tokscale 4.13.0 parser globally deduplicates replayed token events. Model-specific API-price estimates come from the checked AI Charts OpenAI rate manifest, not Tokscale's pricing catalog.",
    "",
    "The scheduled collector task's own small Codex token usage is included in the next settled bucket.",
    "",
    snapshot.methodology.disclaimer,
    "",
    `The checked snapshot was generated ${snapshot.generatedAt}. The rate manifest was frozen ${snapshot.pricing.manifest.frozenAt} with SHA-256 ${snapshot.pricing.manifest.sha256}. The measurement implementation is pinned by revision ${snapshot.methodology.measurement.revision} and manifest SHA-256 ${snapshot.methodology.measurement.sha256}. GPT-5.6 Sol is retained only as a reference price, not as the rate applied to every historical model call.`,
    "",
    "## Sources",
    "",
    ...Array.from(new Set([
      snapshot.plan.sourceUrl,
      snapshot.pricing.manifest.sourceUrl,
      snapshot.pricing.referenceModel.sourceUrl,
      ...snapshot.methodology.sourceUrls,
    ])).map(url => `- [${new URL(url).hostname}](${url})`),
  ]);
}

export function agentGuideMarkdown(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): string {
  const summary = codingAgentDatasetSummary(snapshot);
  return joinMarkdown([
    `# ${site.name}`,
    "",
    `${site.description} The current published chart is a coding-agent comparison built from a checked ${snapshot.source.name} snapshot.`,
    "",
    "## When to use AI Charts",
    "",
    "Use AI Charts when you need a sourced comparison of coding agents across benchmark score, API cost, active time, and total token use. Use it to read the current checked snapshot, cite a retrieval time, or explain what AA Index, DeepSWE, Terminal-Bench 2.0, or SWE-Atlas-QnA measures in this dataset.",
    "",
    "Use the `/data` page or the JSON download when you need the same records the chart uses, including provenance, leaders, normalization, and limits. Use `/blog` when you need a sourced note on a named benchmark rather than the interactive chart.",
    "",
    `Do not treat AI Charts as a live API, ranker, or production SLA. It does not expose OAuth, GraphQL, MCP, or commerce endpoints. It does not recalculate upstream scores. The current snapshot covers ${summary.recordCount} coding-agent configurations, not every AI model or agent domain.`,
    "",
    "## Main pages",
    "",
    `- [Comparison chart](${absolute("/")}). Current coding-agent scatter chart.`,
    `- [ChatGPT Pro API-equivalent value](${absolute("/gpt-subsidy")}). Historical estimates from measured Codex usage and the checked August 25, 2026 API price basis.`,
    `- [Dataset and methodology](${absolute(CODING_AGENT_DATASET_PATH)}). Provenance, definitions, leaders, method, and limits.`,
    `- [JSON snapshot](${absolute(CODING_AGENT_DATASET_DOWNLOAD_PATH)}). Machine-readable copy of the checked records.`,
    `- [Benchmark analysis](${absolute("/blog")}). Sourced notes on named evaluations.`,
    ...blogArticles.map(article => (
      `- [${article.title}](${absolute(blogArticlePath(article.slug))})`
    )),
    `- [XML sitemap](${absolute("/sitemap.xml")})`,
    `- [Robots](${absolute("/robots.txt")})`,
    "",
    "## How to read the site",
    "",
    "Request `Accept: text/markdown` on the HTML page URLs to receive the same content as Markdown. The JSON snapshot at `/data/coding-agents.json` stays `application/json`. Missing paths return HTTP 404 with recovery links to the chart, dataset, sitemap, and this guide.",
    "",
    "Cite the retrieval timestamp on the dataset page when quoting a score. AI Charts is the publisher of the normalized snapshot, not the creator of the Artificial Analysis measurements.",
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
  if (path === CODING_AGENT_DATASET_PATH) {
    return { body: datasetMarkdown(snapshot), contentType: MARKDOWN_CONTENT_TYPE, found: true };
  }
  if (path === "/gpt-subsidy") {
    return { body: gptSubsidyMarkdown(), contentType: MARKDOWN_CONTENT_TYPE, found: true };
  }
  if (path === "/blog") {
    return { body: blogIndexMarkdown(), contentType: MARKDOWN_CONTENT_TYPE, found: true };
  }
  if (path.startsWith("/blog/")) {
    const slug = path.slice("/blog/".length);
    const article = blogArticles.find(candidate => candidate.slug === slug);
    if (article !== undefined) {
      return { body: articleToMarkdown(article), contentType: MARKDOWN_CONTENT_TYPE, found: true };
    }
  }

  return { body: notFoundMarkdown(), contentType: MARKDOWN_CONTENT_TYPE, found: false };
}
