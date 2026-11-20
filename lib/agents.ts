// Coding agents compared: each lab's own CLI running that lab's models, from
// Artificial Analysis's Coding Agent Index runs and the official Terminal-Bench
// leaderboard. Every number and sentence here is computed from the dataset.
import { catalog as defaultCatalog, EFFORT_NAMES, effortName, median, type Catalog } from "./catalog";
import { listNames, type QA } from "./copy";
import { formatDelta, formatRatio, formatScore, formatUsd } from "./format";
import { computeParetoFrontier, getChartScale, type ChartScale } from "./pareto";
import {
  PROVIDERS,
  type CliHarnessEval,
  type EffortPoint,
  type EffortSlug,
  type HarborBenchEval,
  type ModelRelease,
  type ProviderId,
} from "./types";

export type HarnessId = "codex" | "claude-code" | "antigravity-cli";

export type Harness = Readonly<{
  id: HarnessId;
  /** As Artificial Analysis and Terminal-Bench name it; matches `cliEval.harness`. */
  name: string;
  provider: ProviderId;
  /** The command-line tool Artificial Analysis runs. */
  cli: string;
  /** An earlier name people still search for. */
  formerly: string | null;
}>;

export const HARNESSES: readonly Harness[] = [
  { id: "codex", name: PROVIDERS.openai.harness, provider: "openai", cli: "Codex CLI", formerly: null },
  {
    id: "claude-code",
    name: PROVIDERS.anthropic.harness,
    provider: "anthropic",
    cli: "Claude Code",
    formerly: null,
  },
  {
    id: "antigravity-cli",
    name: PROVIDERS.google.harness,
    provider: "google",
    cli: "Antigravity CLI",
    formerly: "Gemini CLI",
  },
];

export function harness(id: HarnessId): Harness {
  return HARNESSES.find((h) => h.id === id)!;
}

/** "Antigravity CLI (Gemini CLI)" for titles that should match both names. */
export function searchName(h: Harness): string {
  return h.formerly ? `${h.name} (${h.formerly})` : h.name;
}

export type AgentRun = Readonly<{
  key: string;
  harness: Harness;
  release: ModelRelease;
  effort: EffortPoint;
  cli: CliHarnessEval;
}>;

export type HarnessGroup = Readonly<{ harness: Harness; runs: readonly AgentRun[] }>;

const indexOf = (run: AgentRun) => run.cli.codingAgentScore;
const costOf = (run: AgentRun) => run.cli.costUsdPerTask;

/** A harness's runs with current models: the best model first, then by effort level. */
export function harnessRuns(h: Harness, cat: Catalog = defaultCatalog): AgentRun[] {
  const runs: AgentRun[] = [];
  for (const release of cat.current) {
    for (const effort of release.efforts) {
      const cli = effort.cliEval;
      if (cli?.harness === h.name) {
        runs.push({ key: `${h.id}:${release.slug}:${effort.effortSlug}`, harness: h, release, effort, cli });
      }
    }
  }
  const top = new Map<string, number>();
  for (const run of runs) {
    top.set(run.release.slug, Math.max(top.get(run.release.slug) ?? 0, indexOf(run)));
  }
  return runs.sort(
    (a, b) =>
      top.get(b.release.slug)! - top.get(a.release.slug)! ||
      a.release.slug.localeCompare(b.release.slug) ||
      a.effort.effortLevel - b.effort.effortLevel,
  );
}

/** Harnesses with at least one current run, in the order given. */
export function harnessGroups(
  ids: readonly HarnessId[] = HARNESSES.map((h) => h.id),
  cat: Catalog = defaultCatalog,
): HarnessGroup[] {
  return ids
    .map((id) => ({ harness: harness(id), runs: harnessRuns(harness(id), cat) }))
    .filter((group) => group.runs.length > 0);
}

function pick(
  runs: readonly AgentRun[],
  better: (a: AgentRun, b: AgentRun) => boolean,
): AgentRun | null {
  let chosen: AgentRun | null = null;
  for (const run of runs) if (!chosen || better(run, chosen)) chosen = run;
  return chosen;
}

/** The run with the highest value of `metric`; ties go to the cheaper run. */
export function bestRun(
  runs: readonly AgentRun[],
  metric: (run: AgentRun) => number = indexOf,
): AgentRun {
  const best = pick(
    runs,
    (a, b) => metric(a) > metric(b) || (metric(a) === metric(b) && costOf(a) < costOf(b)),
  );
  if (!best) throw new Error("bestRun needs at least one run");
  return best;
}

/** The cheapest run; ties go to the higher index. */
export function cheapestRun(runs: readonly AgentRun[]): AgentRun | null {
  return pick(runs, (a, b) => costOf(a) < costOf(b) || (costOf(a) === costOf(b) && indexOf(a) > indexOf(b)));
}

/** Per-task budgets the comparison tables report the best run under. */
export const BUDGETS = [1, 3, 10] as const;

/** The best run that costs less than `budget` per task, if any. */
export function bestUnder(runs: readonly AgentRun[], budget: number): AgentRun | null {
  const within = runs.filter((run) => costOf(run) < budget);
  return within.length > 0 ? bestRun(within) : null;
}

/** The cost frontier of `runs` on the Coding Agent Index, cheapest first. */
export function runFrontier(runs: readonly AgentRun[]): AgentRun[] {
  const byKey = new Map(runs.map((run) => [run.key, run]));
  const points = runs.map((run) => ({
    key: run.key,
    release: run.release,
    effort: run.effort,
    provider: run.release.provider,
    budget: costOf(run),
    score: indexOf(run),
  }));
  return computeParetoFrontier(points).map((point) => byKey.get(point.key)!);
}

export type RunSegment = Readonly<{ harness: Harness; runs: readonly AgentRun[] }>;

/** The shared cost frontier, grouped into runs owned by one harness. */
export function runSegments(runs: readonly AgentRun[]): RunSegment[] {
  const segments: { harness: Harness; runs: AgentRun[] }[] = [];
  for (const run of runFrontier(runs)) {
    const last = segments[segments.length - 1];
    if (last && last.harness.id === run.harness.id) last.runs.push(run);
    else segments.push({ harness: run.harness, runs: [run] });
  }
  return segments;
}

/**
 * The release a harness was measured with most, ties to the higher best
 * score: the chart draws it as that harness's curve.
 */
export function flagship(runs: readonly AgentRun[]): ModelRelease {
  const counts = new Map<string, number>();
  for (const run of runs) counts.set(run.release.slug, (counts.get(run.release.slug) ?? 0) + 1);
  const best = pick(runs, (a, b) => {
    const diff = counts.get(a.release.slug)! - counts.get(b.release.slug)!;
    return diff > 0 || (diff === 0 && indexOf(a) > indexOf(b));
  });
  if (!best) throw new Error("flagship needs at least one run");
  return best.release;
}

/**
 * The chart reads `scores` and `costUsdPerTask`, so a release's runs in one
 * harness fill those slots; AGENT_BENCHMARKS (lib/types.ts) names each slot.
 */
export function chartRelease(release: ModelRelease, h: Harness): ModelRelease | null {
  const efforts = release.efforts.flatMap((effort) => {
    const cli = effort.cliEval;
    if (cli?.harness !== h.name) return [];
    return [
      {
        ...effort,
        scores: {
          coding: cli.codingAgentScore,
          terminalBench4: cli.terminalBench4,
          frontierCode2: cli.frontierCode2,
          intelligence: cli.sweAtlas,
        },
        costUsdPerTask: { total: cli.costUsdPerTask, input: 0, output: 0, reasoning: 0, cacheRead: 0 },
      },
    ];
  });
  return efforts.length > 0 ? { ...release, efforts } : null;
}

/** Each group's models, with their runs inside its agent in the chart's score slots. */
export function agentChartReleases(
  groups: readonly HarnessGroup[],
  cat: Catalog = defaultCatalog,
): ModelRelease[] {
  return groups.flatMap((g) =>
    [...new Set(g.runs.map((r) => r.release.slug))].map(
      (slug) => chartRelease(cat.find(slug)!, g.harness)!,
    ),
  );
}

/** Axes from every agent's runs, so the hub and each matchup page share them. */
export function agentChartScale(cat: Catalog = defaultCatalog): ChartScale {
  return getChartScale(agentChartReleases(harnessGroups(undefined, cat), cat));
}

export type HarnessGap = Readonly<{ run: AgentRun; alone: number; inAgent: number; change: number }>;

/**
 * FrontierCode 2.0 for the same model, effort and 132 tasks, alone in
 * Artificial Analysis's own harness and inside the lab's agent. Terminal-Bench
 * is left out: the agent runs use version 4.1, which changed the checks on all
 * 66 tasks, and the model runs use 4.0.
 */
export function frontierCodeGap(run: AgentRun): HarnessGap {
  const alone = run.effort.scores.frontierCode2;
  return { run, alone, inAgent: run.cli.frontierCode2, change: run.cli.frontierCode2 - alone };
}

export type GapSummary = Readonly<{ count: number; lower: number; median: number }>;

export function summarizeGaps(runs: readonly AgentRun[]): GapSummary {
  const changes = runs.map((run) => frontierCodeGap(run).change);
  return {
    count: changes.length,
    lower: changes.filter((c) => c < 0).length,
    median: median(changes),
  };
}

export type HarborRow = Readonly<{ harness: Harness; release: ModelRelease; result: HarborBenchEval }>;

/** A harness's entries on the official Terminal-Bench leaderboard, best first. */
export function harborRows(h: Harness, cat: Catalog = defaultCatalog): HarborRow[] {
  return cat.current
    .filter((release) => release.harborEval?.agent === h.name)
    .map((release) => ({ harness: h, release, result: release.harborEval! }))
    .sort((a, b) => b.result.accuracy - a.result.accuracy);
}

export function harborEffort(row: HarborRow): string {
  return EFFORT_NAMES[row.result.effort as EffortSlug] ?? row.result.effort;
}

/** Terminal-Bench has 66 tasks. */
export const TERMINAL_BENCH_TASKS = 66;

/**
 * A gap smaller than two tasks' worth of a benchmark is treated as a tie:
 * scores are means over a few attempts, so one task can flip either way.
 */
export function noiseFloor(tasks: number): number {
  return 200 / tasks;
}

/**
 * The entry a reader would pick from a harness's leaderboard rows: the
 * cheapest one within two tasks of its best.
 */
export function harborPick(rows: readonly HarborRow[]): HarborRow | null {
  const top = rows[0];
  if (!top) return null;
  const floor = top.result.accuracy - noiseFloor(TERMINAL_BENCH_TASKS);
  return rows
    .filter((row) => row.result.accuracy >= floor)
    .reduce((a, b) => (b.result.costPerTrialUsd < a.result.costPerTrialUsd ? b : a));
}

export type AgentPair = Readonly<{
  slug: string;
  first: Harness;
  second: Harness;
  /** Other paths that redirect here: the reverse order and the Gemini CLI name. */
  aliases: readonly string[];
}>;

// Order follows search demand (Ahrefs US, November 2026): "codex vs claude
// code" leads "claude code vs codex", and "gemini cli vs claude code" leads
// "claude code vs gemini cli".
const PAIRS: readonly (readonly [HarnessId, HarnessId])[] = [
  ["codex", "claude-code"],
  ["antigravity-cli", "claude-code"],
  ["codex", "antigravity-cli"],
];

function slugsFor(h: Harness): string[] {
  return h.formerly ? [h.id, h.formerly.toLowerCase().replace(/\s+/g, "-")] : [h.id];
}

/** Head-to-head pages for every two harnesses with current runs. */
export function agentPairs(cat: Catalog = defaultCatalog): AgentPair[] {
  const measured = new Set(harnessGroups(undefined, cat).map((g) => g.harness.id));
  return PAIRS.filter(([a, b]) => measured.has(a) && measured.has(b)).map(([a, b]) => {
    const first = harness(a);
    const second = harness(b);
    const slug = `${a}-vs-${b}`;
    const aliases = slugsFor(first)
      .flatMap((x) => slugsFor(second).flatMap((y) => [`${x}-vs-${y}`, `${y}-vs-${x}`]))
      .filter((alias) => alias !== slug);
    return { slug, first, second, aliases };
  });
}

export function findAgentPair(slug: string, cat: Catalog = defaultCatalog): AgentPair | null {
  return agentPairs(cat).find((pair) => pair.slug === slug) ?? null;
}

// Copy. A point of the index is about two Terminal-Bench tasks: one task is
// 1/66 of Terminal-Bench, which is a third of the index.
export const TIE_POINTS = 1;

const score = (run: AgentRun) => indexOf(run).toFixed(1);
const usd = (run: AgentRun) => formatUsd(costOf(run));
const setting = (run: AgentRun) => `${run.release.name} at ${effortName(run.effort.effortSlug)}`;
const pct = (value: number) => formatScore(value, "%");

export function agentLead(groups: readonly HarnessGroup[]): string {
  const word = groups.length === 2 ? "higher" : "highest";
  const tops = groups
    .map((group) => ({ group, top: bestRun(group.runs) }))
    .sort((x, y) => indexOf(y.top) - indexOf(x.top));
  const high = indexOf(tops[0]!.top);
  const level = tops.filter((t) => high - indexOf(t.top) < TIE_POINTS);
  const behind = tops.filter((t) => high - indexOf(t.top) >= TIE_POINTS);

  let text: string;
  if (level.length === 1) {
    const { group, top } = level[0]!;
    text = `${group.harness.name} scores ${word} on the Coding Agent Index: ${score(top)} with ${setting(top)}, for ${usd(top)} per task.`;
  } else {
    const parts = level.map(
      (t) => `${score(t.top)} for ${t.group.harness.name} with ${setting(t.top)} (${usd(t.top)} per task)`,
    );
    text = `${listNames(level.map((t) => t.group.harness.name))} top the Coding Agent Index within a point of each other: ${listNames(parts)}.`;
    const byCost = [...level].sort((x, y) => costOf(x.top) - costOf(y.top));
    const ratio = costOf(byCost[byCost.length - 1]!.top) / costOf(byCost[0]!.top);
    if (level.length === 2 && ratio >= 1.2) {
      text += ` ${byCost[1]!.group.harness.name}'s top run costs ${formatRatio(ratio)} as much per task.`;
    }
  }
  for (const { group, top } of behind) {
    text += ` ${group.harness.name} peaks at ${score(top)}, with ${setting(top)} for ${usd(top)}.`;
  }
  if (level.length === 1 && behind.length > 0) {
    const leader = level[0]!;
    const target = indexOf(behind[0]!.top);
    const pass = cheapestRun(leader.group.runs.filter((run) => indexOf(run) > target));
    if (pass && pass.key !== leader.top.key) {
      text += ` ${leader.group.harness.name} passes that for ${usd(pass)} per task, with ${setting(pass)} (${score(pass)}).`;
    }
  }
  return text;
}

export function agentBudgetText(groups: readonly HarnessGroup[]): string {
  const word = groups.length === 2 ? "higher" : "highest";
  const segments = runSegments(groups.flatMap((group) => group.runs));
  if (segments.length === 1) {
    return `At every budget measured, ${segments[0]!.harness.name} scores at least as high for no more per task.`;
  }
  const low = segments[0]!;
  const high = segments[segments.length - 1]!;
  const start = high.runs[0]!;
  const peak = high.runs[high.runs.length - 1]!;
  if (segments.length === 2) {
    return `Below ${usd(start)} per task, ${low.harness.name} gives the ${word} score; from ${usd(start)}, ${high.harness.name} does, up to ${score(peak)}.`;
  }
  const turn = segments[1]!.runs[0]!;
  const middle = segments.slice(1, -1).flatMap((s) => s.runs);
  const names = [...new Set(middle.map((run) => run.harness.name))];
  const scores = middle.map(indexOf);
  const range = `${Math.min(...scores).toFixed(1)} and ${Math.max(...scores).toFixed(1)}`;
  const between =
    names.length > 1
      ? `${listNames(names)} trade the lead, all between ${range}`
      : `${names[0]} leads, between ${range}`;
  const ends =
    low.harness.id === high.harness.id
      ? `${low.harness.name} gives the ${word} score below ${usd(turn)} per task and from ${usd(start)}, up to ${score(peak)}`
      : `${low.harness.name} gives the ${word} score below ${usd(turn)} per task, and ${high.harness.name} from ${usd(start)}, up to ${score(peak)}`;
  return `${ends}. In between, ${between}.`;
}

const PARTS: readonly {
  label: string;
  area: string;
  tasks: number;
  value: (run: AgentRun) => number;
}[] = [
  {
    label: "Terminal-Bench 4.1",
    area: "terminal tasks",
    tasks: TERMINAL_BENCH_TASKS,
    value: (run) => run.cli.terminalBench4,
  },
  { label: "FrontierCode 2.0", area: "repository coding", tasks: 132, value: (run) => run.cli.frontierCode2 },
  { label: "SWE-Atlas QnA", area: "questions about a codebase", tasks: 124, value: (run) => run.cli.sweAtlas },
];

/** Reasons to pick `self` over `other`, strongest first. */
export function agentChooseReasons(
  self: HarnessGroup,
  other: HarnessGroup,
  cat: Catalog = defaultCatalog,
): string[] {
  const name = self.harness.name;
  const reasons: string[] = [];
  const top = bestRun(self.runs);
  const rivalTop = bestRun(other.runs);
  const gap = indexOf(top) - indexOf(rivalTop);
  if (gap >= TIE_POINTS) {
    reasons.push(
      `You want the highest score: ${setting(top)} reaches ${score(top)} on the Coding Agent Index, ${gap.toFixed(1)} points above ${other.harness.name}'s best.`,
    );
  } else if (gap > -TIE_POINTS && costOf(rivalTop) / costOf(top) >= 1.2) {
    reasons.push(
      `You want a top score for less: ${setting(top)} reaches ${score(top)} for ${usd(top)} per task, level with ${other.harness.name}'s best at ${usd(rivalTop)}.`,
    );
  }

  const segments = runSegments([...self.runs, ...other.runs]);
  const low = segments[0]!;
  if (segments.length > 1 && low.harness.id === self.harness.id) {
    const last = low.runs[low.runs.length - 1]!;
    reasons.push(
      `Your budget is under ${usd(segments[1]!.runs[0]!)} per task: ${name} scores higher at every budget below that, up to ${score(last)} with ${setting(last)} (${usd(last)}).`,
    );
  } else {
    for (const budget of BUDGETS) {
      const mine = bestUnder(self.runs, budget);
      if (mine && !bestUnder(other.runs, budget)) {
        reasons.push(
          `You want runs under ${formatUsd(budget)} per task: of the runs measured, only ${name}'s come in under that, up to ${score(mine)} with ${setting(mine)} (${usd(mine)}).`,
        );
        break;
      }
    }
  }

  const leads = PARTS.flatMap((part) => {
    const mine = part.value(bestRun(self.runs, part.value));
    const theirs = part.value(bestRun(other.runs, part.value));
    return mine - theirs >= noiseFloor(part.tasks) ? [{ part, mine, theirs }] : [];
  });
  if (leads.length > 0) {
    reasons.push(
      `Your work leans on ${listNames(leads.map((l) => l.part.area))}: ${leads.length === 1 ? "its best run beats" : "its best runs beat"} ${other.harness.name}'s on ${listNames(leads.map((l) => `${l.part.label} (${pct(l.mine)} against ${pct(l.theirs)})`))}.`,
    );
  }

  const mine = harborRows(self.harness, cat);
  const theirs = harborRows(other.harness, cat);
  const pickMine = harborPick(mine);
  const pickTheirs = harborPick(theirs);
  if (pickMine && pickTheirs) {
    const [best, rival] = [mine[0]!, theirs[0]!];
    const floor = noiseFloor(TERMINAL_BENCH_TASKS);
    const entry = (row: HarborRow) =>
      `${pct(row.result.accuracy)} at ${formatUsd(row.result.costPerTrialUsd)} per trial`;
    if (best.result.accuracy - rival.result.accuracy >= floor) {
      reasons.push(
        `You want the most official Terminal-Bench passes: with ${best.release.name} it passes ${entry(best)}, against ${entry(rival)} for ${other.harness.name} with ${rival.release.name}.`,
      );
    } else if (
      pickMine.result.accuracy >= pickTheirs.result.accuracy - floor &&
      pickMine.result.costPerTrialUsd * 2 <= pickTheirs.result.costPerTrialUsd
    ) {
      reasons.push(
        `You want official Terminal-Bench results for less: with ${pickMine.release.name} it passes ${entry(pickMine)}, against ${entry(pickTheirs)} for ${other.harness.name} with ${pickTheirs.release.name}.`,
      );
    }
  }

  if (reasons.length === 0) {
    reasons.push(
      `Few reasons in this data: ${other.harness.name} scores at least as high for no more per task at every budget measured.`,
    );
  }
  return reasons.slice(0, 4);
}

function modelAdvice(group: HarnessGroup): string {
  const top = bestRun(group.runs);
  const near = cheapestRun(group.runs.filter((run) => indexOf(top) - indexOf(run) < TIE_POINTS));
  let text = `In ${group.harness.name}, ${setting(top)} scores highest, ${score(top)} for ${usd(top)} per task`;
  if (near && near.key !== top.key) {
    text += `; ${setting(near)} comes within a point for ${usd(near)}`;
  }
  return `${text}.`;
}

export function gapText(groups: readonly HarnessGroup[]): string {
  const all = summarizeGaps(groups.flatMap((group) => group.runs));
  const parts = groups.map((group) => {
    const s = summarizeGaps(group.runs);
    return `${group.harness.name} ${formatDelta(s.median)} over ${s.count} run${s.count === 1 ? "" : "s"}`;
  });
  const share = all.lower === all.count ? `all ${all.count}` : `${all.lower} of ${all.count}`;
  return `On FrontierCode 2.0, ${share} runs scored lower inside the agent than the same model at the same effort in Artificial Analysis's own harness, on the same 132 tasks. The median change is ${formatDelta(all.median)} points: ${listNames(parts)}.`;
}

export const GEMINI_CLI_ANSWER =
  "In May 2026 Google announced it was moving Gemini CLI users to Antigravity CLI. On June 18, 2026, Gemini CLI stopped serving Google AI Pro and Ultra subscribers and people using it free through Gemini Code Assist for individuals; enterprise licences and paid API keys kept access. Artificial Analysis measures Antigravity CLI, so the Gemini results here are Antigravity CLI runs.";

export function agentQuestions(groups: readonly HarnessGroup[]): QA[] {
  const names = groups.map((group) => group.harness.name);
  const all = groups.flatMap((group) => group.runs);
  const cheapest = groups
    .map((group) => ({ group, run: cheapestRun(group.runs)! }))
    .sort((x, y) => costOf(x.run) - costOf(y.run));
  const first = cheapest[0]!;
  const questions: QA[] = [
    {
      q: groups.length === 2 ? `Is ${names[0]} better than ${names[1]}?` : "Which coding agent is best?",
      a: `${agentLead(groups)} ${agentBudgetText(groups)}`,
    },
    {
      q: groups.length === 2 ? `Which is cheaper, ${names[0]} or ${names[1]}?` : "Which coding agent is cheapest?",
      a: `${first.group.harness.name} has the cheapest measured run: ${setting(first.run)} costs ${usd(first.run)} per task and scores ${score(first.run)}. ${cheapest
        .slice(1)
        .map((c) => `${c.group.harness.name}'s cheapest is ${setting(c.run)}, ${usd(c.run)} for ${score(c.run)}.`)
        .join(" ")} Artificial Analysis prices every run at pay-per-token API rates, cache discounts included. Many people use these agents on a subscription plan instead, where the cost is the plan.`,
    },
    {
      q: "Which model works best in each agent?",
      a: groups.map(modelAdvice).join(" "),
    },
    {
      q: "Does the agent change a model's score?",
      a: `${gapText(groups)} Limits and prompts differ between the two set-ups, so the gap measures the whole set-up, not the agent alone. Terminal-Bench can't be compared this way: the agent runs use version 4.1, which changed the checks on all 66 tasks, and the model runs use 4.0.`,
    },
    {
      q: "What about Cursor, OpenCode or other coding agents?",
      a: `These pages compare each lab's own agent running that lab's models, which Artificial Analysis measures on the same tasks at each effort level: ${listNames(
        groups.map((group) => `${group.harness.name} with ${PROVIDERS[group.harness.provider].name} models`),
      )}. Other agents, such as Cursor or OpenCode, aren't compared here; Artificial Analysis's Coding Agents page lists every agent it has run.`,
    },
  ];
  if (groups.some((group) => group.harness.formerly)) {
    questions.push({ q: "What happened to Gemini CLI?", a: GEMINI_CLI_ANSWER });
  }
  questions.push({
    q: "How were these agents tested?",
    a: `Artificial Analysis runs ${listNames(groups.map((group) => group.harness.cli))} on three benchmarks, three attempts per task: FrontierCode 2.0 (132 repository coding tasks), Terminal-Bench 4.1 (66 terminal tasks) and SWE-Atlas QnA (124 questions about codebases). The Coding Agent Index weights the three equally, so one Terminal-Bench task is worth about half a point. ${all.length} runs with current models are listed here.`,
  });
  return questions;
}

export function agentDescription(groups: readonly HarnessGroup[]): string {
  const tops = groups.map((group) => bestRun(group.runs));
  const scores = tops.map(score);
  const costs = tops.map(usd);
  const names = groups.map((group) => group.harness.name);
  return `${listNames(names)} on the Coding Agent Index: best runs ${listNames(scores)}, at ${listNames(costs)} per task. Every model and effort measured inside ${listNames(groups.map((group) => group.harness.cli))}, with official Terminal-Bench results.`;
}
