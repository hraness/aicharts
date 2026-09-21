import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "@/lib/coding-agent-data";
import { codingAgentDatasetModifiedAt } from "@/lib/coding-agent-dataset";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
import { spellCount } from "./real-swe-private-enterprise-benchmark-article";
import {
  TERMINAL_BENCH_TASK_COUNT,
  TERMINAL_BENCH_TRIALS_PER_TASK,
  TERMINAL_BENCH_VERSION,
} from "@/lib/terminal-bench-data";

import {
  BLOG_AUTHORSHIP_DISCLOSURE,
  BLOG_SOURCES,
  callout,
  heading,
  list,
  paragraph,
  table,
  type BlogArticle,
  type InlineContent,
} from "./articles";

export const HARNESS_DESIGN_ARTICLE_SLUG = "harness-design-coding-agents" as const;
export const HARNESS_DESIGN_ARTICLE_PUBLISHED_AT = "2026-09-21" as const;

export type HarnessDesignModel =
  | "Nemotron-3 30B"
  | "Nemotron-3 120B"
  | "Nemotron-3 550B"
  | "Mistral-Medium-3.5-128B";
export type HarnessDesignBenchmark = "SWE-Bench Verified" | "Terminal-Bench 2.1";
export type HarnessDesignBudget = 32 | 64 | 96 | 128;
export type HarnessDesignTier = "T0" | "T1" | "T2" | "T3" | "T4";
export type HarnessDesignManagedTier = Exclude<HarnessDesignTier, "T0">;
export type HarnessDesignAblation = "without planning" | "bash only";

export const HARNESS_DESIGN_MODELS = [
  "Nemotron-3 30B",
  "Nemotron-3 120B",
  "Nemotron-3 550B",
  "Mistral-Medium-3.5-128B",
] as const satisfies readonly HarnessDesignModel[];

export const HARNESS_DESIGN_BENCHMARKS = [
  "SWE-Bench Verified",
  "Terminal-Bench 2.1",
] as const satisfies readonly HarnessDesignBenchmark[];

export const HARNESS_DESIGN_BUDGETS = [32, 64, 96, 128] as const satisfies readonly HarnessDesignBudget[];

export const HARNESS_DESIGN_TIERS = ["T0", "T1", "T2", "T3", "T4"] as const satisfies readonly HarnessDesignTier[];

export const HARNESS_DESIGN_MANAGED_TIERS = ["T1", "T2", "T3", "T4"] as const satisfies readonly HarnessDesignManagedTier[];

export const HARNESS_DESIGN_ABLATIONS = [
  "without planning",
  "bash only",
] as const satisfies readonly HarnessDesignAblation[];

/**
 * One printed cell: success rate in percent, mean cost per task in dollars,
 * and whether the paper marks the cell as significantly different from its
 * matched baseline (two-sided exact McNemar test, Benjamini–Hochberg q < 0.05).
 */
export type HarnessDesignMeasure = Readonly<{
  costUsd: number;
  significant: boolean;
  successPercent: number;
}>;

/** Compact literal form: `[success %, cost $]` or `[success %, cost $, true]` when starred. */
type MeasureLiteral = readonly [number, number] | readonly [number, number, true];

/** Four measures in `HARNESS_DESIGN_MODELS` order. */
type ModelRow = readonly [MeasureLiteral, MeasureLiteral, MeasureLiteral, MeasureLiteral];

type TierTable = Readonly<Record<HarnessDesignBudget, Readonly<Record<HarnessDesignTier, ModelRow>>>>;
type AblationTable = Readonly<Record<HarnessDesignAblation, ModelRow>>;

const SIG = true;

/**
 * Table 3 of the paper: SWE-Bench Verified success rate (%) and mean cost per
 * task ($) for every context-management tier and window budget, with the
 * planning and action-space ablations at the 128k/T4 baseline.
 */
const SWE_TIER_ROWS: TierTable = {
  32: {
    T0: [[9.4, 0.04], [11.4, 0.05], [6.4, 0.26], [12.6, 0.87]],
    T1: [[20.6, 0.09, SIG], [43.0, 0.35, SIG], [51.4, 2.57, SIG], [64.4, 2.16, SIG]],
    T2: [[20.8, 0.09, SIG], [42.2, 0.36, SIG], [53.6, 2.70, SIG], [66.2, 2.12, SIG]],
    T3: [[23.8, 0.11, SIG], [39.6, 0.18, SIG], [58.4, 1.25, SIG], [63.2, 2.52, SIG]],
    T4: [[21.2, 0.11, SIG], [42.2, 0.17, SIG], [55.6, 1.45, SIG], [63.8, 2.04, SIG]],
  },
  64: {
    T0: [[20.8, 0.07], [34.0, 0.10], [29.4, 0.97], [52.8, 2.47]],
    T1: [[23.4, 0.09], [45.4, 0.39, SIG], [63.8, 2.22, SIG], [69.0, 2.65, SIG]],
    T2: [[24.4, 0.09], [43.2, 0.32, SIG], [64.6, 2.17, SIG], [67.8, 2.61, SIG]],
    T3: [[26.4, 0.10, SIG], [43.6, 0.23, SIG], [65.8, 1.78, SIG], [68.4, 2.66, SIG]],
    T4: [[25.8, 0.08, SIG], [41.8, 0.21, SIG], [63.4, 1.78, SIG], [66.0, 2.48, SIG]],
  },
  96: {
    T0: [[24.0, 0.09], [39.6, 0.20], [51.0, 1.60], [66.2, 3.01]],
    T1: [[23.2, 0.09], [43.2, 0.33], [65.0, 2.25, SIG], [68.8, 3.13]],
    T2: [[23.6, 0.09], [45.4, 0.37, SIG], [67.2, 2.33, SIG], [66.2, 3.15]],
    T3: [[23.6, 0.09], [46.2, 0.36, SIG], [66.8, 2.32, SIG], [67.6, 3.12]],
    T4: [[24.8, 0.09], [43.4, 0.30], [66.8, 1.97, SIG], [68.6, 2.85]],
  },
  128: {
    T0: [[24.8, 0.09], [40.2, 0.25], [59.8, 2.08], [67.4, 3.27]],
    T1: [[25.0, 0.10], [44.4, 0.39], [65.2, 2.47, SIG], [68.6, 3.25]],
    T2: [[26.0, 0.10], [45.2, 0.35, SIG], [67.4, 2.64, SIG], [67.0, 3.10]],
    T3: [[23.6, 0.11], [44.0, 0.35], [65.8, 2.54, SIG], [66.6, 3.26]],
    T4: [[25.2, 0.09], [44.0, 0.34], [65.8, 2.33, SIG], [68.6, 3.14]],
  },
};

const SWE_ABLATION_ROWS: AblationTable = {
  "without planning": [[13.6, 0.02, SIG], [46.6, 0.25], [67.8, 3.31], [69.0, 4.65]],
  "bash only": [[10.2, 0.03, SIG], [42.4, 0.35], [69.4, 1.11, SIG], [45.4, 1.72, SIG]],
};

/** Table 4 of the paper: the same layout for Terminal-Bench 2.1. */
const TB_TIER_ROWS: TierTable = {
  32: {
    T0: [[6.74, 0.04], [19.10, 0.09], [28.09, 0.26], [21.35, 0.76]],
    T1: [[11.24, 0.12], [33.71, 0.44, SIG], [33.33, 1.97], [39.33, 2.15, SIG]],
    T2: [[7.87, 0.12], [25.84, 0.46], [33.33, 1.80], [35.96, 2.45, SIG]],
    T3: [[14.61, 0.11], [22.47, 0.13], [38.20, 0.74, SIG], [42.70, 1.91, SIG]],
    T4: [[17.98, 0.11, SIG], [21.35, 0.14], [32.58, 0.82], [42.70, 1.88, SIG]],
  },
  64: {
    T0: [[11.24, 0.08], [20.22, 0.13], [30.34, 0.66], [30.34, 1.78]],
    T1: [[14.61, 0.12], [29.21, 0.28], [41.57, 2.11], [37.08, 2.74, SIG]],
    T2: [[11.24, 0.12], [26.97, 0.32], [40.45, 2.35], [37.08, 2.17]],
    T3: [[14.61, 0.12], [26.97, 0.20], [43.82, 1.61, SIG], [42.70, 2.51, SIG]],
    T4: [[13.48, 0.10], [25.84, 0.22], [44.94, 1.16, SIG], [38.20, 2.51]],
  },
  96: {
    T0: [[12.36, 0.11], [19.10, 0.28], [33.71, 1.14], [33.71, 2.60]],
    T1: [[15.73, 0.14], [22.47, 0.23], [42.70, 2.47], [37.08, 3.00]],
    T2: [[11.24, 0.15], [21.35, 0.37], [43.82, 2.71, SIG], [38.20, 3.12]],
    T3: [[17.98, 0.16], [28.09, 0.32], [34.83, 2.14], [39.33, 2.84]],
    T4: [[13.48, 0.13], [25.84, 0.25], [44.94, 1.66, SIG], [35.96, 2.79]],
  },
  128: {
    T0: [[11.24, 0.12], [25.84, 0.27], [34.83, 1.65], [34.83, 3.32]],
    T1: [[10.11, 0.15], [22.47, 0.40], [40.45, 2.68], [40.45, 3.71]],
    T2: [[16.85, 0.15], [25.84, 0.32], [40.45, 2.37], [37.08, 4.16]],
    T3: [[12.36, 0.16], [26.97, 0.30], [37.08, 2.26], [38.20, 3.65]],
    T4: [[13.48, 0.14], [28.09, 0.28], [44.94, 2.43, SIG], [37.08, 2.22]],
  },
};

const TB_ABLATION_ROWS: AblationTable = {
  "without planning": [[8.99, 0.08], [28.09, 0.38], [46.07, 2.52], [39.33, 3.71]],
  "bash only": [[3.37, 0.02, SIG], [23.56, 0.41], [50.56, 1.70], [43.82, 2.75]],
};

const TIER_ROWS: Readonly<Record<HarnessDesignBenchmark, TierTable>> = {
  "SWE-Bench Verified": SWE_TIER_ROWS,
  "Terminal-Bench 2.1": TB_TIER_ROWS,
};

const ABLATION_ROWS: Readonly<Record<HarnessDesignBenchmark, AblationTable>> = {
  "SWE-Bench Verified": SWE_ABLATION_ROWS,
  "Terminal-Bench 2.1": TB_ABLATION_ROWS,
};

export const HARNESS_DESIGN = {
  arxivId: "2609.20804",
  authors:
    "Run-Ze Fan, Zihao Zhang, Simin Ma, Yebowen Hu, Shouju Wang, Kaiqiang Song, Fei Liu, Hamed Zamani, and Xiaoyang Wang",
  affiliations:
    "UMass Amherst, Emory University, UNC Charlotte, and Zoom Video Communications",
  publishedOn: "September 17, 2026",
  settingCount: 176,
  settingsPerPair: 22,
  tierSettingsPerPair: 20,
  modelCount: 4,
  benchmarkCount: 2,
  sweTaskCount: 500,
  tbTaskCount: 89,
  stepCap: 300,
  outputTokenCapPerTurn: "16,384",
  pricesAccessed: "August 2026",
  prices: {
    "Nemotron-3 30B": "$0.05 and $0.20",
    "Nemotron-3 120B": "$0.08 and $0.45",
    "Nemotron-3 550B": "$0.50 and $2.20",
    "Mistral-Medium-3.5-128B": "$1.50 and $7.50",
  },
  baselineSetting: "T4 with a 128k window",
  quotes: {
    conditionalSystemsProblem:
      "Harness design is thus a conditional systems problem in which each component should be selected for the target model, task type, and resource budget rather than adopted as a default.",
    contextManagementTakeaway:
      "Context management reduces the sensitivity of task success to context-window capacity, enabling effective execution under tighter context budgets.",
    recallTakeaway:
      "Models, especially stronger ones, almost never call recall_event to recover elided observations, so lossless recall yields no accuracy gain over elision alone.",
    planningTakeaway:
      "Planning trades additional computation for accuracy on the weaker model, but primarily reduces cost on the stronger models; its value at intermediate capability remains task-type-dependent.",
  },
  reported: {
    managedGapSwe: ["35.7", "15.9", "5.5", "2.7"],
    managedGapTb: ["9.5", "7.5", "4.8", "2.8"],
    t0OverflowSwe: "78.7% to 8.7%",
    t0OverflowTb: "61.0% to 12.1%",
    t4LowestCostPanels: "seven of eight",
    recallComparisons: 32,
    recallBetter: 15,
    recallWorse: 14,
    recallTies: 3,
    recallMeanDifference: "−0.36",
    recallNeverCalledSettings: 36,
    recallSettings: 64,
    recallHeaviestCallsPerTask: "4.326",
    recallHeaviestGap: "3.37",
    planning30bSwe: "11.6",
    planning30bTb: "4.5",
    planning550bSweCostCut: "30%",
    planningMistralSweCostCut: "32%",
    planning550bSweSuccessDrop: "2.0",
    planningMistralSweSuccessDrop: "0.4",
    planning30bMedianTurnsWithout: 5,
    planning30bMedianTurnsWith: 40,
    planning30bNoEditWithout: "68.6%",
    planning30bNoEditWith: "27.8%",
    planning550bMedianTurnsWithout: 108,
    planning550bMedianTurnsWith: 74,
    planningMistralMedianTurnsWithout: 68,
    planningMistralMedianTurnsWith: 53,
    planning120bTbCostCut: "26%",
    planning550bTbCostCut: "3.6%",
    planningMistralTbCostCut: "about 40%",
    planning30bTbCostRise: "75%",
    tools30bSwe: "15.0",
    tools30bTb: "10.1",
    bashOnly30bTbEarlyStops: "66%",
    bashOnly30bTbTurnsFrom: 71,
    bashOnly30bTbTurnsTo: 15,
    tools120bSwe: "1.6",
    tools120bTb: "4.5",
    bashOnly550bSwe: "3.6",
    bashOnly550bTb: "5.6",
    bashOnly550bSweCostCut: "53%",
    bashOnly550bTbCostCut: "30%",
    bashOnly550bFewerCallsSwe: "32%",
    bashOnly550bFewerCallsTb: "24%",
    toolsMistralSwe: "23.2",
    bashOnlyMistralTb: "6.7",
    mistralBashShareTb: "71.9%",
    mistralBashShareSwe: "40.4%",
    mistralBashOnlyNoEditSwe: "32.8%",
    mistralToolsNoEditSwe: "1.2%",
  },
} as const;

function measure(literal: MeasureLiteral): HarnessDesignMeasure {
  const [successPercent, costUsd, significant] = literal;
  return { costUsd, significant: significant === true, successPercent };
}

function modelIndex(model: HarnessDesignModel): 0 | 1 | 2 | 3 {
  const index = HARNESS_DESIGN_MODELS.indexOf(model);
  if (index === 0 || index === 1 || index === 2 || index === 3) return index;
  throw new Error(`Unknown harness-design model: ${model}`);
}

/** Printed cell for one tier and budget. */
export function tierMeasure(
  benchmark: HarnessDesignBenchmark,
  budget: HarnessDesignBudget,
  tier: HarnessDesignTier,
  model: HarnessDesignModel,
): HarnessDesignMeasure {
  return measure(TIER_ROWS[benchmark][budget][tier][modelIndex(model)]);
}

/** Printed cell for one component ablation at the T4/128k baseline. */
export function ablationMeasure(
  benchmark: HarnessDesignBenchmark,
  ablation: HarnessDesignAblation,
  model: HarnessDesignModel,
): HarnessDesignMeasure {
  return measure(ABLATION_ROWS[benchmark][ablation][modelIndex(model)]);
}

export type HarnessDesignSetting = Readonly<{
  benchmark: HarnessDesignBenchmark;
  measure: HarnessDesignMeasure;
  model: HarnessDesignModel;
  setting:
    | Readonly<{ budget: HarnessDesignBudget; kind: "tier"; tier: HarnessDesignTier }>
    | Readonly<{ ablation: HarnessDesignAblation; kind: "ablation" }>;
}>;

/** Every printed setting: the paper counts 176. */
export function harnessDesignSettings(): readonly HarnessDesignSetting[] {
  return HARNESS_DESIGN_BENCHMARKS.flatMap(benchmark =>
    HARNESS_DESIGN_MODELS.flatMap(model => [
      ...HARNESS_DESIGN_BUDGETS.flatMap(budget =>
        HARNESS_DESIGN_TIERS.map((tier): HarnessDesignSetting => ({
          benchmark,
          measure: tierMeasure(benchmark, budget, tier, model),
          model,
          setting: { budget, kind: "tier", tier },
        }))),
      ...HARNESS_DESIGN_ABLATIONS.map((ablation): HarnessDesignSetting => ({
        benchmark,
        measure: ablationMeasure(benchmark, ablation, model),
        model,
        setting: { ablation, kind: "ablation" },
      })),
    ]));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("Cannot average an empty list.");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The paper’s value of context management: mean success of T1–T4 minus T0
 * success, averaged with equal weight over the four models, in percentage points.
 */
export function managedMinusT0Gap(
  benchmark: HarnessDesignBenchmark,
  budget: HarnessDesignBudget,
): number {
  return mean(HARNESS_DESIGN_MODELS.map((model) => {
    const managed = mean(HARNESS_DESIGN_MANAGED_TIERS.map(tier =>
      tierMeasure(benchmark, budget, tier, model).successPercent));
    return managed - tierMeasure(benchmark, budget, "T0", model).successPercent;
  }));
}

/** Managed tiers whose four-budget mean cost is lowest for one model and benchmark. */
export function lowestMeanCostTiers(
  benchmark: HarnessDesignBenchmark,
  model: HarnessDesignModel,
): readonly HarnessDesignManagedTier[] {
  const means = HARNESS_DESIGN_MANAGED_TIERS.map(tier => ({
    cost: mean(HARNESS_DESIGN_BUDGETS.map(budget =>
      tierMeasure(benchmark, budget, tier, model).costUsd)),
    tier,
  }));
  const lowest = Math.min(...means.map(entry => entry.cost));
  return means
    .filter(entry => Math.abs(entry.cost - lowest) < 1e-9)
    .map(entry => entry.tier);
}

export type HarnessDesignComponentEffect = Readonly<{
  ablated: HarnessDesignMeasure;
  baseline: HarnessDesignMeasure;
  /** Baseline cost relative to the ablated cost, as a percentage change. */
  costChangePercent: number;
  /** Baseline success minus ablated success, in percentage points. */
  successPoints: number;
}>;

/**
 * Effect of keeping a component, measured as the T4/128k baseline (planning on,
 * predefined tools) minus the matched ablation that removes it.
 */
export function componentEffect(
  benchmark: HarnessDesignBenchmark,
  model: HarnessDesignModel,
  ablation: HarnessDesignAblation,
): HarnessDesignComponentEffect {
  const baseline = tierMeasure(benchmark, 128, "T4", model);
  const ablated = ablationMeasure(benchmark, ablation, model);
  if (ablated.costUsd <= 0) {
    throw new RangeError(`Ablated cost must be positive: ${benchmark} ${model} ${ablation}`);
  }
  return {
    ablated,
    baseline,
    costChangePercent: (baseline.costUsd / ablated.costUsd - 1) * 100,
    successPoints: baseline.successPercent - ablated.successPercent,
  };
}

function checkedSnapshot(): CodingAgentSnapshot {
  const parsed = parseCodingAgentSnapshot(codingAgentData);
  if (!parsed.ok) {
    throw new Error(`Checked coding-agent snapshot is invalid: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return parsed.value;
}

function utcCalendarDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.valueOf())) {
    throw new RangeError(`Invalid snapshot timestamp: ${timestamp}`);
  }
  return date.toISOString().slice(0, 10);
}

function latestCalendarDate(...dates: readonly string[]): string {
  const [first, ...rest] = dates;
  if (first === undefined) throw new Error("At least one calendar date is required.");
  return rest.reduce((latest, current) => current > latest ? current : latest, first);
}

export function formatPoints(value: number): string {
  return value.toFixed(1);
}

function formatSuccess(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function measureCell(value: HarnessDesignMeasure): InlineContent {
  return [
    `${formatSuccess(value.successPercent)} at ${formatUsd(value.costUsd)}${value.significant ? "†" : ""}`,
  ];
}

function textCell(value: string): InlineContent {
  return [value];
}

function gapRows(): InlineContent[][] {
  return HARNESS_DESIGN_BUDGETS.map(budget => [
    textCell(`${budget}k`),
    textCell(formatPoints(managedMinusT0Gap("SWE-Bench Verified", budget))),
    textCell(formatPoints(managedMinusT0Gap("Terminal-Bench 2.1", budget))),
  ]);
}

function ablationRows(benchmark: HarnessDesignBenchmark): InlineContent[][] {
  return HARNESS_DESIGN_MODELS.map(model => [
    textCell(model),
    measureCell(tierMeasure(benchmark, 128, "T4", model)),
    measureCell(ablationMeasure(benchmark, "without planning", model)),
    measureCell(ablationMeasure(benchmark, "bash only", model)),
  ]);
}

/** Models from the paper that also appear, by name, in the checked coding-agent snapshot. */
export function snapshotModelsSharedWithPaper(
  snapshot: CodingAgentSnapshot,
): readonly HarnessDesignModel[] {
  const stored = new Set(snapshot.records.map(record => record.model));
  return HARNESS_DESIGN_MODELS.filter(model => stored.has(model));
}

export function createHarnessDesignArticle(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): BlogArticle {
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    HARNESS_DESIGN_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(snapshot.source.retrievedAt),
    utcCalendarDate(codingAgentDatasetModifiedAt(snapshot)),
  );
  const sharedModels = snapshotModelsSharedWithPaper(snapshot);
  const strictlyLowestT4Panels = HARNESS_DESIGN_BENCHMARKS.flatMap(benchmark =>
    HARNESS_DESIGN_MODELS.filter((model) => {
      const lowest = lowestMeanCostTiers(benchmark, model);
      return lowest.length === 1 && lowest[0] === "T4";
    }));
  const tiedT4Panels = HARNESS_DESIGN_BENCHMARKS.flatMap(benchmark =>
    HARNESS_DESIGN_MODELS.flatMap((model) => {
      const lowest = lowestMeanCostTiers(benchmark, model);
      return lowest.length > 1 && lowest.includes("T4") ? [`${model} on ${benchmark}`] : [];
    }));
  const planning30bSwe = componentEffect("SWE-Bench Verified", "Nemotron-3 30B", "without planning");
  const planning30bTb = componentEffect("Terminal-Bench 2.1", "Nemotron-3 30B", "without planning");
  const bash550bSwe = componentEffect("SWE-Bench Verified", "Nemotron-3 550B", "bash only");
  const bash550bTb = componentEffect("Terminal-Bench 2.1", "Nemotron-3 550B", "bash only");
  const bashMistralTb = componentEffect("Terminal-Bench 2.1", "Mistral-Medium-3.5-128B", "bash only");
  const significanceNote =
    "† marks a cell the paper reports as significantly different from the T4 baseline under a two-sided exact McNemar test with Benjamini–Hochberg q < 0.05.";

  return {
    authorshipDisclosure: BLOG_AUTHORSHIP_DISCLOSURE,
    slug: HARNESS_DESIGN_ARTICLE_SLUG,
    title: "What Fan et al.’s harness-component ablations measure",
    dek:
      "Nine researchers held one coding-agent loop fixed and toggled planning, tools, and context management across 176 settings. Each component helped only under named conditions.",
    focusPhrase: "coding agent harness design ablation",
    seoDescription:
      "A 176-setting study isolates planning, action space, and context management in one fixed coding-agent loop. See which component moves accuracy or cost and when.",
    keywords: [
      "coding agent harness",
      "harness design",
      "context management",
      "SWE-Bench Verified",
      "Terminal-Bench 2.1",
      "planning",
      "bash-only agent",
    ],
    publishedAt: HARNESS_DESIGN_ARTICLE_PUBLISHED_AT,
    updatedAt,
    sourceIds: ["fanHarnessDesign", "artificialAnalysisCodingAgents"],
    relatedSlugs: [
      "harnesstax-coding-agent-harness",
      "coding-agent-score-holdouts",
      "aa-index-cost-coding-agents",
    ],
    nextStep: {
      title: "Compare current coding-agent configurations",
      description:
        "The coding-agent chart stores each model with its harness and effort setting. The data page defines every charted benchmark, including the Terminal-Bench 4 standard, with its comparison rules and limits.",
      links: [
        { href: "/coding", label: "Coding-agent chart" },
        { href: "/data", label: "Benchmark definitions and data" },
      ],
    },
    body: [
      paragraph(
        { href: BLOG_SOURCES.fanHarnessDesign.url, text: "An Empirical Study of Harness Design for Coding Agents" },
        ` is a paper posted to arXiv on ${HARNESS_DESIGN.publishedOn} by `,
        HARNESS_DESIGN.authors,
        ", from ",
        HARNESS_DESIGN.affiliations,
        ". It asks which parts of a coding-agent harness change task success and cost, and under what conditions.",
      ),
      paragraph(
        "A harness is the software around a model that gives it tools, keeps track of the task, and decides what history the model sees. Most harness comparisons swap one complete product for another, so a score difference cannot be traced to a single mechanism. The authors instead build one harness whose execution loop stays fixed and vary three components inside it: planning (a persistent task plan the model updates through a tool), the action space (a set of predefined file, search, and shell tools versus a bare bash tool), and context management (how a growing history is compacted to fit a token window).",
      ),
      paragraph(
        `This note reconstructs the paper’s two printed result tables, checks the reported value of context management at each window budget, and states where the ${HARNESS_DESIGN.settingCount} settings stop. It also explains how to read the paper beside the site’s `,
        { href: "/blog/harnesstax-coding-agent-harness", text: "HarnessTax note" },
        ", which answers a different harness question.",
      ),
      heading(`What the ${HARNESS_DESIGN.settingCount} settings cover`),
      paragraph(
        `The study uses four open-weight models: Nemotron-3 at 30B, 120B, and 550B parameters as a within-family capability axis, and Mistral-Medium-3.5-128B from a second family. The authors serve every model locally in BF16 with temperature 0 and a ${HARNESS_DESIGN.outputTokenCapPerTurn}-token output cap per turn. Cost is priced from OpenRouter rates accessed ${HARNESS_DESIGN.pricesAccessed}, per million input and output tokens: ${HARNESS_DESIGN.prices["Nemotron-3 30B"]} for Nemotron-3 30B, ${HARNESS_DESIGN.prices["Nemotron-3 120B"]} for 120B, ${HARNESS_DESIGN.prices["Nemotron-3 550B"]} for 550B, and ${HARNESS_DESIGN.prices["Mistral-Medium-3.5-128B"]} for Mistral-Medium-3.5-128B. The authors describe the models as probes of capability and interaction style, not as optimization targets.`,
      ),
      paragraph(
        `Two benchmarks supply the tasks. SWE-Bench Verified has ${HARNESS_DESIGN.sweTaskCount} human-verified GitHub issues from Python repositories; the agent must produce a patch that passes the issue’s tests. Terminal-Bench 2.1 has ${HARNESS_DESIGN.tbTaskCount} end-to-end tasks in a command-line environment. Each setting reports the share of tasks resolved and the mean cost per task. Every task runs once per setting with a ${HARNESS_DESIGN.stepCap}-step cap. Safety gates, post-edit diagnostics, and stuck detection stay fixed across all settings.`,
      ),
      paragraph(
        "Context management has five tiers. T0 does nothing and ends the run when the window overflows. T1 elides stale tool observations, replacing their bodies with short stubs. T2 adds recall: elided observations go to an external store and a recall_event tool can read them back. T3 summarizes older history with a separate call to the same model and no elision. T4 stages all three: it elides bulky observations once history passes a soft threshold at 60% of the window, and summarizes the oldest middle events once history passes a hard threshold at 85%. The system prompt, the task description, and at least the last two turns always stay verbatim.",
      ),
      paragraph(
        `The five tiers run under four window budgets of 32k, 64k, 96k, and 128k tokens with planning on and the predefined tools, which gives ${HARNESS_DESIGN.tierSettingsPerPair} settings per model and benchmark. Two more settings start from ${HARNESS_DESIGN.baselineSetting} and remove one component each: one disables planning, and one replaces the predefined tools with bash only. That is ${HARNESS_DESIGN.settingsPerPair} settings per pair and ${HARNESS_DESIGN.settingCount} in total. Within each comparison family the authors test success differences with a two-sided exact McNemar test on task-paired outcomes and control the false discovery rate at 0.05.`,
      ),
      heading("Context management pays off when the window is tight"),
      paragraph(
        "The authors define the value of context management as the success gap between the managed tiers (T1 through T4) and T0. Averaged over the four models, that gap shrinks steadily as the window grows. Recomputing it from the printed tables gives the same figures the paper reports.",
      ),
      table(
        "Mean success of T1 through T4 minus T0 success, averaged over the four models, in percentage points. Reconstructed from the paper’s Tables 3 and 4.",
        ["Window budget", "SWE-Bench Verified", "Terminal-Bench 2.1"],
        gapRows(),
      ),
      paragraph(
        `The gap tracks overflow. Across the same budgets, the model-averaged share of T0 tasks lost to window overflow falls from ${HARNESS_DESIGN.reported.t0OverflowSwe} on SWE-Bench Verified and from ${HARNESS_DESIGN.reported.t0OverflowTb} on Terminal-Bench 2.1, while every managed tier overflows on zero tasks at every budget. The authors read this as context management preventing premature termination when the window binds. At 128k the tiers differ little in median trajectory length or in the share of runs that end without an edit, so the mechanism mostly extends runs rather than changing what the agent does. The paper’s takeaway: “`,
        HARNESS_DESIGN.quotes.contextManagementTakeaway,
        "”",
      ),
      heading("Elide first, summarize later"),
      paragraph(
        `Success rates are similar across T1 through T4, so the tiers separate on cost. The paper reports that T4 has the lowest mean cost in ${HARNESS_DESIGN.reported.t4LowestCostPanels} model and benchmark panels. Averaging each tier’s cost over the four budgets in the printed tables, T4 is strictly lowest in ${spellCount(strictlyLowestT4Panels.length)} panels and ties for lowest in the remaining ${spellCount(tiedT4Panels.length)}`,
        tiedT4Panels.length === 0 ? "." : ` (${tiedT4Panels.join("; ")}, where costs round to a cent or two).`,
        " T4 also keeps peak context furthest below the nominal window at every budget and calls the summarizer less often than T3. The authors attribute the cost profile to cheap early elision handling many cases before an LLM summarization call is needed.",
      ),
      paragraph(
        `Recall adds machinery the models rarely use. T1 and T2 differ only in whether elided content can be recovered. Across ${HARNESS_DESIGN.reported.recallComparisons} model, benchmark, and window comparisons, T2 beats T1 in ${HARNESS_DESIGN.reported.recallBetter}, loses in ${HARNESS_DESIGN.reported.recallWorse}, and ties in ${HARNESS_DESIGN.reported.recallTies}, for an equal-weight mean difference of ${HARNESS_DESIGN.reported.recallMeanDifference} percentage points. Of the ${HARNESS_DESIGN.reported.recallSettings} T2 and T4 settings, ${HARNESS_DESIGN.reported.recallNeverCalledSettings} never call recall_event, and the 16 planning and action-space settings record no recall calls at all. Recall use concentrates in Nemotron-3 30B at the 32k window; its heaviest configuration averages ${HARNESS_DESIGN.reported.recallHeaviestCallsPerTask} calls per task and scores ${HARNESS_DESIGN.reported.recallHeaviestGap} points below T1. The authors conclude: “`,
        HARNESS_DESIGN.quotes.recallTakeaway,
        "”",
      ),
      heading("Planning helps the weakest model and saves cost for the strongest"),
      paragraph(
        `The planning ablation compares planning on and off at ${HARNESS_DESIGN.baselineSetting}, with the predefined tools in both settings. For Nemotron-3 30B, planning raises success by ${formatPoints(planning30bSwe.successPoints)} points on SWE-Bench Verified and ${formatPoints(planning30bTb.successPoints)} points on Terminal-Bench 2.1, at higher cost on both. For Nemotron-3 120B there is no consistent success gain; planning raises cost on SWE-Bench Verified and lowers it on Terminal-Bench 2.1. For Nemotron-3 550B and Mistral-Medium-3.5-128B, planning lowers SWE-Bench Verified cost by about ${HARNESS_DESIGN.reported.planning550bSweCostCut} and ${HARNESS_DESIGN.reported.planningMistralSweCostCut} while success falls by ${HARNESS_DESIGN.reported.planning550bSweSuccessDrop} and ${HARNESS_DESIGN.reported.planningMistralSweSuccessDrop} points.`,
      ),
      table(
        `Component ablations on SWE-Bench Verified from the T4, 128k, planning-on, predefined-tools baseline: success rate at mean cost per task. ${significanceNote}`,
        ["Model", "T4 baseline", "Without planning", "Bash only"],
        ablationRows("SWE-Bench Verified"),
      ),
      table(
        `Component ablations on Terminal-Bench 2.1 from the T4, 128k, planning-on, predefined-tools baseline: success rate at mean cost per task. ${significanceNote}`,
        ["Model", "T4 baseline", "Without planning", "Bash only"],
        ablationRows("Terminal-Bench 2.1"),
      ),
      paragraph(
        `The trajectory analysis explains the split. Without planning, Nemotron-3 30B’s median SWE-Bench Verified run drops from ${HARNESS_DESIGN.reported.planning30bMedianTurnsWith} to ${HARNESS_DESIGN.reported.planning30bMedianTurnsWithout} turns, and ${HARNESS_DESIGN.reported.planning30bNoEditWithout} of runs end without editing a file, against ${HARNESS_DESIGN.reported.planning30bNoEditWith} with planning. Planning keeps the weakest model working long enough to attempt an edit. For the stronger models it does the opposite job: it shortens the median SWE-Bench Verified run from ${HARNESS_DESIGN.reported.planning550bMedianTurnsWithout} to ${HARNESS_DESIGN.reported.planning550bMedianTurnsWith} turns for Nemotron-3 550B and from ${HARNESS_DESIGN.reported.planningMistralMedianTurnsWithout} to ${HARNESS_DESIGN.reported.planningMistralMedianTurnsWith} for Mistral, and the removed turns are mostly post-edit verification. On Terminal-Bench 2.1 the cost effect depends on which tail planning trims: about ${HARNESS_DESIGN.reported.planning120bTbCostCut} lower for Nemotron-3 120B, ${HARNESS_DESIGN.reported.planning550bTbCostCut} lower for 550B, ${HARNESS_DESIGN.reported.planningMistralTbCostCut} lower for Mistral, and ${HARNESS_DESIGN.reported.planning30bTbCostRise} higher for 30B, whose runs planning keeps alive.`,
      ),
      paragraph(
        "In the authors’ words, “",
        HARNESS_DESIGN.quotes.planningTakeaway,
        "” The estimate covers one planning implementation, a prompt plus an update_plan tool, not planning as a general reasoning strategy.",
      ),
      heading("Bash-capable models can drop the predefined tools"),
      paragraph(
        `The action-space ablation compares the predefined tool set (read_file, write_file, edit_file, list_files, glob_files, grep_text, web_fetch, and bash) with bash only, at ${HARNESS_DESIGN.baselineSetting} and planning on. The predefined tools help Nemotron-3 30B most: ${HARNESS_DESIGN.reported.tools30bSwe} points on SWE-Bench Verified and ${HARNESS_DESIGN.reported.tools30bTb} on Terminal-Bench 2.1. Without them the model emits tool calls learned in training that the bash-only harness cannot resolve; ${HARNESS_DESIGN.reported.bashOnly30bTbEarlyStops} of its bash-only Terminal-Bench 2.1 runs end after such a call, and the average run shortens from ${HARNESS_DESIGN.reported.bashOnly30bTbTurnsFrom} to ${HARNESS_DESIGN.reported.bashOnly30bTbTurnsTo} turns. For Nemotron-3 120B the gain narrows to ${HARNESS_DESIGN.reported.tools120bSwe} and ${HARNESS_DESIGN.reported.tools120bTb} points.`,
      ),
      paragraph(
        `Nemotron-3 550B crosses over. Bash only raises its success by ${formatPoints(-bash550bSwe.successPoints)} points on SWE-Bench Verified and ${formatPoints(-bash550bTb.successPoints)} on Terminal-Bench 2.1 while cutting cost by ${HARNESS_DESIGN.reported.bashOnly550bSweCostCut} and ${HARNESS_DESIGN.reported.bashOnly550bTbCostCut} (${formatUsd(bash550bSwe.ablated.costUsd)} versus ${formatUsd(bash550bSwe.baseline.costUsd)}, and ${formatUsd(bash550bTb.ablated.costUsd)} versus ${formatUsd(bash550bTb.baseline.costUsd)}). Its bash-only runs issue ${HARNESS_DESIGN.reported.bashOnly550bFewerCallsSwe} fewer calls on SWE-Bench Verified and ${HARNESS_DESIGN.reported.bashOnly550bFewerCallsTb} fewer on Terminal-Bench 2.1, consistent with denser shell commands that bundle several operations. Across all four models, bash only also cuts repeated patching of already edited files and shifts file writes toward whole-file create or replace actions.`,
      ),
      paragraph(
        `Mistral-Medium-3.5-128B shows the task boundary. The predefined tools raise its SWE-Bench Verified success by ${HARNESS_DESIGN.reported.toolsMistralSwe} points, and ${HARNESS_DESIGN.reported.mistralBashOnlyNoEditSwe} of its bash-only runs there end without editing a file, against ${HARNESS_DESIGN.reported.mistralToolsNoEditSwe} with the full set. On Terminal-Bench 2.1, bash only adds ${HARNESS_DESIGN.reported.bashOnlyMistralTb} points, at a higher mean cost in the printed table (${formatUsd(bashMistralTb.ablated.costUsd)} versus ${formatUsd(bashMistralTb.baseline.costUsd)}). With the full set available, Mistral already routes ${HARNESS_DESIGN.reported.mistralBashShareTb} of its Terminal-Bench 2.1 workspace actions through bash, against ${HARNESS_DESIGN.reported.mistralBashShareSwe} on SWE-Bench Verified. Removing competing tools suits the shell-centric suite; the repository suite still rewards predefined read, search, and edit actions.`,
      ),
      callout(
        "What the action-space comparison is",
        "It is a bundled interface change. Bash only removes the predefined tools, their interface instructions, the harness’s file-state tracking, read-before-write checks, and automatic post-edit diagnostics together. The authors say the result does not isolate tool count or action granularity from those other properties.",
      ),
      heading("How to read this beside HarnessTax and the AI Charts chart"),
      paragraph(
        "HarnessTax, covered in the ",
        { href: "/blog/harnesstax-coding-agent-harness", text: "site’s earlier note" },
        ", moved the same frontier model across three complete products (Claude Code, Codex CLI, and Pi) and found that cost moved far more than success. This paper asks a question that design cannot answer: which mechanism inside a harness moves cost or success. Its answer comes from a single research harness and four open-weight models, so its numbers are not a ranking of any product and do not transfer to a named commercial harness without a matched test.",
      ),
      paragraph(
        "The AI Charts coding-agent chart is a checked snapshot of the public ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents page" },
        `, retrieved ${retrievedAt}. It stores each model with its harness and effort setting. `,
        sharedModels.length === 0
          ? "The snapshot stores none of the paper’s four models, so there is no same-name row to place beside these tables."
          : `The snapshot stores ${sharedModels.join(" and ")} by name, in a different harness, task mix, and price basis, so a shared name is not a shared measurement.`,
      ),
      paragraph(
        `The benchmark versions also differ. The paper evaluates Terminal-Bench 2.1 with ${HARNESS_DESIGN.tbTaskCount} tasks and one run per task. The site’s terminal standard is `,
        { href: "/data#terminal-bench-4", text: "Terminal-Bench 4" },
        ` (version ${TERMINAL_BENCH_VERSION}), with ${TERMINAL_BENCH_TASK_COUNT} tasks and ${spellCount(TERMINAL_BENCH_TRIALS_PER_TASK)} trials per task, and the Artificial Analysis coding-agent index also uses Terminal-Bench 4. A Terminal-Bench 2.1 success rate and a Terminal-Bench 4 accuracy come from different task sets and cannot share an axis. `,
        { href: "/data#atlas-swe-bench-verified", text: "SWE-bench Verified" },
        ` appears in the site’s benchmark library as a definition and comparison guide with the same ${HARNESS_DESIGN.sweTaskCount}-task set the paper uses. The site does not chart its scores, and the paper’s rates belong to its own harness and models.`,
      ),
      paragraph(
        { href: "/blog/coding-agent-score-holdouts", text: "Public-suite holdouts" },
        " still apply. Both suites are public. The authors keep web search out of the action space because SWE-Bench tasks come from public GitHub issues whose fixing pull requests are online, and they list prior exposure to tool interfaces among the reasons model size is only an imperfect proxy for capability.",
      ),
      heading("Limits"),
      list(
        [
          "Every figure belongs to one research harness, one planning implementation (a prompt plus an update_plan tool), one threshold policy for context management, and one bundled action-space change. The authors say the results estimate conditional effects of these implementations, not a universally optimal harness.",
        ],
        [
          `Planning and the action space are ablated only at ${HARNESS_DESIGN.baselineSetting}. A full factorial study would be needed to know whether their effects hold under other tiers and budgets.`,
        ],
        [
          `Each setting runs once per task, and Terminal-Bench 2.1 has ${HARNESS_DESIGN.tbTaskCount} tasks. Many Terminal-Bench 2.1 contrasts do not reach significance; the authors rest those conclusions on consistent direction across models and budgets rather than on individually significant cells.`,
        ],
        [
          "The models are three Nemotron-3 sizes and Mistral-Medium-3.5-128B, served locally at OpenRouter list prices. SWE-Bench Verified is Python only. The authors say the crossover points should be validated before transfer to other model families, harness implementations, or task types.",
        ],
        [
          "Cost is the mean token cost per task at the listed prices, not latency, a subscription invoice, or a cache-adjusted bill.",
        ],
        [
          "The reconstructed tables in this note round success rates to one decimal and use the paper’s printed two-decimal costs, so tie and ratio statements carry rounding of up to a cent.",
        ],
        [
          `AI Charts rows come from a different evaluator, harness, price basis, and Terminal-Bench version (${TERMINAL_BENCH_VERSION}, not 2.1). They must not be subtracted from or averaged with the paper’s rates.`,
        ],
      ),
      paragraph(
        "The authors’ closing line states the conclusion the tables support: “",
        HARNESS_DESIGN.quotes.conditionalSystemsProblem,
        "”",
      ),
    ],
  };
}
