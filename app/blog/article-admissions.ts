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
  "mimo-v2-6-pro-cost-frontier": {
    canonicalOwner: blogArticlePath("mimo-v2-6-pro-cost-frontier"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    evidenceType: "checked-dataset-analysis",
    harmIfWrong:
      "A vendor-run CyberGym score under a corrected protocol could be quoted as an independent cybersecurity ranking, an investor’s per-token price multiples could be quoted as measured cost, or a launch-day composite score could be read as a general open-versus-closed verdict.",
    hostFit:
      "AI Charts already charts the Intelligence Index cohort with its cost frontier from a checked snapshot that stores MiMo-V2.6-Pro and every model Xiaomi and Das name, so it can test the frontier and price claims on measured cost per task without adding a new data surface.",
    humanReviewedOn: null,
    lifecycleState: "indexable",
    nearestUrls: [
      {
        distinction:
          "The open-models page compares an open-versus-closed era claim with coding-agent configurations; this page tests one model’s launch claims against the model-level Intelligence Index frontier and its vendor cybersecurity table.",
        url: blogArticlePath("open-models-coding-agent-benchmarks"),
      },
      {
        distinction:
          "The AA Index page derives a cost frontier from coding-agent harness rows; this page places one model on the separate Intelligence Index cost frontier and compares measured per-task multiples with stated per-token multiples.",
        url: blogArticlePath("aa-index-cost-coding-agents"),
      },
      {
        distinction:
          "The small-models page gives a decision rule for adopting a cheaper model on a product acceptance set; this page reports where a specific new model sits on a published frontier and what its scores measure.",
        url: blogArticlePath("small-models-have-arrived"),
      },
    ],
    originalContribution:
      "A snapshot-derived statement of MiMo-V2.6-Pro’s cost-frontier membership with its frontier neighbors and the counts of higher-scoring and cheaper configurations, a table of every configuration within one index point with cost multiples, a side-by-side of Das’s stated price multiples with measured cost-per-task multiples for the same models, a reading of Xiaomi’s cybersecurity table that separates the corrected-protocol CyberGym score from the exploitation benchmarks where frontier models lead, and a verified 10x UltraSpeed price ratio from the first-party OpenRouter endpoint.",
    overlapDecision:
      "Keep separately: no current route covers the model-level Intelligence Index frontier, a specific model launch, or a cybersecurity capability profile, and fewer than a third of its headings or claims overlap any existing article.",
    primaryEvidence:
      "Das’s post owns his multiples, assumptions, throughput, refusal, and multimodal observations; Xiaomi’s release note, model card, and technical report own the parameter counts, license, index claim, training figures, evaluation table, corrected CyberGym oracle, and open-source inventory; the Artificial Analysis model page owns the score, class rank, prices, speed, and cost per task; the OpenRouter listing owns the UltraSpeed prices; the checked Artificial Analysis snapshot owns every frontier position, neighbor, and measured multiple.",
    primarySourceIds: [
      "deedyDasMimoV26",
      "xiaomiMimoV26Release",
      "xiaomiMimoV26ModelCard",
      "xiaomiMimoV26TechnicalReport",
      "artificialAnalysisMimoV26Pro",
      "openRouterMimoV26ProUltraSpeed",
      "artificialAnalysisIntelligenceIndex",
    ],
    readerJob:
      "Understand what MiMo-V2.6-Pro’s 46 on the Intelligence Index and $0.13 per task measure, where the model sits on the measured cost frontier, how far Das’s price and cybersecurity claims are supported by primary sources, and what remains a vendor or single-user observation.",
    reassessOn: "2026-10-27",
    reviewedBy: REVIEWED_BY,
    reviewedOn: "2026-09-22",
    scores: {
      factualConfidence: 2,
      hostFit: 2,
      maintenanceValue: 1,
      originalEvidence: 2,
      readerUtility: 2,
      voiceIntegrity: 2,
    },
    sourceCheckedOn: "2026-09-22",
  },
  "harness-design-coding-agents": {
    canonicalOwner: blogArticlePath("harness-design-coding-agents"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    evidenceType: "primary-source-synthesis",
    harmIfWrong:
      "A conditional component effect measured on four open-weight models in one research harness could be quoted as a universal rule for commercial harnesses, or a Terminal-Bench 2.1 rate could be compared numerically with the site’s Terminal-Bench 4 rows.",
    hostFit:
      "AI Charts already stores model, harness, and setting as one configuration and explains what a harness study measures, so it can place a component-level ablation beside the chart and name the benchmark-version gap without merging the scales.",
    humanReviewedOn: null,
    lifecycleState: "indexable",
    nearestUrls: [
      {
        distinction:
          "HarnessTax moves the same frontier model across three complete products and reports same-model cost gaps; this page explains a study that holds one loop fixed and toggles planning, action space, and context management inside it.",
        url: blogArticlePath("harnesstax-coding-agent-harness"),
      },
      {
        distinction:
          "The holdout page asks whether a public-suite score generalizes to unseen cases; this page reports component effects on two public suites and keeps their exposure risk as a limit.",
        url: blogArticlePath("coding-agent-score-holdouts"),
      },
      {
        distinction:
          "The AA Index page derives a cost frontier from checked single-configuration rows; this page reconstructs another evaluator’s within-harness cost and success tables for models the snapshot does not store.",
        url: blogArticlePath("aa-index-cost-coding-agents"),
      },
    ],
    originalContribution:
      "A typed reconstruction of the paper’s 176 printed settings, a recomputation of the model-averaged managed-minus-T0 gap at each window budget that matches the reported 35.7, 15.9, 5.5, and 2.7 points, a tie-aware check of the seven-of-eight lowest-cost claim for staged elision, and an explicit statement that the paper’s Terminal-Bench 2.1 rates and the site’s Terminal-Bench 4 accuracy are different task sets.",
    overlapDecision:
      "Keep separately: no current route explains component-level harness ablations under a fixed execution loop, the five context-management tiers, or the planning and action-space crossover by model capability.",
    primaryEvidence:
      "The arXiv paper owns every success rate, cost, gap, trajectory statistic, quote, and limitation; the checked Artificial Analysis snapshot owns only the retrieval date and the absence or presence of same-name rows; the checked Terminal-Bench 4 constants own the charted version, task count, and trial count.",
    primarySourceIds: ["fanHarnessDesign", "artificialAnalysisCodingAgents"],
    readerJob:
      "Understand which harness components (planning, action space, and context management) move coding-agent success and cost under a fixed loop, under what model and budget conditions, and how to read those results beside the AI Charts chart without merging benchmark versions.",
    reassessOn: "2026-10-26",
    reviewedBy: REVIEWED_BY,
    reviewedOn: "2026-09-21",
    scores: {
      factualConfidence: 2,
      hostFit: 2,
      maintenanceValue: 1,
      originalEvidence: 2,
      readerUtility: 2,
      voiceIntegrity: 2,
    },
    sourceCheckedOn: "2026-09-21",
  },
  "harnesstax-coding-agent-harness": {
    canonicalOwner: blogArticlePath("harnesstax-coding-agent-harness"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    evidenceType: "primary-source-synthesis",
    harmIfWrong:
      "A same-model cost gap could be quoted as a universal harness ranking, a statistically tested success effect, or a conversion into Artificial Analysis scores.",
    hostFit:
      "AI Charts already stores model, harness, and setting as one configuration and publishes cost-aware benchmark notes, so it can place a crossed-harness study beside the chart without merging the two scales.",
    humanReviewedOn: null,
    lifecycleState: "indexable",
    nearestUrls: [
      {
        distinction:
          "Real-SWE scores each model in its native harness on private tasks; this page explains a study that moves the same model across Claude Code, Codex CLI, and Pi on public suites.",
        url: blogArticlePath("real-swe-private-enterprise-benchmark"),
      },
      {
        distinction:
          "The AA Index page derives a cost frontier from checked single-configuration rows; this page reconstructs a different evaluator’s same-model harness comparison.",
        url: blogArticlePath("aa-index-cost-coding-agents"),
      },
      {
        distinction:
          "The holdout page asks whether a public-suite score generalizes to unseen cases; this page reports harness cost and success on two named public suites and keeps their contamination risk as a limit.",
        url: blogArticlePath("coding-agent-score-holdouts"),
      },
    ],
    originalContribution:
      "A reconstruction of the published 21-pair success and cost tables, a pair-by-pair check of the nine-of-12 alternative-harness success tally that treats provider-harness ties as non-wins, and an explicit refusal to convert those rates into the checked Artificial Analysis snapshot.",
    overlapDecision:
      "Keep separately: no current route evaluates the same model across Claude Code, Codex CLI, and Pi, or reconstructs HarnessTax’s pair tables and 9 of 12 count.",
    primaryEvidence:
      "The HarnessTax page owns every rate, cost, geometric-mean ratio, and method bound; the checked Artificial Analysis snapshot owns only the same-name chart rows and their retrieval date.",
    primarySourceIds: ["harnessTax", "artificialAnalysisCodingAgents"],
    readerJob:
      "Understand what HarnessTax’s same-model cost gap measures when a coding model changes harness, and read that study beside the AI Charts chart without merging the two scales.",
    reassessOn: "2026-10-22",
    reviewedBy: REVIEWED_BY,
    reviewedOn: "2026-09-17",
    scores: {
      factualConfidence: 2,
      hostFit: 2,
      maintenanceValue: 1,
      originalEvidence: 2,
      readerUtility: 2,
      voiceIntegrity: 2,
    },
    sourceCheckedOn: "2026-09-17",
  },
  "real-swe-private-enterprise-benchmark": {
    canonicalOwner: blogArticlePath("real-swe-private-enterprise-benchmark"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    evidenceType: "primary-source-synthesis",
    harmIfWrong:
      "A private-task aggregate could be quoted as a general enterprise capability ranking, compared numerically with public-suite scores, or attributed to a model rather than to its model and harness pair.",
    hostFit:
      "AI Charts publishes configuration-aware benchmark interpretation and already stores several of the same model and harness names in its checked coding-agent snapshot, so it can place the private-task ranking beside the chart without merging the two scales.",
    humanReviewedOn: null,
    lifecycleState: "indexable",
    nearestUrls: [
      {
        distinction:
          "The holdout page asks whether a public-suite score generalizes to cases the optimizer could not see; this page explains a benchmark whose tasks are private by provenance and scored per model and harness pair.",
        url: blogArticlePath("coding-agent-score-holdouts"),
      },
      {
        distinction:
          "MirrorCode measures complete-program reimplementation of public software under large budgets; this page measures scoped changes to licensed private production code under an eight-run pass@1 protocol.",
        url: blogArticlePath("mirrorcode-coding-agent-benchmark"),
      },
      {
        distinction:
          "The AA Index and open-models pages analyze the checked Artificial Analysis snapshot; this page analyzes a separate primary source and uses the snapshot only for same-name rows.",
        url: blogArticlePath("aa-index-cost-coding-agents"),
      },
      {
        distinction:
          "The Devin Fusion page reconstructs a vendor's multi-model harness cost claim; this page explains an independent evaluator's private-task leaderboard and failure taxonomy.",
        url: blogArticlePath("devin-fusion-cost-saving"),
      },
    ],
    originalContribution:
      "A reconciliation of the leaderboard rates with the published 640-rollout task table, derived failure-category totals showing missed requirements as the largest bucket, named per-task rank inversions, the Gemini CLI versus Antigravity harness boundary sourced to Google's own transition notice, and a derived same-name overlap table against the checked snapshot that refuses numeric comparison.",
    overlapDecision:
      "Keep separately: no current route explains private-task provenance, model and harness pair scoring, or a failure taxonomy, and fewer than a third of its headings or claims overlap any existing article.",
    primaryEvidence:
      "Specific Labs' benchmark page owns every rate, count, cost, and quote; Google's developer blog owns the Gemini CLI transition; the Hacker News thread owns the practitioner reactions; the checked Artificial Analysis snapshot owns the same-name comparison rows and their retrieval date.",
    primarySourceIds: [
      "specificLabsRealSwe",
      "googleAntigravityCliTransition",
      "hackerNewsRealSwe",
      "artificialAnalysisCodingAgents",
    ],
    readerJob:
      "Understand what Real-SWE's 38.8% top resolve rate measures for model and harness pairs on private enterprise code, and read that ranking beside the AI Charts coding-agent snapshot without merging the two scales.",
    reassessOn: "2026-10-19",
    reviewedBy: REVIEWED_BY,
    reviewedOn: "2026-09-14",
    scores: {
      factualConfidence: 2,
      hostFit: 2,
      maintenanceValue: 1,
      originalEvidence: 2,
      readerUtility: 2,
      voiceIntegrity: 2,
    },
    sourceCheckedOn: "2026-09-14",
  },
  "devin-fusion-cost-saving": {
    canonicalOwner: blogArticlePath("devin-fusion-cost-saving"),
    decision: "keep",
    evidenceOwner: EVIDENCE_OWNER,
    evidenceType: "primary-source-synthesis",
    harmIfWrong:
      "A vendor's headline saving could be quoted as an independent, configuration-free result, or compared numerically with chart rows measured under a different index version.",
    hostFit:
      "Cognition's headline chart is drawn on the Artificial Analysis coding-agent index that powers the AI Charts chart, and the checked snapshot already stores the named lead models and an earlier Devin CLI configuration.",
    humanReviewedOn: null,
    lifecycleState: "indexable",
    nearestUrls: [
      {
        distinction:
          "The AA Index page derives a cost frontier from checked single-model rows; this page reconstructs a vendor's multi-model harness claim and states why the checked rows cannot yet test it.",
        url: blogArticlePath("aa-index-cost-coding-agents"),
      },
      {
        distinction:
          "The small-models page decides when one cheaper model is adequate for a product feature; this page examines a lead-and-sidekick pairing whose saving depends on delegation.",
        url: blogArticlePath("small-models-have-arrived"),
      },
    ],
    originalContribution:
      "A reconstruction of which comparison produces the 39% figure from the announcement's accessible chart data, a reconciliation of six differently configured Fusion percentages across three dated Cognition posts, and a dated statement of what the checked snapshot stores for the named lead models.",
    overlapDecision:
      "Keep separately: no current route explains a multi-model harness cost claim or reconciles its published percentages by comparator, benchmark, model pair, and date.",
    primaryEvidence:
      "Cognition's three Fusion posts own every reported score, cost, and percentage; the checked Artificial Analysis snapshot owns the single-model baseline rows and their retrieval date.",
    primarySourceIds: [
      "cognitionFusionDesktopCli",
      "cognitionDevinFusion",
      "devinFable51",
      "artificialAnalysisCodingAgents",
    ],
    readerJob:
      "Understand which comparison produces Devin Fusion's 39% saving, what score that comparison gave up, and how to read the other Fusion percentages Cognition has published.",
    reassessOn: "2026-10-16",
    reviewedBy: REVIEWED_BY,
    reviewedOn: "2026-09-11",
    scores: {
      factualConfidence: 2,
      hostFit: 2,
      maintenanceValue: 1,
      originalEvidence: 1,
      readerUtility: 2,
      voiceIntegrity: 2,
    },
    sourceCheckedOn: "2026-09-11",
  },
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
      "A checked reconstruction of the 70-task acceptance funnel and the cost and token frontiers beside the reported resolution rate, plus an explicit separation from the standalone Terminal-Bench 4 owner cohort.",
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
