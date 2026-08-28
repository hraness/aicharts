import codingAgentData from "@/data/coding-agents.json";
import { parseCodingAgentSnapshot, type CodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  codingAgentDatasetModifiedAt,
  codingAgentDatasetSummary,
  currentCodingAgentBenchmarkLeaders,
  formatBenchmarkScore,
  type CodingAgentBenchmarkLeader,
} from "@/lib/coding-agent-dataset";
import {
  codingAgentSnapshotRows,
  formatSnapshotScore,
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

export const EXPERTISE_ARTICLE_SLUG = "coding-agent-scores-still-need-expertise" as const;
export const EXPERTISE_ARTICLE_PUBLISHED_AT = "2026-08-26" as const;
export const HARNESS_DEFINITION_URL =
  "https://hraness.com/writing/what-is-an-agent-harness" as const;
const NAMED_AA_INDEX_LIMIT = 5;

export const LARS_FAYE_EXPERTISE = {
  publishedOn: "July 22, 2026",
  quotes: {
    chollet:
      "You cannot interpolate your way through a completely unique system failure.",
    illusion:
      "Finished with an 'illusion of competence' rather than true understanding.",
    paradox:
      "If these tools demand expertise, yet the tools can actively circumvent the friction that cultivates expertise",
    spolsky:
      "the abstractions save us time working, but they don’t save us time learning.",
  },
  wideningGapTitle:
    "The Widening Gap: The Benefits and Harms of Generative AI for Novice Programmers",
} as const;

export const SEAN_GOEDECKE_EXPERTISE = {
  publishedOn: "July 24, 2026",
  quotes: {
    bottleneck: "the human is the bottleneck, not the model",
    prompting:
      "The most important skill in prompting is expertise in the domain you're prompting for.",
    specifics:
      "system design problems are dominated by concrete specifics, not generic principles.",
  },
} as const;

export const HRANESS_FAYE_READING = {
  savedOn: "2026-08-24",
} as const;

export const HRANESS_GOEDECKE_READING = {
  savedOn: "2026-08-05",
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

export function createCodingAgentScoresStillNeedExpertiseArticle(
  snapshot: CodingAgentSnapshot = checkedSnapshot(),
): BlogArticle {
  const summary = codingAgentDatasetSummary(snapshot);
  const retrievedAt = formatRetrievedAt(snapshot.source.retrievedAt);
  const leaders = currentCodingAgentBenchmarkLeaders(snapshot);
  const aaLeader = requireLeader(leaders, "aaIndex");
  const namedAaIndexRows = codingAgentSnapshotRows(snapshot.records)
    .filter(row => row.aaIndex !== null)
    .slice(0, NAMED_AA_INDEX_LIMIT);
  const updatedAt = latestCalendarDate(
    EXPERTISE_ARTICLE_PUBLISHED_AT,
    utcCalendarDate(snapshot.source.retrievedAt),
    utcCalendarDate(codingAgentDatasetModifiedAt(snapshot)),
  );

  return {
    slug: EXPERTISE_ARTICLE_SLUG,
    title: "Coding-agent scores still need expertise",
    dek:
      "A stored coding-agent score names a model, harness, and setting on a published suite. Faye and Goedecke show why that number still needs a person who can specify and audit the work.",
    focusPhrase: "coding agent score expertise",
    seoDescription:
      "A stored coding-agent score names a model, harness, and suite. Faye and Goedecke show why that number still needs a person who can specify and audit the work.",
    keywords: [
      "coding agent expertise",
      "coding agent benchmark",
      "Lars Faye",
      "Sean Goedecke",
      "AA Index",
      "Artificial Analysis",
    ],
    publishedAt: EXPERTISE_ARTICLE_PUBLISHED_AT,
    updatedAt,
    sourceIds: [
      "larsFayeExpertise",
      "hranessFayeReading",
      "seanGoedeckeExpertise",
      "hranessGoedeckeReading",
      "artificialAnalysisCodingAgents",
    ],
    relatedSlugs: ["coding-agent-score-holdouts"],
    body: [
      paragraph(
        { href: BLOG_SOURCES.larsFayeExpertise.url, text: "Lars Faye’s AI Coding will Prevent Expertise" },
        `, published ${LARS_FAYE_EXPERTISE.publishedOn}, argues that coding assistants demand the expertise they also prevent novices from forming. `,
        { href: BLOG_SOURCES.seanGoedeckeExpertise.url, text: "Sean Goedecke’s LLMs reward expertise" },
        `, published ${SEAN_GOEDECKE_EXPERTISE.publishedOn}, argues that the same models amplify domain knowledge rather than flatten it. This note places those two claims next to the `,
        { href: "/", text: "current coding-agent comparison" },
        ".",
      ),
      paragraph(
        "The checked snapshot answers a narrow measurement question. It records that a named model, on a named agent harness, at a named effort setting, scored a stored value on a named suite. Faye and Goedecke answer a different question: who can specify the work that produced a plausible result, and who can audit that result once it exists. A high cell is not a credential for the person reading it.",
      ),
      heading("Faye’s expert-novice bind"),
      paragraph(
        "Faye names a skilled-orchestrator paradox. The skills that make an assistant useful (taste, review, and the ability to reject a fluent wrong turn) are the skills that unrestricted generation can skip. Veterans already have a history of failing, tracing, and rewriting. Newcomers are told to accelerate with tools that remove that friction.",
      ),
      paragraph(
        "He cites ",
        { emphasis: "em", text: LARS_FAYE_EXPERTISE.wideningGapTitle },
        ", a study of novice programmers that JetBrains highlighted. Heavy assistance produced confident finishes without the planning those novices would have done alone. People who ignored bad suggestions wrote the code they already intended. Faye quotes the study’s verdict: “",
        LARS_FAYE_EXPERTISE.quotes.illusion,
        "”",
      ),
      paragraph(
        "The learning setup is inverted. The student has to steer the mentor first, so domain knowledge is what makes an answer checkable. Without it, the model confirms the direction already implied by the prompt. Faye treats generation as a leaky abstraction and keeps Joel Spolsky’s limit attached: “",
        LARS_FAYE_EXPERTISE.quotes.spolsky,
        "” He also quotes François Chollet: “",
        LARS_FAYE_EXPERTISE.quotes.chollet,
        "”",
      ),
      callout(
        "Quoted from Lars Faye",
        `“${LARS_FAYE_EXPERTISE.quotes.paradox}”`,
      ),
      paragraph(
        "A ",
        { href: BLOG_SOURCES.hranessFayeReading.url, text: "Hraness reading note of Faye’s essay" },
        `, saved ${HRANESS_FAYE_READING.savedOn}, records that bind as a dated digest. The note is a companion citation. The argument lives in Faye’s essay.`,
      ),
      heading("Goedecke’s claim that models reward expertise"),
      paragraph(
        "Goedecke starts from the opposite public story: if everyone can ask the same model for sort-of-okay CSS, then prompting looks like a skill with no content. He calls that reading wrong. He writes: “",
        SEAN_GOEDECKE_EXPERTISE.quotes.prompting,
        "”",
      ),
      paragraph(
        "His illustration is Terence Tao’s conversation with ChatGPT about a counterexample to the Jacobian Conjecture. Tao’s messages stay short, push back when an answer looks too complex, and propose formulations the model did not choose. Goedecke is clear that those habits are not a transferable prompt recipe. They work because Tao understands the mathematics well enough to pull a useful fragment out of a long reply and to notice what looks strange.",
      ),
      paragraph(
        "The same constraint appears in software. Goedecke writes that “",
        SEAN_GOEDECKE_EXPERTISE.quotes.specifics,
        "” Familiarity with a codebase supports questions a generic design lecture cannot: whether a simpler path already exists, whether the system already does the work, and which local terms would make the problem smaller. Novices can still get something from the same model. Experts can steer it much harder.",
      ),
      paragraph(
        "He treats that gap as durable. For many tasks, “",
        SEAN_GOEDECKE_EXPERTISE.quotes.bottleneck,
        "” because the hard work is communicating the desired solution and judging whether the output is that solution. A ",
        { href: BLOG_SOURCES.hranessGoedeckeReading.url, text: "Hraness reading note of Goedecke’s essay" },
        `, saved ${HRANESS_GOEDECKE_READING.savedOn}, keeps that constraint as a dated digest.`,
      ),
      heading("What the snapshot names on each row"),
      paragraph(
        `AI Charts retrieved the checked snapshot on ${retrievedAt}. The dataset contains ${summary.recordCount} model-agent configurations across ${summary.modelCount} models, ${summary.agentCount} agent harnesses, and ${summary.providerCount} providers. The `,
        { href: "/data", text: "dataset page" },
        " defines each metric and lists the highest stored score for that metric. This note copies those named fields. It does not invent an operator, a rank, or a claim about who can read the table.",
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
        "AA Index is the snapshot’s overall 0–100 score across code changes, terminal work, and repository understanding. DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA stay separate. The highest stored AA Index is ",
        formatBenchmarkScore(aaLeader.value),
        " for ",
        aaLeader.record.model,
        " on ",
        aaLeader.record.agent,
        " at the ",
        aaLeader.record.setting,
        " setting. That sentence is complete only when the model, harness, setting, and suite stay attached to the number.",
      ),
      paragraph(
        { href: HARNESS_DEFINITION_URL, text: "Hraness defines an agent harness" },
        " as software that gives a model a place to work: it injects instructions, offers tools, runs an assess-act-reassess loop, and translates across model APIs. The snapshot already treats that layer as part of the observation. Two rows that share a model and differ only in harness or setting are different measurements.",
      ),
      table(
        `Highest stored AA Index configurations in the ${snapshot.source.name} snapshot retrieved ${retrievedAt}`,
        ["Model", "Agent", "Setting", "AA Index"],
        namedAaIndexRows.map(row => [
          textCell(row.model),
          textCell(row.agent),
          textCell(row.setting),
          textCell(formatSnapshotScore(row.aaIndex)),
        ]),
      ),
      paragraph(
        { href: BLOG_SOURCES.artificialAnalysisCodingAgents.url, text: "Artificial Analysis publishes the coding-agent comparison" },
        " that this snapshot copies. AI Charts does not recalculate those scores. The public page is the source for the numbers. Faye and Goedecke are the sources for why a person still has to stand next to them.",
      ),
      heading("A named row still needs a reader"),
      paragraph(
        "The snapshot can tell you that a configuration did well on a published suite at the retrieval date. It cannot tell you whether the person citing that cell can write a specification the harness will follow, or whether that person can notice when the output is fluent and wrong. Those jobs sit outside the table.",
      ),
      paragraph(
        "Faye’s bind is about how that reader is formed. If generation removes the friction that builds taste, the next cohort can inherit a scoreboard it is poorly equipped to audit. Goedecke’s claim is about how that reader is used. The same named harness yields more when the operator already knows the domain well enough to reject a plausible dead end.",
      ),
      paragraph(
        "Those two essays agree on the scarce resource. The model can produce a large space of possible programs. Selecting, specifying, and checking a result still belongs to someone who can recognize a good one. A stored AA Index does not record that someone.",
      ),
      callout(
        "The scoreboard and the reader",
        "Use a stored AA Index, DeepSWE, Terminal-Bench v2.1, or SWE-Atlas-QnA value as evidence that a named model, harness, and setting did well on that named suite. Use Faye and Goedecke when the question is whether the person reading that value can specify the work and audit the output.",
      ),
      heading("Specify and audit stay human work"),
      paragraph(
        "Goedecke’s Tao example is a specification problem. The useful turn is not a longer prompt. It is a person who already knows which objection, simplification, or local term would change the next step. Faye’s prescription keeps the same work on the person after the model answers: documentation, exercises, and checks against sources other than the model.",
      ),
      paragraph(
        "A coding-agent row makes that split concrete. The harness is the loop that offers tools and retries. The setting is the effort the run was allowed. The score is the suite’s verdict on that loop. None of those fields says whether the human goal was stated well, whether a wrong file was accepted, or whether the change should have been smaller. Those checks are the expertise the essays describe.",
      ),
      paragraph(
        "The snapshot is still the right place to look up the named configuration. Open the ",
        { href: "/", text: "comparison chart" },
        " to pin a model or change axes. Open the ",
        { href: "/data", text: "dataset page" },
        " for metric definitions and the full configuration table. Keep Faye and Goedecke next to that lookup when the decision is whether the person in the loop can stand behind the result.",
      ),
      heading("A different question from holdouts"),
      paragraph(
        { href: "/blog/coding-agent-score-holdouts", text: "Why a high score still needs a holdout" },
        " asks whether a public-suite win survives cases the optimizer did not see. This page asks whether the person citing the win can specify and audit the work. Both questions attach to the same leaders table. They fail for different reasons.",
      ),
      paragraph(
        "A holdout can falsify a score when the suite was visible and the hidden cases were not. Missing expertise can leave a true suite score standing while the production change is still wrong, incomplete, or impossible to review. The first failure is about the task set. The second is about the reader.",
      ),
      heading("How to read this scoreboard"),
      paragraph(
        "Read Faye’s essay for the expert-novice bind, the novice-programmer study, and the leaky-abstraction limit. Read the ",
        { href: BLOG_SOURCES.hranessFayeReading.url, text: "Hraness reading note of that essay" },
        " for a dated digest. Read Goedecke’s essay for the claim that prompting skill is domain expertise, and the ",
        { href: BLOG_SOURCES.hranessGoedeckeReading.url, text: "Hraness reading note of that essay" },
        " for its digest. Read the ",
        { href: HARNESS_DEFINITION_URL, text: "Hraness harness definition" },
        " when a row’s agent name needs a noun. Read the ",
        { href: "/data", text: "dataset page" },
        " when you need the current metric definitions. Read ",
        { href: "/blog/coding-agent-score-holdouts", text: "why a high score still needs a holdout" },
        " when the next question is unseen tasks rather than an unseen reader.",
      ),
      paragraph(
        "The useful sentence is narrower than a leaderboard headline. A high coding-agent score means the named model, harness, and setting did well on the visible suite at the retrieval date. Faye and Goedecke add the missing clause: that number still needs a person who can say what the work should be and check whether the output is that work.",
      ),
      heading("Limits of this reading"),
      list(
        [
          "Lars Faye and Sean Goedecke own their essays. AI Charts does not rerun the novice-programmer study, Tao’s conversation, or any other example they cite.",
        ],
        [
          "The Hraness pages are dated digests, not substitutes for the essays. Quote Faye and Goedecke for the arguments and the Hraness notes only for their own digest sentences.",
        ],
        [
          "Artificial Analysis defines the coding-agent scores. AI Charts is an independent visualization and is not affiliated with Artificial Analysis, Lars Faye, Sean Goedecke, or the listed providers.",
        ],
        [
          "Highest stored scores are observations of named configurations in this snapshot. They are not general ranks, operator credentials, or production guarantees.",
        ],
        [
          "The snapshot does not record who specified a run, who reviewed the output, or whether that person could detect a fluent error.",
        ],
        [
          "This is a checked snapshot, not a live mirror. Cite the retrieval timestamp when quoting a value.",
        ],
      ),
    ],
  };
}
