import intelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import type { ArtificialAnalysisIntelligenceRecord } from "@/lib/artificial-analysis-intelligence-data";
import {
  parseArtificialAnalysisIntelligenceV43Snapshot,
  type ArtificialAnalysisIntelligenceV43Snapshot,
} from "@/lib/artificial-analysis-intelligence-v4-3-data";
import {
  formatSnapshotCostUsd,
  formatSnapshotScore,
} from "@/lib/coding-agent-snapshot-rows";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
import {
  MIMO_V26_NAMED_COMPARISONS,
  comparableTaskCost,
  formatCostMultiple,
  formatPointGap,
  mimoClosedReferences,
  mimoComparisonRows,
  mimoFrontierPosition,
  mimoScoreNeighbors,
  type MimoComparisonRow,
  type MimoFrontierPosition,
} from "@/lib/mimo-v2-6-pro-frontier";
import { spellCount } from "./real-swe-private-enterprise-benchmark-article";

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

export const MIMO_V26_ARTICLE_SLUG = "mimo-v2-6-pro-cost-frontier" as const;
export const MIMO_V26_ARTICLE_PUBLISHED_AT = "2026-09-22" as const;
export const MIMO_V26 = {
  releaseNoteUpdatedOn: "September 22, 2026",
  capturedOn: "September 22, 2026",
  artificialAnalysisReleaseDate: "September 21, 2026",
  postedOn: "September 22, 2026",
  author: "Deedy Das",
  authorHandle: "@deedydas",
  authorRole: "a partner at Menlo Ventures",
  model: {
    totalParameters: "1.02 trillion",
    activeParameters: "42 billion",
    contextTokens: "1 million",
    license: "MIT",
    modalities: "text, image, video, and audio input with text output",
    flashTotalParameters: "310 billion",
    flashActiveParameters: "15 billion",
  },
  xiaomi: {
    indexScore: "46",
    openClaim:
      "surpassing Kimi K3 and Qwen3.8 Max to become the most powerful open-source model available",
    closedGap: "Claude Fable 5.1 and GPT-6 Astra",
    pricingClaim: "adopts the same API pricing as the V2.5 series",
    ultraSpeedClaim: "up to 20x inference speed",
    rlSteps: "30",
    rlDays: "less than six days",
    rlTrajectories: "approximately 750,000",
    rlCostPro: "2.62 million",
    rlCostFlash: "850,000",
    deepSweBefore: "58.4",
    deepSweAfter: "72.6",
    samplesPerStep: "1,568",
    tokensPerStep: "2.7 to 3.7 billion",
    environments: "more than 7,000",
    heldOutHarnessesFrom: "about 50%",
    heldOutHarnessesTo: "66%",
  },
  artificialAnalysis: {
    indexScore: "46",
    classRank: "first of 114",
    inputPrice: "$0.435",
    outputPrice: "$0.87",
    cacheDiscount: "99%",
    outputSpeed: "110.8",
    costPerTask: "$0.13",
    indexRunCost: "$206.66",
    indexTokens: "140 million",
    classMedianScore: "18",
  },
  openRouter: {
    proInput: "$0.435",
    proOutput: "$0.87",
    proCacheRead: "$0.0036",
    ultraSpeedInput: "$4.35",
    ultraSpeedOutput: "$8.70",
    ultraSpeedCacheRead: "$0.036",
    ultraSpeedMultiple: "10x",
  },
  /** Table 3 of the model card and technical report. Pro, Flash, MiMo-V2.5-Pro, Claude Opus 5, GPT-5.6 Sol, Claude Fable 5. */
  reported: {
    cyberGymPro: "94.0",
    cyberGymFlash: "95.1",
    cyberGymV25: "40.0",
    exploitGymPro: "17.8",
    exploitGymSol: "30.3",
    exploitBenchPro: "47.9",
    exploitBenchSol: "78.5",
    secBenchProPro: "66.3",
    secBenchProSol: "79.1",
    deepSwePro: "71.9",
    deepSweOpus: "74.0",
    terminalBench4Pro: "34.9",
    terminalBench4Opus: "49.0",
    automationBenchPro: "53.1",
    automationBenchOpus: "50.3",
    gdpvalPro: "1673",
    gdpvalOpus: "1708",
  },
  das: {
    cheaperThanKimi: "15x cheaper than Kimi K3",
    cheaperThanGlm: "6x cheaper than GLM 5.3",
    cheaperThanDeepSeek: "2x cheaper than DeepSeek V4",
    dearerThanFlash: "only 2x more expensive than DeepSeek V4.1 Flash",
    assumptions: "assuming agentic coding and how much is cache hits",
    ultraSpeedThroughput: "3x throughput on OpenRouter",
    ultraSpeedMedian: "150",
    ultraSpeedPrice: "10x the net price",
    cyberGym: "95",
    verdict:
      "too early to tell if it’s the best open source model, but it is a pretty strong contender",
  },
} as const;

function checkedSnapshot(): ArtificialAnalysisIntelligenceV43Snapshot {
  const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceData);
  if (!parsed.ok) {
    throw new Error(`Checked Intelligence Index snapshot is invalid: ${parsed.error.message}`, {
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

const taskCost = comparableTaskCost;

function formatTokens(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pluralConfigurations(count: number): string {
  return count === 1 ? "the one configuration" : `the ${spellCount(count)} configurations`;
}

function textCell(value: string): InlineContent {
  return [value];
}

function scoreCostCells(record: ArtificialAnalysisIntelligenceRecord): InlineContent[] {
  return [
    textCell(record.name),
    textCell(formatSnapshotScore(record.intelligenceIndex)),
    textCell(formatSnapshotCostUsd(taskCost(record))),
  ];
}

function frontierBlocks(
  position: MimoFrontierPosition,
  retrievedAt: string,
): BlogBlock[] {
  const { above, below, bestCheaper, cheapestHigher, cheaperCount, higherCount, onCostFrontier, record } = position;
  const cost = taskCost(record);
  const blocks: BlogBlock[] = [
    paragraph(
      `In the snapshot retrieved ${retrievedAt}, MiMo-V2.6-Pro scores ${formatSnapshotScore(record.intelligenceIndex)} at ${formatSnapshotCostUsd(cost)} per Intelligence Index task and used ${formatTokens(record.outputTokensPerTask.total)} output tokens per task. `,
      onCostFrontier
        ? "It is on the cost frontier: no configuration in the comparable cohort scores higher at the same or lower cost per task."
        : "It is not on the cost frontier in this snapshot: at least one configuration scores higher at the same or lower cost per task.",
    ),
  ];
  if (onCostFrontier && (above !== undefined || below !== undefined)) {
    const neighbors: string[] = [];
    if (below !== undefined) {
      neighbors.push(`${below.name} at ${formatSnapshotScore(below.intelligenceIndex)} for ${formatSnapshotCostUsd(taskCost(below))} below it`);
    }
    if (above !== undefined) {
      neighbors.push(`${above.name} at ${formatSnapshotScore(above.intelligenceIndex)} for ${formatSnapshotCostUsd(taskCost(above))} above it`);
    }
    blocks.push(paragraph(
      `Its frontier neighbors are ${neighbors.join(", and ")}. `,
      above === undefined
        ? "No configuration on the frontier scores higher."
        : `The next step up the frontier buys ${(above.intelligenceIndex - record.intelligenceIndex).toFixed(1)} points for ${formatCostMultiple(taskCost(above) / cost)} the cost.`,
    ));
  }
  const counts: string[] = [];
  if (cheapestHigher === undefined) {
    counts.push("No configuration in the cohort scores higher.");
  } else if (onCostFrontier) {
    counts.push(`${capitalize(pluralConfigurations(higherCount))} that score higher all cost more; the cheapest of them, ${cheapestHigher.record.name}, costs ${formatCostMultiple(cheapestHigher.multiple)} as much per task.`);
  } else {
    counts.push(`The cheapest configuration that scores higher, ${cheapestHigher.record.name}, costs ${formatCostMultiple(cheapestHigher.multiple)} as much per task.`);
  }
  if (bestCheaper === undefined) {
    counts.push("No configuration in the cohort costs less per task.");
  } else if (onCostFrontier) {
    counts.push(`${capitalize(pluralConfigurations(cheaperCount))} that cost less all score lower; the best of them, ${bestCheaper.record.name}, scores ${formatSnapshotScore(bestCheaper.record.intelligenceIndex)}, ${bestCheaper.gapPoints.toFixed(1)} points below.`);
  } else {
    counts.push(`The best-scoring configuration that costs less, ${bestCheaper.record.name}, scores ${formatSnapshotScore(bestCheaper.record.intelligenceIndex)}, ${formatPointGap(-bestCheaper.gapPoints)} points against MiMo-V2.6-Pro.`);
  }
  blocks.push(paragraph(counts.join(" ")));
  return blocks;
}

function neighborBlocks(
  neighbors: readonly ArtificialAnalysisIntelligenceRecord[],
  mimo: ArtificialAnalysisIntelligenceRecord,
  retrievedAt: string,
): BlogBlock[] {
  if (neighbors.length < 2) {
    return [
      paragraph(
        `The snapshot retrieved ${retrievedAt} stores ${spellCount(neighbors.length)} other configuration${neighbors.length === 1 ? "" : "s"} within one index point of MiMo-V2.6-Pro, so this note does not tabulate same-score neighbors.`,
      ),
    ];
  }
  const mimoCost = taskCost(mimo);
  return [
    paragraph(
      `${capitalize(spellCount(neighbors.length))} other configurations in the snapshot score within one index point of MiMo-V2.6-Pro. The table lists them cheapest first, with each cost as a multiple of MiMo-V2.6-Pro’s ${formatSnapshotCostUsd(mimoCost)}.`,
    ),
    table(
      `Configurations within one Intelligence Index point of MiMo-V2.6-Pro in the AI Charts snapshot retrieved ${retrievedAt}`,
      ["Configuration", "Intelligence Index", "Cost per task", "Multiple of MiMo-V2.6-Pro’s cost", "Output tokens per task"],
      neighbors.map(record => [
        ...scoreCostCells(record),
        textCell(formatCostMultiple(taskCost(record) / mimoCost)),
        textCell(formatTokens(record.outputTokensPerTask.total)),
      ]),
    ),
  ];
}

function comparisonBlocks(
  rows: readonly MimoComparisonRow[],
  retrievedAt: string,
): BlogBlock[] {
  if (rows.length < 2) {
    return [
      paragraph(
        `The snapshot retrieved ${retrievedAt} stores ${spellCount(rows.length)} of the ${spellCount(MIMO_V26_NAMED_COMPARISONS.length)} models Das and Xiaomi name, so this note cannot place his price multiples beside measured cost per task.`,
      ),
    ];
  }
  const missing = MIMO_V26_NAMED_COMPARISONS.length - rows.length;
  return [
    table(
      `Models Das and Xiaomi name, as stored in the AI Charts snapshot retrieved ${retrievedAt}. The measured multiple is the configuration’s cost per Intelligence Index task divided by MiMo-V2.6-Pro’s. Das’s multiples are restated in the same direction, so his “2x more expensive than DeepSeek V4.1 Flash” appears as 0.5x.`,
      ["Configuration", "Intelligence Index", "Cost per task", "Measured multiple of MiMo-V2.6-Pro’s cost", "Das’s stated multiple of MiMo-V2.6-Pro’s price"],
      rows.map(row => [
        ...scoreCostCells(row.record),
        textCell(`${formatCostMultiple(row.costMultiple)} (${formatPointGap(row.scoreGapPoints)} points)`),
        textCell(row.comparison.dasMultiple ?? "not stated"),
      ]),
    ),
    ...(missing === 0 ? [] : [
      paragraph(
        `${capitalize(spellCount(missing))} of the named models ${missing === 1 ? "has" : "have"} no same-name row in this snapshot.`,
      ),
    ]),
  ];
}

export function createMimoV26Article(
  snapshot: ArtificialAnalysisIntelligenceV43Snapshot = checkedSnapshot(),
): BlogArticle {
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    MIMO_V26_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(snapshot.source.retrievedAt),
  );
  const position = mimoFrontierPosition(snapshot.records);
  const comparisons = mimoComparisonRows(snapshot.records);
  const neighbors = mimoScoreNeighbors(snapshot.records);
  const closed = mimoClosedReferences(snapshot.records);
  const indexVersion = snapshot.benchmark.version;

  const snapshotBlocks: BlogBlock[] = position === undefined
    ? [
        paragraph(
          `The snapshot retrieved ${retrievedAt} does not store a MiMo-V2.6-Pro row that meets the comparable-cohort rule, so this note cannot place the model on the site’s cost frontier yet.`,
        ),
      ]
    : [
        ...frontierBlocks(position, retrievedAt),
        ...neighborBlocks(neighbors, position.record, retrievedAt),
      ];

  const xiaomiComparators = comparisons.filter(row => row.comparison.namedBy !== "Das");
  const comparatorSentence = xiaomiComparators.length === 0
    ? "The snapshot stores neither comparator by name."
    : `The snapshot stores ${xiaomiComparators.map(row => `${row.record.name} at ${formatSnapshotScore(row.record.intelligenceIndex)}`).join(" and ")}, ${xiaomiComparators.every(row => row.scoreGapPoints < 0) ? "both below" : "not both below"} MiMo-V2.6-Pro${position === undefined ? "" : `’s ${formatSnapshotScore(position.record.intelligenceIndex)}`}${xiaomiComparators.length === 1 ? ", with the other comparator absent" : ""}.`;
  const closedSentence = closed.length === 0
    ? "The snapshot stores neither of the closed models Xiaomi names at a comparable configuration."
    : `In the snapshot, ${closed.map(record => `${record.name} scores ${formatSnapshotScore(record.intelligenceIndex)} at ${formatSnapshotCostUsd(taskCost(record))}`).join(" and ")}.`;

  return {
    authorshipDisclosure: BLOG_AUTHORSHIP_DISCLOSURE,
    slug: MIMO_V26_ARTICLE_SLUG,
    title: "What MiMo-V2.6-Pro’s 46 at $0.13 per task measures",
    dek:
      "On the September 22, 2026 Intelligence Index snapshot, Xiaomi’s open-weights flagship scores within a point of GPT-5.6 Sol and Grok 4.7 at less than a tenth of their cost per task. Its cybersecurity lead is on one kind of task, measured by Xiaomi.",
    focusPhrase: "MiMo-V2.6-Pro Intelligence Index cost",
    seoDescription:
      "Xiaomi’s MiMo-V2.6-Pro scores 46 on the Intelligence Index at $0.13 per task. See where it sits on the measured cost frontier and what its cyber scores show.",
    keywords: [
      "MiMo-V2.6-Pro",
      "Xiaomi MiMo",
      "open-weights model",
      "Artificial Analysis Intelligence Index",
      "cost per task",
      "Pareto frontier",
      "CyberGym",
    ],
    publishedAt: MIMO_V26_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "AI model benchmarks",
    sourceIds: [
      "deedyDasMimoV26",
      "xiaomiMimoV26Release",
      "xiaomiMimoV26ModelCard",
      "xiaomiMimoV26TechnicalReport",
      "artificialAnalysisMimoV26Pro",
      "openRouterMimoV26ProUltraSpeed",
      "artificialAnalysisIntelligenceIndex",
    ],
    relatedSlugs: [
      "open-models-coding-agent-benchmarks",
      "aa-index-cost-coding-agents",
      "small-models-have-arrived",
    ],
    nextStep: {
      title: "Compare current Intelligence Index configurations",
      description:
        "The capability and cost chart plots every comparable configuration in the current snapshot with its cost frontier. The data page defines the index, its evaluations, and its comparison rules.",
      links: [
        { href: "/#intelligence-index", label: "Capability and cost chart" },
        { href: "/data", label: "Benchmark definitions and data" },
      ],
    },
    body: [
      paragraph(
        "Xiaomi announced the MiMo-V2.6 series in a release note dated ",
        MIMO_V26.releaseNoteUpdatedOn,
        ", with weights, a technical report, training environments, and training code published together. The flagship, MiMo-V2.6-Pro, is a sparse mixture-of-experts model with ",
        MIMO_V26.model.totalParameters,
        " total and ",
        MIMO_V26.model.activeParameters,
        " active parameters, a context window of ",
        MIMO_V26.model.contextTokens,
        " tokens, ",
        MIMO_V26.model.modalities,
        ", and an ",
        MIMO_V26.model.license,
        " license. Xiaomi’s ",
        { href: BLOG_SOURCES.xiaomiMimoV26Release.url, text: "release note" },
        " says the model scores ",
        MIMO_V26.xiaomi.indexScore,
        " on the Artificial Analysis Intelligence Index, “",
        MIMO_V26.xiaomi.openClaim,
        ",” while conceding a gap to ",
        MIMO_V26.xiaomi.closedGap,
        ".",
      ),
      paragraph(
        "The same day, ",
        MIMO_V26.author,
        " (",
        MIMO_V26.authorHandle,
        "), ",
        MIMO_V26.authorRole,
        ", ",
        { href: BLOG_SOURCES.deedyDasMimoV26.url, text: "posted on X" },
        " that he had tried the model and was impressed: it was very cheap against Kimi K3, GLM 5.3, and DeepSeek V4, was in his words “unquestionably on the Pareto frontier,” answered a cybersecurity prompt that he says most models refuse, offered a faster paid mode, and handled video, speech, and music tasks well. He concluded that it is “",
        MIMO_V26.das.verdict,
        ".”",
      ),
      paragraph(
        "This note checks the parts of those claims that primary sources and the AI Charts Intelligence Index snapshot can test: what the 46 measures, where the model sits on the measured cost frontier, how Das’s price multiples compare with measured cost per task, what the faster mode costs, and what the cybersecurity numbers do and do not show. Observations that only Das made are labeled as his.",
      ),
      heading("What the 46 measures"),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.artificialAnalysisIntelligenceIndex.url, text: "Artificial Analysis Intelligence Index" },
        ` is a composite of ${spellCount(snapshot.benchmark.evaluationCount)} independently run evaluations, weighted ${snapshot.benchmark.categoryWeightsPercent.agents}% agents, ${snapshot.benchmark.categoryWeightsPercent.coding}% coding, ${snapshot.benchmark.categoryWeightsPercent.scientific}% scientific reasoning, and ${snapshot.benchmark.categoryWeightsPercent.general}% general capability. The current version is ${indexVersion}, and its components are ${snapshot.benchmark.evaluations.join(", ")}. Xiaomi’s 46 is Artificial Analysis’s measurement, not a self-reported score.`,
      ),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.artificialAnalysisMimoV26Pro.url, text: "Artificial Analysis model page" },
        ", captured ",
        MIMO_V26.capturedOn,
        " UTC, lists the model as open weights, released ",
        MIMO_V26.artificialAnalysisReleaseDate,
        ", with an index score of ",
        MIMO_V26.artificialAnalysis.indexScore,
        ", ranked ",
        MIMO_V26.artificialAnalysis.classRank,
        " in its comparison class of large open-weights models, where the median score is ",
        MIMO_V26.artificialAnalysis.classMedianScore,
        ". It records Xiaomi’s API prices of ",
        MIMO_V26.artificialAnalysis.inputPrice,
        " per million input tokens and ",
        MIMO_V26.artificialAnalysis.outputPrice,
        " per million output tokens with a ",
        MIMO_V26.artificialAnalysis.cacheDiscount,
        " cache discount, an output speed of ",
        MIMO_V26.artificialAnalysis.outputSpeed,
        " tokens per second on Xiaomi’s API, and a weighted cost of ",
        MIMO_V26.artificialAnalysis.costPerTask,
        " per index task. Running the whole index generated ",
        MIMO_V26.artificialAnalysis.indexTokens,
        " output tokens and cost ",
        MIMO_V26.artificialAnalysis.indexRunCost,
        ", which the page calls somewhat verbose for its class.",
      ),
      paragraph(
        "Xiaomi’s own evaluation table, printed in the ",
        { href: BLOG_SOURCES.xiaomiMimoV26ModelCard.url, text: "model card" },
        " and the technical report, shows a profile the composite hides. Against Claude Opus 5 in Xiaomi’s runs, MiMo-V2.6-Pro is close on agentic knowledge work (GDPval-AA ",
        MIMO_V26.reported.gdpvalPro,
        " against ",
        MIMO_V26.reported.gdpvalOpus,
        "; AutomationBench ",
        MIMO_V26.reported.automationBenchPro,
        " against ",
        MIMO_V26.reported.automationBenchOpus,
        ") and on long-horizon coding (DeepSWE v1.1 ",
        MIMO_V26.reported.deepSwePro,
        " against ",
        MIMO_V26.reported.deepSweOpus,
        "), and well behind on terminal work (Terminal-Bench 4.0 ",
        MIMO_V26.reported.terminalBench4Pro,
        " against ",
        MIMO_V26.reported.terminalBench4Opus,
        "). Those are Xiaomi’s own runs under its evaluation setup, so they show the shape of the model rather than an independent ranking.",
      ),
      heading("Where it sits on the measured cost frontier"),
      paragraph(
        "The AI Charts capability and cost chart is a checked snapshot of the public ",
        { href: BLOG_SOURCES.artificialAnalysisIntelligenceIndex.url, text: "Artificial Analysis models leaderboard" },
        `, restricted to current, non-estimated configurations with a complete per-task cost breakdown under index version ${indexVersion}. Cost per task is Artificial Analysis’s weighted average of what each evaluation cost at the provider’s list prices, including cached input, so it already reflects the token mix each model produced.`,
      ),
      ...snapshotBlocks,
      heading("Das’s price multiples against measured cost per task"),
      paragraph(
        "Das wrote that “with some standard assumptions” the model is “",
        MIMO_V26.das.cheaperThanKimi,
        ", ",
        MIMO_V26.das.cheaperThanGlm,
        " and ",
        MIMO_V26.das.cheaperThanDeepSeek,
        " and ",
        MIMO_V26.das.dearerThanFlash,
        "” (“",
        MIMO_V26.das.assumptions,
        "”). Those are estimates from list prices under a workload he assumed, not measured costs. He also quoted Xiaomi’s prices of ",
        MIMO_V26.openRouter.proCacheRead,
        " per million cached input tokens, ",
        MIMO_V26.openRouter.proInput,
        " per million input tokens, and ",
        MIMO_V26.openRouter.proOutput,
        " per million output tokens, which match the Artificial Analysis page and the first-party endpoint listed on OpenRouter.",
      ),
      paragraph(
        "The snapshot offers a different ratio for the same models: measured cost per Intelligence Index task, which folds in each model’s verbosity and cache use on one shared task set. Where the two agree, his assumed workload resembles the index’s task mix; where they diverge, the workload differs, not the prices.",
      ),
      ...comparisonBlocks(comparisons, retrievedAt),
      paragraph(
        "Two cautions apply to every row. A cost multiple without the score gap is incomplete; a model that costs a fifth as much and scores ten points lower is a different proposition from one that costs a fifth as much at the same score. And the DeepSeek row is the snapshot’s closest same-name configuration to the “DeepSeek V4” Das named; he did not specify which DeepSeek V4 variant or effort level he priced.",
      ),
      heading("UltraSpeed costs 10x for a claimed up-to-20x"),
      paragraph(
        "Xiaomi’s release note says MiMo-V2.6-Pro also ships in an UltraSpeed mode on its open platform and desktop client, “",
        MIMO_V26.xiaomi.ultraSpeedClaim,
        ".” The ",
        { href: BLOG_SOURCES.openRouterMimoV26ProUltraSpeed.url, text: "OpenRouter listing" },
        " for that edition, captured ",
        MIMO_V26.capturedOn,
        " UTC, describes it as built from the same checkpoint and prices Xiaomi’s endpoint at ",
        MIMO_V26.openRouter.ultraSpeedInput,
        " per million input tokens, ",
        MIMO_V26.openRouter.ultraSpeedOutput,
        " per million output tokens, and ",
        MIMO_V26.openRouter.ultraSpeedCacheRead,
        " per million cached input tokens: ",
        MIMO_V26.openRouter.ultraSpeedMultiple,
        " the standard prices on every line.",
      ),
      paragraph(
        "Das reports that in his use the mode delivered about ",
        MIMO_V26.das.ultraSpeedThroughput,
        ", with a median of about ",
        MIMO_V26.das.ultraSpeedMedian,
        " tokens per second, for “",
        MIMO_V26.das.ultraSpeedPrice,
        ".” That is one person’s throughput on one router on launch day. Artificial Analysis measured the standard model at ",
        MIMO_V26.artificialAnalysis.outputSpeed,
        " tokens per second on Xiaomi’s API and had not published an UltraSpeed measurement when this note was written, so the 20x claim remains Xiaomi’s. Das’s public bio lists OpenRouter, the router he measured on, among his investments.",
      ),
      heading("The cybersecurity lead is on one kind of task"),
      paragraph(
        "Das called the model “insane at cyber,” citing a CyberGym score of ",
        MIMO_V26.das.cyberGym,
        " and one prompt about finding buffer overflows in an image library that the model answered where, in his experience, most models refuse. Xiaomi’s table supports a narrower statement.",
      ),
      paragraph(
        "CyberGym asks an agent to reproduce a known vulnerability in real open-source software: given the project and a description of the bug, produce an input that triggers that specific crash. Xiaomi reports ",
        MIMO_V26.reported.cyberGymPro,
        " for MiMo-V2.6-Pro and ",
        MIMO_V26.reported.cyberGymFlash,
        " for MiMo-V2.6-Flash, against ",
        MIMO_V26.reported.cyberGymV25,
        " for MiMo-V2.5-Pro. Two details bound that number. The ",
        { href: BLOG_SOURCES.xiaomiMimoV26TechnicalReport.url, text: "technical report" },
        " footnotes that Xiaomi corrected what it calls flawed CyberGym evaluation environments using its own oracle, which accepts a proof of concept only when the sanitizer-reported vulnerability type and crash location both match, so the score was not produced under the public CyberGym protocol. And the frontier columns of the table are blank for CyberGym, so the table offers no same-protocol comparison with Claude Opus 5, GPT-5.6 Sol, or Claude Fable 5.",
      ),
      paragraph(
        "Where the table does compare, the lead disappears. On ExploitGym, which measures turning a vulnerability into a working exploit, MiMo-V2.6-Pro scores ",
        MIMO_V26.reported.exploitGymPro,
        " against ",
        MIMO_V26.reported.exploitGymSol,
        " for GPT-5.6 Sol. On ExploitBench, which scores progress through exploitation stages, it scores ",
        MIMO_V26.reported.exploitBenchPro,
        " against ",
        MIMO_V26.reported.exploitBenchSol,
        ". On SEC Bench Pro, which reproduces complex vulnerabilities from bug reports, it scores ",
        MIMO_V26.reported.secBenchProPro,
        " against ",
        MIMO_V26.reported.secBenchProSol,
        ". The report explains the emphasis: Xiaomi trained the model with reinforcement learning on vulnerability reproduction because OSS-Fuzz supplies tens of thousands of confirmed instances with a cheap, deterministic reward, and its published training environments include that task family.",
      ),
      callout(
        "How to read the cyber claim",
        "MiMo-V2.6-Pro reproduces described vulnerabilities in real code at a rate Xiaomi measured far above its predecessor, under Xiaomi’s corrected protocol, with no frontier model measured the same way. On exploitation benchmarks Xiaomi did compare, GPT-5.6 Sol scores higher. Das’s refusal observation is one prompt from one user; the report’s text describes cybersecurity as a training and evaluation domain and does not discuss refusal behavior. Whether a model answers offensive-security prompts is a deployment question that no score in this note measures.",
      ),
      heading("Multimodal output and the report"),
      paragraph(
        "Das also reports that the model is good at producing informational videos with speech and sound effects and at composing music in a digital audio workstation. Xiaomi’s release note describes the same capabilities as demonstrations: popular-science videos that call MiMo-V2.5-TTS for voiceover, and an orchestral piece for about ten instruments that the model scored and converted to MIDI. Neither party reports a benchmark for these outputs, so they stay demonstrations.",
      ),
      paragraph(
        "The technical report’s main subject is how Xiaomi scaled reinforcement learning. The report states that each training step consumed ",
        MIMO_V26.xiaomi.samplesPerStep,
        " samples and ",
        MIMO_V26.xiaomi.tokensPerStep,
        " tokens with context lengths up to 1 million tokens, in a fully asynchronous loop. Pro and Flash each completed ",
        MIMO_V26.xiaomi.rlSteps,
        " steps in ",
        MIMO_V26.xiaomi.rlDays,
        ", ",
        MIMO_V26.xiaomi.rlTrajectories,
        " trajectories in total, at stated training costs of $",
        MIMO_V26.xiaomi.rlCostPro,
        " and $",
        MIMO_V26.xiaomi.rlCostFlash,
        ". Xiaomi reports that Pro’s DeepSWE v1.1 score rose from ",
        MIMO_V26.xiaomi.deepSweBefore,
        " to ",
        MIMO_V26.xiaomi.deepSweAfter,
        " across those steps. The report also freezes the mixture-of-experts router during training, grades passing solutions against each other within a group rather than scoring them all alike, and trains across several lightweight harnesses at once; it reports that mean pass rate on three harnesses held out of training rose from ",
        MIMO_V26.xiaomi.heldOutHarnessesFrom,
        " to ",
        MIMO_V26.xiaomi.heldOutHarnessesTo,
        " on DeepSWE v1.1.",
      ),
      paragraph(
        "The open-source inventory is broader than weights. Xiaomi lists the report, ",
        MIMO_V26.xiaomi.environments,
        " reinforcement-learning task environments across software engineering, vulnerability reproduction, knowledge work, and web development, an end-to-end training framework, the mini-harnesses used for multi-harness training, and a distilled nine-billion-parameter model for smaller experiments.",
      ),
      heading("How to read the open-source claim"),
      paragraph(
        "Xiaomi’s basis for “most powerful open-source model” is one composite, the Intelligence Index, and two named comparators, Kimi K3 and Qwen3.8 Max. ",
        comparatorSentence,
        " The Artificial Analysis page ranks the model first in its open-weights class. The snapshot does not record weight availability, so this note does not rank open models from it; the classification is Artificial Analysis’s. ",
        closedSentence,
        " Xiaomi names both as the closed models it still trails, and Das’s own verdict is that it is “",
        MIMO_V26.das.verdict,
        ".”",
      ),
      heading("Limits"),
      list(
        [
          "Every Xiaomi benchmark figure in this note is a vendor measurement under Xiaomi’s own evaluation setup, and CyberGym uses Xiaomi’s corrected protocol. The Intelligence Index figures are Artificial Analysis measurements under version ",
          indexVersion,
          " and belong to that version’s task mix and weights.",
        ],
        [
          "Cost per Intelligence Index task is an evaluation average at list prices on one shared task set. It is not a coding-agent cost, a production invoice, or a guarantee for a particular workload, and it differs from Das’s per-token multiples by design.",
        ],
        [
          "Das’s throughput, refusal, video, and music observations are one person’s launch-day experience, and he states his own workload assumptions for the price multiples.",
        ],
        [
          "The frontier position, neighbor table, and cost multiples are derived from the snapshot named in each caption and will change as Artificial Analysis adds configurations or the checked snapshot advances.",
        ],
        [
          "AI Charts did not run MiMo-V2.6-Pro, test its refusal behavior, or evaluate UltraSpeed. Speed and refusal claims remain with their sources.",
        ],
      ),
    ],
  };
}
