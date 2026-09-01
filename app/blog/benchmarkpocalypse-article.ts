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
import { HARNESS_DEFINITION_URL } from "./coding-agent-scores-still-need-expertise-article";

export const BENCHMARKPOCALYPSE_ARTICLE_SLUG = "benchmarkpocalypse" as const;
export const BENCHMARKPOCALYPSE_ARTICLE_PUBLISHED_AT = "2026-09-01" as const;

export const DAN_LUU_SCOREBOARD = {
  publishedOn: "August 2026",
  quotes: {
    defaultOverfit:
      "LLMs not only make this trivial, they do it by default, making formerly trustworthy benchmarks meaningless unless you audit the result or trust someone who did.",
    doubleForAi:
      "Note that while this post has discussed non-AI software, everything said here goes double for AI software.",
    kimiFableComments:
      "I've seen lots of people drop comments saying that Kimi K3 is Fable (5) level. But every single person I know who's used it has found it to be substantially worse than GPT-5.6 Sol and Fable.",
    loopChangedCost:
      "What's changed is that it used to take a lot of work to game a large benchmark suite, but an LLM and loop can just do it.",
    realWorldGap:
      "the performance on a wide variety of real-world tasks isn't up to the level it is in benchmarks",
  },
  reported: {
    kimiVulnShare: "approximately a quarter",
    specSpeedup: "12x",
    specTask: "179.art",
    specSuite: "SPECfp2000",
  },
} as const;

export const HRANESS_BENCHMARKPOCALYPSE_READING = {
  savedOn: "2026-08-18",
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

export function nearbyLeaderCount(
  snapshot: CodingAgentSnapshot,
  metricId: CodingAgentBenchmarkLeader["definition"]["id"],
  margin = 5,
): number {
  const values = snapshot.records
    .map(record => record.benchmarks[metricId])
    .filter((value): value is number => value !== null);
  const peak = values.reduce((highest, value) => value > highest ? value : highest, Number.NEGATIVE_INFINITY);
  return values.filter(value => peak - value <= margin).length;
}

export function createBenchmarkpocalypseArticle(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): BlogArticle {
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const leaders = currentCodingAgentBenchmarkLeaders(snapshot);
  const aaLeader = requireLeader(leaders, "aaIndex");
  const deepSweLeader = requireLeader(leaders, "deepSwe");
  const terminalLeader = requireLeader(leaders, "terminalBench");
  const sweAtlasLeader = requireLeader(leaders, "sweAtlas");
  const terminalNearLeaders = nearbyLeaderCount(snapshot, "terminalBench");
  const updatedAt = latestCalendarDate(
    BENCHMARKPOCALYPSE_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(snapshot.source.retrievedAt),
    utcCalendarDate(codingAgentDatasetModifiedAt(snapshot)),
  );

  return {
    slug: BENCHMARKPOCALYPSE_ARTICLE_SLUG,
    title: "The benchmarkpocalypse is not a product win",
    dek:
      "Dan Luu shows that a public scoreboard can be won cheaply, or stop discriminating, without settling product choice. That remaining gap is not a shipping win.",
    focusPhrase: "benchmarkpocalypse scoreboard saturation",
    seoDescription:
      "Dan Luu’s benchmarkpocalypse shows a public scoreboard can be won without settling product choice. Scoreboard saturation is remaining work, not a shipping win.",
    keywords: [
      "benchmarkpocalypse",
      "scoreboard saturation",
      "Dan Luu",
      "coding agent benchmark",
      "public scoreboard",
      "product win",
    ],
    publishedAt: BENCHMARKPOCALYPSE_ARTICLE_PUBLISHED_AT,
    updatedAt,
    section: "Benchmark interpretation",
    sourceIds: [
      "danLuuBenchpocalypse",
      "hranessBenchpocalypseReading",
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: ["terminal-bench-science"],
    body: [
      paragraph(
        { href: BLOG_SOURCES.danLuuBenchpocalypse.url, text: "Dan Luu’s The benchmarkpocalypse" },
        " is an argument about public scoreboards. He writes that a large, formerly trustworthy suite can now be won by an unattended loop, and that the same problem applies twice as hard to AI software. Scoreboard saturation is the product reading of that argument: when a public table stops discriminating the decision a reader needs, topping it is not a shipping win. The ",
        { href: "/", text: "coding-agent comparison chart" },
        " already keeps cost, time, and token use beside those named-suite scores for that reason.",
      ),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.hranessBenchpocalypseReading.url, text: "Hraness reading note of Dan Luu’s The benchmarkpocalypse" },
        `, saved ${HRANESS_BENCHMARKPOCALYPSE_READING.savedOn}, is a dated digest. It is not a substitute for the essay. The sibling note on `,
        { href: "/blog/coding-agent-score-holdouts", text: "why a coding-agent high score still needs a holdout" },
        " stays with Luu’s FRE regex-engine experiment. This page stays with saturation: a cheap public-suite win, or a table that no longer splits products, is remaining measurement work.",
      ),
      heading("Scoreboard saturation is a reading, not a trophy"),
      paragraph(
        "Scoreboard saturation is not a stored field in the Artificial Analysis snapshot. It is a reading of a public table. One form is numeric. Many named configurations sit near the same ceiling, so the lead cell no longer tells you which system to ship. The other form is semantic. The suite is still hard enough that scores have not hit 100, but a “win” no longer stands for the work a product has to do. Luu’s essay is about that second form. A comprehensive public suite can still be climbed in a way that fails later use.",
      ),
      paragraph(
        "Those two forms can arrive together. They do not have to. A table can still spread across models and harnesses while a comment thread treats one high cell as a product verdict. The useful question is whether the public number still answers the decision in front of the reader. If it does not, citing the cell as a win is the mistake, whether the score is 91 or 30.",
      ),
      heading("What Dan Luu changed about a public suite"),
      paragraph(
        "People have always advertised unrepresentative microbenchmarks. Luu’s change is the cost of gaming a large suite. He writes: “",
        DAN_LUU_SCOREBOARD.quotes.loopChangedCost,
        "” CPU vendors once spent skilled engineering time on SPEC-style compiler tricks. He cites Sun improving ",
        DAN_LUU_SCOREBOARD.reported.specTask,
        " by ",
        DAN_LUU_SCOREBOARD.reported.specSpeedup,
        " in ",
        DAN_LUU_SCOREBOARD.reported.specSuite,
        ". An agent can now search that space by default:",
      ),
      callout(
        "Quoted from Dan Luu",
        `“${DAN_LUU_SCOREBOARD.quotes.defaultOverfit}”`,
      ),
      paragraph(
        "He is explicit that the regex-engine loop is the worked example, not the only target. “",
        DAN_LUU_SCOREBOARD.quotes.doubleForAi,
        "” A public coding-agent scoreboard has the same shape as rebar: a named task set, an automated check, and a visible scoring rule. If those are public, an optimizer can climb them. The scarce work is checking whether the cell still means what the suite’s authors thought it meant.",
      ),
      heading("A scoreboard cell is not a use claim"),
      paragraph(
        "Luu’s own AI example is not FRE. It is a scoreboard-versus-use gap on named models. “",
        DAN_LUU_SCOREBOARD.quotes.kimiFableComments,
        "” He adds that “",
        DAN_LUU_SCOREBOARD.quotes.realWorldGap,
        ".” That sentence is the saturation claim in product language. A public table can place two systems together while the people who used both still see a gap.",
      ),
      paragraph(
        "He gives two narrower checks. A friend tried different coding agents on the ICFP 2026 contest problems and saw the same gap. A colleague asked Kimi K3 to scan for vulnerabilities and found ",
        DAN_LUU_SCOREBOARD.reported.kimiVulnShare,
        " of the issues GPT-5.6 Sol found, with no extra finds and no advantage except cost. Luu says people he knows who use cheaper models for real security work pick other systems, such as GLM-5.2, that score worse on public tables and work better in practice.",
      ),
      table(
        "Scoreboard-versus-use checks Dan Luu reports in The benchmarkpocalypse. These are his observations, not Artificial Analysis scores.",
        ["Public scoreboard claim", "What Luu reports from use"],
        [
          [
            textCell("Kimi K3 is Fable 5 level"),
            textCell("Everyone he knows who used both found Kimi K3 substantially worse than GPT-5.6 Sol and Fable"),
          ],
          [
            textCell("Benchmark-level coding-agent performance"),
            textCell("A friend saw the same gap on ICFP 2026 contest problems"),
          ],
          [
            textCell("Security-eval strength for Kimi K3"),
            textCell(`A colleague’s vuln scan found ${DAN_LUU_SCOREBOARD.reported.kimiVulnShare} of the issues GPT-5.6 Sol found, and no extras`),
          ],
          [
            textCell("Cheaper models that win public tables"),
            textCell("People he knows picking cheaper security scanners use GLM-5.2, which scores worse and works better in practice"),
          ],
        ],
      ),
      paragraph(
        "Those rows are anecdotes with named people and named workloads. They are not a second leaderboard. They are enough to keep “the public cell is high” from being reported as “the product is interchangeable.” A saturated comment thread is still a saturated scoreboard when the only cited evidence is the cell.",
      ),
      heading("A low science peak is the other failure"),
      paragraph(
        { href: "/blog/terminal-bench-science", text: "Why a 30% Terminal-Bench-Science score is not a product win" },
        " answers the low-score version of the same product question. Scientists, not vendors, set that bar. The leading named configuration still fails most of the accepted workflows. Cost and token Pareto is the useful comparison there. This page asks the high-score version. A public suite that is cheap to win, or a table that no longer splits products, is also not a shipping decision.",
      ),
      paragraph(
        "The two notes share a refusal. They do not share a task set. Terminal-Bench-Science 0.1 is a scientist-set science suite. Luu’s examples are a regex-engine public suite and later model-versus-use checks. Collapsing them into one “benchmarks are fake” headline would drop the bar, the harness, and the workload.",
      ),
      heading("This snapshot still splits"),
      paragraph(
        "AI Charts retrieved the checked ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents snapshot" },
        ` on ${retrievedAt}. Saturation is not a column in that file. The useful check is whether the stored scores still split named configurations. They do. One model does not own every metric. Terminal-Bench v2.1 is the closest approach to a numeric ceiling, at `,
        formatBenchmarkScore(terminalLeader.value),
        " for ",
        terminalLeader.record.model,
        " on ",
        terminalLeader.record.agent,
        ", with ",
        String(terminalNearLeaders),
        " configurations inside five points of that lead. AA Index, DeepSWE, and SWE-Atlas-QnA still leave a larger remaining gap.",
      ),
      table(
        `Highest stored score by benchmark in the ${snapshot.source.name} snapshot retrieved ${retrievedAt}`,
        ["Benchmark", "Model", "Agent", "Setting", "Score"],
        leaders.map(leader => [
          textCell(leader.definition.label),
          textCell(leader.record.model),
          textCell(leader.record.agent),
          textCell(leader.record.setting),
          textCell(formatBenchmarkScore(leader.value)),
        ]),
      ),
      paragraph(
        { href: HARNESS_DEFINITION_URL, text: "Hraness defines an agent harness" },
        " as software that gives a model a place to work: it injects instructions, offers tools, runs an assess-act-reassess loop, and translates across model APIs. Every stored row already names that layer. The AA Index lead is ",
        formatBenchmarkScore(aaLeader.value),
        " for ",
        aaLeader.record.model,
        " on ",
        aaLeader.record.agent,
        " at the ",
        aaLeader.record.setting,
        " setting. DeepSWE’s lead is ",
        formatBenchmarkScore(deepSweLeader.value),
        " for ",
        deepSweLeader.record.model,
        " on ",
        deepSweLeader.record.agent,
        ". SWE-Atlas-QnA’s lead is ",
        formatBenchmarkScore(sweAtlasLeader.value),
        " for ",
        sweAtlasLeader.record.model,
        " on ",
        sweAtlasLeader.record.agent,
        ". A model name without the harness and setting is an incomplete citation here too.",
      ),
      paragraph(
        "What transfers from Luu is the comparison shape, not a claim that any named row cheated. If a lab can see the task family, the harness, and the scoring rule, a public-suite lead is evidence about that suite. It is not a product interchangeability claim. Open the ",
        { href: "/", text: "coding-agent comparison chart" },
        " when the next question is cost, active time, or token use beside those scores. Those axes still move after a quality cell clusters.",
      ),
      callout(
        "Saturation is not a ship signal",
        "Use a stored AA Index, DeepSWE, Terminal-Bench v2.1, or SWE-Atlas-QnA value as evidence about that named configuration on that named suite. Use a second suite, a holdout, or production work when the question is whether the same system is the product to ship.",
      ),
      heading("How to read a saturated or gameable board"),
      paragraph(
        "Read Luu’s essay for the changed cost of gaming a large suite, the SPEC history, and the Kimi K3 versus Fable use gap. Read the ",
        { href: BLOG_SOURCES.hranessBenchpocalypseReading.url, text: "Hraness reading note of Dan Luu’s The benchmarkpocalypse" },
        " for a dated digest. Read ",
        { href: "/blog/terminal-bench-science", text: "why a 30% Terminal-Bench-Science score is not a product win" },
        " when the bar is scientist-set and still mostly missed. Read ",
        { href: "/blog/coding-agent-score-holdouts", text: "why a coding-agent high score still needs a holdout" },
        " when the next control is hidden cases rather than saturated meaning. Read the ",
        { href: HARNESS_DEFINITION_URL, text: "Hraness harness definition" },
        " when a row’s agent name needs a noun.",
      ),
      paragraph(
        "The useful sentence is narrower than a leaderboard headline. A public scoreboard can be cheap to win. It can also stop discriminating the product decision even when the numbers have not hit 100. Either case is remaining measurement work. It is not a reason to ship.",
      ),
      heading("Limits of this reading"),
      list(
        [
          "Dan Luu reports FRE, SPEC history, and later model-versus-use checks. AI Charts does not rerun those observations or recover unpublished plot points from his images.",
        ],
        [
          "The Hraness page is a dated digest, not a substitute for the essay. Quote Luu for the measurements. Do not treat the digest as a second primary source.",
        ],
        [
          "Kimi K3 versus Fable, the ICFP contest check, and the vulnerability scan are Luu’s reported use observations. They are not Artificial Analysis scores and not a second official suite.",
        ],
        [
          "Artificial Analysis defines the coding-agent scores. AI Charts is an independent visualization and is not affiliated with Artificial Analysis, Dan Luu, or the listed providers.",
        ],
        [
          "This snapshot is not a 100-point ceiling on every metric. Nearby Terminal-Bench v2.1 scores are a clustering check, not proof that the whole table has saturated.",
        ],
        [
          "The claim that scoreboard saturation is not a product win is AI Charts analysis of Luu’s argument and the stored snapshot. Cite Luu for the measurements.",
        ],
      ),
    ],
  };
}
