export type ProviderId = "anthropic" | "openai" | "google";

export type BudgetAxis = "cost" | "tokens";

export type ContextMode = "release" | "live";

export type EffortSlug = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type SnapshotBenchmarkId = "argo-bench" | "roboflow" | "ironbee";
export type CurveEffort = EffortSlug | "default";

/** One published setting on a benchmark's fixed set of tasks. */
export type BenchmarkEffortRun = Readonly<{
  effort: CurveEffort;
  score: number;
  costUsd: number;
  outputTokens: number | null;
}>;

export type BenchmarkSnapshot = Readonly<{
  snapshotDate: string;
  sourceUrl: string;
  runs: Readonly<Partial<Record<string, readonly BenchmarkEffortRun[]>>>;
}>;

/** One costed reasoning setting on DuelLab's GameBench 2 leaderboard. */
export type GameBenchRun = Readonly<{
  effort: EffortSlug;
  /** Relative game-playing strength of generated programs, 0–100. */
  score: number;
  /** DuelLab's mean API cost to generate a player program for one game. */
  costPerProgramUsd: number;
  costBasis: string;
}>;

/**
 * One run on the official Terminal-Bench leaderboard: a coding agent driving
 * the model through every task, five trials (attempts) per task.
 */
export type TerminalBenchRun = Readonly<{
  /** Dataset version the trials were graded on, such as "4.1". 4.1 changed the checks on every task. */
  version: string;
  /** The agent as Terminal-Bench names it, such as "Claude Code" or "Codex". */
  agent: string;
  agentVersion: string | null;
  agentUrl: string | null;
  effort: EffortSlug | null;
  /** Percent of trials passed. */
  accuracy: number;
  /** Half width of the 95% confidence interval, in points. */
  ci95: number | null;
  trials: number;
  successes: number;
  /** The run's API bill divided by its trials; null when the run reported no cost. */
  costPerTaskUsd: number | null;
  /** Tokens per trial: everything, and the output alone. */
  tokensPerTask: Readonly<{ total: number; output: number }>;
  /** Average wall-clock minutes per trial; null when unknown. */
  minutesPerTask: number | null;
  /** The submission file on GitHub. */
  sourceUrl: string;
}>;

export type EpochBenchmarkId = "mirrorCode" | "gpqaDiamond" | "frontierMath";

/** One Epoch AI benchmark result for a model at one reasoning setting. */
export type EpochScore = Readonly<{
  benchmark: EpochBenchmarkId;
  /** Null when Epoch ran the model at its default setting or did not record one. */
  effort: EffortSlug | null;
  /** Percent, 0–100. */
  score: number;
  /** Standard error, in points. */
  stderr: number | null;
  /** The day Epoch started the run. */
  runOn: string | null;
}>;

export type ModelPricing = Readonly<{
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M: number | null;
  maxInputTokens: number | null;
}>;

export type ModelRelease = Readonly<{
  slug: string;
  name: string;
  provider: ProviderId;
  releaseDate: string;
  deprecated: boolean;
  supersededOn: string | null;
  /** The lab's launch post or model page; null when no source links one. */
  announcementUrl: string | null;
  /** List API prices from LiteLLM; null when it does not list the model. */
  pricing: ModelPricing | null;
  /** The model's Terminal-Bench run; null when it has none on the leaderboard. */
  terminalBench: TerminalBenchRun | null;
  epoch: readonly EpochScore[];
  /** Published reasoning settings with scores and costs for all eight games. */
  gameBench?: readonly GameBenchRun[];
  /** Additional snapshots used by the home explorer. */
  benchmarkRuns?: Readonly<Partial<Record<SnapshotBenchmarkId, readonly BenchmarkEffortRun[]>>>;
}>;

export type DataSourceId = "terminal-bench" | "epoch-ai" | "litellm" | "gamebench-2";

export type DataSource = Readonly<{
  id: DataSourceId;
  name: string;
  url: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  covers: string;
}>;

export type ReleaseDataset = Readonly<{
  schemaVersion: 2;
  updatedAt: string;
  snapshotDate: string;
  sources: readonly DataSource[];
  releases: readonly ModelRelease[];
}>;

export const GAME_BENCH = {
  label: "GameBench 2",
  tasks: 8,
  methodologyUrl: "https://benchmarks.duellab.org/methodology",
  releasesUrl: "https://benchmarks.duellab.org/releases/",
  description:
    "Models write programs for eight strategy games. DuelLab scores the programs on a 0–100 scale against a shared field of opponents.",
} as const;

export const TERMINAL_BENCH = {
  label: "Terminal-Bench",
  /** Tasks in the full dataset; 4.1 added and removed none. */
  tasks: 66,
  url: "https://tbench.ai",
  repoUrl: "https://github.com/harbor-framework/terminal-bench",
  releaseNotesUrl: "https://github.com/harbor-framework/terminal-bench/releases/tag/v4.1.0",
  description:
    "Hard, realistic tasks done in a terminal, from building software to science and data work. Each run is a coding agent driving the model, five attempts per task.",
} as const;

export type EpochBenchmarkMeta = Readonly<{
  id: EpochBenchmarkId;
  label: string;
  description: string;
  url: string;
}>;

export const EPOCH_BENCHMARKS: readonly EpochBenchmarkMeta[] = [
  {
    id: "mirrorCode",
    label: "MirrorCode",
    description:
      "A long-horizon coding benchmark. Models reimplement entire programs end-to-end, without access to the original source code.",
    url: "https://epoch.ai/benchmarks/mirrorcode",
  },
  {
    id: "gpqaDiamond",
    label: "GPQA Diamond",
    description:
      "A challenging multiple-choice question set in biology, chemistry, and physics, authored by PhD-level experts.",
    url: "https://epoch.ai/benchmarks/gpqa-diamond",
  },
  {
    id: "frontierMath",
    label: "FrontierMath Tiers 1–3",
    description:
      "Unpublished math problems written by expert mathematicians: Tiers 1 to 3 of FrontierMath, a set Epoch keeps private.",
    url: "https://epoch.ai/benchmarks/frontiermath-tiers-1-3-v2",
  },
];

export const EPOCH_BENCHMARKS_URL = "https://epoch.ai/benchmarks";

export const PROVIDERS: Readonly<
  Record<
    ProviderId,
    Readonly<{
      id: ProviderId;
      name: string;
      shortName: string;
      harness: string;
      url: string;
    }>
  >
> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    shortName: "Anthropic",
    harness: "Claude Code",
    url: "https://www.anthropic.com",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    shortName: "OpenAI",
    harness: "Codex",
    url: "https://openai.com",
  },
  google: {
    id: "google",
    name: "Google",
    shortName: "Google",
    harness: "Antigravity CLI",
    url: "https://deepmind.google",
  },
};
