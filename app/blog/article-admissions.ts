import {
  blogArticlePath,
  type BlogSlug,
  type BlogSourceId,
} from "./articles";

export type BlogArticleAdmission = Readonly<{
  canonicalOwner: `/blog/${BlogSlug}`;
  decision: "keep" | "revise" | "merge" | "noindex" | "remove";
  evidenceOwner: string;
  harmIfWrong: string;
  homepageRole?: string;
  originalContribution: string;
  primaryEvidence: string;
  primarySourceIds: readonly BlogSourceId[];
  readerJob: string;
  reassessOn: `${number}-${number}-${number}`;
  reviewedOn: `${number}-${number}-${number}`;
}>;

const REVIEWED_ON = "2026-09-01" as const;
const REASSESS_ON = "2026-10-13" as const;
const EVIDENCE_OWNER = "AI Charts editorial" as const;

export const BLOG_ARTICLE_ADMISSIONS = {
  "terminal-bench-science": {
    canonicalOwner: blogArticlePath("terminal-bench-science"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    harmIfWrong:
      "Readers could treat one resolution rate as a general scientific capability claim while losing the task funnel, cost, token, and miss-rate boundaries.",
    originalContribution:
      "A checked reconstruction of the 70-task acceptance funnel and the cost and token frontiers beside the reported resolution rate.",
    primaryEvidence:
      "The benchmark announcement owns the task funnel and reported results; the checked Artificial Analysis snapshot owns the named comparison row.",
    primarySourceIds: [
      "terminalBenchScienceAnnouncement",
      "artificialAnalysisCodingAgents",
    ],
    readerJob:
      "Understand what Terminal-Bench-Science's leading 30% result actually measures and which constraints remain outside that number.",
    reassessOn: REASSESS_ON,
    reviewedOn: REVIEWED_ON,
  },
  "small-models-have-arrived": {
    canonicalOwner: blogArticlePath("small-models-have-arrived"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    harmIfWrong:
      "Anecdotal speed or price observations could be mistaken for universal quality or production-cost guarantees.",
    homepageRole: "model economics",
    originalContribution:
      "A decision rule for testing the least expensive model that still clears a product's measured quality requirement.",
    primaryEvidence:
      "French-Owen's reported experiments establish the bounded observations; OpenAI's model page establishes the current listed token prices.",
    primarySourceIds: [
      "calvinFrenchOwenSmallModels",
      "openAiGpt56Luna",
    ],
    readerJob:
      "Decide when a lower-cost model can make a frequently used AI feature viable without assuming that cheaper means adequate.",
    reassessOn: REASSESS_ON,
    reviewedOn: REVIEWED_ON,
  },
  "coding-agent-score-holdouts": {
    canonicalOwner: blogArticlePath("coding-agent-score-holdouts"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    harmIfWrong:
      "A public-suite score could be presented as generalization evidence even when the optimizer has seen or inferred the evaluated cases.",
    homepageRole: "benchmark validity",
    originalContribution:
      "A concrete holdout failure from the FRE experiment applied carefully to the interpretation boundary of the current coding-agent snapshot.",
    primaryEvidence:
      "Dan Luu's reported experiment owns the public-suite and holdout comparison; Artificial Analysis owns the current named-suite scores.",
    primarySourceIds: [
      "danLuuBenchpocalypse",
      "artificialAnalysisCodingAgents",
    ],
    readerJob:
      "Judge why a high coding-agent score still needs cases that the optimizing system could not inspect.",
    reassessOn: REASSESS_ON,
    reviewedOn: REVIEWED_ON,
  },
  "open-models-coding-agent-benchmarks": {
    canonicalOwner: blogArticlePath("open-models-coding-agent-benchmarks"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    harmIfWrong:
      "Different eras, composites, model classifications, harnesses, and settings could be collapsed into a false universal open-versus-closed ranking.",
    originalContribution:
      "A separation between SemiAnalysis's era-specific catch-up claim and the narrower model-harness-setting rows in the checked snapshot.",
    primaryEvidence:
      "SemiAnalysis owns its composite comparisons; Artificial Analysis owns the checked configuration-level measurements.",
    primarySourceIds: [
      "semiAnalysisOpenModels",
      "artificialAnalysisCodingAgents",
    ],
    readerJob:
      "Compare an open-model catch-up claim with current coding-agent rows without treating unlike evaluations as one leaderboard.",
    reassessOn: REASSESS_ON,
    reviewedOn: REVIEWED_ON,
  },
  "aa-index-cost-coding-agents": {
    canonicalOwner: blogArticlePath("aa-index-cost-coding-agents"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    harmIfWrong:
      "A cost-performance frontier could be presented as a universal model ranking or as a price and latency guarantee.",
    originalContribution:
      "A reproducible frontier and efficiency view derived from the same checked rows used by the live chart.",
    primaryEvidence:
      "The checked Artificial Analysis snapshot owns every plotted score, harness, setting, and mean task cost.",
    primarySourceIds: ["artificialAnalysisCodingAgents"],
    readerJob:
      "Choose coding-agent configurations by the observed AA Index and mean task-cost trade-off rather than score alone.",
    reassessOn: REASSESS_ON,
    reviewedOn: REVIEWED_ON,
  },
  "mirrorcode-coding-agent-benchmark": {
    canonicalOwner: blogArticlePath("mirrorcode-coding-agent-benchmark"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    harmIfWrong:
      "Leaderboard configurations, broader paper results, budgets, and held-out behavior could be conflated into an unsupported autonomy claim.",
    homepageRole: "long-horizon evaluation",
    originalContribution:
      "A reader-facing account of behavioral reimplementation, held-out end-to-end tests, and the difference between the maintained leaderboard and broader study.",
    primaryEvidence:
      "Epoch AI's maintained page owns the current leaderboard configuration; the paper owns the broader task design and study results.",
    primarySourceIds: ["mirrorCode", "mirrorCodePaper"],
    readerJob:
      "Understand what MirrorCode tests when an agent reimplements a complete program and how far its current results can be generalized.",
    reassessOn: REASSESS_ON,
    reviewedOn: REVIEWED_ON,
  },
  "slopcodebench-long-horizon-coding-agents": {
    canonicalOwner: blogArticlePath("slopcodebench-long-horizon-coding-agents"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    harmIfWrong:
      "Static quality measures or one benchmark's degradation pattern could be presented as a universal law of long-running agent work.",
    originalContribution:
      "An explanation of checkpointed structural degradation, calibrated static measures, prompt interventions, and their stated limits.",
    primaryEvidence:
      "The SlopCodeBench paper owns the task design, agent runs, calibrated measures, interventions, and limitations.",
    primarySourceIds: ["slopCodeBench"],
    readerJob:
      "Evaluate how one benchmark measures code-quality degradation across repeated agent changes and what that evidence does not establish.",
    reassessOn: REASSESS_ON,
    reviewedOn: REVIEWED_ON,
  },
} as const satisfies Record<BlogSlug, BlogArticleAdmission>;
