import type { BlogSourceId } from "./articles";
import { GPT_6_1_SOL_ARTICLE_SLUG } from "./gpt-6-1-sol-coding-agent-index-article";

/**
 * Admission record for the GPT-6.1 Sol coding-agent note. Copy into
 * `BLOG_ARTICLE_ADMISSIONS` only after the slug is a public blog slug and the
 * Slopcamera figure is registered. Until then the note stays a typed draft.
 */
export const GPT_6_1_SOL_ARTICLE_ADMISSION_DRAFT = {
  canonicalOwner: `/blog/${GPT_6_1_SOL_ARTICLE_SLUG}`,
  decision: "keep" as const,
  drafting: "ai" as const,
  evidenceOwner: "AI Charts editorial",
  evidenceType: "checked-dataset-analysis" as const,
  harmIfWrong:
    "The Codex · GPT-6.1 Sol AA Index could be quoted as a model ranking rather than a harness measurement, its mean cost per task could be pooled with the Intelligence Index cost per task or read as a price, the max setting could be treated as the highest Codex row after the snapshot placed xhigh, a generation step against GPT-6 Sol could be read as a like-for-like rerun at one setting, or OpenAI’s vendor-run DeepSWE figure could be cited as the chart’s measurement.",
  hostFit:
    "AI Charts stores every Codex · GPT-6.1 Sol setting on the coding-agent chart in one snapshot, so it can derive the placed row, rank, cost rank, frontier steps, setting table, component gaps, and the GPT-6 Sol generation step from the rows the chart plots without adding a data surface, and it stores the Intelligence Index max row needed to keep the two measurements apart.",
  humanReviewedOn: null,
  lifecycleState: "indexable" as const,
  nearestUrls: [
    {
      distinction:
        "The GPT-6 Sol page is pinned to cited September snapshots of Codex · GPT-6 Sol (max) and an Index roster that no longer lists that model; this page places Codex · GPT-6.1 Sol on the live coding-agent chart, shows that max is not the highest Codex setting, and uses the live Index only as a two-unit cost callout.",
      url: "/blog/gpt-6-sol-coding-agent-index" as const,
    },
    {
      distinction:
        "The Opus coding-agent page places the chart’s leading and costliest Claude Code row and asks what each step down the frontier gives up; this page places a cheaper Codex configuration and asks which of its own settings lead.",
      url: "/blog/opus-5-5-coding-agent-index" as const,
    },
    {
      distinction:
        "The AA Index page derives the whole coding-agent cost frontier and the AA Index per dollar view; this page reads one configuration’s settings against that frontier and splits its index into components.",
      url: "/blog/aa-index-cost-coding-agents" as const,
    },
    {
      distinction:
        "The Grok 4.7 page places Grok Build · Grok 4.7 on both charts and compares it with Grok 4.6 in the same harness; this page never places Grok and compares GPT-6.1 Sol with GPT-6 Sol in Codex.",
      url: "/blog/grok-4-7-coding-agent-index" as const,
    },
  ],
  nonObviousAnswer:
    "The highest Codex · GPT-6.1 Sol AA Index is not the max setting: xhigh leads the configuration, max scores lower and costs more, and only some of the five settings sit on the coding-agent cost frontier while Claude Code · Sonnet 5.5 and Opus 5.5 cost an order of magnitude more for a higher score. The Intelligence Index GPT-6.1 Sol (max) row is a second unit, and GPT-6 Sol is absent from the live Index roster.",
  observations: [
    "In the coding-agent snapshot retrieved 2026-10-05, Codex · GPT-6.1 Sol (xhigh) is the highest-scoring setting of that configuration, and Codex · GPT-6.1 Sol (max) scores lower at a higher cost per task.",
    "Low, medium, and xhigh sit on the coding-agent cost frontier in that snapshot; high and max do not.",
    "The live Intelligence Index snapshot stores GPT-6.1 Sol (max) and does not store GPT-6 Sol.",
  ],
  originalContribution:
    "A snapshot-derived statement of which Codex · GPT-6.1 Sol setting the coding-agent chart places, that max is not the highest-scoring setting, which of the five settings sit on the cost frontier, the rank and frontier steps of the placed row, a component table, a generation comparison with Codex · GPT-6 Sol that states when the settings differ, and an explicit two-unit separation from the Intelligence Index max row without pooling the scores.",
  overlapDecision:
    "Keep separately: the pinned GPT-6 Sol page shares the two-chart frame and the Sol family name but cites older snapshots, places a different model, and still walks an Index effort ladder this page refuses; the Opus and Grok pages share component and frontier tables as structure for other harnesses. Fewer than a third of the headings or claims overlap any of them.",
  primaryEvidence:
    "The coding-agent snapshot supplies every AA Index, component score, cost, token, and duration value, the frontier, and the update log for the Codex · GPT-6.1 Sol and Codex · GPT-6 Sol rows; the Intelligence Index snapshot supplies the GPT-6.1 Sol (max) score, cost per task, and output tokens for the callout only; OpenAI’s launch page and model docs supply the release claim, prices, availability, effort levels, and vendor-run DeepSWE sentence; Artificial Analysis’s model page supplies the rounded score, prices, cache discount, index token total, context window, and release date.",
  primarySourceIds: [
    "artificialAnalysisCodingAgents",
    "openAiGpt61Sol",
    "openAiGpt61SolDocs",
    "artificialAnalysisIntelligenceIndex",
    "artificialAnalysisGpt61SolModel",
  ] as const satisfies readonly BlogSourceId[],
  readerJob:
    "Understand what Codex · GPT-6.1 Sol’s AA Index and cost per task measure on the dated snapshot, which setting the chart places, why max is not automatically the top Codex row, what the cost frontier and Claude Code contrasts show, and why the Intelligence Index cost is not the same unit.",
  reassessOn: "2026-11-09" as const,
  refreshTriggers: [
    "A coding-agent snapshot adds, removes, or rescores a Codex · GPT-6.1 Sol row or any row that changes its AA Index rank, frontier membership, or which setting leads",
    "The coding-agent snapshot gains a GPT-6.1 Sol row in a harness other than Codex",
    "The Intelligence Index snapshot adds or removes GPT-6.1 Sol or restores GPT-6 Sol",
    "OpenAI changes GPT-6.1 Sol prices or effort levels",
  ],
  reviewedBy: "Codex" as const,
  reviewerType: "ai" as const,
  reviewedOn: "2026-10-05" as const,
  scores: {
    factualConfidence: 2,
    hostFit: 2,
    maintenanceValue: 2,
    originalEvidence: 2,
    readerUtility: 2,
    voiceIntegrity: 1,
  },
  sourceCheckedOn: "2026-10-05" as const,
} as const;
