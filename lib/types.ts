export type ProviderId = "anthropic" | "openai" | "google";

export type BenchmarkId = "coding" | "terminalBench4" | "frontierCode2" | "intelligence";

export type BudgetAxis = "cost" | "tokens";

export type ContextMode = "release" | "live";

export type EffortSlug = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export type BenchmarkScores = Readonly<{
  coding: number;
  terminalBench4: number;
  frontierCode2: number;
  intelligence: number;
}>;

export type CostBreakdown = Readonly<{
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
}>;

export type TokenBreakdown = Readonly<{
  total: number;
  reasoning: number;
  answer: number;
}>;

export type CliHarnessEval = Readonly<{
  harness: string;
  codingAgentScore: number;
  costUsdPerTask: number;
  frontierCode2: number;
  sweAtlas: number;
  terminalBench4: number;
}>;

export type EffortPoint = Readonly<{
  id: string;
  slug: string;
  effortSlug: EffortSlug;
  effortLabel: string;
  shortTag: string;
  effortLevel: number;
  isDefaultEffort: boolean;
  scores: BenchmarkScores;
  costUsdPerTask: CostBreakdown;
  tokensPerTask: TokenBreakdown;
  speedTokPerSec: number | null;
  cliEval: CliHarnessEval | null;
}>;

export type HarborBenchEval = Readonly<{
  agent: string;
  effort: string;
  accuracy: number;
  totalCostUsd: number;
  costPerTrialUsd: number;
}>;

export type ModelPricing = Readonly<{
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M: number | null;
  contextWindowTokens: number;
}>;

export type ModelRelease = Readonly<{
  slug: string;
  name: string;
  provider: ProviderId;
  releaseDate: string;
  deprecated: boolean;
  supersededOn: string | null;
  pricing: ModelPricing;
  summary: string;
  announcementUrl: string;
  benchmarkUrl: string;
  harborEval: HarborBenchEval | null;
  efforts: readonly EffortPoint[];
}>;

export type ReleaseDataset = Readonly<{
  schemaVersion: 1;
  updatedAt: string;
  snapshotDate: string;
  sources: readonly {
    id: string;
    name: string;
    url: string;
    note: string;
  }[];
  releases: readonly ModelRelease[];
}>;

export type BenchmarkMeta = Readonly<{
  id: BenchmarkId;
  label: string;
  shortLabel: string;
  fullLabel: string;
  unit: "%" | "pts";
  description: string;
}>;

export const BENCHMARKS: readonly BenchmarkMeta[] = [
  {
    id: "coding",
    label: "Coding",
    shortLabel: "Coding",
    fullLabel: "Normalized Coding Composite",
    unit: "%",
    description: "50/50 mean of FrontierCode 2.0 (repo SWE) and Terminal-Bench 4.0 (agentic CLI).",
  },
  {
    id: "terminalBench4",
    label: "Terminal-Bench",
    shortLabel: "Terminal",
    fullLabel: "Terminal-Bench 4.0",
    unit: "%",
    description: "Autonomous terminal & CLI software engineering pass rate.",
  },
  {
    id: "frontierCode2",
    label: "FrontierCode",
    shortLabel: "FrontierCode",
    fullLabel: "FrontierCode-AA 2.0",
    unit: "%",
    description: "Multi-file repository coding & bug-resolution pass rate.",
  },
  {
    id: "intelligence",
    label: "Intelligence",
    shortLabel: "Intelligence",
    fullLabel: "Artificial Analysis Intelligence Index v5.0.1",
    unit: "pts",
    description: "9-benchmark reasoning, coding, scientific, and agentic index.",
  },
] as const;

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
