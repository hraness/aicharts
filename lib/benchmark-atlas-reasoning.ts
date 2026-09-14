import checkedSnapshot from "../data/benchmark-atlas-reasoning.json";
import type { BenchmarkAtlasDataset, BenchmarkAtlasEntry, BenchmarkAtlasPoint } from "./benchmark-atlas";
import { reasoningSnapshotSchema } from "./benchmark-atlas-reasoning-data";

const snapshot = reasoningSnapshotSchema.parse(checkedSnapshot);
const arcSource = { name: "ARC Prize", url: "https://arcprize.org/leaderboard", methodologyUrl: "https://arcprize.org/blog/astra" };
const researchSource = { name: "USTC / Metastone", url: "https://agentresearchlab.com/benchmarks/deepresearch-bench-ii/index.html", methodologyUrl: "https://arxiv.org/abs/2601.08536" };
const memorySource = { name: "UCLA LongMemEval team", url: "https://xiaowu0162.github.io/longmemeval-v2/", methodologyUrl: "https://github.com/xiaowu0162/LongMemEval-V2" };

export const REASONING_ATLAS_ENTRIES = [
  {
    id: "arc-agi-2", name: "ARC-AGI-2", version: "2 · semi-private", category: "reasoning",
    question: "Can it solve an unfamiliar visual puzzle?",
    summary: "Infer a rule from a few examples, then apply it to a new grid.", source: arcSource,
    measure: "Percentage of novel abstract grid tasks solved in ARC Prize's semi-private evaluation.",
    comparisonRule: "Compare the same dataset split and reasoning effort. This view selects seven recent model families.",
    limitations: ["Strong puzzle performance does not establish general intelligence.", "Selected configurations have no published cost in this source.", "Scores near the ceiling leave less room to distinguish leading systems."],
    coverage: "charted", tags: ["abstract reasoning", "novel problems", "visual puzzles", "ARC", "AGI"],
  },
  {
    id: "arc-agi-3-standard", name: "ARC-AGI-3 · Standard", version: "3 · semi-private · Standard", category: "reasoning",
    question: "Can it learn the rules by interacting?",
    summary: "Explore an unfamiliar environment and solve it through a shared, minimal agent interface.", source: arcSource,
    measure: "Action-efficiency score relative to the benchmark's human baseline, expressed as a percentage.",
    comparisonRule: "Standard harness only. Compare the selected Astra, Sol, and Opus 5 configurations within this view.",
    limitations: ["Cost is the full evaluation spend, not the cost of one task.", "These are deterministic puzzle environments; they do not measure open-ended real-world competence.", "The Provider Adapter harness is a separate comparison."],
    coverage: "charted", tags: ["interactive reasoning", "exploration", "planning", "ARC", "AGI", "agent"],
  },
  {
    id: "arc-agi-3-adapter", name: "ARC-AGI-3 · Provider Adapter", version: "3 · semi-private · Provider Adapter", category: "reasoning",
    question: "How much does native context management help?",
    summary: "Astra's reasoning settings with its provider's conversation and compaction features enabled.", source: arcSource,
    measure: "ARC-AGI-3 action-efficiency score using the Provider Adapter harness.",
    comparisonRule: "Compare Astra's six effort settings here. These scores are not a ranking against Standard-harness runs.",
    limitations: ["Only Astra is included in this selected adapter cohort.", "Cost is total evaluation spend.", "Near-perfect performance on this bounded test is not proof of general intelligence."],
    coverage: "charted", tags: ["interactive reasoning", "harness", "context management", "ARC", "AGI"],
  },
  {
    id: "deepresearch-bench-ii", name: "DeepResearch Bench II", version: "II · 132 tasks", category: "research",
    question: "Which research agent produces a useful report?",
    summary: "Compare information gathering, analysis, and presentation against expert-written research rubrics.", source: researchSource,
    measure: "Owner-reported weighted rubric score across 132 tasks and 9,430 criteria; component scores appear in the inspector.",
    comparisonRule: "Keep the exact research product and model generation. An o3-era research run does not represent today's OpenAI product.",
    limitations: ["The source includes historical products and does not date every run.", "A model judge evaluates reports; no intervals or comparable costs are published in this table.", "This is a selected set of nine systems, not the full source leaderboard."],
    coverage: "charted", tags: ["deep research", "reports", "citations", "analysis", "search"],
  },
  ...(["small", "medium"] as const).map(tier => ({
    id: `longmemeval-v2-${tier}`, name: `LongMemEval-V2 · ${tier === "small" ? "Small" : "Medium"}`, version: `2 · ${tier} · paper baselines`, category: "memory" as const,
    question: "Can an agent reuse what it learned before?",
    summary: "Compare memory systems that turn previous web-agent work into useful evidence for a later question.", source: memorySource,
    measure: "Answer accuracy with a fixed reader. Query latency is shown for each memory method.",
    comparisonRule: "Compare memory methods within the same history tier and reader configuration. Small and Medium are separate sets.",
    limitations: ["These are six paper baselines; the public submission leaderboard is still empty.", "This measures memory-system plus reader performance, not a general model ranking.", "Query latency excludes the wider application experience; no comparable dollar costs are published."],
    coverage: "charted" as const, tags: ["memory", "retrieval", "agent memory", "latency", "long context"],
  })),
  {
    id: "longmemeval", name: "LongMemEval", version: "1 · S / M", category: "memory",
    question: "Will it remember changing facts across conversations?",
    summary: "Tests recall, updates, time, reasoning across sessions, and knowing when an answer is absent.",
    source: { name: "LongMemEval authors", url: "https://xiaowu0162.github.io/long-mem-eval/", methodologyUrl: "https://github.com/xiaowu0162/LongMemEval" },
    measure: "Answer accuracy on 500 questions across long conversation histories.",
    comparisonRule: "Keep S and M separate; match reader, judge, retrieval budget, and history construction.",
    limitations: ["Retrieval recall@k is not answer accuracy.", "Vendor memory-system scores often use different readers and judges."], coverage: "source-only", tags: ["memory", "conversation", "personalization", "knowledge updates"],
  },
  {
    id: "locomo", name: "LoCoMo", version: "ACL 2024 · public 10-conversation set", category: "memory",
    question: "Can it recall details from a long-running conversation?",
    summary: "A widely cited test for conversational memory, event summaries, and dialogue continuity.",
    source: { name: "Snap Research / UNC", url: "https://snap-research.github.io/locomo/", methodologyUrl: "https://github.com/snap-research/locomo" },
    measure: "Question-answering and conversation tasks with long, multi-session histories.",
    comparisonRule: "Name the public subset, included question categories, scoring method, reader, and retrieval budget.",
    limitations: ["F1, model-judged correctness, and retrieval recall are different scores.", "The small conversation set and differing category exclusions limit cross-report comparisons."], coverage: "source-only", tags: ["memory", "conversation", "personalization", "retrieval"],
  },
  {
    id: "longbench-v2", name: "LongBench v2", version: "2 · 503 questions", category: "memory",
    question: "Can it reason over a very long document?",
    summary: "Reading comprehension across documents, conversations, code repositories, and structured data.",
    source: { name: "LongBench team", url: "https://longbench2.github.io/", methodologyUrl: "https://github.com/THUDM/LongBench" },
    measure: "Multiple-choice accuracy, with short, medium, and long context breakdowns.",
    comparisonRule: "Match chain-of-thought setting, input truncation, length bucket, and model context limit.",
    limitations: ["Long-context reading does not measure persistent memory between sessions.", "Advertised context capacity does not guarantee useful recall at that length."], coverage: "source-only", tags: ["long context", "documents", "reading", "code understanding"],
  },
  {
    id: "browsecomp", name: "BrowseComp", version: "2025 · 1,266 questions", category: "research",
    question: "Can it find a hard-to-locate fact on the web?",
    summary: "Persistent search and multi-step browsing, scored through short factual answers.",
    source: { name: "OpenAI", url: "https://openai.com/index/browsecomp/", methodologyUrl: "https://github.com/openai/simple-evals" },
    measure: "Accuracy on web questions that require extensive information seeking.",
    comparisonRule: "Match search tools, context management, agent count, and retry policy; label developer-reported scores.",
    limitations: ["It does not directly evaluate the quality of a long research report.", "Live search results and different harnesses make cross-release scores difficult to compare."], coverage: "source-only", tags: ["browsing", "search", "deep research", "facts"],
  },
  {
    id: "browsecomp-plus", name: "BrowseComp-Plus", version: "ACL 2026 · fixed corpus", category: "research",
    question: "How good is the research agent when search access is controlled?",
    summary: "A reproducible information-retrieval setting for difficult research questions.",
    source: { name: "Waterloo / CSIRO / collaborators", url: "https://texttron.github.io/BrowseComp-Plus/", methodologyUrl: "https://github.com/texttron/BrowseComp-Plus" },
    measure: "Answer accuracy and retrieval effectiveness over a released document collection.",
    comparisonRule: "Keep corpus revision, retriever, retrieval budget, and agent configuration fixed.",
    limitations: ["A fixed corpus cannot represent the freshness or changing access conditions of the live web.", "BrowseComp-Plus scores cannot be substituted for BrowseComp scores."], coverage: "source-only", tags: ["retrieval", "search", "deep research", "reproducible"],
  },
  {
    id: "frontiermath", name: "FrontierMath", version: "Tiers 1–3 / Tier 4 · v2", category: "reasoning",
    question: "Can it solve a difficult research-level math problem?",
    summary: "Expert-authored mathematical problems with automatically checkable answers.",
    source: { name: "Epoch AI", url: "https://epoch.ai/frontiermath/tiers-1-4", methodologyUrl: "https://epoch.ai/frontiermath/tiers-1-4/about" },
    measure: "Solved-problem rate under the evaluator's tools and compute budget.",
    comparisonRule: "Keep version, difficulty tier, holdout set, and tool budget explicit.",
    limitations: ["Tier 4 and Tiers 1–3 answer different difficulty questions.", "OpenAI funded the original benchmark and has access to some problems; Epoch describes the held-out subsets."], coverage: "source-only", tags: ["math", "reasoning", "proof", "research"],
  },
  {
    id: "astabench", name: "AstaBench", version: "Scientific research suite", category: "science",
    question: "Can it carry out the steps of scientific research?",
    summary: "Evidence spanning literature work, code execution, data analysis, and discovery.",
    source: { name: "Allen Institute for AI", url: "https://allenai.org/blog/astabench-update-spring-2026", methodologyUrl: "https://github.com/allenai/asta-bench" },
    measure: "Task-specific research outcomes across a suite of scientific evaluations.",
    comparisonRule: "Select a named sub-benchmark and matching tools; retain agent configuration and uncertainty.",
    limitations: ["Not every submitted agent supports every task family.", "A suite average can hide a strong specialty and a missing capability."], coverage: "source-only", tags: ["science", "literature", "data analysis", "discovery", "research"],
  },
  {
    id: "scicode", name: "SciCode", version: "2024 · main problems", category: "science",
    question: "Can it translate scientific knowledge into working code?",
    summary: "Coding problems drawn from numerical methods, simulations, and scientific calculations.",
    source: { name: "SciCode authors", url: "https://scicode-bench.github.io/", methodologyUrl: "https://github.com/scicode-bench/SciCode" },
    measure: "Main-problem or subproblem correctness against scientific test cases.",
    comparisonRule: "Keep background-information setting, subproblem assistance, and model-generated versus gold earlier steps separate.",
    limitations: ["An assisted subproblem score is not an end-to-end scientific workflow score.", "This adds more value inside the science category than as another homepage coding total."], coverage: "source-only", tags: ["science", "coding", "physics", "simulation"],
  },
  {
    id: "critpt", name: "CritPt", version: "Research-level physics", category: "science",
    question: "Can it reason through an unfamiliar physics research problem?",
    summary: "Challenging physics tasks that test reasoning beyond standard academic exams.",
    source: { name: "Artificial Analysis / CritPt authors", url: "https://artificialanalysis.ai/evaluations/critpt", methodologyUrl: "https://artificialanalysis.ai/methodology/intelligence-benchmarking" },
    measure: "Accuracy on the evaluator's research-level physics problems.",
    comparisonRule: "Keep the evaluation revision, tools, reasoning budget, and grading protocol fixed.",
    limitations: ["A specialist physics score should not stand in for general scientific usefulness.", "Difficulty and domain coverage differ from HLE and Terminal-Bench-Science."], coverage: "source-only", tags: ["science", "physics", "reasoning", "research"],
  },
  {
    id: "livebench", name: "LiveBench", version: "2026-06-25", category: "general",
    question: "How does it handle fresh, objectively scored tasks?",
    summary: "A periodically refreshed collection covering reasoning, language, data, instruction following, and coding.",
    source: { name: "LiveBench team", url: "https://livebench.ai/", methodologyUrl: "https://github.com/LiveBench/LiveBench" },
    measure: "Objective task scores and category results on a named release.",
    comparisonRule: "Compare only the same release and task categories; refreshes change the exam.",
    limitations: ["Its broad score overlaps with other general-purpose indices.", "Freshness reduces contamination risk; it does not establish its absence."], coverage: "source-only", tags: ["general", "reasoning", "instruction following", "language", "data analysis"],
  },
  {
    id: "livecodebench", name: "LiveCodeBench", version: "Release v6 · dated windows", category: "coding",
    question: "Can it solve a new programming problem?",
    summary: "Competitive-programming problems published over time, with executable tests.",
    source: { name: "LiveCodeBench authors", url: "https://livecodebench.github.io/", methodologyUrl: "https://github.com/LiveCodeBench/LiveCodeBench" },
    measure: "Code-generation correctness on a specified problem-date window and scenario.",
    comparisonRule: "Match release, start/end dates, scenario, sampling count, and execution budget.",
    limitations: ["Algorithmic problem solving does not establish repository-editing skill.", "Different date windows are different cohorts, even if both are called v6."], coverage: "source-only", tags: ["coding", "algorithms", "competitive programming", "fresh tasks"],
  },
  {
    id: "humanitys-last-exam", name: "Humanity’s Last Exam", version: "Classic · 2025-04-03 final set", category: "general",
    question: "Can it answer difficult questions across expert fields?",
    summary: "An academic breadth check spanning mathematics, science, and the humanities, with text and image questions.",
    source: { name: "Center for AI Safety / Scale AI", url: "https://www.lastexam.ai/", methodologyUrl: "https://huggingface.co/datasets/cais/hle" },
    measure: "Answer accuracy on the finalized 2,500-question classic set; calibration is a separate measure.",
    comparisonRule: "Pin the dataset revision, full versus text-only set, tools, reasoning effort, and answer judge. HLE-Rolling is a different exam.",
    limitations: ["Closed-ended expert questions do not measure open-ended discovery or professional work.", "Tool-assisted and no-tool scores cannot be pooled.", "The dataset is gated; this guide links to it without redistributing its questions."], coverage: "source-only", tags: ["HLE", "knowledge", "academic", "reasoning", "multimodal", "science"],
  },
  {
    id: "gpqa-diamond", name: "GPQA Diamond", version: "Diamond · 198 questions", category: "science",
    question: "Can it reason through an expert science question?",
    summary: "A compact multiple-choice test in biology, chemistry, and physics, selected through expert and non-expert review.",
    source: { name: "GPQA authors", url: "https://github.com/idavidrein/gpqa", methodologyUrl: "https://arxiv.org/html/2311.12022v1" },
    measure: "Multiple-choice answer accuracy on the 198-question Diamond subset; random choice has a 25% baseline.",
    comparisonRule: "Keep Diamond separate from Main and Extended. Match prompts, answer shuffling, tools, reasoning budget, and sampling policy.",
    limitations: ["A small fixed exam does not establish scientific discovery or laboratory competence.", "Near-ceiling scores and small gaps require uncertainty, not a confident rank order.", "Best-of-many success is not single-attempt accuracy."], coverage: "source-only", tags: ["GPQA", "science", "physics", "chemistry", "biology", "reasoning"],
  },
  {
    id: "swe-bench-verified", name: "SWE-bench Verified", version: "Verified · 500 tasks", category: "coding",
    question: "Can it repair an issue in an existing repository?",
    summary: "Real repository issues with executable tests, useful for understanding a coding agent's patching ability.",
    source: { name: "SWE-bench team", url: "https://www.swebench.com/", methodologyUrl: "https://www.swebench.com/verified.html" },
    measure: "Percentage of the 500 human-filtered task instances resolved.",
    comparisonRule: "Use one task revision, agent, budget, and attempt policy. The Bash Only view controls the agent; the full board mixes systems.",
    limitations: ["mini-SWE-agent 1.x and 2.x change action handling and sampling and are not automatically comparable.", "Public task exposure and test quality limit conclusions about new, unseen work.", "A repair score does not measure an entire software development workflow."], coverage: "source-only", tags: ["SWE-bench", "coding", "repository", "bug fixing", "agent", "software engineering"],
  },
  {
    id: "swe-bench-pro", name: "SWE-bench Pro", version: "Public · 731 tasks", category: "coding",
    question: "Can it make a larger change in a complex codebase?",
    summary: "Longer software-engineering tasks across public application and developer-tool repositories.",
    source: { name: "Scale AI", url: "https://labs.scale.com/leaderboard/swe_bench_pro_public", methodologyUrl: "https://github.com/scaleapi/SWE-bench_Pro-os" },
    measure: "Resolve rate: the percentage of public tasks whose patches pass the required new and regression tests.",
    comparisonRule: "Keep Public, Private, and Held-out sets separate. Match dataset revision, agent harness, turn limit, cost cap, and attempts.",
    limitations: ["The owner board mixes harnesses and capped versus uncapped runs; its rows are not one controlled cohort.", "Public repository licensing is not evidence that models have never seen the code.", "Task-quality disputes make this supporting evidence, not a universal replacement for Verified or Terminal-Bench."], coverage: "source-only", tags: ["SWE-bench Pro", "coding", "repository", "long horizon", "software engineering"],
  },
  {
    id: "cursorbench", name: "CursorBench", version: "3.2", category: "coding",
    question: "Which model handles the kind of work done inside Cursor?",
    summary: "Ambiguous multi-file tasks drawn from Cursor usage, including instruction following and advanced tool use.",
    source: { name: "Cursor · vendor-reported", url: "https://cursor.com/cursorbench", methodologyUrl: "https://cursor.com/blog/cursorbench" },
    measure: "Cursor's task-correctness score in percent, alongside average API-priced cost per task, tokens, and steps.",
    comparisonRule: "Compare only version 3.2 with its Cursor agent setup and exact model effort. Preserve the pricing revision for cost comparisons.",
    limitations: ["This is a vendor-owned internal evaluation, not an independent cross-product ranking.", "Private tasks and agentic grading limit external reproduction.", "The task set changed from 3.1; small score gaps may reflect evaluation variance."], coverage: "source-only", tags: ["CursorBench", "coding", "Cursor", "production", "multi-file", "agent", "cost"],
  },
  {
    id: "gdpval", name: "GDPval", version: "2025 · original evaluation", category: "work",
    question: "Can it deliver work an experienced professional would accept?",
    summary: "Occupational tasks with reference files and finished deliverables, including documents, presentations, and spreadsheets.",
    source: { name: "OpenAI", url: "https://openai.com/index/gdpval/", methodologyUrl: "https://huggingface.co/datasets/openai/gdpval" },
    measure: "Quality of completed work compared with expert deliverables across 44 occupations; the public gold set contains 220 tasks.",
    comparisonRule: "Name the full or gold task set, grading protocol, scaffolding, and whether ties count toward the reported win rate.",
    limitations: ["The original evaluation and Artificial Analysis's GDPval-AA use different evaluation protocols.", "Producing one deliverable is not the same as doing an entire job or handling its organizational context.", "Developer-reported results need to retain their exact human or model-judge protocol."], coverage: "source-only", tags: ["professional work", "documents", "spreadsheets", "presentations", "knowledge work", "deliverables"],
  },
  {
    id: "gdpval-aa", name: "GDPval-AA", version: "v2", category: "work",
    question: "Which tool-using model produces the strongest professional deliverable?",
    summary: "Artificial Analysis evaluates GDPval work products in its Stirrup agent environment, then compares the outputs head to head.",
    source: { name: "Artificial Analysis", url: "https://artificialanalysis.ai/evaluations/gdpval-aa", methodologyUrl: "https://artificialanalysis.ai/methodology/intelligence-benchmarking" },
    measure: "Pairwise Elo rating anchored to a human-expert baseline of 1,000, with source-reported uncertainty.",
    comparisonRule: "Keep v2, the Stirrup environment, reasoning effort, judge panel, and rating pool together. Elo is not percent correct.",
    limitations: ["The v2 environment, turn limit, and panel of judges differ from v1.", "Model-judged preferences are not a direct measurement of business value or worker replacement.", "Per-task cost must not be mixed with full-evaluation spend."], coverage: "source-only", tags: ["professional work", "office", "deliverables", "Elo", "cost", "agents"],
  },
  {
    id: "osworld-v2", name: "OSWorld 2.0", version: "osworld-v2-2026.08.08", category: "computer-use",
    question: "Can an agent finish a workflow across desktop and web apps?",
    summary: "Long computer-use tasks with verifiable outcomes, not just recognizing a button in a screenshot.",
    source: { name: "OSWorld / XLang Lab", url: "https://osworld-v2.xlang.ai/", methodologyUrl: "https://github.com/xlang-ai/OSWorld-V2/blob/v2026.08.08/benchmark_releases/osworld-v2-2026.08.08.json" },
    measure: "Task completion and partial reward across the pinned 108-workflow release, reported separately.",
    comparisonRule: "Pin code, tasks, assets, website, provider image, step budget, and input/action interface before comparing systems.",
    limitations: ["OSWorld-Verified and OSWorld 2.0 are different task cohorts.", "Partial progress is not a completed workflow.", "Gated environment assets and long runs affect reproducibility; the release manifest identifies the required versions."], coverage: "source-only", tags: ["computer use", "desktop", "browser", "GUI", "workflow", "agents"],
  },
  {
    id: "tau-bench-3", name: "τ³-bench", version: "3 · v1.0.1 grading", category: "work",
    question: "Can a service agent solve the issue while following policy?",
    summary: "Simulated customer-service conversations combine tool actions, user coordination, and domain rules; newer tracks add knowledge retrieval and voice.",
    source: { name: "Sierra Research", url: "https://taubench.com/", methodologyUrl: "https://github.com/sierra-research/tau2-bench" },
    measure: "Task success and repeated-trial reliability within a named domain and communication mode.",
    comparisonRule: "Match domain, task split, user simulator, trials, and text or voice mode. pass^k consistency is not pass@k best-of-k success.",
    limitations: ["The repository retains the tau2-bench name while the current suite is τ³-bench.", "Banking-knowledge results before v1.0.1 are not comparable with the corrected grading.", "Simulated service interactions do not cover every live customer or organizational policy."], coverage: "source-only", tags: ["customer service", "tool use", "policy", "reliability", "voice", "tau-bench", "tau2", "knowledge retrieval"],
  },
] as const satisfies readonly BenchmarkAtlasEntry[];

function sourceMetadata(source: typeof snapshot.arc2.source, name: string) {
  return { name, url: source.url, retrievedAt: source.retrievedAt, revision: source.revision ?? `SHA-256 ${source.sha256}` };
}

function arcDataset(key: "arc2" | "arc3Standard" | "arc3Adapter", benchmarkId: string, version: string, harness: string): BenchmarkAtlasDataset {
  const section = snapshot[key];
  return {
    benchmarkId, version,
    score: { label: key === "arc2" ? "Tasks solved" : "Action-efficiency score", unit: "%", direction: "higher", minimum: 0, maximum: 100 },
    source: sourceMetadata(section.source, "ARC Prize · selected published observations"),
    ...(section.source.observedAt ? { observedAt: section.source.observedAt } : {}),
    evidenceLabel: "Benchmark-owner results · selected cohort",
    configurationLabel: key === "arc3Adapter" ? "Astra effort settings · Provider Adapter" : "Model and reasoning effort",
    comparabilityNote: key === "arc2" ? "Semi-private set. Seven selected recent model families; cost is unpublished for these configurations." : `${harness} only. Dollar values cover the full evaluation. Harness cohorts are shown separately.`,
    ...(key === "arc2" ? {} : { costLabel: "Total evaluation cost (USD)" }),
    points: section.rows.map(row => ({ ...row, harness, uncertainty: null })),
  };
}

const researchDataset: BenchmarkAtlasDataset = {
  benchmarkId: "deepresearch-bench-ii", version: "II · 132 tasks",
  score: { label: "Weighted rubric score", unit: "%", direction: "higher", minimum: 0, maximum: 100 },
  source: sourceMetadata(snapshot.deepResearch.source, "USTC / Metastone · selected published observations"),
  evidenceLabel: "Benchmark-owner table · mixed historical product versions",
  configurationLabel: "Research product as named by the source",
  comparabilityNote: "Nine selected systems. The table includes older products; run dates, exact model versions, costs, and confidence intervals are not consistently supplied.",
  points: snapshot.deepResearch.rows.map(row => ({
    id: row.id, label: row.label, model: row.label, provider: row.provider,
    harness: "Research product's own agent", effort: null, score: row.total, costUsd: null,
    uncertainty: null, sourceUrl: researchSource.url,
    details: [
      { label: "Information recall", value: `${row.recall}%` },
      { label: "Analysis", value: `${row.analysis}%` },
      { label: "Presentation", value: `${row.presentation}%` },
      { label: "Run date", value: "Not consistently published" },
    ],
  })),
};

function memoryDataset(tier: "small" | "medium"): BenchmarkAtlasDataset {
  const points: readonly BenchmarkAtlasPoint[] = snapshot.memory.rows.map(row => ({
    id: row.id, label: `${row.label} · Qwen3.5-9B reader`, model: row.label, provider: "UCLA paper baselines",
    harness: "Qwen3.5-9B reader", effort: null,
    score: tier === "small" ? row.smallAccuracy : row.mediumAccuracy,
    costUsd: null, uncertainty: null, sourceUrl: memorySource.url,
    details: [
      { label: "Query latency", value: `${tier === "small" ? row.smallLatencySeconds : row.mediumLatencySeconds} seconds` },
      { label: "Method family", value: row.family },
      { label: "Reader", value: "Qwen3.5-9B (fixed)" },
      { label: "Reference code configuration", value: row.family === "Coding agent" ? "Codex 0.117.0 · GPT-5.4-mini · xhigh" : "See source for memory configuration" },
      { label: "Cohort", value: `${tier} · published paper baselines` },
    ],
  }));
  return {
    benchmarkId: `longmemeval-v2-${tier}`, version: `2 · ${tier} · paper baselines`,
    score: { label: "Answer accuracy", unit: "%", direction: "higher", minimum: 0, maximum: 100 },
    source: sourceMetadata(snapshot.memory.source, "UCLA LongMemEval-V2 paper baselines"),
    evidenceLabel: "Paper baselines · community submissions pending",
    configurationLabel: "Memory method with a fixed reader",
    comparabilityNote: `${tier === "small" ? "Small" : "Medium"} history tier only. This compares six memory methods, not six foundation models. Latency is in the inspector; dollar cost is not published.`,
    points,
  };
}

export const REASONING_ATLAS_DATASETS: readonly BenchmarkAtlasDataset[] = [
  arcDataset("arc2", "arc-agi-2", "2 · semi-private", "ARC Prize reasoning evaluation"),
  arcDataset("arc3Standard", "arc-agi-3-standard", "3 · semi-private · Standard", "Standard harness"),
  arcDataset("arc3Adapter", "arc-agi-3-adapter", "3 · semi-private · Provider Adapter", "Provider Adapter harness"),
  researchDataset,
  memoryDataset("small"),
  memoryDataset("medium"),
];
