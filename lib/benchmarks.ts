import type { BenchmarkChoice } from "./benchmark-search";
import { EPOCH_BENCHMARKS, GAME_BENCH, TERMINAL_BENCH, type EpochBenchmarkId, type SnapshotBenchmarkId } from "./types";

export type CurveBenchmarkId = SnapshotBenchmarkId | "game-bench";
export type ChartBenchmark = CurveBenchmarkId | "terminal-bench";
export type BenchmarkId = ChartBenchmark | EpochBenchmarkId;

type ChartBenchmarkMeta = Readonly<{
  label: string;
  description: string;
  scoreUnit: "pts" | "%";
  scoreLabel: string;
  costLabel: string;
  workload: string;
  tokens: boolean;
}>;

export const CHART_BENCHMARKS: Readonly<Record<ChartBenchmark, ChartBenchmarkMeta>> = {
  "argo-bench": {
    label: "Argo-Bench",
    description:
      "TextQL tests data agents on 210 enterprise tasks across finance, accounting, operations and growth. Costs cover model API calls. Each line connects one model’s tested settings.",
    scoreUnit: "pts",
    scoreLabel: "Score / 100",
    costLabel: "API cost",
    workload: "task",
    tokens: true,
  },
  "game-bench": {
    label: GAME_BENCH.label,
    description: GAME_BENCH.description,
    scoreUnit: "pts",
    scoreLabel: "Score / 100",
    costLabel: "Estimated cost",
    workload: "program",
    tokens: false,
  },
  "terminal-bench": {
    label: TERMINAL_BENCH.label,
    description: TERMINAL_BENCH.description,
    scoreUnit: "%",
    scoreLabel: "Passed trials",
    costLabel: "Cost",
    workload: "task",
    tokens: true,
  },
  roboflow: {
    label: "Roboflow Visual Reasoning",
    description:
      "Roboflow grades 151 visual reasoning questions with a model judge and estimates API cost from usage. Gemini 4 Argon and Carbon used early-access endpoints.",
    scoreUnit: "%",
    scoreLabel: "Judged accuracy",
    costLabel: "Estimated cost",
    workload: "sample",
    tokens: true,
  },
  ironbee: {
    label: "IronBee Code Review",
    description:
      "Models review 50 real pull requests, three runs per setting. F₂ weights recall more heavily than precision. Costs use uncached API rates.",
    scoreUnit: "pts",
    scoreLabel: "F₂ / 100",
    costLabel: "Estimated cost",
    workload: "PR",
    tokens: true,
  },
};

const PICKER_COPY: Record<BenchmarkId, Pick<BenchmarkChoice, "summary" | "keywords">> = {
  "argo-bench": {
    summary: "Data agents on 210 enterprise tasks, from forecasting to accounting.",
    keywords: ["TextQL", "enterprise data science", "finance", "SQL", "business analytics"],
  },
  "game-bench": {
    summary: "Write programs that compete in eight strategy games.",
    keywords: ["DuelLab", "GameBench 2", "game playing", "code generation"],
  },
  "terminal-bench": {
    summary: "Coding agents on 66 terminal tasks across software, science, and data.",
    keywords: ["CLI", "shell", "agentic coding", "Harbor"],
  },
  roboflow: {
    summary: "Answer 151 image-based visual reasoning questions.",
    keywords: ["computer vision", "multimodal", "image understanding", "VQA"],
  },
  ironbee: {
    summary: "Find issues in 50 real pull requests.",
    keywords: ["code review", "PR", "GitHub", "bug finding", "F2"],
  },
  mirrorCode: {
    summary: "Rebuild complete software packages from their behavior.",
    keywords: ["Epoch AI", "coding", "reimplementation", "long horizon"],
  },
  gpqaDiamond: {
    summary: "Answer graduate-level questions in biology, chemistry, and physics.",
    keywords: ["Epoch AI", "science", "multiple choice", "PhD"],
  },
  frontierMath: {
    summary: "Solve unpublished math problems written by expert mathematicians.",
    keywords: ["Epoch AI", "mathematics", "competition math", "proofs"],
  },
};

const PICKER_LABELS: readonly Pick<BenchmarkChoice<BenchmarkId>, "id" | "label">[] = [
  ...Object.entries(CHART_BENCHMARKS).map(([id, { label }]) => ({ id: id as ChartBenchmark, label })),
  ...EPOCH_BENCHMARKS,
];

export const BENCHMARK_CHOICES: readonly BenchmarkChoice<BenchmarkId>[] = PICKER_LABELS
  .map(({ id, label }) => ({ id, label, ...PICKER_COPY[id] }));

export type BenchmarkSources = Readonly<Record<SnapshotBenchmarkId, Readonly<{
  label: string;
  url: string;
  date: string;
  credit?: string;
  referenceLabel: string;
  referenceUrl: string;
}>>>;
