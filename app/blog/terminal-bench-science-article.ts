import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  codingAgentDatasetModifiedAt,
  currentCodingAgentBenchmarkLeaders,
  formatBenchmarkScore,
  type CodingAgentBenchmarkLeader,
} from "@/lib/coding-agent-dataset";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";

import {
  BLOG_SOURCES,
  callout,
  heading,
  list,
  paragraph,
  table,
  type BlogArticle,
  type InlineContent,
} from "./articles";
export const HARNESS_DEFINITION_URL =
  "https://hraness.com/kb/agent-harnesses" as const;

export const TERMINAL_BENCH_SCIENCE_ARTICLE_SLUG = "terminal-bench-science" as const;
export const TERMINAL_BENCH_SCIENCE_ARTICLE_PUBLISHED_AT = "2026-08-31" as const;

export const TERMINAL_BENCH_SCIENCE = {
  author: "Steven Dillmann",
  nextReleasePrDeadline: "October 5, 2026",
  publishedOn: "August 2026",
  quotes: {
    scientistsSetTheBar:
      "Scientists, not model developers or data vendors, set the bar for scientific capability in AI.",
    strongestResolvesThirty:
      "The strongest model evaluated, Claude Opus 5, achieves a 30% resolution rate on Terminal-Bench-Science 0.1.",
    taskFunnel:
      "Of 920 proposals, 464 were approved for implementation and 386 pull requests were opened, but only 70 tasks made it into Terminal-Bench-Science 0.1.",
    solMatchesFableCost:
      "GPT-5.6 Sol matches Claude Fable 5's performance at less than a third of the cost ($4.2k vs $14.2k).",
  },
  reported: {
    costOpus5: "$7.0k",
    costSol: "$4.2k",
    costFable5: "$14.2k",
    fableTokens: "6.4B",
    solTokens: "8.4B",
    glmOpenLead: "8.1%",
    hardnessGap: "more than 10 percentage points",
    proposalCount: "920",
    approvedCount: "464",
    pullRequestCount: "386",
    acceptedCount: "70",
    trialsPerTask: "three",
    domainCount: "five",
    peakResolution: "30.0%",
    peakResolutionPlain: "30%",
    bothFrontierModels: "Kimi K3 and Claude Opus 5",
  },
  leaderboard: [
    { model: "Claude Opus 5", harness: "Claude Code", resolution: "30.0%" },
    { model: "GPT-5.6 Sol", harness: "Codex", resolution: "22.4%" },
    { model: "Claude Fable 5", harness: "Claude Code", resolution: "21.4%" },
    { model: "Claude Opus 4.8", harness: "Claude Code", resolution: "10.5%" },
    { model: "GPT-5.6 Terra", harness: "Codex", resolution: "8.6%" },
    { model: "GLM 5.3", harness: "Claude Code", resolution: "8.1%" },
    { model: "Kimi K3", harness: "Claude Code", resolution: "7.1%" },
    { model: "Grok 4.6", harness: "Grok Build", resolution: "7.1%" },
    { model: "GPT-5.6 Luna", harness: "Codex", resolution: "3.3%" },
  ],
} as const;

export const HRANESS_TERMINAL_BENCH_SCIENCE_READING = {
  savedOn: "2026-08-29",
} as const;

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

function requireLeader(
  leaders: readonly CodingAgentBenchmarkLeader[],
  metricId: CodingAgentBenchmarkLeader["definition"]["id"],
): CodingAgentBenchmarkLeader {
  const leader = leaders.find(candidate => candidate.definition.id === metricId);
  if (leader === undefined) {
    throw new Error(`Checked snapshot has no leader for ${metricId}.`);
  }
  return leader;
}

export function createTerminalBenchScienceArticle(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): BlogArticle {
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const leaders = currentCodingAgentBenchmarkLeaders(snapshot);
  const terminalLeader = requireLeader(leaders, "terminalBench");
  const updatedAt = latestCalendarDate(
    TERMINAL_BENCH_SCIENCE_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(snapshot.source.retrievedAt),
    utcCalendarDate(codingAgentDatasetModifiedAt(snapshot)),
  );

  return {
    slug: TERMINAL_BENCH_SCIENCE_ARTICLE_SLUG,
    title: "Terminal-Bench-Science: 30% is not a product win",
    dek:
      "Scientists, not vendors, set the bar on Terminal-Bench-Science 0.1. The peak 30% resolution is remaining work, not a shipping product. Cost and token Pareto is the useful comparison.",
    focusPhrase: "Terminal-Bench-Science",
    seoDescription:
      "Terminal-Bench-Science 0.1 lets scientists set the bar. A 30% peak resolution is not a product win; cost and token Pareto is the useful comparison.",
    keywords: [
      "Terminal-Bench-Science",
      "scientific AI agents",
      "resolution rate",
      "cost Pareto",
      "token use",
      "Steven Dillmann",
    ],
    publishedAt: TERMINAL_BENCH_SCIENCE_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "Scientific agent benchmarks",
    sourceIds: [
      "terminalBenchScienceAnnouncement",
      "hranessTerminalBenchScienceReading",
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: ["small-models-have-arrived"],
    body: [
      paragraph(
        { href: BLOG_SOURCES.terminalBenchScienceAnnouncement.url, text: "Terminal-Bench-Science 0.1" },
        " is a Stanford-led benchmark of AI agents on scientific research workflows. ",
        TERMINAL_BENCH_SCIENCE.author,
        ", writing the announcement for the Terminal-Bench-Science team, says ",
        `“${TERMINAL_BENCH_SCIENCE.quotes.scientistsSetTheBar}”`,
        " The suite is built with the Terminal-Bench and Harbor team and with domain experts. Of ",
        TERMINAL_BENCH_SCIENCE.reported.proposalCount,
        " proposals, only ",
        TERMINAL_BENCH_SCIENCE.reported.acceptedCount,
        " tasks survived domain, technical, and bar-raiser review. ",
        `“${TERMINAL_BENCH_SCIENCE.quotes.strongestResolvesThirty}”`,
      ),
      paragraph(
        "That ",
        TERMINAL_BENCH_SCIENCE.reported.peakResolutionPlain,
        " cell is the headline. It is not a product win. A research assistant that fails most of the workflows scientists chose to measure is still a research object. The useful comparison on AI Charts is the one the suite already reports next to resolution: cost and token Pareto. The ",
        { href: "/", text: "coding-agent comparison chart" },
        " already plots those axes for a different, software-engineering snapshot.",
      ),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.hranessTerminalBenchScienceReading.url, text: "Hraness reading note of that announcement" },
        `, saved ${HRANESS_TERMINAL_BENCH_SCIENCE_READING.savedOn}, is a dated digest. It is not a substitute for the primary page.`,
      ),
      heading("Scientists set the evaluation bar"),
      paragraph(
        "Tasks come from researchers’ own work across the life, physical, Earth, mathematical, and engineering sciences. They are not textbook questions or standardized exercises. Contributors propose workflows. Reviewers approve a subset for implementation. A later review asks whether each task is objectively verifiable, hard for current frontier agents, and scientifically real.",
      ),
      paragraph(
        `“${TERMINAL_BENCH_SCIENCE.quotes.taskFunnel}”`,
        " Dillmann presents that selectivity as evidence that it is hard to write tasks that are scientifically interesting, hard for frontier agents, and specified well enough to grade. The accepted set covers scientific data analysis, statistical inference, simulation, optimization, theorem proving, image reconstruction, signal processing, inverse problems, sensor calibration, model fitting, classification, and scientific machine learning.",
      ),
      paragraph(
        { href: HARNESS_DEFINITION_URL, text: "Hraness defines an agent harness" },
        " as software that gives a model a place to work: it injects instructions, offers tools, runs an assess-act-reassess loop, and translates across model APIs. The Science leaderboard names that layer. Claude Code, Codex, and Grok Build are part of each observation. A model name without the harness is an incomplete citation here too.",
      ),
      heading("A 30% peak is remaining work"),
      paragraph(
        "Each evaluated model ran ",
        TERMINAL_BENCH_SCIENCE.reported.trialsPerTask,
        " independent trials per task across all ",
        TERMINAL_BENCH_SCIENCE.reported.acceptedCount,
        " tasks. Claude Opus 5 with Claude Code leads at ",
        TERMINAL_BENCH_SCIENCE.reported.peakResolution,
        ". GPT-5.6 Sol with Codex is next at ",
        TERMINAL_BENCH_SCIENCE.leaderboard[1].resolution,
        ", then Claude Fable 5 with Claude Code at ",
        TERMINAL_BENCH_SCIENCE.leaderboard[2].resolution,
        ". Claude Opus 4.8 sits at ",
        TERMINAL_BENCH_SCIENCE.leaderboard[3].resolution,
        ". Several other named systems resolve less than 11%. GLM 5.3 with Claude Code is the strongest open model at ",
        TERMINAL_BENCH_SCIENCE.reported.glmOpenLead,
        ". GPT-5.6 Luna with Codex is last at ",
        TERMINAL_BENCH_SCIENCE.leaderboard[8].resolution,
        ".",
      ),
      table(
        "Terminal-Bench-Science 0.1 resolution rates from the announcement",
        ["Model", "Agent harness", "Resolution"],
        TERMINAL_BENCH_SCIENCE.leaderboard.map(row => [
          textCell(row.model),
          textCell(row.harness),
          textCell(row.resolution),
        ]),
      ),
      paragraph(
        "The suite is calibrated to sit ",
        TERMINAL_BENCH_SCIENCE.reported.hardnessGap,
        " below Terminal-Bench 3.0 for every model evaluated on both. Reviewers rejected tasks that frontier agents already solve easily. A ",
        TERMINAL_BENCH_SCIENCE.reported.peakResolutionPlain,
        " resolution rate therefore means the leading configuration still failed most of the remaining, scientist-set workflows. That is a ceiling on current capability, not a claim that a lab can replace the scientist on the work the suite measures.",
      ),
      paragraph(
        "The announcement’s own goal is agents that execute demanding workflows so scientists can spend more time on questions, hypotheses, interpretation, and communication. A system that resolves three in ten of the accepted tasks does not yet occupy that role.",
      ),
      heading("Cost and tokens split the useful ranking"),
      paragraph(
        `“${TERMINAL_BENCH_SCIENCE.quotes.solMatchesFableCost}”`,
        " Claude Opus 5 reaches the highest resolution at ",
        TERMINAL_BENCH_SCIENCE.reported.costOpus5,
        ". On tokens, Claude Fable 5 matches GPT-5.6 Sol’s performance while using about a quarter fewer tokens (",
        TERMINAL_BENCH_SCIENCE.reported.fableTokens,
        " versus ",
        TERMINAL_BENCH_SCIENCE.reported.solTokens,
        "). Only ",
        TERMINAL_BENCH_SCIENCE.reported.bothFrontierModels,
        " appear on both the cost-resolution and token-resolution Pareto frontiers.",
      ),
      table(
        "Cost and token facts Terminal-Bench-Science 0.1 reports beside resolution",
        ["Comparison", "Reported result", "What it changes"],
        [
          [
            textCell("GPT-5.6 Sol versus Claude Fable 5"),
            textCell(`${TERMINAL_BENCH_SCIENCE.reported.costSol} versus ${TERMINAL_BENCH_SCIENCE.reported.costFable5}`),
            textCell("Similar resolution at less than a third of the evaluation cost"),
          ],
          [
            textCell("Claude Opus 5 evaluation cost"),
            textCell(TERMINAL_BENCH_SCIENCE.reported.costOpus5),
            textCell("Highest resolution at a higher total evaluation cost"),
          ],
          [
            textCell("Claude Fable 5 versus GPT-5.6 Sol tokens"),
            textCell(`${TERMINAL_BENCH_SCIENCE.reported.fableTokens} versus ${TERMINAL_BENCH_SCIENCE.reported.solTokens}`),
            textCell("Similar resolution at about a quarter fewer tokens"),
          ],
          [
            textCell("Both Pareto frontiers"),
            textCell(TERMINAL_BENCH_SCIENCE.reported.bothFrontierModels),
            textCell("The only named systems on both the cost and token fronts"),
          ],
        ],
      ),
      paragraph(
        "Peak resolution and the useful trade-off are different questions. A product team that can only cite the ",
        TERMINAL_BENCH_SCIENCE.reported.peakResolutionPlain,
        " cell has not yet answered which configuration is cheapest, or cheapest in tokens, for a given quality bar.",
      ),
      callout(
        "Pareto, not a trophy",
        "Use the 30% cell as evidence that the leading named configuration still fails most scientist-set workflows. Use the cost and token frontiers when the question is which configuration is not strictly worse on quality and spend.",
      ),
      heading("This chart already plots that trade-off"),
      paragraph(
        "The current AI Charts coding-agent comparison plots AA Index, DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA against API cost, active time, or total token use. Those scores belong to a checked ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents snapshot" },
        `. AI Charts retrieved it on ${retrievedAt}. Terminal-Bench-Science 0.1 is not in that snapshot. The two Terminal-Bench names share a franchise and a review culture. They do not share a task set.`,
      ),
      paragraph(
        "The snapshot’s highest stored Terminal-Bench v2.1 score is ",
        formatBenchmarkScore(terminalLeader.value),
        " for ",
        terminalLeader.record.model,
        " on ",
        terminalLeader.record.agent,
        " at the ",
        terminalLeader.record.setting,
        " setting. That number is a software-engineering terminal-suite observation. It does not establish a Science resolution rate.",
      ),
      paragraph(
        "What transfers is the comparison shape. Terminal-Bench-Science publishes cost and token Pareto next to resolution because a peak score without those axes is an incomplete product signal. This host already charts that shape for the coding-agent snapshot. Open the ",
        { href: "/", text: "coding-agent comparison chart" },
        " to change axes. Read ",
        { href: "/blog/small-models-have-arrived", text: "how cheaper AI models can make everyday products viable" },
        " when the question is a frequent-use consumer feature rather than a scientist-set workflow.",
      ),
      heading("A different question from cheaper everyday models"),
      paragraph(
        { href: "/blog/small-models-have-arrived", text: "How cheaper AI models can make everyday products viable" },
        " asks whether a lower-cost model can make a repeated product feature viable once it meets a written quality bar. This page asks whether a ",
        TERMINAL_BENCH_SCIENCE.reported.peakResolutionPlain,
        " peak on a scientist-set science suite is a shipping research assistant. Both notes treat cost as part of the result. They do not share a workload.",
      ),
      paragraph(
        "The small-models note can stay with one person’s news-page experiment and listed token prices. This note stays with Dillmann’s scientist-set bar, the ",
        TERMINAL_BENCH_SCIENCE.reported.acceptedCount,
        "-task funnel, and the cost and token frontiers the suite already publishes. Collapsing those questions into one “cheaper is better” headline would drop the bar, the harness, and the task set.",
      ),
      heading("How to read Terminal-Bench-Science"),
      paragraph(
        "Read ",
        { href: BLOG_SOURCES.terminalBenchScienceAnnouncement.url, text: "Dillmann’s announcement" },
        " for the task funnel, the ",
        TERMINAL_BENCH_SCIENCE.reported.acceptedCount,
        "-task coverage, the named resolution rates, the cost and token frontiers, and the living-benchmark roadmap. Read the ",
        { href: BLOG_SOURCES.hranessTerminalBenchScienceReading.url, text: "Hraness reading note of that announcement" },
        " for a dated digest. Read the ",
        { href: HARNESS_DEFINITION_URL, text: "Hraness harness definition" },
        " when a row’s agent name needs a noun. The next release, 0.2, has a pull-request deadline of ",
        TERMINAL_BENCH_SCIENCE.nextReleasePrDeadline,
        ". Tasks are versioned so Harbor can re-run trials.",
      ),
      paragraph(
        "The useful sentence is narrower than a leaderboard headline. Scientists set the bar. The leading named configuration resolves ",
        TERMINAL_BENCH_SCIENCE.reported.peakResolutionPlain,
        " of the accepted workflows. That remaining miss rate is the result. Cost and token Pareto is how AI Charts already asks the next product question.",
      ),
      heading("Limits of this reading"),
      list(
        [
          "Resolution rates, costs, and token totals belong to the named 0.1 release, models, harnesses, and three-trial protocol on the announcement. They can change in a later release.",
        ],
        [
          "Terminal-Bench-Science 0.1 is not in the checked Artificial Analysis coding-agent snapshot. A stored Terminal-Bench v2.1 score is a different suite.",
        ],
        [
          "Reported evaluation costs are totals across all 70 tasks. They are not a production invoice, a subscription price, or a per-query quote.",
        ],
        [
          "The suite is a living benchmark. Later releases will add, retire, and recalibrate tasks as the frontier moves.",
        ],
        [
          "Resolution varies by scientific domain. A suite score is not a domain score, and a domain lead is not a general research-assistant claim.",
        ],
        [
          "The claim that 30% is not a product win is AI Charts analysis of those reported rates. Cite Dillmann for the measurements.",
        ],
      ),
    ],
  };
}
