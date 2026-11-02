import {
  assertLaunchBeats,
  resolveLaunchBeats,
  type LaunchBeat,
} from "@hraness/design-kit/launch";

import { launchFacts } from "./facts";

/**
 * The illustrated sections of "Introducing aicharts". Each one describes
 * one part of the benchmark reference.
 * Numbers are {placeholders} filled from ./facts; the design kit rejects a
 * beat that types a digit. Every visual is a mockup id from
 * components/launch-mockups, drawn from the same checked data the site uses.
 */
const authoredBeats: readonly LaunchBeat[] = [
  {
    id: "what",
    part: "what",
    headline: "See which AI model wins at each price",
    post: "aicharts puts published AI benchmark scores and the cost of a task on one chart, so you can see which model gives the most for your budget. Every point names its source and the day it was checked.",
    visual: { kind: "mockup", id: "chart", state: { view: "models" } },
    alt: "The aicharts homepage chart, in an illustration: models plotted by benchmark score against cost per task.",
    detailHref: "/",
  },
  {
    id: "models",
    part: "does",
    headline: "Every model on one score and cost chart",
    post: "The homepage chart plots {intelligenceConfigs} model settings by Artificial Analysis Intelligence Index {intelligenceVersion} score against cost per task. The line joins the models nothing cheaper beats, so the best pick at each price stands out.",
    visual: { kind: "mockup", id: "chart", state: { view: "frontier" } },
    alt: "The models chart, in an illustration, with the best-value line drawn through the cheapest models at each score.",
    facts: ["intelligenceConfigs", "intelligenceVersion"],
    detailHref: "/",
  },
  {
    id: "coding",
    part: "does",
    headline: "Coding agents, compared as the setups you run",
    post: "The coding chart compares {codingConfigs} coding-agent setups. Each point is a model, the agent app running it, and an effort setting. Hover one to see its scores, cost per task, time, and tokens.",
    visual: { kind: "mockup", id: "chart", state: { view: "coding" } },
    alt: "The coding chart, in an illustration: one setup is hovered, showing its model, agent, effort, score, cost and time.",
    facts: ["codingConfigs"],
    detailHref: "/coding",
  },
  {
    id: "library",
    part: "does",
    headline: "A library of benchmarks, each on its own scale",
    post: "The benchmarks library covers {libraryEntries} tests across reasoning, research, memory, images, video and audio. Each one is labelled as a chart, a guide to the source, or an early test, and it keeps its own scale.",
    visual: { kind: "mockup", id: "library", state: {} },
    alt: "The benchmarks library, in an illustration: entries grouped by topic, each tagged charted, source guide or emerging.",
    facts: ["libraryEntries"],
    detailHref: "/benchmarks",
  },
  {
    id: "how",
    part: "how",
    headline: "Each chart keeps its source and scale",
    post: "Every chart links to the published results it plots. The data page names each source, benchmark version, date and cost unit, so results from different tests and setups stay apart.",
    visual: { kind: "mockup", id: "data", state: {} },
    alt: "A data page entry, in an illustration: source, benchmark version, date, cost unit and comparison limits.",
    detailHref: "/data",
  },
  {
    id: "who",
    part: "who",
    headline: "For picking a model on cost, not for one overall rank",
    post: "aicharts is for choosing a model or coding agent by weighing score against cost, time or tokens. If you want one overall ranking of every model, look elsewhere: aicharts builds no score of its own, and it cannot test your codebase.",
    visual: { kind: "mockup", id: "chart", state: { view: "tokens" } },
    alt: "The models chart switched to output tokens per task, in an illustration, so wordier models sit further right.",
    detailHref: "/blog/aa-index-cost-coding-agents",
  },
  {
    id: "vision",
    part: "vision",
    headline: "Every published result, with its setup and date",
    post: "The goal is a catalog where any benchmark result you might use to pick a model shows its setup, version, cost and date. Tests that have only a source guide today are meant to become charts once their data can be checked.",
    visual: { kind: "mockup", id: "data", state: { category: "reasoning" } },
    alt: "A reasoning benchmark's data entry, in an illustration: the question, source, version, valid comparisons and limits.",
    detailHref: "/data",
  },
  {
    id: "limits",
    part: "limits",
    headline: "The scores come from their owners, not from aicharts",
    post: "Scores, costs and token counts come from the benchmark owners and trackers aicharts cites; it runs no tests itself. Costs keep the source's unit, per task or per full run, so compare two only when the unit matches.",
    visual: { kind: "mockup", id: "chart", state: { view: "source" } },
    alt: "A chart's source details, in an illustration: who published the scores, the day they were checked, and the cost unit.",
    detailHref: "/data",
  },
  {
    id: "status",
    part: "status",
    headline: "Free benchmark charts, with no account required",
    post: "The charts, benchmark library, source data and notes are free at aicharts.io. Open them in your browser; no account or install is required.",
    visual: { kind: "mockup", id: "library", state: { coverage: "charted" } },
    alt: "The public benchmark library, in an illustration, showing charted results grouped by task.",
    detailHref: "/benchmarks",
  },
];

export const launchBeats: readonly LaunchBeat[] = resolveLaunchBeats(
  authoredBeats,
  launchFacts,
);

assertLaunchBeats(launchBeats);
