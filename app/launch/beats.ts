import {
  assertLaunchKit,
  buildSocialKit,
  resolveLaunchBeats,
  type LaunchBeat,
  type LaunchKitOptions,
  type LaunchMessaging,
  type LaunchRelease,
  type SocialKit,
} from "@hraness/design-kit/launch";

import { site } from "@/app/site";

import { LAUNCH_STATUS, launchFacts } from "./facts";

/**
 * The beats of "Introducing aicharts". Each one is a short section of the
 * launch post and one post in the launch threads, so each reads on its own.
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
    alt: "Illustration of the aicharts homepage chart: models plotted by benchmark score against cost per task.",
    detailHref: "/",
  },
  {
    id: "models",
    part: "does",
    headline: "Every model on one score and cost chart",
    post: "The homepage chart plots {intelligenceConfigs} model settings by Artificial Analysis Intelligence Index {intelligenceVersion} score against cost per task. The line joins the models nothing cheaper beats, so the best pick at each price stands out.",
    visual: { kind: "mockup", id: "chart", state: { view: "frontier" } },
    alt: "Illustration of the models chart with the best-value line drawn through the cheapest models at each score.",
    facts: ["intelligenceConfigs", "intelligenceVersion"],
    detailHref: "/",
  },
  {
    id: "coding",
    part: "does",
    headline: "Coding agents, compared as the setups you run",
    post: "The coding chart compares {codingConfigs} coding-agent setups. Each point is a model, the agent app running it, and an effort setting. Hover one to see its scores, cost per task, time, and tokens.",
    visual: { kind: "mockup", id: "chart", state: { view: "coding" } },
    alt: "Illustration of the coding chart: one setup is hovered, showing its model, agent, effort, score, cost and time.",
    facts: ["codingConfigs"],
    detailHref: "/coding",
  },
  {
    id: "library",
    part: "does",
    headline: "A library of benchmarks, each on its own scale",
    post: "The benchmarks library covers {libraryEntries} tests across reasoning, research, memory, images, video and audio. Each one is labelled as a chart, a guide to the source, or an early test, and it keeps its own scale.",
    visual: { kind: "mockup", id: "library", state: {} },
    alt: "Illustration of the benchmarks library: entries grouped by topic, each tagged charted, source guide or emerging.",
    facts: ["libraryEntries"],
    detailHref: "/benchmarks",
  },
  {
    id: "usage",
    part: "does",
    headline: "Count the tokens your own agents use",
    post: "The aicharts collector reads the usage files your coding agents already keep, from {usageSources} supported sources, and adds up tokens, cost and speed per model and day. Prompts and transcripts stay on your machine.",
    visual: { kind: "mockup", id: "usage", state: {} },
    alt: "Illustration of the usage dashboard with made-up numbers: tokens per day, stacked by agent, with totals.",
    facts: ["usageSources"],
    detailHref: "/usage",
  },
  {
    id: "how",
    part: "how",
    headline: "Numbers leave your machine, words never do",
    post: "A local report is a file you open in your browser tab. On a Mac you can also sync daily totals to your dashboard: token counts, cost and time per agent and model. Prompts, transcripts, file paths and keys stay on your machine.",
    visual: { kind: "mockup", id: "collector", state: {} },
    alt: "Illustration: a terminal: the collector writes a local report, then an enrolled Mac syncs daily number totals.",
    detailHref: "/usage",
  },
  {
    id: "who",
    part: "who",
    headline: "For picking a model on cost, not for one overall rank",
    post: "aicharts is for choosing a model or coding agent by weighing score against cost, time or tokens. If you want one overall ranking of every model, look elsewhere: aicharts builds no score of its own, and it cannot test your codebase.",
    visual: { kind: "mockup", id: "chart", state: { view: "tokens" } },
    alt: "Illustration of the models chart switched to output tokens per task, so wordier models sit further right.",
    detailHref: "/blog/aa-index-cost-coding-agents",
  },
  {
    id: "vision",
    part: "vision",
    headline: "Every published result, with its setup and date",
    post: "The goal is a catalog where any benchmark result you might use to pick a model shows its setup, version, cost and date. Tests that have only a source guide today are meant to become charts once their data can be checked.",
    visual: { kind: "mockup", id: "data", state: {} },
    alt: "Illustration: one data page entry: the question, what it measures, source, version, valid comparisons, limits.",
    detailHref: "/data",
  },
  {
    id: "limits",
    part: "limits",
    headline: "The scores come from their owners, not from aicharts",
    post: "Scores, costs and token counts come from the benchmark owners and trackers aicharts cites; it runs no tests itself. Costs keep the source's unit, per task or per full run, so compare two only when the unit matches.",
    visual: { kind: "mockup", id: "chart", state: { view: "source" } },
    alt: "Illustration: a chart point's details: its source, the day it was checked, and the cost unit.",
    detailHref: "/data",
  },
  {
    id: "status",
    part: "status",
    headline: "The charts are free and live; the collector is early",
    post: "The charts and notes are free at aicharts.io. Usage collector status: {status}. Version {cliVersion} for Linux is on GitHub Releases; on a Mac you build it from source.",
    visual: { kind: "mockup", id: "status", state: {} },
    alt: "Illustration of the collector's terminal status view: collecting, last pass and last sync, and its outputs.",
    facts: ["status", "cliVersion"],
    detailHref: "/usage",
  },
];

export const launchBeats: readonly LaunchBeat[] = resolveLaunchBeats(authoredBeats, launchFacts);

export const LAUNCH_POST_PATH = "/blog/introducing-ai-charts" as const;
export const LAUNCH_POST_URL = `${site.origin}${LAUNCH_POST_PATH}`;

/** The portfolio messaging record: the tagline and description in app/site.ts. */
export const launchMessaging: LaunchMessaging = {
  names: { name: site.name },
  tagline: site.tagline,
  meta: site.description,
};

export const launchRelease: LaunchRelease = {
  status: LAUNCH_STATUS,
  tags: ["Artificial Intelligence", "Developer Tools", "Data Visualization"],
};

/**
 * The charts need no install. The collector's Linux build is a public
 * GitHub release, but the collector is In development, so the posts never
 * ask readers to install it.
 */
export const launchKitOptions: LaunchKitOptions = {
  status: LAUNCH_STATUS,
  publicInstall: false,
  tagline: launchMessaging.tagline,
  canonicalUrl: LAUNCH_POST_URL,
  forbiddenNames: ["ccusage", "Tokscale"],
};

export const socialKit: SocialKit = buildSocialKit(
  launchBeats,
  launchMessaging,
  launchRelease,
  LAUNCH_POST_URL,
);
assertLaunchKit(launchBeats, socialKit, launchKitOptions);
