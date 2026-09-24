import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "@/lib/coding-agent-data";
import { codingAgentDatasetModifiedAt } from "@/lib/coding-agent-dataset";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";

import {
  BLOG_SOURCE_NOTE,
  BLOG_SOURCES,
  callout,
  heading,
  list,
  paragraph,
  table,
  type BlogArticle,
  type InlineContent,
} from "./articles";

export const HARNESS_TAX_ARTICLE_SLUG = "harnesstax-coding-agent-harness" as const;
export const HARNESS_TAX_ARTICLE_PUBLISHED_AT = "2026-09-17" as const;

export type HarnessTaxHarness = "Claude Code" | "Codex" | "Pi";
export type HarnessTaxModel =
  | "Claude Fable 5"
  | "Claude Opus 4.8"
  | "Claude Sonnet 4.6"
  | "Claude Haiku 4.5"
  | "GPT-5.6 Sol"
  | "GPT-5.6 Luna"
  | "Kimi K3";

export type HarnessTaxPair = Readonly<{
  costUsd: string;
  harness: HarnessTaxHarness;
  model: HarnessTaxModel;
  success: string;
}>;

export const HARNESS_TAX_HARNESSES = [
  "Claude Code",
  "Codex",
  "Pi",
] as const satisfies readonly HarnessTaxHarness[];

export const HARNESS_TAX_MODELS = [
  "Claude Fable 5",
  "Claude Opus 4.8",
  "Claude Sonnet 4.6",
  "Claude Haiku 4.5",
  "GPT-5.6 Sol",
  "GPT-5.6 Luna",
  "Kimi K3",
] as const satisfies readonly HarnessTaxModel[];

/** Provider harness used in the authors’ 12 Anthropic and OpenAI comparisons. */
export const HARNESS_TAX_OWN_HARNESS = {
  "Claude Fable 5": "Claude Code",
  "Claude Opus 4.8": "Claude Code",
  "Claude Sonnet 4.6": "Claude Code",
  "Claude Haiku 4.5": "Claude Code",
  "GPT-5.6 Sol": "Codex",
  "GPT-5.6 Luna": "Codex",
} as const satisfies Record<Exclude<HarnessTaxModel, "Kimi K3">, HarnessTaxHarness>;

/**
 * Published SWE-bench Lite pair table from the HarnessTax page captured
 * September 16, 2026 UTC. Costs are standardized dollars per attempt.
 */
export const HARNESS_TAX_SWE_PAIRS: readonly HarnessTaxPair[] = [
  { model: "Claude Fable 5", harness: "Claude Code", success: "97.8%", costUsd: "$1.329" },
  { model: "Claude Fable 5", harness: "Codex", success: "96.7%", costUsd: "$0.890" },
  { model: "Claude Fable 5", harness: "Pi", success: "96.7%", costUsd: "$0.666" },
  { model: "Claude Opus 4.8", harness: "Claude Code", success: "86.7%", costUsd: "$0.976" },
  { model: "Claude Opus 4.8", harness: "Codex", success: "88.9%", costUsd: "$0.694" },
  { model: "Claude Opus 4.8", harness: "Pi", success: "82.2%", costUsd: "$0.473" },
  { model: "Claude Sonnet 4.6", harness: "Claude Code", success: "66.7%", costUsd: "$0.669" },
  { model: "Claude Sonnet 4.6", harness: "Codex", success: "68.9%", costUsd: "$0.745" },
  { model: "Claude Sonnet 4.6", harness: "Pi", success: "64.4%", costUsd: "$0.679" },
  { model: "Claude Haiku 4.5", harness: "Claude Code", success: "52.2%", costUsd: "$0.426" },
  { model: "Claude Haiku 4.5", harness: "Codex", success: "57.8%", costUsd: "$0.392" },
  { model: "Claude Haiku 4.5", harness: "Pi", success: "60.0%", costUsd: "$0.374" },
  { model: "GPT-5.6 Sol", harness: "Claude Code", success: "77.8%", costUsd: "$1.540" },
  { model: "GPT-5.6 Sol", harness: "Codex", success: "73.3%", costUsd: "$0.561" },
  { model: "GPT-5.6 Sol", harness: "Pi", success: "74.4%", costUsd: "$0.441" },
  { model: "GPT-5.6 Luna", harness: "Claude Code", success: "55.6%", costUsd: "$0.152" },
  { model: "GPT-5.6 Luna", harness: "Codex", success: "55.6%", costUsd: "$0.035" },
  { model: "GPT-5.6 Luna", harness: "Pi", success: "53.3%", costUsd: "$0.030" },
  { model: "Kimi K3", harness: "Claude Code", success: "76.7%", costUsd: "$0.784" },
  { model: "Kimi K3", harness: "Codex", success: "74.4%", costUsd: "$0.845" },
  { model: "Kimi K3", harness: "Pi", success: "72.2%", costUsd: "$0.455" },
];

/**
 * Published Terminal-Bench 2.0 pair table from the same captured page.
 */
export const HARNESS_TAX_TB_PAIRS: readonly HarnessTaxPair[] = [
  { model: "Claude Fable 5", harness: "Claude Code", success: "75.6%", costUsd: "$1.554" },
  { model: "Claude Fable 5", harness: "Codex", success: "72.2%", costUsd: "$0.976" },
  { model: "Claude Fable 5", harness: "Pi", success: "71.1%", costUsd: "$1.079" },
  { model: "Claude Opus 4.8", harness: "Claude Code", success: "68.9%", costUsd: "$0.899" },
  { model: "Claude Opus 4.8", harness: "Codex", success: "72.2%", costUsd: "$0.848" },
  { model: "Claude Opus 4.8", harness: "Pi", success: "72.2%", costUsd: "$0.758" },
  { model: "Claude Sonnet 4.6", harness: "Claude Code", success: "62.2%", costUsd: "$0.669" },
  { model: "Claude Sonnet 4.6", harness: "Codex", success: "63.3%", costUsd: "$0.552" },
  { model: "Claude Sonnet 4.6", harness: "Pi", success: "65.6%", costUsd: "$0.614" },
  { model: "Claude Haiku 4.5", harness: "Claude Code", success: "41.1%", costUsd: "$0.263" },
  { model: "Claude Haiku 4.5", harness: "Codex", success: "31.1%", costUsd: "$0.214" },
  { model: "Claude Haiku 4.5", harness: "Pi", success: "47.8%", costUsd: "$0.250" },
  { model: "GPT-5.6 Sol", harness: "Claude Code", success: "71.1%", costUsd: "$1.355" },
  { model: "GPT-5.6 Sol", harness: "Codex", success: "78.9%", costUsd: "$0.761" },
  { model: "GPT-5.6 Sol", harness: "Pi", success: "83.3%", costUsd: "$0.421" },
  { model: "GPT-5.6 Luna", harness: "Claude Code", success: "70.0%", costUsd: "$0.098" },
  { model: "GPT-5.6 Luna", harness: "Codex", success: "72.2%", costUsd: "$0.064" },
  { model: "GPT-5.6 Luna", harness: "Pi", success: "76.7%", costUsd: "$0.045" },
  { model: "Kimi K3", harness: "Claude Code", success: "66.7%", costUsd: "$0.521" },
  { model: "Kimi K3", harness: "Codex", success: "70.0%", costUsd: "$0.450" },
  { model: "Kimi K3", harness: "Pi", success: "73.3%", costUsd: "$0.383" },
];

export const HARNESS_TAX = {
  authors:
    "Melissa Z. Pan, Shuo Yang, Negar Arabzadeh, Ion Stoica, and Matei Zaharia at UC Berkeley, with Wei-Lin Chiang at Arena",
  capturedOn: "September 16, 2026 UTC",
  priceListDate: "September 1, 2026",
  pairCount: 21,
  modelCount: 7,
  harnessCount: 3,
  tasksPerBenchmark: 30,
  attemptsPerTask: 3,
  turnCap: 100,
  bootstrapResamples: "10,000",
  quotes: {
    claudeMayNotNeedClaudeCode: "your Claude models may not need Claude Code",
    harnessTax:
      "Paying extra for essentially the same quality because the use of different harnesses is like paying a… Harness Tax",
    upToFiveTimes: "The same model can achieve similar success rates at up to 5x costs.",
  },
  reported: {
    fableSweClaudeCodeSuccess: "97.8%",
    fableSweCodexSuccess: "96.7%",
    fableSwePiSuccess: "96.7%",
    fableSweClaudeCodeCost: "$1.33",
    fableSwePiCost: "$0.67",
    claudeCodeVsPiSwe: "2.0×",
    claudeCodeVsCodexSwe: "1.6×",
    claudeCodeVsPiTb: "1.5×",
    successEffectSwe: "±2%",
    successEffectTb: "±5%",
    fableSwePiTurns: "15.4",
    fableSweClaudeCodeTurns: "15.3",
    fableSweSuccessLift: "1.1%",
    initialContextMultiple: "over 10×",
    sonnetSweCodexSuccess: "68.9%",
    sonnetSweClaudeCodeSuccess: "66.7%",
    solTbPiSuccess: "83.3%",
    solTbCodexSuccess: "78.9%",
    solTbPiCost: "$0.42",
    solTbCodexCost: "$0.76",
    alternativeWins: "nine of 12",
    anthropicOpenaiModels: 6,
    piTools: "read, write, edit, and bash",
  },
} as const;

export type HarnessTaxAlternativeWin = Readonly<{
  benchmark: "SWE-bench Lite" | "Terminal-Bench 2.0";
  highest: readonly HarnessTaxPair[];
  model: keyof typeof HARNESS_TAX_OWN_HARNESS;
  own: HarnessTaxPair;
}>;

function parsePercent(value: string): number {
  if (!value.endsWith("%")) {
    throw new RangeError(`Success rate must end with %: ${value}`);
  }
  const parsed = Number.parseFloat(value.slice(0, -1));
  if (!Number.isFinite(parsed)) {
    throw new RangeError(`Invalid success rate: ${value}`);
  }
  return parsed;
}

function parseUsd(value: string): number {
  if (!value.startsWith("$")) {
    throw new RangeError(`Cost must start with $: ${value}`);
  }
  const parsed = Number.parseFloat(value.slice(1));
  if (!Number.isFinite(parsed)) {
    throw new RangeError(`Invalid cost: ${value}`);
  }
  return parsed;
}

function requirePair(
  rows: readonly HarnessTaxPair[],
  model: HarnessTaxModel,
  harness: HarnessTaxHarness,
): HarnessTaxPair {
  const pair = rows.find(row => row.model === model && row.harness === harness);
  if (pair === undefined) {
    throw new Error(`Missing HarnessTax pair: ${model} in ${harness}`);
  }
  return pair;
}

function pairsForModel(
  rows: readonly HarnessTaxPair[],
  model: HarnessTaxModel,
): readonly HarnessTaxPair[] {
  return HARNESS_TAX_HARNESSES.map(harness => requirePair(rows, model, harness));
}

/** Harnesses that share the highest published success rate for one model. */
export function highestSuccessPairs(
  rows: readonly HarnessTaxPair[],
  model: HarnessTaxModel,
): readonly HarnessTaxPair[] {
  const pairs = pairsForModel(rows, model);
  const peak = Math.max(...pairs.map(pair => parsePercent(pair.success)));
  return pairs.filter(pair => parsePercent(pair.success) === peak);
}

function alternativeWin(
  rows: readonly HarnessTaxPair[],
  benchmark: HarnessTaxAlternativeWin["benchmark"],
  model: keyof typeof HARNESS_TAX_OWN_HARNESS,
): HarnessTaxAlternativeWin | undefined {
  const ownHarness = HARNESS_TAX_OWN_HARNESS[model];
  const own = requirePair(rows, model, ownHarness);
  const highest = highestSuccessPairs(rows, model);
  if (highest.some(pair => pair.harness === ownHarness)) return undefined;
  return { benchmark, highest, model, own };
}

/**
 * Comparisons in which the published peak success rate excludes the model’s
 * provider harness. Ties that include the provider harness are not wins.
 */
export function harnessTaxAlternativeWins(): readonly HarnessTaxAlternativeWin[] {
  const models = Object.keys(HARNESS_TAX_OWN_HARNESS) as (keyof typeof HARNESS_TAX_OWN_HARNESS)[];
  return [
    ...models.flatMap(model => {
      const win = alternativeWin(HARNESS_TAX_SWE_PAIRS, "SWE-bench Lite", model);
      return win === undefined ? [] : [win];
    }),
    ...models.flatMap(model => {
      const win = alternativeWin(HARNESS_TAX_TB_PAIRS, "Terminal-Bench 2.0", model);
      return win === undefined ? [] : [win];
    }),
  ];
}

/** Largest same-model cost ratio in one published pair table. */
export function largestSameModelCostRatio(rows: readonly HarnessTaxPair[]): Readonly<{
  high: HarnessTaxPair;
  low: HarnessTaxPair;
  model: HarnessTaxModel;
  ratio: number;
}> {
  let best: ReturnType<typeof largestSameModelCostRatio> | undefined;
  for (const model of HARNESS_TAX_MODELS) {
    const pairs = pairsForModel(rows, model);
    const low = pairs.reduce((current, pair) =>
      parseUsd(pair.costUsd) < parseUsd(current.costUsd) ? pair : current);
    const high = pairs.reduce((current, pair) =>
      parseUsd(pair.costUsd) > parseUsd(current.costUsd) ? pair : current);
    const ratio = parseUsd(high.costUsd) / parseUsd(low.costUsd);
    if (best === undefined || ratio > best.ratio) {
      best = { high, low, model, ratio };
    }
  }
  if (best === undefined) throw new Error("HarnessTax pair table is empty.");
  return best;
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

function textCell(value: string): InlineContent {
  return [value];
}

function pairRows(rows: readonly HarnessTaxPair[]): InlineContent[][] {
  return HARNESS_TAX_MODELS.flatMap(model =>
    HARNESS_TAX_HARNESSES.map(harness => {
      const pair = requirePair(rows, model, harness);
      return [
        textCell(pair.model),
        textCell(pair.harness),
        textCell(pair.success),
        textCell(pair.costUsd),
      ];
    }));
}

export function createHarnessTaxArticle(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): BlogArticle {
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    HARNESS_TAX_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(snapshot.source.retrievedAt),
    utcCalendarDate(codingAgentDatasetModifiedAt(snapshot)),
  );
  const alternativeWins = harnessTaxAlternativeWins();
  const lunaSweSpread = largestSameModelCostRatio(HARNESS_TAX_SWE_PAIRS);
  const snapshotAgents = new Set(snapshot.records.map(record => record.agent));
  const storesPi = snapshotAgents.has("Pi");
  const storesClaudeCode = snapshotAgents.has("Claude Code");
  const storesCodex = snapshotAgents.has("Codex");

  return {
    sourceNote: BLOG_SOURCE_NOTE,
    slug: HARNESS_TAX_ARTICLE_SLUG,
    title: "What HarnessTax’s same-model cost gap measures",
    dek:
      "UC Berkeley and Arena researchers ran 21 model and harness pairs on two public suites. Success stayed close across harnesses; cost did not.",
    focusPhrase: "HarnessTax coding agent harness",
    seoDescription:
      "HarnessTax ran 21 model and harness pairs on two public suites. See what its same-model cost gap covers, why Pi stays competitive, and the limits.",
    keywords: [
      "HarnessTax",
      "coding agent harness",
      "Claude Code",
      "Codex CLI",
      "Pi",
      "SWE-bench Lite",
    ],
    publishedAt: HARNESS_TAX_ARTICLE_PUBLISHED_AT,
    updatedAt,
    sourceIds: ["harnessTax", "artificialAnalysisCodingAgents"],
    relatedSlugs: [
      "real-swe-private-enterprise-benchmark",
      "coding-agent-score-holdouts",
      "open-models-coding-agent-benchmarks",
      "aa-index-cost-coding-agents",
    ],
    nextStep: {
      title: "Compare current coding-agent configurations",
      description:
        "The coding-agent chart stores each model with its harness and effort setting. The calculator prices a different question: one subscription seat’s token volume on API and GPU paths.",
      links: [
        { href: "/coding", label: "Coding-agent chart" },
        { href: "/calculator", label: "Subscription vs API vs GPUs" },
      ],
    },
    body: [
      paragraph(
        { href: BLOG_SOURCES.harnessTax.url, text: "HarnessTax" },
        " is a 2026 evaluation by ",
        HARNESS_TAX.authors,
        ". The page captured ",
        HARNESS_TAX.capturedOn,
        " asks how much a coding-agent harness changes task success and cost when the model stays the same.",
      ),
      paragraph(
        "A harness is the software that gives a model tools, manages context, and runs the task. The authors compare 21 model and harness pairs: seven models in Claude Code, Codex CLI, and Pi, on 30 randomly sampled tasks from SWE-bench Lite and 30 from Terminal-Bench 2.0. Codex CLI appears as Codex in the result tables. Each pair gets three attempts per task.",
      ),
      paragraph(
        "This note reconstructs the published pair tables, checks the claim that an alternative harness posts the highest success rate in ",
        HARNESS_TAX.reported.alternativeWins,
        " Anthropic and OpenAI comparisons, and states what those results do not cover.",
      ),
      heading("What the 21 pairs cover"),
      paragraph(
        "The authors start from each harness’s native configuration, select its high-effort setting, and cap each attempt at ",
        `${HARNESS_TAX.turnCap} agent turns. Turn counts and effort settings follow each harness’s own definitions. Task success uses each benchmark’s official evaluator. Cost and success are averaged across a task’s three attempts, then across the ${HARNESS_TAX.tasksPerBenchmark} tasks. The 95% confidence intervals use ${HARNESS_TAX.bootstrapResamples} bootstrap resamples of those task averages. Token costs use a fixed direct-API price list dated ${HARNESS_TAX.priceListDate}, applied to each model in every harness.`,
      ),
      paragraph(
        "On SWE-bench Lite, the task containers have no external network. The authors disable the default web tools in Claude Code and Codex and reject hosted tool declarations at the API request. For Pi they add two packages to configure subscription keys and control agent turns. They access Kimi K3 through Fireworks AI and keep that model’s single native thinking mode in all three harnesses.",
      ),
      heading("Cost moves more than success"),
      paragraph(
        HARNESS_TAX.quotes.upToFiveTimes,
        " Claude Fable 5 is the clearest same-quality example on SWE-bench Lite: it solves ",
        HARNESS_TAX.reported.fableSweClaudeCodeSuccess,
        " of attempts in Claude Code, ",
        HARNESS_TAX.reported.fableSweCodexSuccess,
        " in Codex, and ",
        HARNESS_TAX.reported.fableSwePiSuccess,
        " in Pi, while Claude Code costs about twice as much as Pi (",
        HARNESS_TAX.reported.fableSweClaudeCodeCost,
        " versus ",
        HARNESS_TAX.reported.fableSwePiCost,
        "). Across shared models, the authors report geometric-mean cost ratios: Claude Code costs about ",
        HARNESS_TAX.reported.claudeCodeVsPiSwe,
        " as much as Pi and ",
        HARNESS_TAX.reported.claudeCodeVsCodexSwe,
        " as much as Codex on SWE-bench Lite, and ",
        HARNESS_TAX.reported.claudeCodeVsPiTb,
        " as much as Pi on Terminal-Bench 2.0. The average harness effect on success stays within ",
        HARNESS_TAX.reported.successEffectSwe,
        " on SWE-bench Lite and about ",
        HARNESS_TAX.reported.successEffectTb,
        " on Terminal-Bench 2.0.",
      ),
      paragraph(
        "The published SWE-bench Lite table’s largest same-model cost spread is ",
        lunaSweSpread.model,
        " at ",
        lunaSweSpread.low.costUsd,
        " in ",
        lunaSweSpread.low.harness,
        " and ",
        lunaSweSpread.high.costUsd,
        " in ",
        lunaSweSpread.high.harness,
        ", with success rates of ",
        lunaSweSpread.low.success,
        " and ",
        lunaSweSpread.high.success,
        ". That pairing is the comparison behind the authors’ “up to 5x” figure. They call paying more for essentially the same success a harness tax: a default agent pairing can hide that gap if you only look at resolve rate.",
      ),
      table(
        `HarnessTax SWE-bench Lite success rate and standardized cost per attempt, captured ${HARNESS_TAX.capturedOn}`,
        ["Model", "Harness", "Success rate", "Cost per attempt"],
        pairRows(HARNESS_TAX_SWE_PAIRS),
      ),
      table(
        `HarnessTax Terminal-Bench 2.0 success rate and standardized cost per attempt, captured ${HARNESS_TAX.capturedOn}`,
        ["Model", "Harness", "Success rate", "Cost per attempt"],
        pairRows(HARNESS_TAX_TB_PAIRS),
      ),
      paragraph(
        "GPT-5.6 Luna is the lowest-cost model on both benchmarks. Claude Fable 5 has the highest success rate on SWE-bench Lite. Kimi K3, an open-weight model, sits near GPT-5.6 Sol on the SWE-bench Lite cost-success frontier and just below the Terminal-Bench 2.0 frontier. Those ranks belong to this 30-task sample and price list, not to a general leaderboard.",
      ),
      heading("A four-tool harness stays on the frontier"),
      paragraph(
        "Pi reaches the published Pareto frontier on both benchmarks with four tools: ",
        HARNESS_TAX.reported.piTools,
        ". On SWE-bench Lite, Fable 5 averages ",
        HARNESS_TAX.reported.fableSwePiTurns,
        " turns per attempt in Pi and ",
        HARNESS_TAX.reported.fableSweClaudeCodeTurns,
        " in Claude Code, yet Claude Code costs about twice as much for a ",
        HARNESS_TAX.reported.fableSweSuccessLift,
        " increase in success. The authors treat that as higher spending per recorded turn, and they note that turn definitions differ by harness.",
      ),
      paragraph(
        "A harness tax can start on the first model call. Across all seven models on SWE-bench Lite, Claude Code’s mean initial context is ",
        HARNESS_TAX.reported.initialContextMultiple,
        " Pi’s, with longer instructions and larger tool definitions. Total spend still depends on caching, generated tokens, and later calls. The authors say richer harness features may still help other models, workloads, or interactive settings, so harness complexity is an empirical trade-off rather than a default upgrade.",
      ),
      heading("Models can lead outside their own harness"),
      paragraph(
        "Providers sometimes optimize a model for their own coding environment. The authors cite OpenAI’s description of GPT-5-Codex as optimized for software engineering in Codex. Across the six Anthropic and OpenAI models and both benchmarks, an alternative harness still posts the highest observed success rate in ",
        HARNESS_TAX.reported.alternativeWins,
        " comparisons. Reconstructing that count from the published tables, a comparison counts as an alternative win only when the provider harness is not among the pairs tied for the highest success rate.",
      ),
      list(
        ...alternativeWins.map(win => {
          const highest = win.highest
            .map(pair => `${pair.harness} at ${pair.success}`)
            .join(" and ");
          return [
            `${win.model} on ${win.benchmark}: ${highest}, ahead of ${win.own.harness} at ${win.own.success}.`,
          ];
        }),
      ),
      paragraph(
        "Two of those gaps are the ones the authors highlight. Claude Sonnet 4.6 solves ",
        HARNESS_TAX.reported.sonnetSweCodexSuccess,
        " of SWE-bench Lite attempts in Codex versus ",
        HARNESS_TAX.reported.sonnetSweClaudeCodeSuccess,
        " in Claude Code, at a similar cost. GPT-5.6 Sol on Terminal-Bench 2.0 reaches ",
        HARNESS_TAX.reported.solTbPiSuccess,
        " in Pi versus ",
        HARNESS_TAX.reported.solTbCodexSuccess,
        " in Codex, at about half the cost (",
        HARNESS_TAX.reported.solTbPiCost,
        " versus ",
        HARNESS_TAX.reported.solTbCodexCost,
        "). The authors’ line that ",
        `“${HARNESS_TAX.quotes.claudeMayNotNeedClaudeCode}”`,
        " applies to highest success in this sample.",
      ),
      callout(
        "What the nine of 12 count is",
        "It is a highest-success tally on six Anthropic and OpenAI models over two 30-task samples. It is not a cost ranking, a statistically tested harness effect, or a result for Kimi K3, which has no provider harness in this study.",
      ),
      heading("How to read HarnessTax beside the AI Charts chart"),
      paragraph(
        "The AI Charts coding-agent chart is a checked snapshot of the public ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents page" },
        `, retrieved ${retrievedAt}. It stores each model, harness, and effort setting with an AA Index score and mean cost per task. HarnessTax is not one of the site’s checked datasets. Its suites are SWE-bench Lite and Terminal-Bench 2.0, not the AA Index mix, so there is no supported conversion between the two scales.`,
      ),
      paragraph(
        storesPi
          ? "The snapshot stores a Pi harness row. That is still a name match, not the same run, effort setting, task sample, or price list."
          : [
            "The snapshot ",
            storesClaudeCode && storesCodex
              ? "stores Claude Code and Codex rows for several of the same model names. It does not store Pi."
              : storesClaudeCode
                ? "stores Claude Code rows and does not store Pi."
                : storesCodex
                  ? "stores Codex rows and does not store Pi."
                  : "does not store Pi.",
            " A shared model or harness name is not the same evaluation.",
          ].join(""),
      ),
      paragraph(
        { href: "/blog/real-swe-private-enterprise-benchmark", text: "Real-SWE" },
        " scores each model in its native harness on private production tasks. HarnessTax does the opposite measurement: it moves the same model across three harnesses on public suites. ",
        { href: "/blog/coding-agent-score-holdouts", text: "Public-suite holdouts" },
        " still matter here. The authors say these two open-source benchmarks may have appeared in training, and they treat that as a limit on generalization.",
      ),
      heading("Limits"),
      list(
        [
          `Every rate and cost belongs to ${HARNESS_TAX.tasksPerBenchmark} tasks per benchmark, three attempts, a ${HARNESS_TAX.turnCap}-turn cap, high-effort native settings, and the ${HARNESS_TAX.priceListDate} direct-API price list on the page captured ${HARNESS_TAX.capturedOn}.`,
        ],
        [
          "SWE-bench Lite and Terminal-Bench 2.0 are public suites. The authors say models may have encountered them during training, and they expect results to differ on other benchmarks and on real development workflows.",
        ],
        [
          `The average harness effect on success is a reported bound (${HARNESS_TAX.reported.successEffectSwe} and about ${HARNESS_TAX.reported.successEffectTb}), not a proof that harness choice never changes resolve rate.`,
        ],
        [
          "Cost is standardized token cost per attempt, not a subscription invoice, a cache-adjusted bill, or latency.",
        ],
        [
          "Turn counts are not comparable across harnesses. The first-call context comparison is a starting-tax observation, not a full cost decomposition.",
        ],
        [
          "The nine of 12 alternative-harness tally is a highest-success count on six models. Several of those gaps are small, and the published intervals overlap.",
        ],
        [
          "AI Charts snapshot rows that share a model or harness name come from a different suite, retrieval date, and effort setting. They must not be subtracted from or averaged with HarnessTax rates.",
        ],
      ),
    ],
  };
}
