import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  codingAgentDatasetModifiedAt,
  codingAgentDatasetSummary,
} from "@/lib/coding-agent-dataset";
import {
  codingAgentSnapshotRows,
  formatSnapshotScore,
  type CodingAgentSnapshotRow,
} from "@/lib/coding-agent-snapshot-rows";
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

export const SMALL_MODELS_ARTICLE_SLUG = "small-models-have-arrived" as const;
export const SMALL_MODELS_ARTICLE_PUBLISHED_AT = "2026-08-28" as const;
export const CATCHING_UP_SIBLING_PATH = "/blog/are-open-models-catching-up" as const;

export const FRENCH_OWEN_SMALL_MODELS = {
  publishedOn: "August 26, 2026",
  quotes: {
    lunaNews:
      "But looking at luna, the results are pretty decent, and the average cost is ~$0.10.",
    tokenCosts: "There's a straightforward answer: token costs.",
  },
  reported: {
    lunaSpeed: "100",
    newsEvalLuna: "$0.10",
    newsEvalSonnet: "$1",
    researchThread: "tens of cents",
    tokenSpewerShare: "95%",
  },
} as const;

export const HRANESS_SMALL_MODELS_READING = {
  digestUrl: "https://hraness.com/reading/small-models-have-arrived" as const,
  gist:
    "Calvin French-Owen argues that small, fast models have crossed a cost-quality threshold that unlocks consumer AI.",
  savedOn: "2026-08-27",
  tokenCostNotTaste:
    "Inference cost, not product taste, is why consumer AI companies have been scarce.",
} as const;

const NAMED_CODING_MODELS = ["Fable 5", "GPT-5.6 Sol"] as const;

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

function requireHighestAaIndexRowForModelPrefix(
  rows: readonly CodingAgentSnapshotRow[],
  modelPrefix: string,
): CodingAgentSnapshotRow {
  const row = rows.find(candidate => (
    candidate.model.startsWith(modelPrefix) && candidate.aaIndex !== null
  ));
  if (row === undefined || row.aaIndex === null) {
    throw new Error(`Checked snapshot has no AA Index row for ${modelPrefix}.`);
  }
  return row;
}

export function createSmallModelsHaveArrivedArticle(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): BlogArticle {
  const summary = codingAgentDatasetSummary(snapshot);
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const rows = codingAgentSnapshotRows(snapshot.records);
  const namedCodingRows = NAMED_CODING_MODELS.map(modelPrefix =>
    requireHighestAaIndexRowForModelPrefix(rows, modelPrefix));
  const updatedAt = latestCalendarDate(
    SMALL_MODELS_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(snapshot.source.retrievedAt),
    utcCalendarDate(codingAgentDatasetModifiedAt(snapshot)),
  );

  return {
    slug: SMALL_MODELS_ARTICLE_SLUG,
    title: "A cheap model can close a bill and still lose the scoreboard",
    dek:
      "Calvin French-Owen says small fast models crossed a consumer cost threshold. A news-eval dollar win is not a reason to collapse named coding-agent rows.",
    focusPhrase: "small models have arrived",
    seoDescription:
      "French-Owen says small models crossed a consumer cost threshold. A news-eval dollar win is not a reason to collapse named coding-agent rows.",
    keywords: [
      "small models have arrived",
      "cheap models",
      "consumer AI",
      "gpt-5.6-luna",
      "coding agent benchmarks",
      "inference cost",
    ],
    publishedAt: SMALL_MODELS_ARTICLE_PUBLISHED_AT,
    updatedAt,
    sourceIds: [
      "calvinFrenchOwenSmallModels",
      "hranessSmallModelsReading",
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: ["are-open-models-catching-up"],
    body: [
      paragraph(
        { href: BLOG_SOURCES.calvinFrenchOwenSmallModels.url, text: "Calvin French-Owen writes that small models have arrived" },
        `, in an essay published ${FRENCH_OWEN_SMALL_MODELS.publishedOn}. He reports gpt-5.6-luna near ${FRENCH_OWEN_SMALL_MODELS.reported.lunaSpeed} tokens per second, research-thread API bills in the ${FRENCH_OWEN_SMALL_MODELS.reported.researchThread}, and a personalized news eval near ${FRENCH_OWEN_SMALL_MODELS.reported.newsEvalLuna} versus about ${FRENCH_OWEN_SMALL_MODELS.reported.newsEvalSonnet} on Sonnet-class models. He treats inference cost as the reason consumer AI companies were scarce. He still reaches for frontier models when the work is hard coding. This note keeps that split.`,
      ),
      paragraph(
        "AI Charts publishes ",
        { href: "/", text: "named coding-agent rows" },
        " on a Pareto frontier and a scoreboard. Each stored row names a model, an agent harness, and an effort setting. A consumer-cheap model that wins a news-eval dollar chart is not a reason to collapse those rows into one cheap-won column. ",
        { href: CATCHING_UP_SIBLING_PATH, text: "Closing a scoreboard is a different event from closing a consumer bill" },
        ". That sibling note asks whether a SemiAnalysis era composite should erase the named rows. This page asks whether a ten-cent news eval should.",
      ),
      paragraph(
        "This page is not the ",
        { href: HRANESS_SMALL_MODELS_READING.digestUrl, text: "Hraness reading digest of French-Owen’s essay" },
        `. The digest, saved ${HRANESS_SMALL_MODELS_READING.savedOn}, is a dated companion citation. Quote French-Owen for the measurements. Quote the digest only for its own sentences.`,
      ),
      heading("French-Owen measures a consumer bill"),
      paragraph(
        `The essay’s evidence is a personal cost chart, not a public coding-agent suite. French-Owen has been running gpt-5.6-luna through a codebase, email, and a knowledge base. The speed claim is about ${FRENCH_OWEN_SMALL_MODELS.reported.lunaSpeed} tokens per second. The bill claim is that fairly complicated research threads stay in the ${FRENCH_OWEN_SMALL_MODELS.reported.researchThread}, including searches across thousands of emails.`,
      ),
      paragraph(
        `His pet eval is a daily personalized news site. The prompt asks a model to research him, then build a micro-site of stories from Hacker News, Reddit, and Twitter. On Sonnet-class models he spent about ${FRENCH_OWEN_SMALL_MODELS.reported.newsEvalSonnet} to get anywhere. On luna he reports decent results at an average of about ${FRENCH_OWEN_SMALL_MODELS.reported.newsEvalLuna}. He writes: “${FRENCH_OWEN_SMALL_MODELS.quotes.lunaNews}”`,
      ),
      table(
        "Quoted consumer-cost observations from the August 26, 2026 essay",
        ["Observation", "Quoted figure", "What it measures"],
        [
          [
            textCell("gpt-5.6-luna speed"),
            textCell(`About ${FRENCH_OWEN_SMALL_MODELS.reported.lunaSpeed} tokens per second`),
            textCell("Interactive throughput on his runs"),
          ],
          [
            textCell("Research-thread API bill"),
            textCell(FRENCH_OWEN_SMALL_MODELS.reported.researchThread),
            textCell("Complicated personal research, including large email search"),
          ],
          [
            textCell("Personalized news eval"),
            textCell(`${FRENCH_OWEN_SMALL_MODELS.reported.newsEvalLuna} versus ${FRENCH_OWEN_SMALL_MODELS.reported.newsEvalSonnet} on Sonnet-class models`),
            textCell("His daily news-site prompt, not a coding-agent suite"),
          ],
        ],
      ),
      paragraph(
        "Those figures belong to French-Owen’s runs and his news prompt. They are not AA Index cells, DeepSWE cells, or mean API costs from ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis’s coding-agents comparison" },
        ". A ten-cent news eval can be a faithful citation of the essay and still leave the coding-agent scoreboard untouched.",
      ),
      heading("Token cost, not taste, blocked consumer AI"),
      paragraph(
        "Investors asked him why consumer AI companies have been scarce. His answer is a cost structure, not a missing product idea. “",
        FRENCH_OWEN_SMALL_MODELS.quotes.tokenCosts,
        "” The pre-AI consumer playbook assumed a cheap-to-run website, virality, then an ads marketplace. Per-request inference broke that capital path. A product that spends a dollar to assemble one personalized edition cannot charge a newspaper subscription and survive.",
      ),
      paragraph(
        "A ",
        { href: HRANESS_SMALL_MODELS_READING.digestUrl, text: "Hraness reading note of the essay" },
        ` records the same limit as a dated digest: “${HRANESS_SMALL_MODELS_READING.gist}” The digest’s cost sentence is the one this page keeps in view: “${HRANESS_SMALL_MODELS_READING.tokenCostNotTaste}”`,
      ),
      paragraph(
        "That claim is about whether a consumer loop can pay for itself. It is not a claim about which named coding-agent configuration leads a public suite. Crossing a news-eval dollar threshold can unlock a class of products and still leave the scoreboard’s columns in place.",
      ),
      heading("He still keeps frontier models for hard coding"),
      paragraph(
        "The same essay refuses to retire the expensive models. For coding work French-Owen almost always reaches for Fable 5 and GPT-5.6 Sol. He says that habit made the small-model progress easy to miss. He also expects demand for frontier-level models to keep compounding in engineering, hard science, and model training.",
      ),
      paragraph(
        `He reports a second demand curve from Peter Reinhardt. About ${FRENCH_OWEN_SMALL_MODELS.reported.tokenSpewerShare} of that operator work is “token spewer” responsiveness: hopping on calls, nudging people, and blocking and tackling. The remaining slice is the novel-breakthrough work he still assigns to an expensive model. Cheap models, in this telling, can start to cover the responsive slice. They do not replace the slice that still needs a frontier stack.`,
      ),
      paragraph(
        "French-Owen also names GLM 5.3 as a new option on a general Pareto frontier. That sentence is his. The checked coding-agent snapshot does not store a GLM-5.3 row, and this page does not mint one. A general cost-quality remark is not a stored AA Index cell.",
      ),
      heading("A news-eval win is not a coding-agent cell"),
      paragraph(
        `AI Charts retrieved the checked snapshot on ${retrievedAt}. The dataset contains ${summary.recordCount} model-agent configurations across ${summary.modelCount} models, ${summary.agentCount} agent harnesses, and ${summary.providerCount} providers. The snapshot has no consumer-bill field and no news-eval dollar column. Each row is already a product citation: a model name, a harness name, and an effort setting, with scores copied from Artificial Analysis.`,
      ),
      paragraph(
        "The snapshot does not store a gpt-5.6-luna coding-agent row. That absence is part of the argument. A consumer-eval dollar chart does not mint a named AA Index cell. Inventing a luna scoreboard line from a ten-cent news prompt would collapse two jobs into one column.",
      ),
      paragraph(
        "The snapshot does store named Fable 5 and GPT-5.6 Sol configurations, the models French-Owen still reaches for when the work is hard coding. Those rows stay attached to a harness and a setting. They are coding-agent observations on the retrieval date. They are not consumer-bill observations.",
      ),
      table(
        `Named coding-agent rows already stored for French-Owen’s coding models, ${snapshot.source.name} snapshot retrieved ${retrievedAt}`,
        ["Model", "Agent", "Setting", "AA Index"],
        namedCodingRows.map(row => [
          textCell(row.model),
          textCell(row.agent),
          textCell(row.setting),
          textCell(formatSnapshotScore(row.aaIndex)),
        ]),
      ),
      paragraph(
        "Those two lines are already on the ",
        { href: "/", text: "live coding-agent comparison" },
        ". They remain two named products. A cheap-model headline that erased the harness or the setting would drop the only fields that make a stored row citeable.",
      ),
      callout(
        "Consumer bill and scoreboard stay separate",
        "Use French-Owen for the news-eval dollar threshold, the research-thread bills, and his own split between cheap responsiveness and frontier coding. Use the coding-agent snapshot when you need a named model, harness, and setting. Do not treat a ten-cent news eval as an instruction to merge those rows.",
      ),
      heading("The harness still names the row"),
      paragraph(
        { href: HARNESS_DEFINITION_URL, text: "Hraness defines an agent harness" },
        " as software that gives a model a place to work: it injects instructions, offers tools, runs an assess-act-reassess loop, and translates across model APIs. French-Owen’s own close already points at that layer. He says fast, cheap, good-enough models still need new harnesses, prompt-injection safety, roles, and permissions before they can run a business.",
      ),
      paragraph(
        "A cheaper engine does not delete the place the engine works. If the consumer job is a news loop, the missing work is a harness that can run that loop at a ten-cent bill. If the coding job is a named scoreboard cell, the row still has to say which harness and which setting produced the score. Keeping those jobs in different columns is how a later cheap-model row can appear without rewriting the frontier rows already stored.",
      ),
      heading("Closing a bill is not closing a scoreboard"),
      paragraph(
        { href: CATCHING_UP_SIBLING_PATH, text: "Open models can close a scoreboard and still lose the product" },
        " asks whether a SemiAnalysis era composite should collapse named coding-agent rows into an open-won headline. This page asks the adjacent question for a consumer bill. Both notes keep the snapshot as named configurations. They do not share a source suite.",
      ),
      table(
        "What each source is allowed to decide",
        ["Source", "Question it answers", "What a win there means"],
        [
          [
            textCell("French-Owen news eval"),
            textCell("Can a small fast model assemble a personalized edition at a consumer-viable bill?"),
            textCell("A dollar-chart observation on his prompt"),
          ],
          [
            textCell("French-Owen coding habit"),
            textCell("Which models does he still use for hard coding?"),
            textCell("A product preference, not a second news eval"),
          ],
          [
            textCell("AI Charts coding-agent snapshot"),
            textCell("What did this named model, harness, and setting score on the stored metrics?"),
            textCell("A configuration observation on the retrieval date"),
          ],
        ],
      ),
      paragraph(
        "The useful failure mode is a headline that treats the first row as a substitute for the third. “Small models have arrived” can be a faithful citation of French-Owen and still be the wrong instruction for this snapshot. The snapshot would have to invent a luna coding-agent cell, or drop harness and setting from the Fable and Sol rows, to print a cheap-won rank. The essay does not ask for that drop. It keeps frontier models for hard coding while it celebrates the cheaper consumer loop.",
      ),
      heading("How to read this page"),
      paragraph(
        "Read the French-Owen essay for the luna speed, the research-thread bills, the news-eval dollar comparison, the consumer-capital argument, and the coding-versus-responsiveness split. Read the ",
        { href: HRANESS_SMALL_MODELS_READING.digestUrl, text: "Hraness reading note" },
        " for a dated digest of those claims. This page is not that digest. Read the ",
        { href: "/", text: "coding-agent comparison" },
        " when you need the live named rows. Read ",
        { href: CATCHING_UP_SIBLING_PATH, text: "why closing a scoreboard is not closing a consumer bill" },
        " when the adjacent source is SemiAnalysis rather than a news-eval dollar chart. Read the ",
        { href: HARNESS_DEFINITION_URL, text: "Hraness harness definition" },
        " when a later cheap-model row still needs a noun for the software around the weights.",
      ),
      paragraph(
        "The useful sentence is narrower than the essay title. Small fast models can close a consumer bill on a news eval. French-Owen still picks frontier models for hard coding. AI Charts keeps the live coding-agent snapshot as named model, harness, and setting rows for the same reason.",
      ),
      heading("Limits of this comparison"),
      list(
        [
          "French-Owen reports his own luna runs, news-eval bills, and coding preference. AI Charts does not rerun that prompt or recover unpublished cost traces.",
        ],
        [
          "The Hraness page is a dated digest, not a substitute for the essay. Quote French-Owen for the measurements and the Hraness note only for its own digest sentences. This page is not that digest.",
        ],
        [
          "Artificial Analysis defines the coding-agent scores. AI Charts is an independent visualization and is not affiliated with Artificial Analysis, French-Owen, or the listed providers.",
        ],
        [
          "This page does not add a gpt-5.6-luna coding-agent cell. A consumer-eval dollar chart is not a stored AA Index observation.",
        ],
        [
          "Named Fable 5 and GPT-5.6 Sol scores belong to the stored model, harness, setting, task set, and evaluation version on the retrieval date. They do not establish results for every repository or production workflow.",
        ],
        [
          "This is a checked snapshot, not a live mirror. Cite the retrieval timestamp when quoting a value.",
        ],
      ),
    ],
  };
}
