import {
  blogArticlePath,
  type BlogSlug,
  type BlogSourceId,
} from "./articles";

type AdmissionScore = 0 | 1 | 2;

export type BlogArticleAdmission = Readonly<{
  canonicalOwner: `/blog/${BlogSlug}`;
  decision: "keep" | "revise" | "merge" | "noindex" | "remove";
  evidenceOwner: string;
  evidenceType: "checked-dataset-analysis" | "primary-source-synthesis";
  harmIfWrong: string;
  homepageRole?: string;
  hostFit: string;
  humanReviewedOn: `${number}-${number}-${number}` | null;
  lifecycleState: "indexable";
  nearestUrls: readonly Readonly<{
    distinction: string;
    url: `/blog/${BlogSlug}`;
  }>[];
  originalContribution: string;
  overlapDecision: string;
  primaryEvidence: string;
  primarySourceIds: readonly BlogSourceId[];
  readerJob: string;
  reassessOn: `${number}-${number}-${number}`;
  reviewedBy: "Codex editorial review";
  reviewedOn: `${number}-${number}-${number}`;
  scores: Readonly<{
    factualConfidence: AdmissionScore;
    hostFit: AdmissionScore;
    maintenanceValue: AdmissionScore;
    originalEvidence: AdmissionScore;
    readerUtility: AdmissionScore;
    voiceIntegrity: AdmissionScore;
  }>;
  sourceCheckedOn: `${number}-${number}-${number}`;
}>;

const REVIEWED_ON = "2026-09-02" as const;
const REASSESS_ON = "2026-10-13" as const;
const EVIDENCE_OWNER = "AI Charts editorial" as const;
const REVIEWED_BY = "Codex editorial review" as const;

export const HOME_EDITORIAL_SLUGS = [
  "small-models-have-arrived",
  "coding-agent-score-holdouts",
  "mirrorcode-coding-agent-benchmark",
] as const satisfies readonly BlogSlug[];

export const BLOG_ARTICLE_ADMISSIONS = {
  "terminal-bench-science": {
    canonicalOwner: blogArticlePath("terminal-bench-science"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    evidenceType: "primary-source-synthesis",
    harmIfWrong:
      "Readers could treat one resolution rate as a general scientific capability claim while losing the task funnel, cost, token, and miss-rate boundaries.",
    hostFit:
      "AI Charts publishes configuration-aware benchmark interpretation and can distinguish this scientific suite from the similarly named terminal benchmark in its checked chart.",
    humanReviewedOn: null,
    lifecycleState: "indexable",
    nearestUrls: [
      {
        distinction:
          "The AA Index page derives a cost frontier from the checked coding-agent snapshot; this page explains a separate scientific suite and its own published resource frontiers.",
        url: blogArticlePath("aa-index-cost-coding-agents"),
      },
      {
        distinction:
          "The holdout page concerns public-suite generalization; this page concerns task selection, resolution, cost, and tokens in one scientist-built evaluation.",
        url: blogArticlePath("coding-agent-score-holdouts"),
      },
    ],
    originalContribution:
      "A checked reconstruction of the 70-task acceptance funnel and the cost and token frontiers beside the reported resolution rate, plus an explicit separation from Terminal-Bench v2.1.",
    overlapDecision:
      "Keep separately: its scientific task funnel, configuration, and incomparable metric are not answered by the site's coding-agent snapshot analyses.",
    primaryEvidence:
      "The benchmark announcement owns the task funnel and reported results; the checked Artificial Analysis snapshot owns the named comparison row.",
    primarySourceIds: [
      "terminalBenchScienceAnnouncement",
      "artificialAnalysisCodingAgents",
    ],
    readerJob:
      "Understand what Terminal-Bench-Science's leading 30% result actually measures and which constraints remain outside that number.",
    reassessOn: REASSESS_ON,
    reviewedBy: REVIEWED_BY,
    reviewedOn: REVIEWED_ON,
    scores: {
      factualConfidence: 2,
      hostFit: 2,
      maintenanceValue: 1,
      originalEvidence: 1,
      readerUtility: 2,
      voiceIntegrity: 2,
    },
    sourceCheckedOn: "2026-08-31",
  },
  "small-models-have-arrived": {
    canonicalOwner: blogArticlePath("small-models-have-arrived"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    evidenceType: "primary-source-synthesis",
    harmIfWrong:
      "Anecdotal speed or price observations could be mistaken for universal quality or production-cost guarantees.",
    homepageRole: "model economics",
    hostFit:
      "AI Charts already compares model-task cost with measured quality; this guide turns that product surface into a bounded workflow-level selection rule.",
    humanReviewedOn: null,
    lifecycleState: "indexable",
    nearestUrls: [
      {
        distinction:
          "The AA Index page compares measured coding-agent rows; this page explains how to test a cheaper model on a product-specific acceptance set.",
        url: blogArticlePath("aa-index-cost-coding-agents"),
      },
      {
        distinction:
          "The science page compares evaluation-level cost and tokens; this page addresses recurring feature economics and escalation rules.",
        url: blogArticlePath("terminal-bench-science"),
      },
    ],
    originalContribution:
      "A decision rule for testing the least expensive model that still clears a product's measured quality requirement, including accepted-result cost and escalation.",
    overlapDecision:
      "Keep separately: no other route answers the product-level decision of when a low-cost model is adequate for repeated use.",
    primaryEvidence:
      "French-Owen's reported experiments establish the bounded observations; OpenAI's model page establishes the current listed token prices.",
    primarySourceIds: [
      "calvinFrenchOwenSmallModels",
      "openAiGpt56Luna",
    ],
    readerJob:
      "Decide when a lower-cost model can make a frequently used AI feature viable without assuming that cheaper means adequate.",
    reassessOn: REASSESS_ON,
    reviewedBy: REVIEWED_BY,
    reviewedOn: REVIEWED_ON,
    scores: {
      factualConfidence: 2,
      hostFit: 1,
      maintenanceValue: 1,
      originalEvidence: 1,
      readerUtility: 2,
      voiceIntegrity: 2,
    },
    sourceCheckedOn: "2026-08-28",
  },
  "coding-agent-score-holdouts": {
    canonicalOwner: blogArticlePath("coding-agent-score-holdouts"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    evidenceType: "checked-dataset-analysis",
    harmIfWrong:
      "A public-suite score could be presented as generalization evidence even when the optimizer has seen or inferred the evaluated cases.",
    homepageRole: "benchmark validity",
    hostFit:
      "AI Charts publishes the named public-suite scores whose interpretation changes when no hidden holdout accompanies the checked snapshot.",
    humanReviewedOn: null,
    lifecycleState: "indexable",
    nearestUrls: [
      {
        distinction:
          "The open-models page compares unlike composites and current rows; this page asks whether a public-suite result generalizes to unseen cases.",
        url: blogArticlePath("open-models-coding-agent-benchmarks"),
      },
      {
        distinction:
          "MirrorCode embeds held-out tests in project reimplementation; this page applies an observed public-suite failure to the site's current snapshot.",
        url: blogArticlePath("mirrorcode-coding-agent-benchmark"),
      },
    ],
    originalContribution:
      "A concrete holdout failure from the FRE experiment applied carefully to the interpretation boundary of the current coding-agent snapshot.",
    overlapDecision:
      "Keep separately from model-class and cost pages; retire the broader benchmarkpocalypse page without redirect because its product-saturation question was not merged here.",
    primaryEvidence:
      "Dan Luu's reported experiment owns the public-suite and holdout comparison; Artificial Analysis owns the current named-suite scores.",
    primarySourceIds: [
      "danLuuBenchpocalypse",
      "artificialAnalysisCodingAgents",
    ],
    readerJob:
      "Judge why a high coding-agent score still needs cases that the optimizing system could not inspect.",
    reassessOn: REASSESS_ON,
    reviewedBy: REVIEWED_BY,
    reviewedOn: REVIEWED_ON,
    scores: {
      factualConfidence: 2,
      hostFit: 2,
      maintenanceValue: 1,
      originalEvidence: 2,
      readerUtility: 2,
      voiceIntegrity: 2,
    },
    sourceCheckedOn: "2026-08-26",
  },
  "open-models-coding-agent-benchmarks": {
    canonicalOwner: blogArticlePath("open-models-coding-agent-benchmarks"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    evidenceType: "checked-dataset-analysis",
    harmIfWrong:
      "Different eras, composites, model classifications, harnesses, and settings could be collapsed into a false universal open-versus-closed ranking.",
    hostFit:
      "AI Charts owns the normalized model-harness-setting rows and can compare them with an external era claim without collapsing unlike measurements.",
    humanReviewedOn: null,
    lifecycleState: "indexable",
    nearestUrls: [
      {
        distinction:
          "The AA Index page ranks the score-cost frontier without classifying weight access; this page adds an explicit open-weight allowlist and preserves unlike source metrics.",
        url: blogArticlePath("aa-index-cost-coding-agents"),
      },
      {
        distinction:
          "The holdout page tests generalization of public scores; this page compares open-model catch-up claims with current named configurations.",
        url: blogArticlePath("coding-agent-score-holdouts"),
      },
    ],
    originalContribution:
      "A checked open-weight classification and side-by-side separation between SemiAnalysis's era composites and current model-harness-setting rows.",
    overlapDecision:
      "Keep as the canonical open-model route and redirect the duplicate catch-up slug here because it answers the same query from the same primary evidence.",
    primaryEvidence:
      "SemiAnalysis owns its composite comparisons; Artificial Analysis owns the checked configuration-level measurements.",
    primarySourceIds: [
      "semiAnalysisOpenModels",
      "artificialAnalysisCodingAgents",
    ],
    readerJob:
      "Compare an open-model catch-up claim with current coding-agent rows without treating unlike evaluations as one leaderboard.",
    reassessOn: REASSESS_ON,
    reviewedBy: REVIEWED_BY,
    reviewedOn: REVIEWED_ON,
    scores: {
      factualConfidence: 2,
      hostFit: 2,
      maintenanceValue: 1,
      originalEvidence: 2,
      readerUtility: 2,
      voiceIntegrity: 2,
    },
    sourceCheckedOn: "2026-08-26",
  },
  "aa-index-cost-coding-agents": {
    canonicalOwner: blogArticlePath("aa-index-cost-coding-agents"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    evidenceType: "checked-dataset-analysis",
    harmIfWrong:
      "A cost-performance frontier could be presented as a universal model ranking or as a price and latency guarantee.",
    hostFit:
      "The article derives its frontier from the exact checked rows that power AI Charts and links readers back to the interactive axes and dataset.",
    humanReviewedOn: null,
    lifecycleState: "indexable",
    nearestUrls: [
      {
        distinction:
          "The open-models page groups configurations by an explicit weight-access rule; this page derives the unconstrained cost-performance frontier.",
        url: blogArticlePath("open-models-coding-agent-benchmarks"),
      },
      {
        distinction:
          "The science page reports another evaluation's aggregate resource frontiers; this page computes row-level trade-offs from AI Charts' own checked snapshot.",
        url: blogArticlePath("terminal-bench-science"),
      },
    ],
    originalContribution:
      "A reproducible frontier and efficiency view derived from the same checked rows used by the live chart.",
    overlapDecision:
      "Keep as the canonical score-versus-cost analysis because no other route derives this frontier from the product dataset.",
    primaryEvidence:
      "The checked Artificial Analysis snapshot owns every plotted score, harness, setting, and mean task cost.",
    primarySourceIds: ["artificialAnalysisCodingAgents"],
    readerJob:
      "Choose coding-agent configurations by the observed AA Index and mean task-cost trade-off rather than score alone.",
    reassessOn: REASSESS_ON,
    reviewedBy: REVIEWED_BY,
    reviewedOn: REVIEWED_ON,
    scores: {
      factualConfidence: 2,
      hostFit: 2,
      maintenanceValue: 2,
      originalEvidence: 2,
      readerUtility: 2,
      voiceIntegrity: 2,
    },
    sourceCheckedOn: "2026-08-22",
  },
  "mirrorcode-coding-agent-benchmark": {
    canonicalOwner: blogArticlePath("mirrorcode-coding-agent-benchmark"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    evidenceType: "primary-source-synthesis",
    harmIfWrong:
      "Leaderboard configurations, broader paper results, budgets, and held-out behavior could be conflated into an unsupported autonomy claim.",
    homepageRole: "long-horizon evaluation",
    hostFit:
      "AI Charts specializes in configuration-aware benchmark interpretation, and this page reconciles the maintained leaderboard with the broader paper rather than presenting a bare score.",
    humanReviewedOn: null,
    lifecycleState: "indexable",
    nearestUrls: [
      {
        distinction:
          "The holdout page applies a post-hoc unseen test to a public-suite win; MirrorCode builds held-out end-to-end behavior into project-scale evaluation.",
        url: blogArticlePath("coding-agent-score-holdouts"),
      },
      {
        distinction:
          "Terminal-Bench-Science measures scientific workflow resolution; MirrorCode measures complete-program behavioral reimplementation under very large budgets.",
        url: blogArticlePath("terminal-bench-science"),
      },
    ],
    originalContribution:
      "A configuration reconciliation between the maintained leaderboard and broader paper, with held-out behavior, budgets, strict solve semantics, and contamination limits kept separate.",
    overlapDecision:
      "Keep separately: no other retained page reconciles two versions of a project-scale reimplementation benchmark or explains strict near-solves.",
    primaryEvidence:
      "Epoch AI's maintained page owns the current leaderboard configuration; the paper owns the broader task design and study results.",
    primarySourceIds: ["mirrorCode", "mirrorCodePaper"],
    readerJob:
      "Understand what MirrorCode tests when an agent reimplements a complete program and how far its current results can be generalized.",
    reassessOn: REASSESS_ON,
    reviewedBy: REVIEWED_BY,
    reviewedOn: REVIEWED_ON,
    scores: {
      factualConfidence: 2,
      hostFit: 2,
      maintenanceValue: 1,
      originalEvidence: 1,
      readerUtility: 2,
      voiceIntegrity: 2,
    },
    sourceCheckedOn: "2026-08-05",
  },
} as const satisfies Record<BlogSlug, BlogArticleAdmission>;
