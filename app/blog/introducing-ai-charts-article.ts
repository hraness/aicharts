import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import terminalBenchData from "@/data/terminal-bench.json";
import { ARTIFICIAL_ANALYSIS_INTELLIGENCE_VERSION } from "@/lib/artificial-analysis-intelligence-data";
import {
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "@/lib/artificial-analysis-intelligence-v4-3-data";
import { formatUpdateDate } from "@/lib/coding-agent-updates";
import {
  parseTerminalBenchSnapshot,
  type TerminalBenchSnapshot,
} from "@/lib/terminal-bench-data";

import {
  BLOG_SOURCE_NOTE,
  heading,
  paragraph,
  type BlogArticle,
} from "./articles";

export const INTRODUCING_AI_CHARTS_SLUG = "introducing-ai-charts" as const;
export const INTRODUCING_AI_CHARTS_PUBLISHED_AT = "2026-09-24" as const;

/**
 * Links to other notes carry the live title of the note they open, so a
 * retitled note fails the blog tests instead of leaving a stale anchor.
 */
export const INTRODUCING_AI_CHARTS_NOTE_LINKS = {
  aaIndexCost: {
    href: "/blog/aa-index-cost-coding-agents",
    text: "Highest AA Index and lowest cost pick different coding agents",
  },
  holdouts: {
    href: "/blog/coding-agent-score-holdouts",
    text: "Why a coding-agent high score still needs a holdout",
  },
  harnessTax: {
    href: "/blog/harnesstax-coding-agent-harness",
    text: "What HarnessTax’s same-model cost gap measures",
  },
  terminalBenchScience: {
    href: "/blog/terminal-bench-science",
    text: "What Terminal-Bench-Science’s 30% result measures",
  },
} as const;

function checkedIntelligenceSnapshot(): ArtificialAnalysisIntelligenceV43Snapshot {
  const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
  if (!parsed.ok) {
    throw new Error(`Checked Intelligence snapshot is invalid: ${parsed.error.message}`, {
      cause: parsed.error,
    });
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

/** "4.0.0" reads as "4.0", the way the benchmark owners name the release. */
function majorMinor(version: string): string {
  const [major, minor] = version.split(".");
  if (major === undefined || minor === undefined) {
    throw new RangeError(`Expected a dotted version, received ${version}.`);
  }
  return `${major}.${minor}`;
}

export function createIntroducingAiChartsArticle(
  intelligence: ArtificialAnalysisIntelligenceV43Snapshot = checkedIntelligenceSnapshot(),
  terminalBench: TerminalBenchSnapshot = checkedTerminalBenchSnapshot(),
): BlogArticle {
  const intelligenceVersion = intelligence.benchmark.version;
  const intelligenceRetrievedOn = formatUpdateDate(intelligence.source.retrievedAt);
  const terminalBenchVersion = majorMinor(terminalBench.benchmark.version);
  const links = INTRODUCING_AI_CHARTS_NOTE_LINKS;

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: INTRODUCING_AI_CHARTS_SLUG,
    title: "Introducing AI Charts",
    dek:
      "AI Charts plots published AI benchmark results, and each benchmark snapshot records its source, named version, and retrieval date.",
    focusPhrase: "AI Charts benchmark charts",
    seoDescription:
      "AI Charts plots published AI model and coding-agent benchmark results by score, cost, time, and tokens, with each snapshot's source, version, and date.",
    keywords: [
      "AI Charts",
      "AI benchmarks",
      "coding agents",
      "model comparison",
      "benchmark cost frontier",
    ],
    publishedAt: INTRODUCING_AI_CHARTS_PUBLISHED_AT,
    updatedAt: INTRODUCING_AI_CHARTS_PUBLISHED_AT,
    section: "About AI Charts",
    sourceIds: [
      "artificialAnalysisCodingAgents",
      "artificialAnalysisIntelligenceIndex",
      "terminalBenchRepository",
    ],
    relatedSlugs: [
      "aa-index-cost-coding-agents",
      "coding-agent-score-holdouts",
      "harnesstax-coding-agent-harness",
    ],
    showRelatedProducts: true,
    body: [
      paragraph(
        "AI Charts plots published benchmark results for AI models and coding agents, and each chart names the source and retrieval date behind its numbers.",
      ),
      heading("A score means little without its setup"),
      paragraph(
        "The same model can appear on a coding leaderboard several times with different results, because a coding-agent result belongs to a whole configuration: the model, the agent harness that runs it, and the effort setting. The benchmark has a version, the run has a cost, and the table was true on one date. A leaderboard screenshot usually drops most of that.",
      ),
      paragraph(
        "On the ",
        { href: "/coding", text: "coding-agent chart" },
        ", each point is one named configuration. Hover it to see its model, harness, and effort setting, its scores, and its cost, time, and total token use where the source reports them. The chart names its source and the date the snapshot was retrieved. In the benchmarks library, results also show the uncertainty interval the source reports, labeled with the source's own interval type. Each benchmark snapshot records its source, its named version, and when it was retrieved.",
      ),
      heading("Who it is for"),
      paragraph(
        "AI Charts is for someone choosing a model or coding agent who wants to weigh score against cost, time, or tokens. A typical question is which configurations score about as well as the leader for much less per task. On the chart, the answer is the cost frontier: a configuration stays on it only when nothing cheaper scores at least as well. The note ",
        links.aaIndexCost,
        " walks through that trade-off on one dated snapshot.",
      ),
      paragraph(
        "If you want one overall rank across every task, use something else. AI Charts builds no composite score of its own. Where a source publishes an index, such as Artificial Analysis's, AI Charts shows that index as the source defines it. Reasoning, research, memory, image, video, and audio results stay on their own scales. AI Charts also cannot tell you how a model will do on your own codebase. The note ",
        links.holdouts,
        " explains why a test set the model never saw is still worth building.",
      ),
      heading("What you can open today"),
      paragraph(
        `The homepage chart plots model configurations by Artificial Analysis Intelligence Index score against cost or output tokens per task. In the snapshot retrieved ${intelligenceRetrievedOn}, it uses Intelligence Index v${intelligenceVersion}, and the earlier v${ARTIFICIAL_ANALYSIS_INTELLIGENCE_VERSION} results stay a separate dataset. Scores are never relabeled from one version to another.`,
      ),
      paragraph(
        "The ",
        { href: "/coding", text: "coding chart" },
        ` plots results from the Artificial Analysis Coding Agent Index v1.5 and its three components, DeepSWE v1.1, Terminal-Bench 4, and SWE-Atlas-QnA, against cost, duration, or total token use. Pin a model to see the configurations that score near it, or pin a provider to see its range. The site's coding standard is the official, version-pinned Terminal-Bench ${terminalBenchVersion} snapshot from the benchmark's owners, which sits in the benchmarks library as its own cohort. Artificial Analysis runs Terminal-Bench 4 in its own harness, so its scores and the owners' results are kept apart.`,
      ),
      paragraph(
        "The ",
        { href: "/benchmarks", text: "benchmarks library" },
        " covers reasoning, research, memory, images, video, audio, and world models. It labels each entry as a charted result, a source guide, or an emerging evaluation. A source guide describes a benchmark whose scores AI Charts has not imported, and it shows no numbers.",
      ),
      paragraph(
        "The ",
        { href: "/data", text: "data page" },
        " lists, for every entry, the question it answers, the measure, the source, the exact version, the comparison rules, and the limits. Charted entries link a JSON download of the plotted data.",
      ),
      paragraph(
        "The ",
        { href: "/blog", text: "notes" },
        " each take one benchmark, study, or result and explain what it measures and where the evidence stops. ",
        links.harnessTax,
        " covers a study that ran the same models in different harnesses on two public suites. ",
        links.terminalBenchScience,
        " reads a science benchmark's top result against its cost and token use. Each note cites its primary sources and names the configuration and date behind the results it discusses.",
      ),
      heading("Where the catalog is going"),
      paragraph(
        "The aim is a catalog where any published benchmark result a person might use to pick a model can be read with its configuration, version, cost, and date. Benchmarks that have only a source guide today are meant to become charts once their data can be checked the same way. New notes will follow the questions readers bring to the charts, one benchmark or result at a time, and each benchmark will keep its own scale.",
      ),
      heading("Limits and status"),
      paragraph(
        `AI Charts does not run evaluations. The scores, costs, and token counts come from the benchmark owners and aggregators it cites, and it is not affiliated with them or with the model providers in the data. Cost figures keep the source's denominator, such as per task or per full evaluation, so two costs are comparable only when that denominator matches. The charts show dated snapshots: the Intelligence Index snapshot is checked for updates every four hours and the coding-agent snapshot daily, and the earlier v${ARTIFICIAL_ANALYSIS_INTELLIGENCE_VERSION} data is frozen. Some vendor-run results, such as CursorBench, appear as supplemental evidence for a model running inside that vendor's product, not as an independent standard.`,
      ),
      paragraph(
        "The benchmark charts and notes are live at aicharts.io. AI Charts also includes a local tool that measures your own coding agents' token use. Its status is In development: build it from source, since there is no packaged release yet.",
      ),
    ],
  };
}
