import { GAME_BENCH, TERMINAL_BENCH, type SnapshotBenchmarkId } from "./types";

export type CurveBenchmarkId = SnapshotBenchmarkId | "game-bench";
export type ChartBenchmark = CurveBenchmarkId | "terminal-bench";

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

export type BenchmarkSources = Readonly<Record<SnapshotBenchmarkId, Readonly<{
  label: string;
  url: string;
  date: string;
  credit?: string;
  referenceLabel: string;
  referenceUrl: string;
}>>>;
