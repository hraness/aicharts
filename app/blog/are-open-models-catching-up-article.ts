import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  codingAgentDatasetModifiedAt,
  codingAgentDatasetSummary,
  currentCodingAgentBenchmarkLeaders,
  formatBenchmarkScore,
  type CodingAgentBenchmarkLeader,
} from "@/lib/coding-agent-dataset";
import { formatSnapshotScore } from "@/lib/coding-agent-snapshot-rows";
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

export const CATCHING_UP_ARTICLE_SLUG = "are-open-models-catching-up" as const;
export const CATCHING_UP_ARTICLE_PUBLISHED_AT = "2026-08-27" as const;

export const SEMIANALYSIS_CATCHING_UP = {
  digestUrl: "https://hraness.com/reading/are-open-models-catching-up" as const,
  publishedOn: "August 21, 2026",
  reported: {
    era2CatchupMonths: "8.5",
    era2R10528: "78",
    era3Glm52: "72.4",
    era3GlmMonths: "6",
    era3KimiK26: "56.3",
    era3KimiMonths: "4.8",
  },
} as const;

export const HRANESS_CATCHING_UP_READING = {
  gist:
    "The authors still prefer Anthropic’s productized stack for daily work and treat public benchmarks as hill-climbable, incomplete proxies for real use.",
  productDecides: "The product, not the leaderboard, still decides daily use.",
  savedOn: "2026-08-21",
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

export function createAreOpenModelsCatchingUpArticle(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): BlogArticle {
  const summary = codingAgentDatasetSummary(snapshot);
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const leaders = currentCodingAgentBenchmarkLeaders(snapshot);
  const aaLeader = requireLeader(leaders, "aaIndex");
  const updatedAt = latestCalendarDate(
    CATCHING_UP_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(snapshot.source.retrievedAt),
    utcCalendarDate(codingAgentDatasetModifiedAt(snapshot)),
  );

  return {
    slug: CATCHING_UP_ARTICLE_SLUG,
    title: "Open models can close a scoreboard and still lose the product",
    dek:
      "SemiAnalysis measures a shrinking open-versus-closed gap on era composites, then still picks a productized closed stack for daily work. A catch-up number is not a reason to collapse named coding-agent rows.",
    focusPhrase: "open models catching up",
    seoDescription:
      "SemiAnalysis finds 4.8 to 6 month catch-up on era composites. They still prefer a productized closed stack. AI Charts keeps named coding-agent rows.",
    keywords: [
      "open models catching up",
      "open versus closed models",
      "SemiAnalysis",
      "coding agent harness",
      "productized AI stack",
      "Artificial Analysis",
    ],
    publishedAt: CATCHING_UP_ARTICLE_PUBLISHED_AT,
    updatedAt,
    sourceIds: [
      "semiAnalysisOpenModels",
      "hranessOpenModelsReading",
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: ["open-models-coding-agent-benchmarks"],
    body: [
      paragraph(
        { href: BLOG_SOURCES.semiAnalysisOpenModels.url, text: "SemiAnalysis asks whether open models are catching up" },
        `, in an essay published ${SEMIANALYSIS_CATCHING_UP.publishedOn} by Evan Cloutier, Max Kan, Jordan Nanos, and Dylan Patel. Their measurement is an era-specific composite. Catch-up time has halved with each generation, down to 4.8 to 6 months in the agentic era. In the same essay they still prefer a productized closed stack for daily work, because public composites are hill-climbable. This note keeps that split.`,
      ),
      paragraph(
        "The ",
        { href: "/", text: "current coding-agent comparison" },
        " names a model, an agent harness, and an effort setting on every stored row. A composite catch-up number is not a reason to collapse those rows into “open won.” The ",
        { href: "/blog/open-models-coding-agent-benchmarks", text: "named open-weight coding-agent rows" },
        " stay on their own page. This page asks what SemiAnalysis’s own product preference changes about that headline.",
      ),
      heading("SemiAnalysis measures catch-up by era"),
      paragraph(
        "The essay refuses one historical scoreboard. Early-scaling exams saturate, reasoning exams replace them, and agentic work then needs terminal, browsing, and software-engineering tasks. Their Era 3 suite is Terminal-Bench 2.1, BrowseComp-Plus, τ³-banking, and DeepSWE. They ran most scores on Prime Intellect’s evaluation stack and used additional runs from Artificial Analysis and Datacurve.",
      ),
      paragraph(
        "On that design they report a cycle. A closed lab jumps first. Other labs reverse-engineer the advance, including through distillation, and close the gap. Their measured trend is that each generation takes about half as long to catch the first closed model of its era.",
      ),
      table(
        "Quoted SemiAnalysis catch-up intervals from the August 21, 2026 essay",
        ["Era", "Quoted catch-up", "Closed reference they name"],
        [
          [
            textCell("Reasoning"),
            textCell(`${SEMIANALYSIS_CATCHING_UP.reported.era2CatchupMonths} months to ${SEMIANALYSIS_CATCHING_UP.reported.era2R10528}`),
            textCell("The o1-era opening gap, closed by DeepSeek R1-0528"),
          ],
          [
            textCell("Agentic"),
            textCell(`${SEMIANALYSIS_CATCHING_UP.reported.era3KimiMonths} months at ${SEMIANALYSIS_CATCHING_UP.reported.era3KimiK26}`),
            textCell("Opus 4.5, passed by Kimi K2.6 on their composite"),
          ],
          [
            textCell("Agentic"),
            textCell(`${SEMIANALYSIS_CATCHING_UP.reported.era3GlmMonths} months at ${SEMIANALYSIS_CATCHING_UP.reported.era3Glm52}`),
            textCell("GPT-5.2, cleared by GLM-5.2 on their composite"),
          ],
        ],
      ),
      paragraph(
        "Those are SemiAnalysis measurements. They report a faster close in Era 3 than in the two earlier eras. The numbers belong to their suite and their choice of era-opening closed flags. They are not AA Index cells, and they are not a verdict on every later closed product.",
      ),
      heading("The same authors still pick a product"),
      paragraph(
        "The essay’s daily-work clause sits next to the catch-up chart. Kimi K3 scores higher than Fable 5 on their curated composite, but the authors still prefer Fable for daily work. They credit Anthropic’s product work around the model and warn that benchmarks are incomplete proxies for real use.",
      ),
      paragraph(
        "They already applied that clause inside the closed field. GPT-5.2 scored higher than Opus 4.5 on their suite, yet their account says the user experience did not follow the composite. They treat the complete model-and-harness product as the relevant unit and Anthropic’s stack as the agentic-era default, even when another closed flag leads the same suite.",
      ),
      paragraph(
        "A ",
        { href: SEMIANALYSIS_CATCHING_UP.digestUrl, text: "Hraness reading note of the SemiAnalysis essay" },
        `, saved ${HRANESS_CATCHING_UP_READING.savedOn}, records the same limit as a dated digest: “${HRANESS_CATCHING_UP_READING.gist}” The digest’s product sentence is the one this page keeps in view: “${HRANESS_CATCHING_UP_READING.productDecides}”`,
      ),
      heading("Public composites are hill-climbable"),
      paragraph(
        "SemiAnalysis limits what the composites prove. A lab can build reinforcement-learning environments that resemble published benchmark tasks and optimize against them. A later open release can pass the era-opening closed flags on that suite and still leave the daily product undecided.",
      ),
      paragraph(
        "Hill-climbing is a property of a published task set, not a property of open weights. A closed lab can train against the same public composite. An open lab can ship weights that look strong on that composite and weak inside another harness, another setting, or a private workflow. The catch-up interval measures how fast the suite moved. It does not measure whether the winning weights are the thing a person should run tomorrow.",
      ),
      callout(
        "Scoreboard and product stay separate",
        "Use SemiAnalysis for the historical catch-up cycle on their era composites, and for their own daily-work preference. Use the coding-agent snapshot when you need a named model, harness, and setting. Do not treat a 4.8-month composite pass as an instruction to merge those rows.",
      ),
      heading("A coding-agent row is a product, not a weight class"),
      paragraph(
        { href: HARNESS_DEFINITION_URL, text: "Hraness defines an agent harness" },
        " as software that gives a model a place to work: it injects instructions, offers tools, runs an assess-act-reassess loop, and translates across model APIs. SemiAnalysis’s agentic-era clause uses the same split. The composite can move when the weights move. Daily use, in their telling, still follows the productized loop around those weights.",
      ),
      paragraph(
        `AI Charts retrieved the checked snapshot on ${retrievedAt}. The dataset contains ${summary.recordCount} model-agent configurations across ${summary.modelCount} models, ${summary.agentCount} agent harnesses, and ${summary.providerCount} providers. The snapshot has no open-versus-closed field. Each row is already a product citation: a model name, a harness name, and an effort setting, with scores copied from `,
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis’s coding-agents comparison" },
        ".",
      ),
      paragraph(
        "The highest AA Index in this snapshot is ",
        formatBenchmarkScore(aaLeader.value),
        " for ",
        aaLeader.record.model,
        " on ",
        aaLeader.record.agent,
        " at the ",
        aaLeader.record.setting,
        " setting. That sentence is complete only when those four fields stay attached. Replacing it with “open won” or “closed won” would drop the harness, the setting, the suite, and the retrieval date.",
      ),
      table(
        `Current coding-agent leaders in the ${snapshot.source.name} snapshot retrieved ${retrievedAt}`,
        ["Benchmark", "Model", "Agent", "Setting", "Score"],
        leaders.map(leader => [
          textCell(leader.definition.label),
          textCell(leader.record.model),
          textCell(leader.record.agent),
          textCell(leader.record.setting),
          textCell(formatSnapshotScore(leader.record.benchmarks[leader.definition.id])),
        ]),
      ),
      paragraph(
        "Those leaders are observations of named configurations, not a weight-class rank. Several stored rows use another lab’s harness around a first-party model. The snapshot therefore already mixes weights with someone else’s agent product. That is one reason a model-only catch-up story and this table can diverge without either source being wrong.",
      ),
      heading("A catch-up number does not collapse the snapshot"),
      paragraph(
        "SemiAnalysis’s 4.8-to-6-month result compares later open releases with the closed flags that opened the agentic era on their suite. The live snapshot compares current named configurations on Artificial Analysis’s coding-agent metrics. Passing Opus 4.5 or GPT-5.2 on an unpublished average is a different event from leading the ",
        { href: "/data", text: "checked dataset" },
        " today.",
      ),
      paragraph(
        { href: "/blog/open-models-coding-agent-benchmarks", text: "Open models on coding-agent benchmarks" },
        " is the page that copies those named harness rows and places SemiAnalysis’s quoted catch-up figures beside matching model strings. That page answers whether classified open-weight rows sit with the current AA Index leaders. This page answers whether the essay’s catch-up number is a reason to stop naming the rows.",
      ),
      table(
        "What each source is allowed to decide",
        ["Source", "Question it answers", "What a win there means"],
        [
          [
            textCell("SemiAnalysis Era 3 composite"),
            textCell("Did a later open release pass the era-opening closed flags on their suite?"),
            textCell("Catch-up on that composite, in the quoted months"),
          ],
          [
            textCell("AI Charts coding-agent snapshot"),
            textCell("What did this named model, harness, and setting score on the stored metrics?"),
            textCell("A configuration observation on the retrieval date"),
          ],
          [
            textCell("SemiAnalysis daily-work note"),
            textCell("Which stack do the authors still use?"),
            textCell("A product preference, not a second composite"),
          ],
        ],
      ),
      paragraph(
        "The useful failure mode is a headline that treats the first row as a substitute for the second and third. “Open caught up in 4.8 months” can be a faithful citation of SemiAnalysis and still be the wrong instruction for this snapshot. The snapshot would have to drop harness and setting to print that headline. SemiAnalysis’s own Fable preference is evidence that they do not make that drop either.",
      ),
      heading("How to read the two pages"),
      paragraph(
        "Read the SemiAnalysis essay for the cycle, the catch-up intervals, the hill-climb limit, and the daily-work preference. Read the ",
        { href: SEMIANALYSIS_CATCHING_UP.digestUrl, text: "Hraness reading note" },
        " for a dated digest of those claims. Read ",
        { href: "/blog/open-models-coding-agent-benchmarks", text: "open models on coding-agent benchmarks" },
        " when you need the current classified open-weight AA Index cells. Read the ",
        { href: "/", text: "coding-agent leaders table" },
        " and the ",
        { href: "/data", text: "checked dataset" },
        " when you need the full configuration list. Read the ",
        { href: HARNESS_DEFINITION_URL, text: "Hraness harness definition" },
        " when a row’s agent name needs a noun.",
      ),
      paragraph(
        "Read ",
        { href: "/blog/coding-agent-score-holdouts", text: "why a high score still needs a holdout" },
        " when the next question is unseen tasks rather than an unseen product layer. Read ",
        { href: "/blog/coding-agent-scores-still-need-expertise", text: "why coding-agent scores still need expertise" },
        " when the next question is whether the person citing the cell can specify and audit the work. Those notes share the leaders table. They do not share this product-versus-scoreboard question.",
      ),
      paragraph(
        "Read ",
        { href: "/blog/small-models-have-arrived", text: "why a cheap model can close a consumer bill and still lose the scoreboard" },
        " when the source is a news-eval dollar chart rather than an era composite.",
      ),
      paragraph(
        "The useful sentence is narrower than the essay title. Open models can close an era composite against the closed flags that opened that era. SemiAnalysis still picks a productized closed stack for daily work. AI Charts keeps the live coding-agent snapshot as named model, harness, and setting rows for the same reason.",
      ),
      heading("Limits of this comparison"),
      list(
        [
          "SemiAnalysis defines and operates its era composites and states its own daily-work preference. AI Charts does not rerun that suite or recover unpublished chart points from images.",
        ],
        [
          "The Hraness page is a dated digest, not a substitute for the essay. Quote SemiAnalysis for the measurements and the Hraness note only for its own digest sentences.",
        ],
        [
          "Artificial Analysis defines the coding-agent scores. AI Charts is an independent visualization and is not affiliated with Artificial Analysis, SemiAnalysis, or the listed providers.",
        ],
        [
          "This page does not classify snapshot rows as open or closed. Weight-class grouping stays on the named-row note, where the allowlist is an explicit analysis choice.",
        ],
        [
          "Scores belong to the named model, harness, setting, task set, and evaluation version on the retrieval date. They do not establish results for every repository or production workflow.",
        ],
        [
          "This is a checked snapshot, not a live mirror. Cite the retrieval timestamp when quoting a value.",
        ],
      ),
    ],
  };
}
