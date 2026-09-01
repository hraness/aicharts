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
  GPT_SUBSIDY_DESCRIPTION,
  formatSubsidyDate,
  formatSubsidyTokens,
  formatSubsidyUsd,
  latestGptSubsidyObservation,
  parseGptSubsidySnapshot,
  type GptSubsidySnapshot,
} from "./gpt-subsidy-data";
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
  MODEL_RELEASE_RADAR_HIGHLIGHTS,
  MODEL_RELEASES_AWAITING_BENCHMARK,
  MODEL_RELEASES_WITH_EARLY_DEEP_SWE,
} from "./model-release-collection";

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
        href: "/models",
        label: "Model benchmark cards",
        note: "Shareable model-and-profile cards with observed benchmark, cost, time, and total-token ranges from the current snapshot.",
      },
      {
        href: "/gpt-subsidy",
        label: "ChatGPT Pro API-equivalent value",
        note: "Historical measured values from Codex token usage and the checked August 25, 2026 API price basis. Subscription-adjusted history is unavailable.",
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
        href: blogArticlePath("open-models-coding-agent-benchmarks"),
        label: "Open models on coding-agent benchmarks",
        note: "Whether classified open-weight rows sit with the current AA Index leaders, using the same checked snapshot and a SemiAnalysis catch-up essay.",
      },
      {
        href: blogArticlePath("are-open-models-catching-up"),
        label: "Open models can close a scoreboard and still lose the product",
        note: "SemiAnalysis’s era-composite catch-up versus their productized-stack preference, kept distinct from the named-row snapshot.",
      },
      {
        href: blogArticlePath("benchmarkpocalypse"),
        label: "The benchmarkpocalypse is not a product win",
        note: "Dan Luu’s public-suite argument and scoreboard saturation: a cheap or clustered win is remaining measurement work, not a shipping decision.",
      },
      {
        href: blogArticlePath("terminal-bench-science"),
        label: "Terminal-Bench-Science: 30% is not a product win",
        note: "Scientists set the evaluation bar on Terminal-Bench-Science 0.1. The peak 30% resolution is remaining work; cost and token Pareto is the useful comparison.",
      },
      {
        href: blogArticlePath("small-models-have-arrived"),
        label: "Cheaper AI models can make everyday products viable",
        note: "How lower inference costs change frequent-use product economics and how to test the cheapest model that meets a task’s quality bar.",
      },
      {
        href: blogArticlePath("coding-agent-score-holdouts"),
        label: "Why a coding-agent high score still needs a holdout",
        note: "Dan Luu’s FRE holdout and the checked snapshot’s named-suite scores, kept distinct from the open-models comparison.",
      },
      {
        href: blogArticlePath("coding-agent-scores-still-need-expertise"),
        label: "Coding-agent scores still need expertise",
        note: "Lars Faye and Sean Goedecke on why a named-suite score still needs a person who can specify and audit the work.",
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
    `For AA Index versus mean API cost see [AA Index versus cost for coding agents](${absolute(blogArticlePath("aa-index-cost-coding-agents"))}). For whether classified open-weight rows sit with those leaders see [open models on coding-agent benchmarks](${absolute(blogArticlePath("open-models-coding-agent-benchmarks"))}). For why a closing benchmark gap does not settle product choice see [open models can close a scoreboard and still lose the product](${absolute(blogArticlePath("are-open-models-catching-up"))}). For how lower inference costs change frequent-use product economics see [cheaper AI models can make everyday products viable](${absolute(blogArticlePath("small-models-have-arrived"))}). For why a 30% Terminal-Bench-Science score is not a product win see [Terminal-Bench-Science: 30% is not a product win](${absolute(blogArticlePath("terminal-bench-science"))}). For why scoreboard saturation is not a product win see [the benchmarkpocalypse is not a product win](${absolute(blogArticlePath("benchmarkpocalypse"))}). For why a public-suite high score still needs a holdout see [why a coding-agent high score still needs a holdout](${absolute(blogArticlePath("coding-agent-score-holdouts"))}). For why that number still needs a person who can specify and audit the work see [coding-agent scores still need expertise](${absolute(blogArticlePath("coding-agent-scores-still-need-expertise"))}).`,
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

function modelCardsMarkdown(): string {
  return joinMarkdown([
    "# Model cards",
    "",
    `${MODEL_CARD_PRESENTATIONS.length} model-and-profile benchmark cards from the current Artificial Analysis coding-agents snapshot. Cataloged cards use canonical model-and-profile routes. Newly observed identities or profile settings receive deterministic provisional routes so a data refresh can publish without manual intervention. Cards show observed ranges when multiple agent harnesses evaluated the same configuration.`,
    "",
    `[Source snapshot](${MODEL_CARD_SNAPSHOT.source.url}), retrieved ${formatRetrievedAt(MODEL_CARD_SNAPSHOT.source.retrievedAt)}.`,
    "",
    "## Release radar",
    "",
    `${MODEL_RELEASES_AWAITING_BENCHMARK.length} recent releases from established providers are awaiting a complete four-benchmark Artificial Analysis index; ${MODEL_RELEASES_WITH_EARLY_DEEP_SWE.length} already have direct DeepSWE evidence. Discovery is not a score. OpenRouter is the first-line model-identity catalog, with Artificial Analysis used only when a model is unresolved. A labeled early [DeepSWE v${DIRECT_DEEP_SWE_EVIDENCE.source.benchmarkVersion}](${DEEP_SWE_LEADERBOARD_URL}) pass@1 result, when present, comes directly from DataCurve's mini-swe-agent leaderboard and remains outside the Artificial Analysis chart and cards. Partial Artificial Analysis observations can appear there with missing metrics shown explicitly.`,
    "",
    ...MODEL_RELEASE_RADAR_HIGHLIGHTS.map(release => {
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

export function gptSubsidyMarkdown(
  snapshot: GptSubsidySnapshot = checkedGptSubsidySnapshot(),
): string {
  const latest = latestGptSubsidyObservation(snapshot);
  const rows = snapshot.observations.map(observation => [
    formatSubsidyDate(observation.observedAt),
    `${formatSubsidyDate(observation.periodStartedAt)}–${formatSubsidyDate(observation.periodEndsAt)}`,
    formatSubsidyTokens(observation.tokens.total),
    formatSubsidyUsd(observation.trailingSevenDayApiEquivalentUsd),
  ]);
  const table = [
    "| Observed | Period | Tokens | Trailing 7-day API value |",
    "| --- | --- | ---: | ---: |",
    ...rows.map(row => `| ${row.join(" | ")} |`),
  ].join("\n");

  return joinMarkdown([
    `# ${snapshot.title}`,
    "",
    GPT_SUBSIDY_DESCRIPTION,
    "",
    `The latest measured trailing-seven-day API-retail-equivalent value is ${formatSubsidyUsd(latest.trailingSevenDayApiEquivalentUsd)}. It covers seven complete UTC days and is not projected into a monthly value.`,
    "",
    `Across the measured trailing ${snapshot.periodSummary.days}-day period, local Codex usage has an API-retail-equivalent value of ${formatSubsidyUsd(snapshot.periodSummary.apiEquivalentUsd)}.`,
    "",
    "This is one user's available local Codex logs on one machine. It is not a platform-wide or representative ChatGPT Pro estimate. Historical logs span account switches without durable account attribution. The subscription-adjusted multiple is therefore unavailable rather than calculated against one $200 subscription. API-key or otherwise API-billed usage, purchased ChatGPT credits, free or reset credits, and temporary promotions cannot be separated.",
    "",
    "## History",
    "",
    table,
    "",
    "No monthly projection, one-plan normalization, quota-exhaustion estimate, or per-refill projection is published for this historical period. Current allowance state cannot be joined reliably to historical session usage across authentication, subscription, or credit-source changes.",
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
    "Use AI Charts when you need a sourced comparison of coding agents across benchmark score, API cost, active time, and total token use. Use it to read the current checked snapshot, cite a retrieval time, or explain what AA Index, DeepSWE, Terminal-Bench v2.1, or SWE-Atlas-QnA measures in this dataset.",
    "",
    "Use the `/data` page or the JSON download when you need the same records the chart uses, including provenance, leaders, normalization, and limits. Use `/models` for canonical cataloged model-and-profile card routes, deterministic provisional routes for newly observed identities, and shareable images. Use `/blog` when you need a sourced note on a named benchmark rather than the interactive chart.",
    "",
    `Do not treat AI Charts as a live API, ranker, or production SLA. It does not expose OAuth, GraphQL, MCP, or commerce endpoints. It does not recalculate upstream scores. The current snapshot covers ${summary.recordCount} coding-agent configurations, not every AI model or agent domain.`,
    "",
    "## Main pages",
    "",
    `- [Comparison chart](${absolute("/")}). Current coding-agent scatter chart.`,
    `- [Model benchmark cards](${absolute("/models")}). Shareable cards for each model and benchmark profile, with canonical routes for cataloged identities.`,
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
      return { body: articleToMarkdown(article), contentType: MARKDOWN_CONTENT_TYPE, found: true };
    }
  }

  return { body: notFoundMarkdown(), contentType: MARKDOWN_CONTENT_TYPE, found: false };
}
