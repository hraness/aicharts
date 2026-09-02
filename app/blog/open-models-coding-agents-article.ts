import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  codingAgentDatasetModifiedAt,
  codingAgentDatasetSummary,
} from "@/lib/coding-agent-dataset";
import {
  aaIndexCostFrontier,
  codingAgentSnapshotRows,
  formatSnapshotCostUsd,
  formatSnapshotScore,
} from "@/lib/coding-agent-snapshot-rows";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
import {
  formatAaIndexGap,
  highestAaIndexRow,
  highestAaIndexRowForModel,
  isOpenWeightCodingAgent,
  openWeightCodingAgentRows,
  openWeightProviderNames,
  unclassifiedProviderNames,
} from "@/lib/open-weight-coding-agents";

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

export const OPEN_MODELS_ARTICLE_SLUG = "open-models-coding-agent-benchmarks" as const;
export const OPEN_MODELS_ARTICLE_PUBLISHED_AT = "2026-08-26" as const;
const OPEN_WEIGHT_LEADER_LIMIT = 8;
const CLOSED_LEADER_LIMIT = 8;

const SEMIANALYSIS_OPEN_MODELS = {
  publishedOn: "August 21, 2026",
  quotes: {
    era1DeepSeekV3: "94.1",
    era1Gpt35: "75.7",
    era1Gpt4o: "95.5",
    era1Llama2: "39.9",
    era1Llama31: "86",
    era1StartGapPoints: "35.8",
    era2CatchupMonths: "8.5",
    era2R10528: "78",
    era2StartGapPoints: "12.1",
    era3Glm52: "72.4",
    era3GlmMonths: "6",
    era3KimiK26: "56.3",
    era3KimiMonths: "4.8",
  },
} as const;

const SEMIANALYSIS_NAMED_CATCHUP = [
  {
    closedReference: "Opus 4.5",
    composite: SEMIANALYSIS_OPEN_MODELS.quotes.era3KimiK26,
    model: "Kimi K2.6",
    months: SEMIANALYSIS_OPEN_MODELS.quotes.era3KimiMonths,
  },
  {
    closedReference: "GPT-5.2",
    composite: SEMIANALYSIS_OPEN_MODELS.quotes.era3Glm52,
    model: "GLM-5.2",
    months: SEMIANALYSIS_OPEN_MODELS.quotes.era3GlmMonths,
  },
] as const;

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

function take<T>(items: readonly T[], limit: number): T[] {
  return items.slice(0, limit);
}

function joinNames(names: readonly string[]): string {
  if (names.length === 0) {
    throw new Error("At least one provider name is required.");
  }
  const last = names[names.length - 1];
  if (last === undefined) throw new Error("At least one provider name is required.");
  if (names.length === 1) return last;
  if (names.length === 2) {
    const first = names[0];
    if (first === undefined) throw new Error("At least one provider name is required.");
    return `${first} and ${last}`;
  }
  return `${names.slice(0, -1).join(", ")}, and ${last}`;
}

export function createOpenModelsCodingAgentsArticle(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): BlogArticle {
  const summary = codingAgentDatasetSummary(snapshot);
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const rows = codingAgentSnapshotRows(snapshot.records);
  const openRows = openWeightCodingAgentRows(snapshot.records);
  const closedLeaders = take(rows.filter(row => row.aaIndex !== null), CLOSED_LEADER_LIMIT);
  const openLeaders = take(openRows.filter(row => row.aaIndex !== null), OPEN_WEIGHT_LEADER_LIMIT);
  const top = highestAaIndexRow(rows);
  const topOpen = highestAaIndexRow(openRows);
  const openNames = openWeightProviderNames(snapshot.records);
  const unclassifiedNames = unclassifiedProviderNames(snapshot.records);
  const frontier = aaIndexCostFrontier(snapshot.records);
  const openFrontier = frontier.filter(point => isOpenWeightCodingAgent(point.record));
  const namedCatchup = SEMIANALYSIS_NAMED_CATCHUP.flatMap((entry) => {
    const row = highestAaIndexRowForModel(rows, entry.model);
    return row === undefined ? [] : [{ entry, row }];
  });

  if (top === undefined || top.aaIndex === null) {
    throw new Error("Checked snapshot has no AA Index values for the open-models article.");
  }
  if (topOpen === undefined || topOpen.aaIndex === null) {
    throw new Error("Checked snapshot has no open-weight AA Index values for the open-models article.");
  }
  if (openNames.length === 0) {
    throw new Error("Checked snapshot has no classified open-weight providers.");
  }

  const updatedAt = latestCalendarDate(
    OPEN_MODELS_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(snapshot.source.retrievedAt),
    utcCalendarDate(codingAgentDatasetModifiedAt(snapshot)),
  );
  const aaGap = formatAaIndexGap(top.aaIndex, topOpen.aaIndex);
  const firstOpenFrontier = openFrontier[0];

  return {
    authorshipDisclosure: BLOG_AUTHORSHIP_DISCLOSURE,
    slug: OPEN_MODELS_ARTICLE_SLUG,
    title: "Are open models catching up on coding-agent benchmarks?",
    dek:
      "SemiAnalysis reports a shrinking open-versus-closed gap on era-specific composites. The current coding-agent snapshot answers a narrower question: named model, harness, setting, and cost.",
    focusPhrase: "open models coding agent benchmarks",
    seoDescription:
      "SemiAnalysis reports faster open-model catch-up on era composites. This coding-agent snapshot shows a different gap once harness, AA Index, and cost are named.",
    keywords: [
      "open models",
      "coding agent benchmark",
      "AA Index",
      "SemiAnalysis",
      "open-weight models",
      "Artificial Analysis",
    ],
    publishedAt: OPEN_MODELS_ARTICLE_PUBLISHED_AT,
    updatedAt,
    sourceIds: [
      "semiAnalysisOpenModels",
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: ["aa-index-cost-coding-agents"],
    body: [
      paragraph(
        { href: BLOG_SOURCES.semiAnalysisOpenModels.url, text: "SemiAnalysis asks whether open models are catching up" },
        `, in an essay published ${SEMIANALYSIS_OPEN_MODELS.publishedOn} by Evan Cloutier, Max Kan, Jordan Nanos, and Dylan Patel. Their answer is about era-specific composites: catch-up time has halved with each generation, down to 4.8 to 6 months in the agentic era. This note keeps that claim in its own measurement, then asks a different question of the `,
        { href: "/", text: "current coding-agent leaders table" },
        ".",
      ),
      paragraph(
        "The Artificial Analysis snapshot stored by AI Charts names a model, an agent harness, an effort setting, and a mean API cost for every row. It does not publish an open-versus-closed field. The comparison below uses an explicit provider allowlist, copies scores from the checked snapshot, and quotes only SemiAnalysis figures that appear in the essay text. The two sources can agree that open models have become more useful without agreeing that they have closed the coding-agent table.",
      ),
      heading("SemiAnalysis measures era composites"),
      paragraph(
        "SemiAnalysis refuses a single historical scoreboard. Early-scaling exams saturate, reasoning exams replace them, and agentic work then needs terminal, browsing, and software-engineering tasks. Their Era 3 suite is Terminal-Bench 2.1, BrowseComp-Plus, τ³-banking, and DeepSWE. They ran most scores on Prime Intellect's evaluation stack and used additional runs from Artificial Analysis and Datacurve.",
      ),
      paragraph(
        `On that design they report a cycle. A closed lab jumps first. Other labs reverse-engineer the advance, including through distillation, and close the gap. In the early-scaling era their composite is ${SEMIANALYSIS_OPEN_MODELS.quotes.era1Gpt35} for GPT-3.5 Turbo and ${SEMIANALYSIS_OPEN_MODELS.quotes.era1Llama2} for Llama-2-70B. Llama-3.1-405B later reaches ${SEMIANALYSIS_OPEN_MODELS.quotes.era1Llama31}. GPT-4o and DeepSeek V3 finish the era at ${SEMIANALYSIS_OPEN_MODELS.quotes.era1Gpt4o} and ${SEMIANALYSIS_OPEN_MODELS.quotes.era1DeepSeekV3}.`,
      ),
      paragraph(
        `The reasoning-era opening gap is ${SEMIANALYSIS_OPEN_MODELS.quotes.era2StartGapPoints} points, against ${SEMIANALYSIS_OPEN_MODELS.quotes.era1StartGapPoints} at the start of the previous era. DeepSeek R1-0528 closes that opening gap at ${SEMIANALYSIS_OPEN_MODELS.quotes.era2R10528} after ${SEMIANALYSIS_OPEN_MODELS.quotes.era2CatchupMonths} months. In the agentic era they report that Kimi K2.6 surpassed Opus 4.5 at ${SEMIANALYSIS_OPEN_MODELS.quotes.era3KimiK26} in ${SEMIANALYSIS_OPEN_MODELS.quotes.era3KimiMonths} months, and that GLM-5.2 cleared GPT-5.2 at ${SEMIANALYSIS_OPEN_MODELS.quotes.era3Glm52} in ${SEMIANALYSIS_OPEN_MODELS.quotes.era3GlmMonths} months.`,
      ),
      paragraph(
        "Those sentences are SemiAnalysis measurements, not AI Charts calculations. The essay also limits what the composites prove. The authors still prefer Fable 5 for daily work over Kimi K3, even while saying Kimi K3 may score higher on their curated suite. They treat public benchmarks as hill-climbable: labs can train reinforcement-learning environments that mimic the evals.",
      ),
      heading("What the coding-agent snapshot records"),
      paragraph(
        `AI Charts retrieved the checked snapshot on ${retrievedAt}. The dataset contains ${summary.recordCount} model-agent configurations across ${summary.modelCount} models, ${summary.agentCount} agent harnesses, and ${summary.providerCount} providers. AA Index is the snapshot's overall 0–100 score across code changes, terminal work, and repository understanding. DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA stay separate. The `,
        { href: "/data", text: "dataset page" },
        " lists every configuration and the highest stored score for each metric.",
      ),
      paragraph(
        "This is a closer relative of SemiAnalysis's agentic era than of their earlier exams, but it is not the same composite. The snapshot omits BrowseComp-Plus and τ³-banking, adds SWE-Atlas-QnA, and reports DeepSWE as its own column instead of folding it into an unpublished average. Every row also carries a harness and setting. A model name without those fields is an incomplete citation here.",
      ),
      heading("Closed configurations still lead on AA Index"),
      paragraph(
        `The highest AA Index in this snapshot is ${formatSnapshotScore(top.aaIndex)} for ${top.model} on ${top.agent} at the ${top.setting} setting, with a mean API cost of ${formatSnapshotCostUsd(top.costUsd)} per task. The next stored scores belong to other closed-lab configurations. That is an observation of this table, not a claim that the same systems lead on SemiAnalysis's suite.`,
      ),
      table(
        `Highest AA Index configurations in the ${snapshot.source.name} snapshot retrieved ${retrievedAt}`,
        ["Model", "Agent", "Setting", "AA Index", "Cost"],
        closedLeaders.map(row => [
          textCell(row.model),
          textCell(row.agent),
          textCell(row.setting),
          textCell(formatSnapshotScore(row.aaIndex)),
          textCell(formatSnapshotCostUsd(row.costUsd)),
        ]),
      ),
      paragraph(
        "Open the ",
        { href: "/", text: "comparison chart" },
        " to change axes or pin a model. The leaders table on that page is the same checked snapshot, not a live scrape of the upstream page.",
      ),
      heading("Highest open-weight configurations in this snapshot"),
      paragraph(
        `AI Charts classifies a configuration as open-weight only when its provider is ${joinNames(openNames)}. Those families are the ones SemiAnalysis treats as open in the essay (DeepSeek, Kimi, Qwen, and GLM). The snapshot does not state a license, so this allowlist is an analysis choice. ${unclassifiedNames.length === 0 ? "No provider in this snapshot is left unclassified." : `${joinNames(unclassifiedNames)} ${unclassifiedNames.length === 1 ? "is" : "are"} left unclassified because the snapshot does not state a license and the SemiAnalysis essay does not name ${unclassifiedNames.length === 1 ? "that family" : "those families"} as open.`} Cursor, xAI, Google, OpenAI, and Anthropic stay closed.`,
      ),
      paragraph(
        `Under that rule, the highest open-weight AA Index is ${formatSnapshotScore(topOpen.aaIndex)} for ${topOpen.model} on ${topOpen.agent} at the ${topOpen.setting} setting, with a mean API cost of ${formatSnapshotCostUsd(topOpen.costUsd)} per task. That is ${aaGap} AA Index points behind ${top.model} on ${top.agent}. The gap is AI Charts subtraction of two stored scores. It is not a SemiAnalysis composite.`,
      ),
      table(
        `Highest open-weight AA Index configurations in the ${snapshot.source.name} snapshot retrieved ${retrievedAt}`,
        ["Model", "Agent", "Provider", "Setting", "AA Index", "Cost"],
        openLeaders.map(row => [
          textCell(row.model),
          textCell(row.agent),
          textCell(row.providerName),
          textCell(row.setting),
          textCell(formatSnapshotScore(row.aaIndex)),
          textCell(formatSnapshotCostUsd(row.costUsd)),
        ]),
      ),
      paragraph(
        `${openLeaders.length} open-weight configurations are shown, from ${openRows.length} classified open-weight rows in the snapshot. Several of those rows use Claude Code or Codex rather than a first-party harness. The snapshot therefore mixes model weights with another lab's agent product. That is one reason a model-only catch-up story and this table can diverge.`,
      ),
      heading("The same named models sit in different places"),
      paragraph(
        namedCatchup.length === 0
          ? "The SemiAnalysis essay quotes agentic-era catch-up scores for named models that are not present in this snapshot. No side-by-side row is possible until those names reappear in a validated refresh."
          : "SemiAnalysis's agentic-era catch-up claim names models that also appear in this snapshot. The essay's composite and the stored AA Index are different measurements of those names. The table copies the quoted SemiAnalysis figure beside the highest AA Index row for the same model string.",
      ),
      ...(namedCatchup.length === 0
        ? []
        : [
            table(
              `Named SemiAnalysis catch-up models that also appear in the ${snapshot.source.name} snapshot retrieved ${retrievedAt}`,
              ["Model", "SemiAnalysis composite", "Closed reference", "Months", "AA Index here", "Agent here"],
              namedCatchup.map(({ entry, row }) => [
                textCell(entry.model),
                textCell(entry.composite),
                textCell(entry.closedReference),
                textCell(entry.months),
                textCell(formatSnapshotScore(row.aaIndex)),
                textCell(`${row.agent}, ${row.setting}`),
              ]),
            ),
            paragraph(
              "Kimi K2.6 and GLM-5.2 can close SemiAnalysis's Era 3 composite against older closed flags and still sit well below the current AA Index leaders here. That is not a contradiction in one scoreboard. It is two scoreboards. SemiAnalysis compares era-opening closed models to later open releases on their suite. This snapshot compares current named configurations on Artificial Analysis's coding-agent metrics.",
            ),
          ]),
      paragraph(
        "SemiAnalysis also writes that Kimi K3 may outscore Fable 5 on their composite while they still prefer Fable for daily work. This snapshot does not contain a SemiAnalysis composite for either name, so no Kimi K3-versus-Fable 5 number is quoted from that suite. On AA Index, the stored Fable 5 and Kimi K3 rows can be read on the ",
        { href: "/data", text: "full configuration table" },
        ".",
      ),
      heading("Cost changes which gap you see"),
      paragraph(
        "AA Index leaders in this snapshot are expensive relative to the cheapest rows. The ",
        { href: "/blog/aa-index-cost-coding-agents", text: "AA Index versus cost note" },
        " keeps a configuration on the frontier only when no other configuration is both cheaper and at least as strong. That derived view is AI Charts analysis of the stored pairs.",
      ),
      paragraph(
        firstOpenFrontier === undefined
          ? "No classified open-weight configuration sits on the AA Index versus cost frontier in this snapshot."
          : `At least one classified open-weight configuration is on that frontier: ${firstOpenFrontier.record.model} on ${firstOpenFrontier.record.agent} at the ${firstOpenFrontier.record.setting} setting, with AA Index ${formatSnapshotScore(firstOpenFrontier.yValue)} and mean API cost ${formatSnapshotCostUsd(firstOpenFrontier.xValue)} per task.${openFrontier.length > 1 ? ` ${openFrontier.length} open-weight frontier points appear in this snapshot.` : ""} Open-weight rows are more visible when the question is inexpensive score than when the question is the highest AA Index.`,
      ),
      callout(
        "Two questions, two answers",
        "Use SemiAnalysis for the historical catch-up cycle on their era composites. Use this snapshot when you need a named coding-agent configuration, a harness, and a task-level cost. Do not treat one as a reprint of the other.",
      ),
      paragraph(
        "The useful sentence is narrower than the essay title. Open-weight coding agents in this snapshot are close enough to matter on cost and close enough to appear in the middle of the AA Index list. They are not the current AA Index leaders. SemiAnalysis's faster catch-up time describes their composites, not this table.",
      ),
      heading("Limits of this comparison"),
      list(
        [
          "SemiAnalysis defines and operates its era composites. AI Charts does not rerun that suite or recover unpublished chart points from images.",
        ],
        [
          "Artificial Analysis defines the coding-agent scores and costs. AI Charts is an independent visualization and is not affiliated with Artificial Analysis, SemiAnalysis, or the listed providers.",
        ],
        [
          "The open-weight set is an explicit provider allowlist, not a field in the snapshot. A license change, a new provider, or a different definition of open would change the grouped rows.",
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
