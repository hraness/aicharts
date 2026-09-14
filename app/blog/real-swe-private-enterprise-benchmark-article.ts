import codingAgentData from "@/data/coding-agents.json";
import {
  parseCodingAgentSnapshot,
  type CodingAgentRecord,
  type CodingAgentSnapshot,
} from "@/lib/coding-agent-data";
import { codingAgentDatasetModifiedAt } from "@/lib/coding-agent-dataset";
import {
  formatSnapshotCostUsd,
  formatSnapshotScore,
} from "@/lib/coding-agent-snapshot-rows";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
import {
  realSweSnapshotOverlaps,
  type RealSweConfiguration,
  type RealSweHarness,
  type RealSweSnapshotOverlap,
} from "@/lib/real-swe-snapshot-overlap";

import {
  BLOG_AUTHORSHIP_DISCLOSURE,
  BLOG_SOURCES,
  callout,
  heading,
  list,
  paragraph,
  table,
  type BlogArticle,
  type BlogBlock,
  type InlineContent,
} from "./articles";

export const REAL_SWE_ARTICLE_SLUG = "real-swe-private-enterprise-benchmark" as const;
export const REAL_SWE_ARTICLE_PUBLISHED_AT = "2026-09-14" as const;

export type RealSweLeaderboardEntry = Readonly<{
  costNote?: string;
  costUsd: string;
  harness: RealSweHarness;
  meanOutputTokens: string;
  model: string;
  rank: string;
  resolution: string;
}>;

export type RealSweTask = Readonly<{
  name: string;
  /** Passed rollouts out of eight, in leaderboard model order. */
  passes: readonly [number, number, number, number, number, number, number, number];
  resolution: string;
}>;

export type RealSweFailureCategory = Readonly<{
  definition: string;
  name: string;
}>;

export type RealSweFailureProfile = Readonly<{
  /** Failed rollouts per category, in `failureCategories` order. */
  counts: readonly [number, number, number, number, number];
  failedRollouts: number;
  model: string;
}>;

export type RealSweInstructionComparison = Readonly<{
  benchmark: string;
  filesEdited: string;
  medianPromptChars: string;
}>;

const REAL_SWE_LEADERBOARD: readonly RealSweLeaderboardEntry[] = [
  { rank: "1", model: "Fable 5.1", harness: "Claude Code", resolution: "38.8%", costUsd: "$6.96", meanOutputTokens: "64k" },
  { rank: "2", model: "GPT-6 Astra", harness: "Codex CLI", resolution: "33.8%", costUsd: "$4.67", meanOutputTokens: "24k" },
  { rank: "3", model: "Gemini 3.8 Flash", harness: "Gemini CLI", resolution: "31.2%", costUsd: "$2.50", meanOutputTokens: "94k" },
  { rank: "4", model: "GLM 5.3", harness: "Claude Code", resolution: "28.8%", costUsd: "$5.12", meanOutputTokens: "117k" },
  { rank: "=5", model: "Grok 4.6", harness: "Grok Build", resolution: "23.8%", costUsd: "$3.44", costNote: "incomplete usage; actual cost may be higher", meanOutputTokens: "67k" },
  { rank: "=5", model: "Muse Spark 1.3", harness: "Muse Code", resolution: "23.8%", costUsd: "$2.74", meanOutputTokens: "87k" },
  { rank: "7", model: "Kimi K3", harness: "Kimi Code", resolution: "18.8%", costUsd: "$3.90", costNote: "incomplete usage; actual cost may be higher", meanOutputTokens: "43k" },
  { rank: "8", model: "GPT-5.6 Sol", harness: "Codex CLI", resolution: "16.2%", costUsd: "$2.65", meanOutputTokens: "23k" },
];

const REAL_SWE_TASKS: readonly RealSweTask[] = [
  { name: "Multi-region sweep", passes: [7, 8, 8, 2, 3, 8, 2, 5], resolution: "67.2%" },
  { name: "API keys & environments", passes: [8, 5, 7, 5, 4, 6, 0, 7], resolution: "65.6%" },
  { name: "Entitlement overage lines", passes: [8, 7, 5, 3, 1, 1, 6, 1], resolution: "50.0%" },
  { name: "Customer identity migration", passes: [3, 1, 3, 4, 8, 3, 4, 0], resolution: "40.6%" },
  { name: "Billing schedule migration", passes: [3, 1, 2, 2, 0, 0, 1, 0], resolution: "14.1%" },
  { name: "API token metering", passes: [1, 5, 0, 1, 0, 0, 1, 0], resolution: "12.5%" },
  { name: "S3 datastore measurement", passes: [0, 0, 0, 3, 2, 1, 1, 0], resolution: "10.9%" },
  { name: "Linearizable scan", passes: [0, 0, 0, 2, 1, 0, 0, 0], resolution: "4.7%" },
  { name: "Tax jurisdiction", passes: [1, 0, 0, 1, 0, 0, 0, 0], resolution: "3.1%" },
  { name: "Analytics stream reducer", passes: [0, 0, 0, 0, 0, 0, 0, 0], resolution: "0.0%" },
];

const REAL_SWE_FAILURE_CATEGORIES: readonly RealSweFailureCategory[] = [
  { name: "Unverified assumption", definition: "Builds on a guess about the system instead of checking it in the workspace." },
  { name: "Missed requirement", definition: "Leaves out behavior the instruction requires." },
  { name: "Integration error", definition: "Right idea, wired into the surrounding system incorrectly." },
  { name: "Regression", definition: "Breaks existing behavior while making the change." },
  { name: "Wrong file", definition: "Delivers the change somewhere the running application never calls, such as a one-off script." },
];

const REAL_SWE_FAILURE_PROFILES: readonly RealSweFailureProfile[] = [
  { model: "Fable 5.1", failedRollouts: 49, counts: [12, 18, 17, 2, 0] },
  { model: "GPT-6 Astra", failedRollouts: 53, counts: [18, 15, 18, 2, 0] },
  { model: "Gemini 3.8 Flash", failedRollouts: 55, counts: [6, 16, 27, 6, 0] },
  { model: "GLM 5.3", failedRollouts: 57, counts: [16, 22, 15, 0, 4] },
  { model: "Grok 4.6", failedRollouts: 61, counts: [15, 41, 5, 0, 0] },
  { model: "Muse Spark 1.3", failedRollouts: 61, counts: [12, 22, 25, 2, 0] },
  { model: "Kimi K3", failedRollouts: 65, counts: [10, 35, 18, 0, 2] },
  { model: "GPT-5.6 Sol", failedRollouts: 67, counts: [29, 21, 11, 6, 0] },
];

const REAL_SWE_INSTRUCTION_COMPARISON: readonly RealSweInstructionComparison[] = [
  { benchmark: "Real-SWE", medianPromptChars: "1,742", filesEdited: "11" },
  { benchmark: "FrontierCode", medianPromptChars: "2,056", filesEdited: "6" },
  { benchmark: "DeepSWE", medianPromptChars: "1,975", filesEdited: "6" },
  { benchmark: "Terminal-Bench 3", medianPromptChars: "1,584", filesEdited: "Not reported" },
  { benchmark: "FrontierSWE v2", medianPromptChars: "992", filesEdited: "Not reported" },
];

export const REAL_SWE = {
  authors: "Snagnik Das, Siddhant Paliwal, and Janak Sunil",
  capturedOn: "September 14, 2026 UTC",
  publishedIn: "September 2026",
  hackerNewsSubmittedOn: "September 12, 2026",
  quotes: {
    governingQuestion:
      "Can a coding agent actually do the work of a software engineer in the real world?",
    nativeHarnesses:
      "We use native harnesses to reflect how enterprise engineers work in practice, evaluating model-and-harness combinations rather than models in isolation.",
    resolutionDefinition:
      "Resolution rate is equivalent to pass@1, averaged over eight independent runs per task. 95% confidence intervals are shown.",
    outOfDistribution:
      "Tasks on private codebases are natively out of distribution.",
    weakerAtPatterns:
      "We’ve found that today’s models are weaker at understanding company coding patterns and frequently miss requirements or don’t verify their assumptions.",
    verifiers:
      "The verifiers are inspired by existing test suites in the codebase or use those tests verbatim.",
  },
  rollouts: {
    modelCount: 8,
    runsPerTask: 8,
    taskCount: 10,
    total: 640,
    perModel: 80,
    shortFailed: "70 of 98",
    shortFailedRate: "71.4%",
    longFailed: "398 of 542",
    longFailedRate: "73.4%",
  },
  leaderboard: REAL_SWE_LEADERBOARD,
  tasks: REAL_SWE_TASKS,
  tasksBelowFifteenPercent: 6,
  failureCategories: REAL_SWE_FAILURE_CATEGORIES,
  failureProfiles: REAL_SWE_FAILURE_PROFILES,
  failureShares: {
    grokMissedRequirement: "67.2%",
    kimiMissedRequirement: "53.8%",
    geminiIntegrationError: "49.1%",
    solUnverifiedAssumption: "43.3%",
  },
  instructionComparison: REAL_SWE_INSTRUCTION_COMPARISON,
  codebases: [
    "a Luma or Partiful competitor with more than 200,000 users and a top-100 App Store ranking",
    "a consumer fintech platform that processes more than 100,000 bank statements",
    "enterprise AI sales platforms with complex business workflows",
  ],
  services:
    "an AWS emulator, Docker, Kubernetes, GitHub, a Linear MCP server, PostgreSQL, MySQL, MongoDB, Gel, Redis, Go, Python, Node.js, Vitest, Slack, Intercom, Google Drive, email, and ClickUp",
  costRange: { low: "$2.50", high: "$6.96" },
  googleTransition: {
    announcedOn: "May 19, 2026",
    consumerCutoff: "June 18, 2026",
  },
} as const;

export const REAL_SWE_CONFIGURATIONS = REAL_SWE.leaderboard.map(entry => ({
  harness: entry.harness,
  model: entry.model,
  resolution: entry.resolution,
})) satisfies readonly (RealSweConfiguration & { resolution: string })[];

type RealSweChartConfiguration = (typeof REAL_SWE_CONFIGURATIONS)[number];

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

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

const SMALL_COUNT_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
] as const;

/** Spells out zero through nine in prose; larger counts stay numerals. */
export function spellCount(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Counts must be non-negative integers: ${value}`);
  }
  return SMALL_COUNT_WORDS[value] ?? String(value);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) throw new RangeError("Denominator must be positive.");
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/** Passed rollouts per model across the published sample, in leaderboard order. */
export function realSwePassTotals(): number[] {
  return REAL_SWE.leaderboard.map((_, modelIndex) =>
    sum(REAL_SWE.tasks.map(task => task.passes[modelIndex])));
}

/** Failed rollouts per category across every model, in `failureCategories` order. */
export function realSweFailureTotals(): number[] {
  return REAL_SWE.failureCategories.map((_, categoryIndex) =>
    sum(REAL_SWE.failureProfiles.map(profile => profile.counts[categoryIndex])));
}

export function realSweFailedRolloutTotal(): number {
  return sum(REAL_SWE.failureProfiles.map(profile => profile.failedRollouts));
}

export function realSweChartOverlaps(
  records: readonly CodingAgentRecord[],
): RealSweSnapshotOverlap<RealSweChartConfiguration>[] {
  return realSweSnapshotOverlaps(REAL_SWE_CONFIGURATIONS, records);
}

const NOT_IN_SNAPSHOT = "Not in the snapshot" as const;

function overlapRow(
  overlap: RealSweSnapshotOverlap<RealSweChartConfiguration>,
): InlineContent[] {
  const { configuration, record } = overlap;
  const pair = `${configuration.model} · ${configuration.harness}`;
  if (record === undefined) {
    return [
      textCell(pair),
      textCell(configuration.resolution),
      textCell(NOT_IN_SNAPSHOT),
      textCell("-"),
      textCell("-"),
    ];
  }
  return [
    textCell(pair),
    textCell(configuration.resolution),
    textCell(`${record.model} · ${record.agent} · ${record.setting}`),
    textCell(formatSnapshotScore(record.benchmarks.aaIndex)),
    textCell(formatSnapshotCostUsd(record.economics.costUsd)),
  ];
}

function overlapBlocks(snapshot: CodingAgentSnapshot, retrievedAt: string): BlogBlock[] {
  const overlaps = realSweChartOverlaps(snapshot.records);
  const present = overlaps.filter(overlap => overlap.record !== undefined);
  const missing = overlaps.filter(overlap => overlap.record === undefined);
  if (present.length === 0) {
    return [
      paragraph(
        `The snapshot retrieved ${retrievedAt} stores none of the ${spellCount(overlaps.length)} Real-SWE model and harness names, so the chart currently has no row to place beside any Real-SWE result.`,
      ),
    ];
  }
  const missingNames = missing.map(overlap =>
    `${overlap.configuration.model} in ${overlap.configuration.harness}`);
  const missingSentence = missing.length === 0
    ? "Every Real-SWE pair has a same-name row in the snapshot."
    : `${capitalize(spellCount(missing.length))} ${missing.length === 1 ? "pair has" : "pairs have"} no same-name row in the snapshot: ${missingNames.join(", ")}.`;
  return [
    paragraph(
      `The snapshot retrieved ${retrievedAt} stores ${spellCount(present.length)} of the ${spellCount(overlaps.length)} Real-SWE model and harness names. The table pairs each Real-SWE configuration with the snapshot row that shares its model and harness name at the highest stored effort setting. Real-SWE does not publish effort settings, so each row is a name match, not the same run. ${missingSentence}`,
    ),
    table(
      `Real-SWE pairs beside same-name rows in the AI Charts snapshot retrieved ${retrievedAt}`,
      ["Real-SWE pair", "Real-SWE resolution", "Snapshot row", "AA Index", "Mean cost per task"],
      overlaps.map(overlapRow),
    ),
    paragraph(
      "The two columns of scores measure different things. Real-SWE resolution is the share of 80 private-task rollouts that passed a company-derived verifier. AA Index is a composite of DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA on public task sets. A pair can therefore sit higher in one column than the other without either source being wrong, and the two values must not be subtracted, averaged, or plotted on one axis.",
    ),
  ];
}

export function createRealSweArticle(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): BlogArticle {
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    REAL_SWE_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(snapshot.source.retrievedAt),
    utcCalendarDate(codingAgentDatasetModifiedAt(snapshot)),
  );
  const [fable, astra, gemini, glm, grok, muse, kimi, sol] = REAL_SWE.leaderboard;
  const passTotals = realSwePassTotals();
  const fablePasses = passTotals[0];
  if (fablePasses === undefined) throw new Error("Leaderboard has no first entry.");
  const failureTotals = realSweFailureTotals();
  const failedTotal = realSweFailedRolloutTotal();
  const [unverifiedTotal, missedTotal, integrationTotal, regressionTotal, wrongFileTotal] = failureTotals;
  if (
    unverifiedTotal === undefined
    || missedTotal === undefined
    || integrationTotal === undefined
    || regressionTotal === undefined
    || wrongFileTotal === undefined
  ) {
    throw new Error("Failure taxonomy must have five categories.");
  }
  const modelColumns = REAL_SWE.leaderboard.map(entry => entry.model);

  return {
    authorshipDisclosure: BLOG_AUTHORSHIP_DISCLOSURE,
    slug: REAL_SWE_ARTICLE_SLUG,
    title: "What Real-SWE’s 38.8% on private enterprise code measures",
    dek:
      "Specific Labs licensed private production codebases and scored eight model-and-harness pairs over 640 rollouts. The leading 38.8% is an aggregate that per-task results reorder.",
    focusPhrase: "Real-SWE benchmark",
    seoDescription:
      "Real-SWE scores model-and-harness pairs on private enterprise code. See what its 38.8% top result covers, how per-task results reorder it, and its limits.",
    keywords: [
      "Real-SWE",
      "Specific Labs",
      "private enterprise codebases",
      "coding agent benchmark",
      "model and harness",
      "resolution rate",
    ],
    publishedAt: REAL_SWE_ARTICLE_PUBLISHED_AT,
    updatedAt,
    sourceIds: [
      "specificLabsRealSwe",
      "googleAntigravityCliTransition",
      "hackerNewsRealSwe",
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: ["coding-agent-score-holdouts", "aa-index-cost-coding-agents"],
    body: [
      paragraph(
        { href: BLOG_SOURCES.specificLabsRealSwe.url, text: "Real-SWE" },
        " is a coding-agent benchmark from Specific Labs, published in ",
        REAL_SWE.publishedIn,
        " by ",
        REAL_SWE.authors,
        ". Its tasks come from private production codebases that the company licensed from real businesses, and each result belongs to a model running inside its own native harness. The page captured ",
        REAL_SWE.capturedOn,
        " ranks ",
        fable.model,
        " in ",
        fable.harness,
        " first at ",
        fable.resolution,
        ", ",
        astra.model,
        " in ",
        astra.harness,
        " second at ",
        astra.resolution,
        ", and ",
        sol.model,
        " in ",
        sol.harness,
        " eighth at ",
        sol.resolution,
        ". The question Specific Labs puts on the page is: ",
        `“${REAL_SWE.quotes.governingQuestion}”`,
      ),
      paragraph(
        "This note explains what that 38.8% covers, why the per-task results reorder the leaderboard, which failure the tasks expose most often, and how to read the ranking beside the AI Charts coding-agent chart, which stores several of the same model and harness names from a different evaluation.",
      ),
      heading("What the resolution rate covers"),
      paragraph(
        `“${REAL_SWE.quotes.resolutionDefinition}” Pass@1 means the share of single attempts that pass, so a rate of 38.8% says that on average about four attempts in 10 produced a change the verifier accepted. The published analysis covers `,
        `${REAL_SWE.rollouts.taskCount} sample tasks, ${spellCount(REAL_SWE.rollouts.modelCount)} model and harness pairs, and ${spellCount(REAL_SWE.rollouts.runsPerTask)} runs per task, which is ${REAL_SWE.rollouts.total} rollouts in total and ${REAL_SWE.rollouts.perModel} per pair. The leaderboard rates match that sample: ${fable.model} passed ${fablePasses} of ${REAL_SWE.rollouts.perModel} rollouts in the task table below, which rounds to ${fable.resolution}.`,
      ),
      table(
        `Real-SWE leaderboard and estimated cost per rollout, captured ${REAL_SWE.capturedOn}`,
        ["Rank", "Model", "Harness", "Resolution rate", "Estimated cost per rollout"],
        REAL_SWE.leaderboard.map(entry => [
          textCell(entry.rank),
          textCell(entry.model),
          textCell(entry.harness),
          textCell(entry.resolution),
          textCell(entry.costNote === undefined ? entry.costUsd : `${entry.costUsd} (${entry.costNote})`),
        ]),
      ),
      paragraph(
        "Each agent ran in an isolated sandbox. Tasks use the Harbor format, and the grader injects the verifier only at grading time. ",
        `“${REAL_SWE.quotes.verifiers}” The leaderboard chart shows 95% confidence intervals, but the page does not print the interval values. The 10 tasks are a published sample; Specific Labs offers the sample on request and does not state how many tasks or codebases the full benchmark contains.`,
      ),
      heading("Why private production tasks are hard"),
      paragraph(
        "Specific Labs screened codebases for companies with substantial usage, strong engineering teams, and demanding production workloads. The disclosed examples are ",
        REAL_SWE.codebases[0],
        ", ",
        REAL_SWE.codebases[1],
        ", and ",
        REAL_SWE.codebases[2],
        ". The tasks are changes those companies’ engineers were paid to make: correcting invoice tax across differently configured businesses, migrating customer identities, and metering API tokens. The published tax example asks the agent to price destination tax through a TaxJar sandbox or production authority, report refused addresses without stopping the invoice, file settled sales back under the invoice number, and show both VAT registrations on invoices between European parties.",
      ),
      paragraph(
        "Each environment exposes only the services its workflow needs. Across the task set those services include ",
        REAL_SWE.services,
        ". An agent therefore works across code, infrastructure, and business tools in one rollout, rather than against a repository and a test suite alone.",
      ),
      paragraph(
        "The instructions are not longer than those of comparable benchmarks. The work behind them is wider. Specific Labs reports medians for its own tasks and for four other suites; the FrontierCode and DeepSWE figures come from Cognition’s published comparison, and no files-edited figure exists for Terminal-Bench 3 or FrontierSWE v2. The prompt-length measurement covers eight repository-backed sample tasks, while the results table covers 10, and the page does not reconcile the two counts.",
      ),
      table(
        "Median instruction length and files edited by the reference solution, as reported by Specific Labs",
        ["Benchmark", "Median instruction (characters)", "Median files edited"],
        REAL_SWE.instructionComparison.map(row => [
          textCell(row.benchmark),
          textCell(row.medianPromptChars),
          textCell(row.filesEdited),
        ]),
      ),
      paragraph(
        "Short rollouts failed about as often as long ones. ",
        `${REAL_SWE.rollouts.shortFailedRate} of rollouts under 10 minutes failed (${REAL_SWE.rollouts.shortFailed}), against ${REAL_SWE.rollouts.longFailedRate} of rollouts of 10 minutes or longer (${REAL_SWE.rollouts.longFailed}). Specific Labs attributes the difficulty to triaging several systems and understanding requirements inside codebases full of existing business logic and coding patterns, not to agents giving up early.`,
      ),
      heading("Per-task results reorder the leaderboard"),
      paragraph(
        `${capitalize(spellCount(REAL_SWE.tasksBelowFifteenPercent))} of the ${REAL_SWE.rollouts.taskCount} sample tasks resolve below 15%. Two tasks resolve above 65% across all eight pairs, and one task, Analytics stream reducer, resolves in none of its 64 rollouts. The table lists passed rollouts out of eight for every pair, in leaderboard order.`,
      ),
      table(
        "Passed rollouts out of eight per task and model, as reported by Specific Labs",
        ["Task", ...modelColumns, "All pairs"],
        REAL_SWE.tasks.map(task => [
          textCell(task.name),
          ...task.passes.map(passes => textCell(`${passes}/8`)),
          textCell(task.resolution),
        ]),
      ),
      paragraph(
        "The aggregate order does not survive contact with individual tasks. On Customer identity migration, ",
        grok.model,
        " passed 8 of 8 while ",
        astra.model,
        " passed 1 of 8 and ",
        sol.model,
        " passed none. On S3 datastore measurement, the three highest-ranked pairs all passed 0 of 8 while ",
        glm.model,
        " passed 3 and ",
        grok.model,
        " passed 2. On API token metering, ",
        astra.model,
        " passed 5 of 8 while ",
        fable.model,
        " passed 1 and ",
        gemini.model,
        " passed none. On Entitlement overage lines, ",
        kimi.model,
        " passed 6 of 8 while ",
        grok.model,
        ", ",
        muse.model,
        ", and ",
        sol.model,
        " each passed 1.",
      ),
      callout(
        "How to use the aggregate",
        "Use the leaderboard to shortlist pairs, then look for the task class closest to your change. A pair that leads the aggregate can be the worst option for a migration or a datastore change in this sample, and a pair in the bottom half can be the only one that resolves a task reliably.",
      ),
      heading("Missed requirements are the most common failure"),
      paragraph(
        "Specific Labs groups failed rollouts by observed submission behavior, following the DeepSWE taxonomy and applying it to every model in the same way:",
      ),
      list(
        ...REAL_SWE.failureCategories.map(category => [
          { emphasis: "strong" as const, text: category.name },
          `: ${category.definition}`,
        ]),
      ),
      table(
        "Failed rollouts per category and model, as reported by Specific Labs, with totals across all eight pairs",
        ["Model", "Failed rollouts", ...REAL_SWE.failureCategories.map(category => category.name)],
        [
          ...REAL_SWE.failureProfiles.map(profile => [
            textCell(profile.model),
            textCell(String(profile.failedRollouts)),
            ...profile.counts.map(count => textCell(String(count))),
          ]),
          [
            textCell("All eight pairs"),
            textCell(String(failedTotal)),
            ...failureTotals.map(total => textCell(String(total))),
          ],
        ],
      ),
      paragraph(
        `Across the ${failedTotal} failed rollouts, missed requirement accounts for ${missedTotal} (${formatPercent(missedTotal, failedTotal)}), integration error for ${integrationTotal}, unverified assumption for ${unverifiedTotal}, regression for ${regressionTotal}, and wrong file for ${wrongFileTotal}. The mix differs by model. `,
        grok.model,
        ` attributes ${REAL_SWE.failureShares.grokMissedRequirement} of its failures to missed requirements and `,
        kimi.model,
        ` ${REAL_SWE.failureShares.kimiMissedRequirement}. `,
        gemini.model,
        ` fails most often by integration error (${REAL_SWE.failureShares.geminiIntegrationError}), and `,
        sol.model,
        ` most often by unverified assumption (${REAL_SWE.failureShares.solUnverifiedAssumption}). Regressions and wrong-file deliveries are rare for every pair.`,
      ),
      paragraph(
        `Specific Labs draws one conclusion from that pattern: “${REAL_SWE.quotes.weakerAtPatterns}” For a team pointing an agent at its own repository, the largest failure bucket in this sample is requirement capture against existing conventions, not code generation.`,
      ),
      heading("Cost per rollout"),
      paragraph(
        `Estimated cost per rollout ranges from ${REAL_SWE.costRange.low} for `,
        gemini.model,
        ` to ${REAL_SWE.costRange.high} for `,
        fable.model,
        ". The highest resolution is also the most expensive rollout, but the relationship is not monotonic: ",
        glm.model,
        ` cost ${glm.costUsd} for ${glm.resolution}, while `,
        gemini.model,
        ` reached ${gemini.resolution} at less than half that cost. Specific Labs flags the `,
        grok.model,
        " and ",
        kimi.model,
        " figures as incomplete usage whose actual cost may be higher. Mean output tokens per rollout range from ",
        `${sol.meanOutputTokens} for ${sol.model} and ${astra.meanOutputTokens} for ${astra.model} to ${glm.meanOutputTokens} for ${glm.model}. These are evaluation estimates for this sample, not a price list.`,
      ),
      heading("The harness is part of the measurement"),
      paragraph(
        `“${REAL_SWE.quotes.nativeHarnesses}” Each score therefore belongs to a pair. `,
        gemini.model,
        " ran in ",
        gemini.harness,
        ", and Google ",
        { href: BLOG_SOURCES.googleAntigravityCliTransition.url, text: "announced" },
        ` on ${REAL_SWE.googleTransition.announcedOn} that it is transitioning Gemini CLI to Antigravity CLI, which shares a server-side harness with the Antigravity desktop application. The notice set ${REAL_SWE.googleTransition.consumerCutoff} as the date consumer Gemini CLI access would stop serving requests, while enterprise licenses and paid API keys keep Gemini CLI available. Commenters in the launch discussion raised the same harness question. The `,
        gemini.resolution,
        " result is specific to the Gemini CLI pairing. A result for the same model in Antigravity would be a different measurement, not a correction, and the same holds for any other model moved to a different harness.",
      ),
      heading("How to read Real-SWE beside the AI Charts chart"),
      paragraph(
        "The AI Charts coding-agent chart is a checked snapshot of the public ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents page" },
        `, retrieved ${retrievedAt}. It stores each model, harness, and effort setting with an AA Index score, its component benchmarks, mean cost per task, active time, and token use. Real-SWE is not one of the site’s checked datasets, and Specific Labs publishes no resolve-rate comparison between Real-SWE and any public suite, so there is no supported conversion between the two scales.`,
      ),
      ...overlapBlocks(snapshot, retrievedAt),
      heading("Private provenance trades reproducibility for contamination resistance"),
      paragraph(
        `“${REAL_SWE.quotes.outOfDistribution}” Specific Labs argues that the code and its solutions are not available on the public internet and states that 99% of tokens in real-world enterprises are hidden from frontier models. The page asserts this from provenance; it reports no contamination measurement against the evaluated models.`,
      ),
      paragraph(
        "The same design removes the usual external check. Tasks and verifiers stay private, the published sample is available on request, and nobody outside Specific Labs can rerun the evaluation and post a differing result. In the ",
        { href: BLOG_SOURCES.hackerNewsRealSwe.url, text: "Hacker News discussion" },
        ` submitted on ${REAL_SWE.hackerNewsSubmittedOn}, commenters objected that a benchmark whose code cannot be inspected asks readers to take the result on trust, others replied that transparency is the price of a benchmark that is harder to game, and one commenter who runs a benchmark in another domain argued that contamination should be measured every time. Those are practitioner reactions, not measurements, but they name the trade a reader accepts when using a private-task leaderboard.`,
      ),
      heading("Limits"),
      list(
        [
          `Every rate, cost, token count, and failure share belongs to the ${REAL_SWE.rollouts.taskCount}-task published sample, the named model and harness pairs, and the eight-run protocol on the page captured ${REAL_SWE.capturedOn}. The full benchmark is larger and unpublished, and the page can change.`,
        ],
        [
          "Resolution is pass@1 averaged over eight runs. It does not report how close a failed rollout came, and the 95% intervals drawn on the leaderboard chart are not printed as numbers.",
        ],
        [
          "Scores are harness-specific. Gemini 3.8 Flash in Gemini CLI, GLM 5.3 in Claude Code, and Kimi K3 in Kimi Code are pairs; the same model in another harness is a different measurement.",
        ],
        [
          "Specific Labs publishes no resolve-rate crosswalk to SWE-bench-style public suites. Its only cross-benchmark figures are median instruction length and median files edited, and the prompt-length medians cover eight sample tasks while the results cover 10.",
        ],
        [
          "Estimated cost per rollout is an evaluation estimate with incomplete usage for two pairs. It is not a subscription price or a production invoice.",
        ],
        [
          "The snapshot rows in this note share model and harness names with Real-SWE pairs. They come from public task sets, from effort settings that Real-SWE does not publish, and from a different retrieval date, and they must not be compared numerically with Real-SWE resolution.",
        ],
        [
          "Private tasks cannot be independently rerun. The out-of-distribution claim rests on provenance and licensing terms that Specific Labs does not disclose.",
        ],
      ),
    ],
  };
}
