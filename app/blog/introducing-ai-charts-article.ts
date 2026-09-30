import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import terminalBenchData from "@/data/terminal-bench.json";
import { ARTIFICIAL_ANALYSIS_INTELLIGENCE_VERSION } from "@/lib/artificial-analysis-intelligence-data";
import {
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "@/lib/artificial-analysis-intelligence-v4-3-data";
import {
  parseTerminalBenchSnapshot,
  type TerminalBenchSnapshot,
} from "@/lib/terminal-bench-data";

import { launchBeats } from "@/app/launch/beats";
import { LAUNCH_STATUS } from "@/app/launch/facts";
import { site } from "@/app/site";
import type { ArticleVideoRecord } from "@hraness/design-kit";

import {
  BLOG_SOURCE_NOTE,
  heading,
  list,
  paragraph,
  type BlogArticle,
} from "./articles";

/**
 * The launch film, rendered from video/ with Slopcamera and delivered to
 * public/media. It feeds the page's VideoObject too.
 */
export const INTRODUCING_AI_CHARTS_FILM = {
  name: "Introducing aicharts",
  description:
    "A 42-second film with captions and no narration. After the title card it pans an illustrated aicharts page: the score and cost chart with the line through the models nothing cheaper beats, the coding-agent chart with one setup's cost, time and tokens, and the usage dashboard beside the collector commands, ending on what stays on your machine, the snapshot counts and what aicharts does not do.",
  sources: [
    { src: "/media/aicharts-launch.webm", type: "video/webm" },
    { src: "/media/aicharts-launch.mp4", type: "video/mp4" },
  ],
  poster: "/media/aicharts-launch-poster.jpg",
  captions: "/media/aicharts-launch.vtt",
  width: 1920,
  height: 1080,
  duration: "PT42.5S",
  uploadDate: "2026-09-29",
} as const satisfies ArticleVideoRecord;

export const INTRODUCING_AI_CHARTS_SLUG = "introducing-ai-charts" as const;
export const INTRODUCING_AI_CHARTS_PUBLISHED_AT = "2026-09-24" as const;
/** Rewritten as launch beats with illustrations; collector status after the cli-v0.2.0 release. */
export const INTRODUCING_AI_CHARTS_UPDATED_AT = "2026-09-29" as const;

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
  const terminalBenchVersion = majorMinor(terminalBench.benchmark.version);
  const links = INTRODUCING_AI_CHARTS_NOTE_LINKS;

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: INTRODUCING_AI_CHARTS_SLUG,
    title: "Introducing aicharts",
    dek: site.description,
    focusPhrase: "aicharts benchmark charts",
    seoDescription:
      "aicharts plots published AI model and coding-agent benchmark results by score, cost, time, and tokens, with each snapshot's source, version, and date.",
    keywords: [
      "aicharts",
      "AI benchmarks",
      "coding agents",
      "model comparison",
      "benchmark cost frontier",
    ],
    publishedAt: INTRODUCING_AI_CHARTS_PUBLISHED_AT,
    updatedAt: INTRODUCING_AI_CHARTS_UPDATED_AT,
    section: "About aicharts",
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
        `Status: the benchmark charts and notes are free and live at aicharts.io. The usage collector is ${LAUNCH_STATUS.toLowerCase()}.`,
      ),
      {
        caption: "The launch film: illustrations of aicharts's charts and usage dashboard, with captions.",
        type: "video",
        video: INTRODUCING_AI_CHARTS_FILM,
      },
      { beats: launchBeats, type: "launch-beats" },
      heading("Go deeper"),
      list(
        [links.aaIndexCost, ": the cost frontier worked through on one dated coding-agent snapshot."],
        [links.holdouts, ": why a public score cannot tell you how a model does on your code."],
        [links.harnessTax, ": the same models in different agent apps, and the cost gap between them."],
        [links.terminalBenchScience, ": one science benchmark's top result read against its cost and tokens."],
        [{ href: "/data", text: "The data page" }, `: every entry's source, version and limits. The homepage uses Intelligence Index v${intelligenceVersion}; the earlier v${ARTIFICIAL_ANALYSIS_INTELLIGENCE_VERSION} results stay a separate dataset, and the owners' Terminal-Bench ${terminalBenchVersion} results stay apart from Artificial Analysis's own runs.`],
      ),
    ],
  };
}
