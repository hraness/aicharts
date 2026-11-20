// Coding agents compared: each lab's own agent running that lab's current
// models, from the official Terminal-Bench leaderboard. Every number and
// sentence here is computed from the dataset.
import { bestEpoch, catalog as defaultCatalog, TB_TIE, type Catalog } from "./catalog";
import { agentLabel, effortPhrase, epochTie, listNames, type QA } from "./copy";
import { formatRatio, formatScore, formatTokens, formatUsd } from "./format";
import { computeParetoFrontier, getChartScale, type ChartScale, type PlottedPoint } from "./pareto";
import {
  PROVIDERS,
  TERMINAL_BENCH,
  type EpochBenchmarkId,
  type EpochScore,
  type ModelRelease,
  type ProviderId,
  type TerminalBenchRun,
} from "./types";

export type HarnessId = "codex" | "claude-code" | "antigravity-cli";

export type Harness = Readonly<{
  id: HarnessId;
  /** As Terminal-Bench names the agent; matches `terminalBench.agent`. */
  name: string;
  provider: ProviderId;
  /** An earlier name people still search for. */
  formerly: string | null;
}>;

export const HARNESSES: readonly Harness[] = [
  { id: "codex", name: PROVIDERS.openai.harness, provider: "openai", formerly: null },
  { id: "claude-code", name: PROVIDERS.anthropic.harness, provider: "anthropic", formerly: null },
  {
    id: "antigravity-cli",
    name: PROVIDERS.google.harness,
    provider: "google",
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
  run: TerminalBenchRun;
}>;

export type HarnessGroup = Readonly<{ harness: Harness; runs: readonly AgentRun[] }>;

const scoreOf = (r: AgentRun) => r.run.accuracy;
/** Runs that reported no cost sort after every priced run. */
const costOf = (r: AgentRun) => r.run.costPerTaskUsd ?? Number.POSITIVE_INFINITY;

/** A harness's runs with current models, highest score first. */
export function harnessRuns(h: Harness, cat: Catalog = defaultCatalog): AgentRun[] {
  return cat.current
    .filter((release) => release.terminalBench?.agent === h.name)
    .map((release) => ({
      key: `${h.id}:${release.slug}`,
      harness: h,
      release,
      run: release.terminalBench!,
    }))
    .sort(
      (a, b) =>
        scoreOf(b) - scoreOf(a) || costOf(a) - costOf(b) || a.release.slug.localeCompare(b.release.slug),
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

/** The highest-scoring run; ties go to the cheaper run. */
export function bestRun(runs: readonly AgentRun[]): AgentRun {
  const best = pick(
    runs,
    (a, b) => scoreOf(a) > scoreOf(b) || (scoreOf(a) === scoreOf(b) && costOf(a) < costOf(b)),
  );
  if (!best) throw new Error("bestRun needs at least one run");
  return best;
}

/** The cheapest run that reported a cost; ties go to the higher score. */
export function cheapestRun(runs: readonly AgentRun[]): AgentRun | null {
  return pick(
    runs.filter((run) => run.run.costPerTaskUsd !== null),
    (a, b) => costOf(a) < costOf(b) || (costOf(a) === costOf(b) && scoreOf(a) > scoreOf(b)),
  );
}

/** The run a reader would pick: the cheapest one within two tasks of the best. */
export function pickRun(runs: readonly AgentRun[]): AgentRun | null {
  if (runs.length === 0) return null;
  const top = scoreOf(bestRun(runs));
  return cheapestRun(runs.filter((run) => top - scoreOf(run) < TB_TIE)) ?? bestRun(runs);
}

/** Per-task budgets the comparison tables report the best run under. */
export const BUDGETS = [1, 3, 10] as const;

/** The best run that costs less than `budget` per task, if any. */
export function bestUnder(runs: readonly AgentRun[], budget: number): AgentRun | null {
  const within = runs.filter((run) => costOf(run) < budget);
  return within.length > 0 ? bestRun(within) : null;
}

/** The cost frontier of `runs`, cheapest first. */
export function runFrontier(runs: readonly AgentRun[]): AgentRun[] {
  const byKey = new Map(runs.map((run) => [run.key, run]));
  const points: PlottedPoint[] = runs
    .filter((run) => run.run.costPerTaskUsd !== null)
    .map((run) => ({
      key: run.key,
      release: run.release,
      run: run.run,
      provider: run.release.provider,
      budget: run.run.costPerTaskUsd!,
      score: run.run.accuracy,
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

/** The releases each group ran, for the chart: one point per run. */
export function agentChartReleases(groups: readonly HarnessGroup[]): ModelRelease[] {
  return groups.flatMap((g) => g.runs.map((r) => r.release));
}

/** Axes from every agent's runs, so the hub and each matchup page share them. */
export function agentChartScale(cat: Catalog = defaultCatalog): ChartScale {
  return getChartScale(agentChartReleases(harnessGroups(undefined, cat)));
}

/** Compares dotted versions such as "4.1" and "4.10" part by part. */
export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Runs graded on an older dataset version than the newest one shown. */
export function olderVersionRuns(runs: readonly AgentRun[]): AgentRun[] {
  if (runs.length === 0) return [];
  const newest = runs.map((r) => r.run.version).reduce((v, w) => (compareVersions(w, v) > 0 ? w : v));
  return runs.filter((r) => r.run.version !== newest);
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

// Copy.
const score = (run: AgentRun) => formatScore(scoreOf(run), "%");
const usd = (run: AgentRun) =>
  run.run.costPerTaskUsd !== null ? formatUsd(run.run.costPerTaskUsd) : "no reported cost";

export function agentLead(groups: readonly HarnessGroup[]): string {
  const word = groups.length === 2 ? "higher" : "highest";
  const tops = groups
    .map((group) => ({ group, top: bestRun(group.runs) }))
    .sort((x, y) => scoreOf(y.top) - scoreOf(x.top));
  const high = scoreOf(tops[0]!.top);
  const level = tops.filter((t) => high - scoreOf(t.top) < TB_TIE);
  const behind = tops.filter((t) => high - scoreOf(t.top) >= TB_TIE);

  let text: string;
  if (level.length === 1) {
    const { group, top } = level[0]!;
    text = `${group.harness.name} scores ${word} on Terminal-Bench: ${score(top)} with ${top.release.name}, for ${usd(top)} per task.`;
  } else {
    const parts = level.map(
      (t) => `${score(t.top)} for ${t.group.harness.name} with ${t.top.release.name} (${usd(t.top)} per task)`,
    );
    text = `${listNames(level.map((t) => t.group.harness.name))} are level at the top of Terminal-Bench, within two tasks of each other: ${listNames(parts)}.`;
    const priced = level.filter((t) => t.top.run.costPerTaskUsd !== null);
    const byCost = [...priced].sort((x, y) => costOf(x.top) - costOf(y.top));
    if (byCost.length >= 2) {
      const ratio = costOf(byCost[byCost.length - 1]!.top) / costOf(byCost[0]!.top);
      if (ratio >= 1.2) {
        text += ` ${byCost[byCost.length - 1]!.group.harness.name}'s top run costs ${formatRatio(ratio)} as much per task as ${byCost[0]!.group.harness.name}'s.`;
      }
    }
  }
  for (const { group, top } of behind) {
    text += ` ${group.harness.name} peaks at ${score(top)}, with ${top.release.name} for ${usd(top)}.`;
  }
  return text;
}

/**
 * The cheapest frontier run within two tasks of the top score, when it isn't
 * the top run itself: past its cost, spending more buys little.
 */
export function enoughRun(runs: readonly AgentRun[]): AgentRun | null {
  const frontier = runFrontier(runs);
  const peak = frontier[frontier.length - 1];
  if (!peak) return null;
  const enough = frontier.find((run) => scoreOf(peak) - scoreOf(run) < TB_TIE)!;
  return enough.key === peak.key ? null : enough;
}

export function agentBudgetText(groups: readonly HarnessGroup[]): string {
  const word = groups.length === 2 ? "higher" : "highest";
  const all = groups.flatMap((group) => group.runs);
  const segments = runSegments(all);
  if (segments.length === 0) return "";
  let text: string;
  if (segments.length === 1) {
    text = `At every budget measured, ${segments[0]!.harness.name} scores at least as high for no more per task.`;
  } else {
    const low = segments[0]!;
    const high = segments[segments.length - 1]!;
    const start = high.runs[0]!;
    const peak = high.runs[high.runs.length - 1]!;
    if (segments.length === 2) {
      text = `Below ${usd(start)} per task, ${low.harness.name} gives the ${word} score; from ${usd(start)}, ${high.harness.name} does, up to ${score(peak)}.`;
    } else {
      const turn = segments[1]!.runs[0]!;
      const middle = segments.slice(1, -1).flatMap((s) => s.runs);
      const names = [...new Set(middle.map((run) => run.harness.name))];
      const scores = middle.map(scoreOf);
      const lo = Math.min(...scores);
      const hi = Math.max(...scores);
      const range =
        lo === hi
          ? `at ${formatScore(lo, "%")}`
          : `between ${formatScore(lo, "%")} and ${formatScore(hi, "%")}`;
      const between =
        names.length > 1 ? `${listNames(names)} trade the lead, all ${range}` : `${names[0]} leads, ${range}`;
      const ends =
        low.harness.id === high.harness.id
          ? `${low.harness.name} gives the ${word} score below ${usd(turn)} per task and from ${usd(start)}, up to ${score(peak)}`
          : `${low.harness.name} gives the ${word} score below ${usd(turn)} per task, and ${high.harness.name} from ${usd(start)}, up to ${score(peak)}`;
      text = `${ends}. In between, ${between}.`;
    }
  }
  const enough = enoughRun(all);
  if (enough) {
    const peak = runFrontier(all).at(-1)!;
    const more = `paying more buys at most ${(scoreOf(peak) - scoreOf(enough)).toFixed(1)} points`;
    const start = segments[segments.length - 1]!.runs[0]!;
    text +=
      enough.key === start.key
        ? ` Past ${usd(enough)}, ${more}.`
        : ` From ${usd(enough)} per task, ${enough.harness.name} with ${enough.release.name} comes within two tasks of the top score; ${more}.`;
  }
  return text;
}

/** Reasons to pick `self` over `other`, strongest first. */
export function agentChooseReasons(self: HarnessGroup, other: HarnessGroup): string[] {
  const name = self.harness.name;
  const reasons: string[] = [];
  const top = bestRun(self.runs);
  const rivalTop = bestRun(other.runs);
  const gap = scoreOf(top) - scoreOf(rivalTop);
  const level = Math.abs(gap) < TB_TIE;
  if (gap >= TB_TIE) {
    reasons.push(
      `You want the highest score: with ${top.release.name} it passes ${score(top)} of Terminal-Bench, ${gap.toFixed(1)} points above ${other.harness.name}'s best.`,
    );
  } else if (level && costOf(rivalTop) / costOf(top) >= 1.2) {
    reasons.push(
      `You want a top score for less: with ${top.release.name} it passes ${score(top)} for ${usd(top)} per task, within two tasks of ${other.harness.name}'s best at ${usd(rivalTop)}.`,
    );
  }

  // Where on the shared cost frontier this agent leads.
  const segments = runSegments([...self.runs, ...other.runs]);
  const owned = segments.findIndex((s) => s.harness.id === self.harness.id);
  if (segments.length === 1 && owned === 0) {
    reasons.push(`At every budget measured, ${name} scores at least as high for no more per task.`);
  } else if (owned !== -1 && owned < segments.length - 1) {
    const mine = segments[owned]!;
    const last = mine.runs[mine.runs.length - 1]!;
    const until = usd(segments[owned + 1]!.runs[0]!);
    reasons.push(
      owned === 0
        ? `Your budget is under ${until} per task: ${name} scores higher at every budget below that, up to ${score(last)} with ${last.release.name} (${usd(last)}).`
        : `Your budget is between ${usd(mine.runs[0]!)} and ${until} per task: ${name} scores higher in that range, up to ${score(last)} with ${last.release.name} (${usd(last)}).`,
    );
  }

  // MirrorCode is Epoch AI's long coding benchmark, run on the model alone.
  const ownLong = bestEpochRun(self.runs, "mirrorCode");
  const rivalLong = bestEpochRun(other.runs, "mirrorCode");
  if (ownLong && rivalLong && ownLong.score.score - rivalLong.score.score >= epochTie(ownLong.score, rivalLong.score)) {
    reasons.push(
      `You hand it long coding projects: on Epoch AI's MirrorCode, ${ownLong.release.name} scores ${formatScore(ownLong.score.score, "%")} against ${formatScore(rivalLong.score.score, "%")} for ${rivalLong.release.name}, the best of ${other.harness.name}'s models there. Epoch runs the model on its own, outside the agent.`,
    );
  }

  const mine = pickRun(self.runs);
  const theirs = pickRun(other.runs);
  if (mine && theirs) {
    const ownTokens = mine.run.tokensPerTask.output;
    if (ownTokens > 0 && theirs.run.tokensPerTask.output / ownTokens >= 1.5) {
      reasons.push(
        `You want shorter output: ${mine.release.name} wrote ${formatTokens(ownTokens)} output tokens per task against ${formatTokens(theirs.run.tokensPerTask.output)} for ${theirs.release.name}.`,
      );
    }
    const a = mine.run.minutesPerTask;
    const b = theirs.run.minutesPerTask;
    if (a && b && b / a >= 1.3) {
      reasons.push(
        `You want quicker runs: ${mine.release.name} took ${Math.round(a)} minutes per task against ${Math.round(b)} for ${theirs.release.name}.`,
      );
    }
  }

  if (reasons.length === 0) {
    reasons.push(
      level
        ? `Few reasons in this data: its best run, ${score(top)} with ${top.release.name} for ${usd(top)} per task, is within two tasks of ${other.harness.name}'s best, ${score(rivalTop)} with ${rivalTop.release.name} for ${usd(rivalTop)}.`
        : `Few reasons in this data: ${other.harness.name}'s best run scores ${(-gap).toFixed(1)} points higher, and ${name} leads at no budget on the cost frontier.`,
    );
  }
  return reasons.slice(0, 5);
}

/** The agent's model with the best Epoch score on a benchmark, if any has one. */
export function bestEpochRun(
  runs: readonly AgentRun[],
  benchmark: EpochBenchmarkId,
): { release: ModelRelease; score: EpochScore } | null {
  let best: { release: ModelRelease; score: EpochScore } | null = null;
  for (const run of runs) {
    const score = bestEpoch(run.release, benchmark);
    if (score && (!best || score.score > best.score.score)) best = { release: run.release, score };
  }
  return best;
}

function modelAdvice(group: HarnessGroup): string {
  const top = bestRun(group.runs);
  const near = pickRun(group.runs);
  let text = `In ${group.harness.name}, ${top.release.name} scores highest, ${score(top)} for ${usd(top)} per task`;
  if (near && near.key !== top.key) {
    text += `; ${near.release.name} comes within two tasks of it for ${usd(near)}`;
  }
  return `${text}.`;
}

export const GEMINI_CLI_ANSWER =
  "In May 2026 Google announced it was moving Gemini CLI users to Antigravity CLI. On June 18, 2026, Gemini CLI stopped serving Google AI Pro and Ultra subscribers and people using it free through Gemini Code Assist for individuals; enterprise licences and paid API keys kept access. The Gemini results on these pages are Terminal-Bench runs in Antigravity CLI.";

export function agentQuestions(groups: readonly HarnessGroup[]): QA[] {
  const names = groups.map((group) => group.harness.name);
  const all = groups.flatMap((group) => group.runs);
  const near = groups
    .flatMap((group) => {
      const run = pickRun(group.runs);
      return run && run.run.costPerTaskUsd !== null ? [run] : [];
    })
    .sort((x, y) => costOf(x) - costOf(y));
  const cheapest = cheapestRun(all);
  const older = olderVersionRuns(all);
  const questions: QA[] = [
    {
      q: groups.length === 2 ? `Is ${names[0]} better than ${names[1]}?` : "Which coding agent is best?",
      a: `${agentLead(groups)} ${agentBudgetText(groups)}`.trim(),
    },
  ];
  if (near.length > 0) {
    const nearText = near
      .map((run) => `${run.release.name} in ${run.harness.name}, ${score(run)} for ${usd(run)} per task`)
      .join("; ");
    const floor =
      cheapest && !near.some((run) => run.key === cheapest.key)
        ? ` The cheapest run of all is ${cheapest.release.name} in ${cheapest.harness.name}, ${usd(cheapest)} per task for ${score(cheapest)}.`
        : "";
    questions.push({
      q:
        groups.length === 2
          ? `Which is cheaper, ${names[0]} or ${names[1]}?`
          : "Which coding agent is cheapest?",
      a: `Each agent's cheapest run within two tasks of its best: ${nearText}.${floor} A run's cost is what it reported spending across its trials, divided by the trials; on a subscription plan you pay the plan instead.`,
    });
  }
  questions.push(
    {
      q: "Which model works best in each agent?",
      a: groups.map(modelAdvice).join(" "),
    },
    {
      q: "What about Cursor, OpenCode or other coding agents?",
      a: `These pages compare each lab's own agent running that lab's current models: ${listNames(
        groups.map((group) => `${group.harness.name} with ${PROVIDERS[group.harness.provider].name} models`),
      )}. The Terminal-Bench leaderboard also lists other agents, such as mini-SWE-agent, GitHub Copilot, Grok Build and Muse Code; they aren't compared here.`,
    },
  );
  if (groups.some((group) => group.harness.formerly)) {
    questions.push({ q: "What happened to Gemini CLI?", a: GEMINI_CLI_ANSWER });
  }
  questions.push({
    q: "How were these agents tested?",
    a: `Each run is on the official Terminal-Bench leaderboard: the agent attempts all ${TERMINAL_BENCH.tasks} tasks at least five times each, and errored trials count as failures. Before a run is listed, an LLM judge reviews every passing trial for reward hacking, and trials the maintainers disqualify count as failures too. ${all.length} runs with current models are compared here${
      older.length > 0
        ? `; ${listNames(older.map((r) => r.release.name))} ${older.length === 1 ? "was" : "were"} graded on version ${older[0]!.run.version}, before 4.1 changed the checks on every task`
        : ""
    }.`,
  });
  return questions;
}

export function agentDescription(groups: readonly HarnessGroup[]): string {
  const tops = groups.map((group) => bestRun(group.runs));
  const names = groups.map((group) => group.harness.name);
  return `${listNames(names)} on Terminal-Bench: best runs ${listNames(tops.map(score))}, at ${listNames(tops.map(usd))} per task. Cost, tokens and time per model.`;
}

/** A run's setting for tables: "Codex 0.169.0, Max effort". */
export function runSetting(run: AgentRun): string {
  return `${agentLabel(run.run)}, ${effortPhrase(run.run.effort).replace(/^at /, "")}`;
}
