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
export const TERMINAL_BENCH_SCIENCE_ARTICLE_SLUG = "terminal-bench-science" as const;
export const TERMINAL_BENCH_SCIENCE_ARTICLE_PUBLISHED_AT = "2026-08-31" as const;

export const TERMINAL_BENCH_SCIENCE = {
  author: "Steven Dillmann",
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
    peakResolution: "30.0%",
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
    authorshipDisclosure: BLOG_AUTHORSHIP_DISCLOSURE,
    slug: TERMINAL_BENCH_SCIENCE_ARTICLE_SLUG,
    title: "What Terminal-Bench-Science’s 30% result measures",
    dek:
      "Terminal-Bench-Science accepted 70 of 920 proposed research workflows. Its leading configuration resolved 30%; the published cost and token frontiers show why that score is only one part of the result.",
    focusPhrase: "Terminal-Bench-Science",
    seoDescription:
      "See what Terminal-Bench-Science 0.1’s 30% result covers, how 70 tasks were selected, and how cost and token use change the model comparison.",
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
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: ["aa-index-cost-coding-agents"],
    body: [
      paragraph(
        { href: BLOG_SOURCES.terminalBenchScienceAnnouncement.url, text: "Terminal-Bench-Science 0.1" },
        " is a Stanford-led evaluation of AI agents on scientific research workflows. ",
        TERMINAL_BENCH_SCIENCE.author,
        ", writing for the benchmark team, reports that ",
        TERMINAL_BENCH_SCIENCE.reported.proposalCount,
        " proposed workflows became ",
        TERMINAL_BENCH_SCIENCE.reported.acceptedCount,
        " accepted tasks after domain, implementation, and difficulty review. The team’s stated principle is: ",
        `“${TERMINAL_BENCH_SCIENCE.quotes.scientistsSetTheBar}”`,
      ),
      heading("What the 30% result covers"),
      paragraph(
        `“${TERMINAL_BENCH_SCIENCE.quotes.taskFunnel}” Each configuration ran `,
        TERMINAL_BENCH_SCIENCE.reported.trialsPerTask,
        " independent trials per task across all ",
        TERMINAL_BENCH_SCIENCE.reported.acceptedCount,
        " tasks. The accepted set spans scientific data analysis, statistical inference, simulation, optimization, theorem proving, image reconstruction, signal processing, inverse problems, sensor calibration, model fitting, classification, and scientific machine learning. The leaderboard records the model together with its agent harness, because the harness is part of the evaluated configuration.",
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
        `“${TERMINAL_BENCH_SCIENCE.quotes.strongestResolvesThirty}” The suite is calibrated to sit `,
        TERMINAL_BENCH_SCIENCE.reported.hardnessGap,
        " below Terminal-Bench 3.0 for every model evaluated on both. Because reviewers excluded workflows that frontier systems already solved easily, 30% describes performance on a deliberately difficult accepted set. It should not be read as a success rate for arbitrary laboratory work or as evidence that one model can replace a scientist.",
      ),
      heading("Cost and tokens change the comparison"),
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
        "The highest resolution, lowest evaluation cost, and lowest token use do not select the same configuration. A team choosing an evaluation candidate therefore needs a quality threshold and a budget, rather than a single overall winner.",
      ),
      callout(
        "How to use the result",
        "Use resolution to compare completion on this accepted task set. Use the published cost and token frontiers to find configurations that improve one of those resources without giving up more resolution than your work can tolerate.",
      ),
      heading("How it relates to AI Charts"),
      paragraph(
        "The ",
        { href: "/", text: "AI Charts homepage" },
        " now includes Terminal-Bench-Science 0.1 as the scientific-workflow member of its five-role benchmark portfolio. Its scores remain separate from the interactive Artificial Analysis coding-agent chart, which plots AA Index, DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA against API cost, active time, or total token use. Those coding observations come from a checked ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents snapshot" },
        ` retrieved ${retrievedAt}.`,
      ),
      paragraph(
        "For orientation, the snapshot’s highest stored Terminal-Bench v2.1 score is ",
        formatBenchmarkScore(terminalLeader.value),
        " for ",
        terminalLeader.record.model,
        " on ",
        terminalLeader.record.agent,
        " at the ",
        terminalLeader.record.setting,
        " setting. That value belongs to a software-engineering terminal benchmark; it cannot be compared numerically with the 30% Science resolution rate. The shared lesson is methodological: keep the task set, model, harness, quality measure, cost, and token use attached to every comparison.",
      ),
      heading("Limits"),
      list(
        [
          "Resolution rates, costs, and token totals belong to the named 0.1 release, models, harnesses, and three-trial protocol on the announcement. They can change in a later release.",
        ],
        [
          "Terminal-Bench-Science 0.1 is a homepage benchmark family, not a field in the checked Artificial Analysis coding-agent snapshot. A stored Terminal-Bench v2.1 score is a different suite.",
        ],
        [
          "Reported evaluation costs are totals across all 70 tasks. They are not a production invoice, a subscription price, or a per-query quote.",
        ],
        ["The suite is living and versioned; later releases can add, retire, or recalibrate tasks."],
        ["Resolution varies by scientific domain, so the aggregate is not a domain-specific capability claim."],
      ),
    ],
  };
}
