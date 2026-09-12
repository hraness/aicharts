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

export const DEVIN_FUSION_ARTICLE_SLUG = "devin-fusion-cost-saving" as const;
export const DEVIN_FUSION_ARTICLE_PUBLISHED_AT = "2026-09-11" as const;

type HeadlinePoint = Readonly<{
  configuration: string;
  costChange: string;
  costUsd: string;
  indexScore: string;
}>;

type BenchmarkComparison = Readonly<{
  benchmark: string;
  fusionAstra: string;
  fusionFable: string;
  leadAstra: string;
  leadFable: string;
}>;

type SidekickComparison = Readonly<{
  fusionResult: string;
  listPrice: string;
  sidekick: string;
}>;

export const DEVIN_FUSION = {
  announcedOn: "September 11, 2026",
  headline:
    "up to 39% more efficient compared to other model harnesses across major coding benchmarks",
  headlineIndex: "Artificial Analysis Coding Agent Index v1.5",
  headlinePoints: [
    {
      configuration: "Codex, Astra (max)",
      costChange: "reference",
      costUsd: "$7.47",
      indexScore: "61.6",
    },
    {
      configuration: "Devin Fusion, Astra + SWE-2",
      costChange: "39% lower",
      costUsd: "$4.54",
      indexScore: "58.9",
    },
    {
      configuration: "Claude Code, Fable 5.1 (max)",
      costChange: "reference",
      costUsd: "$12.36",
      indexScore: "62.2",
    },
    {
      configuration: "Devin Fusion, Fable 5.1 + SWE-2",
      costChange: "36% lower",
      costUsd: "$7.90",
      indexScore: "61.7",
    },
  ] as const satisfies readonly HeadlinePoint[],
  headlineScoreGaps: {
    astra: "2.7",
    fable: "0.5",
  },
  otherHeadlineScores: "Claude Opus 5 (max) on Claude Code at 60, Kimi K3 on Kimi Code CLI at 52, and Qwen3.8 Max on Claude Code and DeepSeek V4 on Codex at 43",
  benchmarkComparisons: [
    {
      benchmark: "DeepSWE 1.1",
      leadFable: "64.3 at $14.63",
      fusionFable: "63.1 at $7.88 (−46%)",
      leadAstra: "67.6 at $7.88",
      fusionAstra: "67.3 at $4.69 (−40%)",
    },
    {
      benchmark: "Terminal-Bench 4",
      leadFable: "57.6 at $17.46",
      fusionFable: "56.1 at $13.37 (−23%)",
      leadAstra: "55.6 at $10.08",
      fusionAstra: "50.0 at $6.06 (−40%)",
    },
    {
      benchmark: "SWE-Atlas QnA",
      leadFable: "64.8 at $7.57",
      fusionFable: "65.9 at $5.00 (−34%)",
      leadAstra: "61.8 at $5.72",
      fusionAstra: "59.4 at $3.59 (−37%)",
    },
    {
      benchmark: "Vals Code Migration",
      leadFable: "54.6 at $70.97",
      fusionFable: "57.3 at $42.00 (−41%)",
      leadAstra: "67.7 at $44.36",
      fusionAstra: "61.3 at $35.51 (−20%)",
    },
    {
      benchmark: "FrontierCode 1.1 (Extended)",
      leadFable: "63.6 at $2.68",
      fusionFable: "63.5 at $1.67 (−38%)",
      leadAstra: "63.1 at $2.62",
      fusionAstra: "63.4 at $2.34 (−11%)",
    },
  ] as const satisfies readonly BenchmarkComparison[],
  benchmarkSavingRange: "11% to 46%",
  sidekickComparisons: [
    {
      sidekick: "GPT-5.6 Luna (high)",
      listPrice: "$0.20 per million tokens",
      fusionResult: "62.0 at $2.39",
    },
    {
      sidekick: "SWE-2 (medium)",
      listPrice: "$0.75 per million tokens (+275%)",
      fusionResult: "63.4 at $2.34 (−2%)",
    },
  ] as const satisfies readonly SidekickComparison[],
  earlier: {
    juneInitial: "35%",
    juneUpdated: "up to 60%",
    juneUpdatedOn: "August 7, 2026",
    juneFable5: "41%",
    augustFusionCost: "$1.43",
    augustFable51Cost: "$2.68",
    augustSaving: "47%",
    septemberFusionCost: "$1.67",
    septemberSaving: "38%",
  },
  fableVersusOpusLead: "9% less",
  artificialAnalysisListing: {
    observedOn: "September 11, 2026",
    configurations: [
      "Devin Fusion CLI · Claude Fable 5.1 XHigh + SWE-2 Medium",
      "Devin Fusion CLI · GPT-6 Astra XHigh + SWE-2 Medium",
    ],
  },
} as const;

export type LeadModelBaseline = Readonly<{
  label: string;
  record: CodingAgentRecord | undefined;
}>;

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

function highestSettingRow(
  records: readonly CodingAgentRecord[],
  agent: string,
  modelPrefix: string,
): CodingAgentRecord | undefined {
  return records
    .filter(record => record.agent === agent && record.model.startsWith(modelPrefix))
    .sort((left, right) => right.settingRank - left.settingRank || left.id.localeCompare(right.id))[0];
}

/**
 * Fusion rows are identified by the harness name Artificial Analysis publishes,
 * so the article's snapshot statement stays truthful after a later checked
 * snapshot adds them without a copy edit.
 */
export function fusionSnapshotRecords(
  records: readonly CodingAgentRecord[],
): CodingAgentRecord[] {
  return records
    .filter(record => record.agent.toLowerCase().includes("fusion"))
    .sort((left, right) => (
      (right.benchmarks.aaIndex ?? -1) - (left.benchmarks.aaIndex ?? -1)
      || left.id.localeCompare(right.id)
    ));
}

export function leadModelBaselines(
  records: readonly CodingAgentRecord[],
): LeadModelBaseline[] {
  return [
    { label: "Fable 5.1 lead", record: highestSettingRow(records, "Claude Code", "Fable 5.1") },
    { label: "GPT-6 Astra lead", record: highestSettingRow(records, "Codex", "GPT-6 Astra") },
    { label: "Devin CLI single model", record: highestSettingRow(records, "Devin CLI", "SWE-1.7") },
  ];
}

function snapshotRowCells(record: CodingAgentRecord): InlineContent[] {
  return [
    textCell(record.model),
    textCell(record.agent),
    textCell(record.setting),
    textCell(formatSnapshotScore(record.benchmarks.aaIndex)),
    textCell(formatSnapshotCostUsd(record.economics.costUsd)),
  ];
}

function baselineBlocks(
  snapshot: CodingAgentSnapshot,
  retrievedAt: string,
): BlogBlock[] {
  const present = leadModelBaselines(snapshot.records)
    .map(baseline => baseline.record)
    .filter((record): record is CodingAgentRecord => record !== undefined);
  if (present.length < 2) {
    return [
      paragraph(
        `The snapshot retrieved ${retrievedAt} does not store enough of the lead models named in Cognition’s post to show a single-model baseline table.`,
      ),
    ];
  }
  return [
    table(
      `Single-model configurations from the AI Charts snapshot retrieved ${retrievedAt}`,
      ["Model", "Agent", "Setting", "AA Index", "Mean cost per task"],
      present.map(snapshotRowCells),
    ),
    paragraph(
      `Cognition’s headline chart reports ${DEVIN_FUSION.headlinePoints[2].indexScore} for Fable 5.1 (max) on Claude Code and ${DEVIN_FUSION.headlinePoints[0].indexScore} for Astra (max) on Codex. Where the snapshot values differ from those, the difference comes from the index version, its component benchmarks, and the retrieval date, not from a change in the model. Compare a Fusion configuration only with rows measured under the same index version.`,
    ),
  ];
}

function fusionStatusBlocks(
  snapshot: CodingAgentSnapshot,
  retrievedAt: string,
): BlogBlock[] {
  const fusionRecords = fusionSnapshotRecords(snapshot.records);
  if (fusionRecords.length === 0) {
    return [
      paragraph(
        `The snapshot retrieved ${retrievedAt} does not include a Fusion configuration. The chart therefore cannot confirm or contradict Cognition’s figures yet. AI Charts will show Fusion rows once a later checked snapshot includes them.`,
      ),
    ];
  }
  const count = fusionRecords.length === 1
    ? "one Fusion configuration"
    : `${fusionRecords.length} Fusion configurations`;
  return [
    paragraph(
      `The snapshot retrieved ${retrievedAt} includes ${count}. The values below are copied from that snapshot and belong to its index version, not to Cognition’s chart.`,
    ),
    table(
      `Fusion configurations in the AI Charts snapshot retrieved ${retrievedAt}`,
      ["Model", "Agent", "Setting", "AA Index", "Mean cost per task"],
      fusionRecords.map(snapshotRowCells),
    ),
  ];
}

export function createDevinFusionCostSavingArticle(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): BlogArticle {
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const updatedAt = latestCalendarDate(
    DEVIN_FUSION_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(snapshot.source.retrievedAt),
    utcCalendarDate(codingAgentDatasetModifiedAt(snapshot)),
  );
  const [astraLead, astraFusion, fableLead, fableFusion] = DEVIN_FUSION.headlinePoints;

  return {
    authorshipDisclosure: BLOG_AUTHORSHIP_DISCLOSURE,
    slug: DEVIN_FUSION_ARTICLE_SLUG,
    title: "What Devin Fusion’s 39% saving measures",
    dek:
      "Cognition’s 39% is one comparison: an Astra-led Fusion pair against Codex on the Artificial Analysis index, at a lower score. The same post’s other reported savings run from 11% to 46%.",
    focusPhrase: "Devin Fusion cost saving",
    seoDescription:
      "Cognition’s Devin Fusion pairs a frontier lead with an SWE-2 sidekick. See which comparison produces the 39% figure, what score it gave up, and its limits.",
    keywords: [
      "Devin Fusion",
      "Cognition",
      "multi-model harness",
      "coding agent cost",
      "SWE-2",
      "Artificial Analysis",
    ],
    publishedAt: DEVIN_FUSION_ARTICLE_PUBLISHED_AT,
    updatedAt,
    sourceIds: [
      "cognitionFusionDesktopCli",
      "cognitionDevinFusion",
      "devinFable51",
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: ["aa-index-cost-coding-agents", "small-models-have-arrived"],
    body: [
      paragraph(
        "Cognition, the company behind the Devin coding agent, released Fusion in Devin Desktop and Devin CLI on ",
        DEVIN_FUSION.announcedOn,
        ". Fusion is a harness that runs two agents at once. A frontier model, the lead, plans the task, hands out work, and reviews the result. A less expensive model, the sidekick, explores the code, makes the changes, and runs the tests. The ",
        { href: BLOG_SOURCES.cognitionFusionDesktopCli.url, text: "announcement" },
        " calls Fusion ",
        `“${DEVIN_FUSION.headline}.”`,
      ),
      paragraph(
        "That sentence carries one number and several comparisons. This note identifies which comparison produces the 39%, lists the other savings Cognition reports in the same post and its two earlier Fusion posts, and states what the AI Charts coding-agent snapshot can and cannot show about the new harness. Every percentage below is a Cognition-reported measurement unless the text says otherwise.",
      ),
      heading("Where the 39% comes from"),
      paragraph(
        "The headline chart in the announcement plots configurations on the ",
        DEVIN_FUSION.headlineIndex,
        ", the composite score that Artificial Analysis publishes for coding-agent harness and model combinations. The chart shows each configuration’s index score and its mean cost per run relative to the provider’s own harness. Two pairs carry the comparison. Cognition labels OpenAI’s GPT-6 Astra as Astra, and the tables below keep Cognition’s labels.",
      ),
      table(
        `Headline comparison on the ${DEVIN_FUSION.headlineIndex}, as reported by Cognition on ${DEVIN_FUSION.announcedOn}`,
        ["Configuration", "Index score", "Mean cost per run", "Cost change"],
        DEVIN_FUSION.headlinePoints.map(point => [
          textCell(point.configuration),
          textCell(point.indexScore),
          textCell(point.costUsd),
          textCell(point.costChange),
        ]),
      ),
      paragraph(
        "The 39% is the Astra pair: ",
        astraFusion.configuration,
        " at ",
        astraFusion.costUsd,
        " per run against ",
        astraLead.configuration,
        " at ",
        astraLead.costUsd,
        ". That saving came with an index score ",
        DEVIN_FUSION.headlineScoreGaps.astra,
        " points lower (",
        astraFusion.indexScore,
        " against ",
        astraLead.indexScore,
        "). The Fable pair saved 36% (",
        fableFusion.costUsd,
        " against ",
        fableLead.costUsd,
        ") and gave up ",
        DEVIN_FUSION.headlineScoreGaps.fable,
        " points (",
        fableFusion.indexScore,
        " against ",
        fableLead.indexScore,
        "). “Up to 39%” therefore names the larger of two savings, and the larger saving is also the one with the larger score gap.",
      ),
      paragraph(
        "The same chart places other single-model configurations lower on the index: ",
        DEVIN_FUSION.otherHeadlineScores,
        ". Those points show where the two Fusion pairs sit among current harnesses; they are not part of the 39% calculation.",
      ),
      heading("Same lead, with and without a sidekick"),
      paragraph(
        "The post also reports a five-benchmark table that holds the lead model constant and adds SWE-2, Cognition’s own model, as the sidekick. Cognition states that it partnered with Artificial Analysis and Vals AI for these evaluations. FrontierCode is Cognition’s own benchmark. Each cell is a score followed by mean cost per task.",
      ),
      table(
        `Lead model alone versus Fusion with an SWE-2 sidekick, as reported by Cognition on ${DEVIN_FUSION.announcedOn}`,
        ["Benchmark", "Fable 5.1", "Fusion (Fable 5.1 + SWE-2)", "Astra", "Fusion (Astra + SWE-2)"],
        DEVIN_FUSION.benchmarkComparisons.map(row => [
          textCell(row.benchmark),
          textCell(row.leadFable),
          textCell(row.fusionFable),
          textCell(row.leadAstra),
          textCell(row.fusionAstra),
        ]),
      ),
      paragraph(
        "The cost reductions in this table run from ",
        DEVIN_FUSION.benchmarkSavingRange,
        ". None of them is 39%, because this table compares Fusion with the same lead model running alone in Devin, while the headline compares Fusion with another vendor’s harness. In six of the 10 cells the score moved by 1.5 points or less. The larger moves are Astra on Terminal-Bench 4 (55.6 to 50.0), Astra on Vals Code Migration (67.7 to 61.3), Astra on SWE-Atlas QnA (61.8 to 59.4), and Fable 5.1 on Vals Code Migration, where Fusion scored higher (54.6 to 57.3).",
      ),
      paragraph(
        "Read the table as a per-benchmark, per-pair result. A single Fusion percentage without the lead model, the sidekick, the benchmark, the thinking level, and the date is an incomplete citation.",
      ),
      heading("Earlier Fusion numbers used different comparisons"),
      paragraph(
        "Cognition has published Fusion cost figures in three posts since June, and they are not the same measurement. The ",
        { href: BLOG_SOURCES.cognitionDevinFusion.url, text: "June 29, 2026 introduction" },
        " first reported a ",
        DEVIN_FUSION.earlier.juneInitial,
        " cost reduction on its FrontierCode benchmark, then revised it to ",
        DEVIN_FUSION.earlier.juneUpdated,
        " on FrontierCode 1.1 Extended data updated ",
        DEVIN_FUSION.earlier.juneUpdatedOn,
        " for Opus and GPT-5.5-level leads. The same post reported ",
        DEVIN_FUSION.earlier.juneFable5,
        " for Fable 5 as lead, measured before Fable 5 access was suspended.",
      ),
      paragraph(
        "The ",
        { href: BLOG_SOURCES.devinFable51.url, text: "August 31, 2026 Fable 5.1 post" },
        " reported Devin Fusion at ",
        DEVIN_FUSION.earlier.augustFusionCost,
        " per FrontierCode 1.1 Extended task against ",
        DEVIN_FUSION.earlier.augustFable51Cost,
        " for Fable 5.1 alone, a ",
        DEVIN_FUSION.earlier.augustSaving,
        " saving, without naming the sidekick. The September table reports the named Fable 5.1 and SWE-2 pair at ",
        DEVIN_FUSION.earlier.septemberFusionCost,
        " on the same benchmark, a ",
        DEVIN_FUSION.earlier.septemberSaving,
        " saving. The two Fusion costs differ because the configurations differ, and only the September figure names both models.",
      ),
      heading("A more expensive sidekick did not cost more"),
      paragraph(
        "Cognition reports that a stronger sidekick can leave the total unchanged. With GPT-6 Astra at the high thinking level as lead on FrontierCode, replacing GPT-5.6 Luna with SWE-2 raised the sidekick’s list price by 275%, lowered the cost per task by 2%, and raised the score from 62.0 to 63.4.",
      ),
      table(
        "Sidekick comparison with an Astra lead on FrontierCode, as reported by Cognition",
        ["Sidekick", "List price", "Score at cost per task"],
        DEVIN_FUSION.sidekickComparisons.map(row => [
          textCell(row.sidekick),
          textCell(row.listPrice),
          textCell(row.fusionResult),
        ]),
      ),
      paragraph(
        "Cognition’s explanation is that a stronger sidekick needs fewer attempts and fewer review rounds from the lead, so the lead’s token use falls. The post makes the same argument for the lead seat: with the same sidekick, Fable 5 as lead cost ",
        DEVIN_FUSION.fableVersusOpusLead,
        " than Opus 4.8 while scoring higher on FrontierCode, even though Fable’s per-token price is about twice as high. Both are Cognition’s measurements of its own harness, and both support its stated conclusion that cost per completed task is the number to compare, rather than price per token.",
      ),
      heading("What the AI Charts snapshot shows"),
      paragraph(
        "The AI Charts coding-agent chart is a checked snapshot of the public ",
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis coding-agents page" },
        `, retrieved ${retrievedAt}. The snapshot stores AA Index with DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA as component benchmarks. Cognition’s headline chart and table use Coding Agent Index v1.5, DeepSWE 1.1, and Terminal-Bench 4. Values from the two index versions are different measurements and must not be compared with each other.`,
      ),
      paragraph(
        "The snapshot does include the two lead models in their single-model harnesses and Cognition’s earlier Devin CLI configuration, so a reader can see what the site currently stores for those names.",
      ),
      ...baselineBlocks(snapshot, retrievedAt),
      ...fusionStatusBlocks(snapshot, retrievedAt),
      paragraph(
        "On ",
        DEVIN_FUSION.artificialAnalysisListing.observedOn,
        ", the live Artificial Analysis page listed two Fusion configurations: ",
        DEVIN_FUSION.artificialAnalysisListing.configurations[0],
        " and ",
        DEVIN_FUSION.artificialAnalysisListing.configurations[1],
        ". Those labels name the lead thinking level as XHigh and the sidekick level as Medium. Cognition’s FrontierCode figures use the medium thinking level for the lead. Configuration labels differ across the three tables in this note, so carry the label with the number.",
      ),
      callout(
        "How to read a Fusion claim",
        "Ask which two configurations are compared, on which benchmark and index version, at which thinking levels, and on which date. Then read the score beside the cost. A 39% saving with a 2.7-point lower score and a 36% saving with a 0.5-point lower score are different results.",
      ),
      heading("Limits"),
      list(
        [
          "Every percentage in Cognition’s posts is a vendor measurement of its own harness. Cognition names Artificial Analysis and Vals AI as evaluation partners for the September table, and FrontierCode is Cognition’s own benchmark.",
        ],
        [
          "Scores and costs belong to the named lead, sidekick, benchmark, index version, thinking level, and date. Cognition revised its June figure from 35% to up to 60% after a data update, and later posts report different configurations.",
        ],
        [
          "Mean cost per run or per task is an evaluation average. It is not a subscription price, a production invoice, or a guarantee for a specific repository.",
        ],
        [
          "The AI Charts snapshot is checked on its own schedule and stores an earlier index composition. A Fusion row that appears on the live source page is not in the chart until a later checked snapshot includes it.",
        ],
        [
          "Fusion depends on how well the lead delegates. Cognition’s own June examples include a hard TypeScript feature whose score fell from 54 to 27 when the coding was delegated, so the average saving does not describe every task.",
        ],
      ),
    ],
  };
}
