import type { BlogSourceId } from "./articles";
import { HAIKU_55_ARTICLE_SLUG } from "./haiku-5-5-intelligence-index-article";

/**
 * Admission record for the Claude Haiku 5.5 Intelligence Index note. Drafted
 * by an AI agent from the checked snapshots and the cited Anthropic and
 * Artificial Analysis pages; reviewed by an AI reviewer independent of the
 * drafting run.
 */
export const HAIKU_55_ARTICLE_ADMISSION_DRAFT = {
  canonicalOwner: `/blog/${HAIKU_55_ARTICLE_SLUG}`,
  decision: "keep" as const,
  drafting: "ai" as const,
  evidenceOwner: "AI Charts editorial",
  evidenceType: "checked-dataset-analysis" as const,
  harmIfWrong:
    "The 43.4 Intelligence Index score of Claude Haiku 5.5 (Max) could be quoted as a coding-agent result when the coding-agent chart stores no Haiku row, the $0.213 cost per Index task could be compared with a harness cost per task or with Anthropic’s list prices, the model could be called the cheapest frontier point when MiMo-V2.6-Pro scores higher for less, the launch-week rank and frontier vertex could be repeated after new rows entered the chart, the five effort rows could be read as one setting, or Anthropic’s vendor-run table and 75% saving against Haiku 4.5 could be cited as chart measurements.",
  hostFit:
    "AI Charts stores every Claude Haiku 5.5 effort level, every Claude Sonnet 5.5 and Claude Opus 5.5 effort level, and every GPT-6 Luna row in the checked Intelligence Index snapshot, and the absence of a Haiku row in the checked coding-agent snapshot, so it can derive the rank, the frontier vertices, the effort ladder, the cost components, the Anthropic-only frontier, and the Sonnet and Opus rows the Haiku rows beat from the same data the charts plot without adding a data surface.",
  humanReviewedOn: null,
  lifecycleState: "indexable" as const,
  nearestUrls: [
    {
      distinction:
        "The Opus 5.5 page places the chart’s leading configuration and walks the whole cost frontier down from the top; this page places a row 32nd of 108 that one cheaper row keeps off the frontier, asks what each of five effort steps buys, and draws a second frontier through Anthropic rows alone.",
      url: "/blog/opus-5-5-intelligence-index" as const,
    },
    {
      distinction:
        "The Sonnet 5.5 page places Claude Code · Sonnet 5.5 on the coding-agent chart and tabulates five Claude Code settings; this page never scores a harness, and uses the Sonnet 5.5 Intelligence Index rows only as the family rows Haiku is priced against.",
      url: "/blog/sonnet-5-5-coding-agent-index" as const,
    },
    {
      distinction:
        "The MiMo page places the open-weights model that dominates the Haiku max row and tests an investor’s claims; this page names MiMo-V2.6-Pro once, as the one row that keeps Haiku off the frontier, and spends its length on the Haiku effort ladder and Anthropic’s own range.",
      url: "/blog/mimo-v2-6-pro-cost-frontier" as const,
    },
    {
      distinction:
        "The small-models essay argues from a dated snapshot that cheap models had reached useful scores across the chart; this page places one small model released after that essay, with its effort rows, cost components, and the larger models of the same family.",
      url: "/blog/small-models-have-arrived" as const,
    },
  ],
  nonObviousAnswer:
    "The Haiku max row is not on the cost frontier because one row, MiMo-V2.6-Pro, scores 2.9 points higher for 0.6x the cost, but the xhigh row one step down is a frontier vertex; the five Haiku steps each multiply cost per task by 1.6x to 1.9x and buy +2.1 to +5.0 points; and within Anthropic’s own range the Haiku rows beat Opus 5.5 (Low), Sonnet 5.5 (Medium), and Sonnet 5.5 (Low) on both axes, so every Anthropic-only frontier vertex below Sonnet 5.5 (High) is a Haiku effort level.",
  observations: [
    "In the Intelligence Index snapshot retrieved 2026-10-10, Claude Haiku 5.5 (Max) scores 43.4 for $0.213 per task, 32nd of 108 configurations with a positive cost; 37 cost less. MiMo-V2.6-Pro at 46.3 for $0.133 is the only configuration that scores at least as high at the same or lower cost, so the max row is off the frontier while Claude Haiku 5.5 (Xhigh) at 41.3 for $0.124 is a vertex between GPT-6.1 Sol (Low) and GPT-6 Luna (Max).",
    "The five effort rows run from 29.5 for $0.025 at low to 43.4 for $0.213 at max: 13.9 points for 8.7x the cost, with the largest step from low to medium at +5.0 points for 1.9x and the smallest from xhigh to max at +2.1 points for 1.7x. Reasoning tokens are 80% of output tokens at max; cache reads are $0.095 of the $0.213.",
    "The snapshot stores 20 Anthropic rows with a measured cost, five each for Claude Haiku 5.5, Claude Sonnet 5.5, Claude Opus 5.5, and Claude Fable 5.1. Claude Opus 5.5 (Low) at 42.3 for $0.551, Claude Sonnet 5.5 (Medium) at 40.8 for $0.483, and Claude Sonnet 5.5 (Low) at 35.9 for $0.345 are each beaten on both axes by a Haiku row; the Anthropic-only frontier runs Opus max, Sonnet max, Opus xhigh, Opus high, Opus medium, Sonnet high, then the five Haiku rows.",
    "The coding-agent snapshot retrieved 2026-10-05 stores no row that runs Claude Haiku 5.5 in any harness; its Anthropic rows are Claude Code with Claude Fable 5.1, Claude Opus 5, Claude Opus 5.5, and Claude Sonnet 5.5. Anthropic’s page prices the model at $0.10 and $0.50 per million tokens for prompts up to 100,000 tokens and claims a 75% average saving against Haiku 4.5, which the snapshot stores no row for.",
  ],
  originalContribution:
    "A snapshot-derived statement of Claude Haiku 5.5 (Max)’s Intelligence Index rank, the one row that keeps it off the cost frontier, the count of cheaper rows, its one-point neighbors, and the five highest-scoring configurations after it; a count of which Haiku effort rows are frontier vertices with the vertex above and below each; a five-level effort ladder stating the points and cost multiple each step buys with the reasoning share of output tokens; a split of each level’s cost per task into cache reads, cache writes, non-cached input, reasoning, and answer tokens; a table pricing every Sonnet 5.5 and Opus 5.5 row against the Haiku max row with a frontier drawn through Anthropic rows alone; a placement of GPT-6 Luna’s rows against Haiku; and an explicit statement that the coding-agent chart stores no Haiku row.",
  overlapDecision:
    "Keep separately: the Opus 5.5 Index page shares the effort-ladder and cost-component tables as structure but places the chart’s leader and walks the frontier from the top, while this page places a row off the frontier and adds the Anthropic-only frontier and the family table; the MiMo page shares one row, named here only as the dominator; the Sonnet 5.5 page scores a harness this page never scores; the small-models essay argues a chart-wide trend without an effort ladder. Fewer than a third of the headings or claims overlap any of them.",
  primaryEvidence:
    "The checked Intelligence Index snapshot supplies every Intelligence Index score, cost per task and its components, output token count, effort level, creator, and release date for each Claude Haiku 5.5 row and the cohort around it, including the Sonnet 5.5, Opus 5.5, Fable 5.1, MiMo-V2.6-Pro, GPT-6.1 Sol, and GPT-6 Luna rows; the checked coding-agent snapshot supplies the Anthropic rows and the absence of a Haiku row; Anthropic’s announcement supplies the release date, the two price tiers, the cache prices, the Haiku 4.5 prices, the 75% claim and its footnote, the effort-setting sentence, the larger-models sentence, the prompt-share claim, the Cognition quotation, the model ID, and the vendor-run table; Artificial Analysis’s model page supplies the rounded score, class rank, prices, cache discount, index cost and token total, output speed, context window, release date, and summary sentences.",
  primarySourceIds: [
    "artificialAnalysisIntelligenceIndex",
    "artificialAnalysisClaudeHaiku55Model",
    "anthropicClaudeHaiku55",
    "artificialAnalysisCodingAgents",
  ] as const satisfies readonly BlogSourceId[],
  readerJob:
    "Understand where Claude Haiku 5.5’s five effort rows land on the Intelligence Index against cost per task, which row keeps the max row off the cost frontier and which Haiku row is a frontier vertex, what each effort step buys in points and cost, how the Haiku rows price against Claude Sonnet 5.5 and Claude Opus 5.5 on the same chart, which of Anthropic’s numbers are vendor numbers, and why the coding-agent chart has no Haiku score yet.",
  reassessOn: "2026-11-16" as const,
  refreshTriggers: [
    "A data refresh adds, removes, or rescores a Claude Haiku 5.5 row, a Claude Haiku 4.5 row, or any row that changes the Intelligence Index rank, the dominating row, the frontier vertices, the one-point neighbors, or the nearest-score table",
    "A data refresh adds, removes, or rescores a Claude Sonnet 5.5, Claude Opus 5.5, Claude Fable 5.1, or GPT-6 Luna row, which moves the family table, the dominated rows, or the Anthropic-only frontier",
    "The coding-agent snapshot gains a Claude Haiku 5.5 row in any harness",
    "Artificial Analysis changes the Intelligence Index version, its evaluations, or the Claude Haiku 5.5 model page prices, rank, or summary",
    "Anthropic changes Claude Haiku 5.5 prices, price tiers, effort levels, or names a default effort level",
  ],
  reviewedBy: "Claude Fable 5.1" as const,
  reviewerType: "ai" as const,
  reviewedOn: "2026-10-12" as const,
  scores: {
    factualConfidence: 2,
    hostFit: 2,
    maintenanceValue: 1,
    originalEvidence: 2,
    readerUtility: 2,
    voiceIntegrity: 2,
  },
  sourceCheckedOn: "2026-10-12" as const,
} as const;
