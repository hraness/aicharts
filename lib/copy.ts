// Page text, computed from the dataset. Every number in a sentence comes from
// a Terminal-Bench run, an Epoch AI score or a LiteLLM price.
import {
  bestEpoch,
  catalog as defaultCatalog,
  effortName,
  TB_TIE,
  type Catalog,
  type ReleasePair,
} from "./catalog";
import {
  formatContext,
  formatDelta,
  formatFullDate,
  formatPrice,
  formatRatio,
  formatScore,
  formatTokens,
  formatUsd,
} from "./format";
import { buildPlottedPoints, comparePointToFrontier, computeParetoFrontier } from "./pareto";
import {
  EPOCH_BENCHMARKS,
  PROVIDERS,
  TERMINAL_BENCH,
  type EffortSlug,
  type EpochBenchmarkId,
  type EpochScore,
  type ModelRelease,
  type TerminalBenchRun,
} from "./types";

export type QA = Readonly<{ q: string; a: string }>;

const lab = (r: ModelRelease) => PROVIDERS[r.provider].name;
const pct = (value: number) => formatScore(value, "%");

export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Codex 0.169.0", or the agent alone when the run gave no version. */
export function agentLabel(run: TerminalBenchRun): string {
  return run.agentVersion ? `${run.agent} ${run.agentVersion}` : run.agent;
}

/** "at Max effort", or "at its default setting". */
export function effortPhrase(effort: EffortSlug | null): string {
  return effort ? `at ${effortName(effort)} effort` : "at its default setting";
}

function priceText(r: ModelRelease): string | null {
  return r.pricing ? `${formatPrice(r.pricing.inputPer1M)}/${formatPrice(r.pricing.outputPer1M)}` : null;
}

function apiPriceSentence(r: ModelRelease): string {
  const p = r.pricing;
  if (!p) return "";
  const cached = p.cachedInputPer1M !== null ? `, and ${formatPrice(p.cachedInputPer1M)} for cached input` : "";
  return `The API charges ${formatPrice(p.inputPer1M)} per million input tokens and ${formatPrice(p.outputPer1M)} per million output tokens${cached}.`;
}

function costPhrase(run: TerminalBenchRun): string {
  return run.costPerTaskUsd !== null
    ? `for ${formatUsd(run.costPerTaskUsd)} per task`
    : "in a run that reported no cost";
}

function trialsPerTask(run: TerminalBenchRun): string {
  const per = run.trials / TERMINAL_BENCH.tasks;
  return Number.isInteger(per) ? `${per} times` : `about ${Math.round(per)} times`;
}

function supersededText(r: ModelRelease, cat: Catalog, subject = "it"): string {
  if (!r.supersededOn) return "";
  const next = cat.successorOf(r);
  return `${lab(r)} superseded ${subject} on ${formatFullDate(r.supersededOn)}${next ? ` with ${next.name}` : ""}.`;
}

const EPOCH_LABEL = Object.fromEntries(EPOCH_BENCHMARKS.map((b) => [b.id, b.label])) as Record<
  EpochBenchmarkId,
  string
>;

function bestScores(release: ModelRelease): EpochScore[] {
  return EPOCH_BENCHMARKS.map((b) => bestEpoch(release, b.id)).filter((s): s is EpochScore => s !== null);
}

/** "Epoch AI measures it at 96.8% on GPQA Diamond and 92.6% on FrontierMath Tiers 1–3." */
function epochSentence(release: ModelRelease, subject = "it"): string {
  const best = bestScores(release);
  if (best.length === 0) return "";
  return `Epoch AI measures ${subject} at ${listNames(best.map((s) => `${pct(s.score)} on ${EPOCH_LABEL[s.benchmark]}`))}${release.epoch.length > best.length ? ", its best settings" : ""}.`;
}

/**
 * Two Epoch scores differ beyond chance when the gap passes 1.96 standard
 * errors of the difference; at least one point either way.
 */
export function epochTie(a: EpochScore, b: EpochScore): number {
  return Math.max(1, 1.96 * Math.hypot(a.stderr ?? 0, b.stderr ?? 0));
}

export type ModelCopy = Readonly<{
  description: string;
  lead: string;
  standing: string;
  questions: readonly QA[];
}>;

function standingText(release: ModelRelease, cat: Catalog): string {
  const run = release.terminalBench;
  if (release.deprecated) {
    const next = cat.successorOf(release);
    const nextRun = next?.terminalBench;
    return `${supersededText(release, cat) || `${lab(release)} has superseded it.`}${
      next && nextRun
        ? ` ${next.name} passes ${pct(nextRun.accuracy)} of Terminal-Bench ${costPhrase(nextRun)}.`
        : ""
    }`;
  }
  // The lead already says the model has no run yet.
  if (!run) return "";
  if (run.costPerTaskUsd === null) {
    return "Its run reported no cost, so it sits on the tokens chart only.";
  }
  if (cat.liveFrontier.has(release.slug)) {
    return `It earns a frontier star: no current model scores higher on Terminal-Bench for ${formatUsd(run.costPerTaskUsd)} per task or less.`;
  }
  const points = buildPlottedPoints(cat.current, "cost");
  const own = points.find((p) => p.key === release.slug);
  const comparison = own ? comparePointToFrontier(own, computeParetoFrontier(points)) : null;
  if (comparison && !comparison.onFrontier) {
    const rival = comparison.dominator;
    return `No frontier star today: ${rival.release.name} passes ${pct(rival.score)} for ${formatUsd(rival.budget)} per task, ${comparison.scoreDeficit > 0.05 ? "above" : "matching"} ${release.name}'s ${pct(run.accuracy)} for no more.`;
  }
  return "Its run sits on the live cost frontier, but below the bar for a frontier star: 75% of the top Terminal-Bench score.";
}

function upgradeAnswer(newer: ModelRelease, older: ModelRelease): string {
  const parts: string[] = [];
  const a = newer.terminalBench;
  const b = older.terminalBench;
  if (a && b) {
    const gap = a.accuracy - b.accuracy;
    parts.push(
      `On Terminal-Bench ${newer.name} passes ${pct(a.accuracy)} against ${pct(b.accuracy)} for ${older.name} (${formatDelta(gap)} points${Math.abs(gap) < TB_TIE ? ", within two tasks' worth" : ""}).`,
    );
    if (a.costPerTaskUsd !== null && b.costPerTaskUsd !== null) {
      parts.push(
        `It costs ${formatUsd(a.costPerTaskUsd)} per task against ${formatUsd(b.costPerTaskUsd)}.`,
      );
    }
  }
  const shared = EPOCH_BENCHMARKS.flatMap((meta) => {
    const x = bestEpoch(newer, meta.id);
    const y = bestEpoch(older, meta.id);
    return x && y ? [`${meta.label} ${pct(x.score)} against ${pct(y.score)}`] : [];
  });
  if (shared.length > 0) parts.push(`On Epoch AI's benchmarks: ${listNames(shared)}.`);
  if (parts.length === 0) return `There are no results in common to compare yet.`;
  return parts.join(" ");
}

export function modelCopy(release: ModelRelease, cat: Catalog = defaultCatalog): ModelCopy {
  const name = release.name;
  const run = release.terminalBench;
  const epoch = epochSentence(release);
  const intro = `${name} is ${lab(release)}'s model released ${formatFullDate(release.releaseDate)}.`;

  let lead: string;
  let description: string;
  if (run) {
    lead = `${intro} On Terminal-Bench it passed ${pct(run.accuracy)} of ${run.trials} trials in ${agentLabel(run)} ${effortPhrase(run.effort)}, ${costPhrase(run)}.${epoch ? ` ${epoch}` : ""}`;
    description = `${name} passes ${pct(run.accuracy)} of Terminal-Bench in ${run.agent}${run.costPerTaskUsd !== null ? ` for ${formatUsd(run.costPerTaskUsd)} per task` : ""}. API prices, Epoch AI scores and rival models compared.`;
  } else if (epoch) {
    lead = `${intro} It has no run on the Terminal-Bench leaderboard yet. ${epoch}`;
    const top = bestScores(release)[0]!;
    description = `${name}: ${pct(top.score)} on ${EPOCH_LABEL[top.benchmark]} from Epoch AI, with ${lab(release)} API prices and rival models compared.`;
  } else {
    const price = priceText(release);
    lead = `${intro} Neither Terminal-Bench nor Epoch AI has published results for it yet${price ? `; its API price is ${price} per million input/output tokens` : ""}. This page fills in when they do.`;
    description = `${name}, released ${formatFullDate(release.releaseDate)}: ${lab(release)} API prices now, Terminal-Bench and Epoch AI results when they are published.`;
  }

  const questions: QA[] = [];
  if (run) {
    questions.push({
      q: `How does ${name} score on Terminal-Bench?`,
      a: `It passed ${run.successes} of ${run.trials} trials, ${pct(run.accuracy)}${run.ci95 !== null ? ` (±${run.ci95.toFixed(1)} points at 95% confidence)` : ""}, running in ${agentLabel(run)} ${effortPhrase(run.effort)}. Terminal-Bench has ${TERMINAL_BENCH.tasks} tasks; this run tried each ${trialsPerTask(run)} and was graded on version ${run.version} of the tasks.`,
    });
    questions.push({
      q: `How much does ${name} cost per task?`,
      a: `${
        run.costPerTaskUsd !== null
          ? `Its Terminal-Bench run reported ${formatUsd(run.costPerTaskUsd)} per task`
          : "Its Terminal-Bench run reported no cost"
      } and used ${formatTokens(run.tokensPerTask.output)} output tokens per task. ${apiPriceSentence(release)}`.trim(),
    });
  } else if (release.pricing) {
    questions.push({
      q: `How much does ${name} cost?`,
      a: `${apiPriceSentence(release)} There is no Terminal-Bench run yet to give a cost per task.`,
    });
  }
  if (release.epoch.length > 0) {
    questions.push({
      q: `How does ${name} do on Epoch AI's benchmarks?`,
      a: `${EPOCH_BENCHMARKS.flatMap((meta) => {
        const scores = release.epoch.filter((s) => s.benchmark === meta.id);
        if (scores.length === 0) return [];
        const best = bestEpoch(release, meta.id)!;
        return [
          `${meta.label}: ${pct(best.score)}${scores.length > 1 || best.effort ? ` ${effortPhrase(best.effort)}` : ""}${scores.length > 1 ? `, of ${scores.length} settings run` : ""}.`,
        ];
      }).join(" ")} Scores are Epoch AI's, under CC BY 4.0.`,
    });
  }
  const predecessor = cat.predecessorOf(release);
  if (predecessor) {
    questions.push({
      q: `Is ${name} better than ${predecessor.name}?`,
      a: upgradeAnswer(release, predecessor),
    });
  }
  questions.push({
    q: `When was ${name} released?`,
    a: `${lab(release)} released ${name} on ${formatFullDate(release.releaseDate)}. ${
      release.deprecated
        ? supersededText(release, cat)
        : `It is current in this data as of ${formatFullDate(cat.dataset.snapshotDate)}.`
    }`,
  });

  return { description, lead, standing: standingText(release, cat), questions };
}

export type PairCopy = Readonly<{
  description: string;
  lead: string;
  budget: string;
  choose: readonly Readonly<{ release: ModelRelease; reasons: readonly string[] }>[];
  questions: readonly QA[];
}>;

const EPOCH_REASONS: Readonly<Record<EpochBenchmarkId, string>> = {
  mirrorCode: "You hand it long coding projects",
  gpqaDiamond: "You need graduate-level science",
  frontierMath: "You need hard math",
};

function chooseReasons(x: ModelRelease, y: ModelRelease, cat: Catalog): string[] {
  const reasons: string[] = [];
  const rx = x.terminalBench;
  const ry = y.terminalBench;
  if (rx && ry) {
    if (rx.accuracy - ry.accuracy >= TB_TIE) {
      reasons.push(
        `You want the higher Terminal-Bench score: ${pct(rx.accuracy)} against ${pct(ry.accuracy)}.`,
      );
    }
    const cx = rx.costPerTaskUsd;
    const cy = ry.costPerTaskUsd;
    if (cx !== null && cy !== null && cy / cx >= 1.2) {
      reasons.push(`You want to spend less per task: ${formatUsd(cx)} against ${formatUsd(cy)} on Terminal-Bench.`);
    }
    const ox = rx.tokensPerTask.output;
    const oy = ry.tokensPerTask.output;
    if (ox > 0 && oy / ox >= 1.2) {
      reasons.push(`You want fewer output tokens: ${formatTokens(ox)} per task against ${formatTokens(oy)}.`);
    }
    const mx = rx.minutesPerTask;
    const my = ry.minutesPerTask;
    if (mx !== null && my !== null && my / mx >= 1.2) {
      reasons.push(`You want quicker runs: ${Math.round(mx)} minutes per task against ${Math.round(my)}.`);
    }
  } else if (rx) {
    reasons.push(
      `You want a measured coding agent result: ${pct(rx.accuracy)} of Terminal-Bench in ${rx.agent}, where ${y.name} has no run yet.`,
    );
  }
  for (const meta of EPOCH_BENCHMARKS) {
    const a = bestEpoch(x, meta.id);
    const b = bestEpoch(y, meta.id);
    if (a && b && a.score - b.score >= epochTie(a, b)) {
      reasons.push(`${EPOCH_REASONS[meta.id]}: ${meta.label} ${pct(a.score)} against ${pct(b.score)}.`);
    }
  }
  const px = x.pricing;
  const py = y.pricing;
  if (px && py && px.outputPer1M < py.outputPer1M && px.inputPer1M <= py.inputPer1M) {
    reasons.push(
      `You pay by the token: ${priceText(x)} per million input/output tokens against ${priceText(y)}.`,
    );
  }
  if (px?.maxInputTokens && py?.maxInputTokens && px.maxInputTokens / py.maxInputTokens >= 1.2) {
    reasons.push(
      `You need longer inputs: up to ${formatContext(px.maxInputTokens)} tokens against ${formatContext(py.maxInputTokens)}.`,
    );
  }
  if (x.provider !== y.provider) {
    const harness = PROVIDERS[x.provider].harness;
    reasons.push(
      `You work in ${harness}, ${lab(x)}'s own coding agent${rx?.agent === harness ? ", where its Terminal-Bench run was made" : ""}.`,
    );
  }
  if (!x.deprecated && y.deprecated) {
    reasons.push(`You want a current model: ${supersededText(y, cat, y.name)}`);
  }
  if (x.deprecated) {
    reasons.push(`You have a setup pinned to it, though ${supersededText(x, cat)}`);
  }
  if (reasons.length === 0) {
    reasons.push(`Few reasons in this data: ${y.name} matches or beats it on every measure both have.`);
  }
  return reasons;
}

/** The two runs' cost per task, or their output tokens when a cost is missing. */
export function budgetText(a: ModelRelease, b: ModelRelease): string {
  const ra = a.terminalBench;
  const rb = b.terminalBench;
  if (!ra || !rb) return "";
  const ca = ra.costPerTaskUsd;
  const cb = rb.costPerTaskUsd;
  if (ca !== null && cb !== null) {
    const [cheap, dear] = ca <= cb ? [a, b] : [b, a];
    const low = Math.min(ca, cb);
    const high = Math.max(ca, cb);
    if (high / low < 1.05) {
      return `They cost about the same per task: ${formatUsd(ca)} for ${a.name} and ${formatUsd(cb)} for ${b.name}.`;
    }
    const gap = dear.terminalBench!.accuracy - cheap.terminalBench!.accuracy;
    const verdict =
      gap >= TB_TIE
        ? ` Its ${formatDelta(gap)} points cost ${formatRatio(high / low)} as much.`
        : gap > -TB_TIE
          ? " For scores this close, the cheaper run gives about the same for less."
          : ` ${cheap.name} also scores higher.`;
    return `${dear.name} costs ${formatUsd(high)} per task against ${formatUsd(low)} for ${cheap.name}.${verdict}`;
  }
  return `${ca === null ? a.name : b.name}'s run reported no cost. In output tokens per task, ${a.name} used ${formatTokens(ra.tokensPerTask.output)} and ${b.name} ${formatTokens(rb.tokensPerTask.output)}.`;
}

function pairLead(a: ModelRelease, b: ModelRelease): string {
  const ra = a.terminalBench;
  const rb = b.terminalBench;
  if (ra && rb) {
    const gap = ra.accuracy - rb.accuracy;
    if (Math.abs(gap) < TB_TIE) {
      return `${a.name} and ${b.name} are level on Terminal-Bench: ${pct(ra.accuracy)} in ${ra.agent} against ${pct(rb.accuracy)} in ${rb.agent}, within two tasks' worth of each other.`;
    }
    const [hi, lo] = gap > 0 ? [a, b] : [b, a];
    const h = hi.terminalBench!;
    const l = lo.terminalBench!;
    return `${hi.name} passes more of Terminal-Bench: ${pct(h.accuracy)} in ${h.agent} ${effortPhrase(h.effort)}, against ${pct(l.accuracy)} for ${lo.name} in ${l.agent}.`;
  }
  if (ra || rb) {
    const [has, lacks] = ra ? [a, b] : [b, a];
    const r = has.terminalBench!;
    const epoch = epochSentence(lacks, lacks.name);
    return `${has.name} passes ${pct(r.accuracy)} of Terminal-Bench in ${r.agent}; ${lacks.name} has no run on the leaderboard yet.${epoch ? ` ${epoch}` : ""}`;
  }
  const shared = EPOCH_BENCHMARKS.flatMap((meta) => {
    const x = bestEpoch(a, meta.id);
    const y = bestEpoch(b, meta.id);
    return x && y ? [`${meta.label} ${pct(x.score)} against ${pct(y.score)}`] : [];
  });
  if (shared.length > 0) {
    return `Neither has a Terminal-Bench run yet. On Epoch AI's benchmarks, ${a.name} against ${b.name}: ${listNames(shared)}.`;
  }
  return `${a.name} and ${b.name} have no benchmark results in common yet; this page compares their prices and dates until they do.`;
}

export function pairCopy(pair: ReleasePair, cat: Catalog = defaultCatalog): PairCopy {
  const { first: a, second: b } = pair;
  const lead = pairLead(a, b);
  const budget = budgetText(a, b);
  const ra = a.terminalBench;
  const rb = b.terminalBench;

  const costLine = (r: ModelRelease) => {
    const run = r.terminalBench;
    const price = priceText(r);
    const perTask =
      run?.costPerTaskUsd != null ? `${formatUsd(run.costPerTaskUsd)} per Terminal-Bench task` : null;
    const perToken = price ? `${price} per million input/output tokens` : null;
    const parts = [perTask, perToken].filter(Boolean);
    return parts.length > 0 ? `${r.name}: ${parts.join(", ")}.` : `${r.name}: no price listed.`;
  };

  const questions: QA[] = [
    {
      q: `Is ${a.name} better than ${b.name} for coding?`,
      a: `${lead}${budget ? ` ${budget}` : ""}`,
    },
    {
      q: `Which is cheaper, ${a.name} or ${b.name}?`,
      a: `${costLine(a)} ${costLine(b)}`,
    },
  ];
  const sharedEpoch = EPOCH_BENCHMARKS.flatMap((meta) => {
    const x = bestEpoch(a, meta.id);
    const y = bestEpoch(b, meta.id);
    if (!x || !y) return [];
    const tie = Math.abs(x.score - y.score) < epochTie(x, y);
    return [
      `${meta.label}: ${pct(x.score)} against ${pct(y.score)}${tie ? ", within the margin of error" : ""}.`,
    ];
  });
  if (sharedEpoch.length > 0) {
    questions.push({
      q: `How do ${a.name} and ${b.name} compare on Epoch AI's benchmarks?`,
      a: `Best scores, ${a.name} first. ${sharedEpoch.join(" ")}`,
    });
  }
  questions.push({
    q: `When were ${a.name} and ${b.name} released?`,
    a: `${lab(a)} released ${a.name} on ${formatFullDate(a.releaseDate)}; ${lab(b)} released ${b.name} on ${formatFullDate(b.releaseDate)}.${a.deprecated ? ` ${supersededText(a, cat, a.name)}` : ""}${b.deprecated ? ` ${supersededText(b, cat, b.name)}` : ""}`,
  });

  const description =
    ra && rb
      ? `${a.name} vs ${b.name} on Terminal-Bench: ${pct(ra.accuracy)} against ${pct(rb.accuracy)}${
          ra.costPerTaskUsd !== null && rb.costPerTaskUsd !== null
            ? `, ${formatUsd(ra.costPerTaskUsd)} against ${formatUsd(rb.costPerTaskUsd)} per task`
            : ""
        }. Epoch AI scores and API prices side by side.`
      : `${a.name} vs ${b.name}: Terminal-Bench and Epoch AI results where published, API prices and release dates side by side.`;

  return {
    description,
    lead,
    budget,
    choose: [
      { release: a, reasons: chooseReasons(a, b, cat) },
      { release: b, reasons: chooseReasons(b, a, cat) },
    ],
    questions,
  };
}
