import {
  bestEffort,
  catalog as defaultCatalog,
  cheapestEffort,
  curveSteps,
  defaultEffort,
  efficientEffort,
  effortName,
  frontierSegments,
  LAB_SETTING_NAMES,
  EFFORT_NAMES,
  effortStepRows,
  matchingEffort,
  publishedEffortSteps,
  summarizeEffortStep,
  type Catalog,
  type EffortStep,
  type EffortStepRow,
  type ReleasePair,
} from "./catalog";
import {
  formatContext,
  formatDelta,
  formatFullDate,
  formatPrice,
  formatRatio,
  formatScore,
  formatUsd,
} from "./format";
import { buildPlottedPoints, comparePointToFrontier, computeParetoFrontier } from "./pareto";
import {
  PROVIDERS,
  type BenchmarkId,
  type EffortPoint,
  type EffortSlug,
  type ModelRelease,
  type ProviderId,
} from "./types";

export type QA = Readonly<{ q: string; a: string }>;

const pct = (e: EffortPoint, benchmark: BenchmarkId = "coding") =>
  formatScore(e.scores[benchmark], benchmark === "intelligence" ? "pts" : "%");
const cost = (e: EffortPoint) => formatUsd(e.costUsdPerTask.total);
const level = (e: EffortPoint) => effortName(e.effortSlug);
const lab = (r: ModelRelease) => PROVIDERS[r.provider].name;

export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function priceText(r: ModelRelease): string {
  return `${formatPrice(r.pricing.inputPer1M)}/${formatPrice(r.pricing.outputPer1M)}`;
}

function supersededText(r: ModelRelease, cat: Catalog, subject = "it"): string {
  if (!r.supersededOn) return "";
  const next = cat.successorOf(r);
  return `${lab(r)} superseded ${subject} on ${formatFullDate(r.supersededOn)}${next ? ` with ${next.name}` : ""}.`;
}

export type StepNote = Readonly<{ text: string; drop: boolean; stepSlug: string | null }>;

export type ModelCopy = Readonly<{
  description: string;
  lead: string;
  standing: string;
  steps: readonly StepNote[];
  questions: readonly QA[];
}>;

export function modelCopy(release: ModelRelease, cat: Catalog = defaultCatalog): ModelCopy {
  const name = release.name;
  const best = bestEffort(release);
  const preset = defaultEffort(release);
  const cheapest = cheapestEffort(release);
  const efficient = efficientEffort(release);
  const priciest = release.efforts.reduce((a, b) =>
    b.costUsdPerTask.total > a.costUsdPerTask.total ? b : a,
  );
  const single = release.efforts.length === 1;

  const lead = single
    ? `${name} is ${lab(release)}'s model released ${formatFullDate(release.releaseDate)}, measured at one effort setting: ${pct(best)} on the coding composite at ${level(best)} for ${cost(best)} per task.`
    : `${name} is ${lab(release)}'s model released ${formatFullDate(release.releaseDate)}. On the coding composite it scores ${pct(best)} at ${level(best)} effort for ${cost(best)} per task; its default, ${level(preset)}, scores ${pct(preset)} for ${cost(preset)}.${
        efficient.effortSlug !== best.effortSlug
          ? ` ${level(efficient)} comes within a point of its best for ${cost(efficient)} per task instead of ${cost(best)}.`
          : ""
      }`;

  let standing: string;
  if (release.deprecated) {
    const next = cat.successorOf(release);
    standing = `${supersededText(release, cat)}${
      next
        ? ` ${next.name} scores ${pct(bestEffort(next))} at its best for ${cost(bestEffort(next))} per task.`
        : ""
    }`;
  } else {
    const stars = cat.liveFrontier("coding").get(release.slug) ?? [];
    if (stars.length > 0) {
      standing = `${listNames(stars.map(level))} ${stars.length === 1 ? "earns a frontier star" : "earn frontier stars"}: at ${stars.length === 1 ? "that cost" : "those costs"}, no current model scores higher on coding.`;
    } else {
      const points = buildPlottedPoints(cat.current, "coding", "cost");
      const own = points.find((p) => p.key === `${release.slug}:${best.effortSlug}`);
      const comparison = own ? comparePointToFrontier(own, computeParetoFrontier(points)) : null;
      if (comparison && !comparison.onFrontier) {
        const rival = comparison.dominator;
        standing = `No setting earns a frontier star: ${rival.release.name} at ${level(rival.effort)} effort scores ${pct(rival.effort)} for ${cost(rival.effort)} per task, ${comparison.scoreDeficit > 0.05 ? "above" : "matching"} ${name}'s best for no more.`;
      } else {
        standing = `Its ${level(best)} setting sits on the live cost frontier, but below the bar for a frontier star: 75% of the top coding score.`;
      }
    }
  }

  const published = publishedEffortSteps(cat.releases);
  const steps: StepNote[] = curveSteps(release).map((step) => {
    const drop = step.scoreDelta < 0;
    const stepSlug =
      published.find((s) => s.lower === step.from.effortSlug && s.higher === step.to.effortSlug)
        ?.slug ?? null;
    const text = drop
      ? `${level(step.from)} → ${level(step.to)}: ${level(step.to)} scores ${Math.abs(step.scoreDelta).toFixed(1)} points lower and costs ${formatRatio(step.costRatio)} as much (${cost(step.from)} → ${cost(step.to)}).`
      : formatDelta(step.scoreDelta) === "0.0"
        ? `${level(step.from)} → ${level(step.to)}: no change in score for ${formatRatio(step.costRatio)} the cost per task (${cost(step.from)} → ${cost(step.to)}).`
        : `${level(step.from)} → ${level(step.to)}: ${formatDelta(step.scoreDelta)} points for ${formatRatio(step.costRatio)} the cost per task (${cost(step.from)} → ${cost(step.to)}).`;
    return { text, drop, stepSlug };
  });

  const drops = curveSteps(release).filter((s) => s.scoreDelta < 0);
  const questions: QA[] = [
    {
      q: `How much does ${name} cost per task?`,
      a: single
        ? `${name} costs ${cost(best)} per task at ${level(best)} effort on Artificial Analysis's coding tasks. API prices are ${formatPrice(release.pricing.inputPer1M)} per million input tokens and ${formatPrice(release.pricing.outputPer1M)} per million output tokens.`
        : `On Artificial Analysis's coding tasks, ${name} costs ${cost(cheapest)} per task at ${level(cheapest)} effort${cheapest === preset ? ", its default," : ""} and ${cost(priciest)} at ${level(priciest)}${priciest === preset ? ", its default" : ""}${cheapest !== preset && priciest !== preset ? `; its default, ${level(preset)}, costs ${cost(preset)}` : ""}. API prices are ${formatPrice(release.pricing.inputPer1M)} per million input tokens and ${formatPrice(release.pricing.outputPer1M)} per million output tokens.`,
    },
    {
      q: `Which ${name} effort level is best for coding?`,
      a: single
        ? `It was measured at ${level(best)} only: ${pct(best)} for ${cost(best)} per task.`
        : `${level(best)} scores highest, ${pct(best)} for ${cost(best)} per task.${
        efficient.effortSlug !== best.effortSlug
          ? ` ${level(efficient)} comes within a point of it for ${cost(efficient)}, the better buy unless every point counts.`
          : single
            ? ""
            : " No cheaper setting comes within a point of it."
      }${drops
        .map((s) => ` ${level(s.to)} scores lower than ${level(s.from)} while costing more.`)
        .join("")}`,
    },
    {
      q: `What is ${name}'s default effort level?`,
      a: `${level(preset)}. ${lab(release)} calls this setting ${LAB_SETTING_NAMES[release.provider]}; ${name} was measured at ${listNames(release.efforts.map(level))}.`,
    },
  ];
  const predecessor = cat.predecessorOf(release);
  if (predecessor) {
    const before = bestEffort(predecessor);
    const match = matchingEffort(release, predecessor);
    questions.push({
      q: `Is ${name} better than ${predecessor.name}?`,
      a: `On the coding composite ${name} scores ${pct(best)} at its best against ${pct(before)} for ${predecessor.name} (${formatDelta(best.scores.coding - before.scores.coding)} points). ${
        match
          ? `It matches ${predecessor.name}'s best at ${level(match)} effort for ${cost(match)} per task, against ${cost(before)}.`
          : `It does not reach ${predecessor.name}'s best score at any setting.`
      }`,
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

  return {
    description: `${name} scores ${pct(best)} on the coding composite at ${level(best)} effort for ${cost(best)} per task. Every effort setting, ${lab(release)} pricing and rival models compared on cost.`,
    lead,
    standing,
    steps,
    questions,
  };
}

export type PairCopy = Readonly<{
  description: string;
  lead: string;
  budget: string;
  choose: readonly Readonly<{ release: ModelRelease; reasons: readonly string[] }>[];
  questions: readonly QA[];
}>;

const BENCH_REASONS: readonly [BenchmarkId, (a: string, b: string) => string][] = [
  ["terminalBench4", (a, b) => `Your work happens in the terminal: Terminal-Bench 4.0 ${a} against ${b}.`],
  ["frontierCode2", (a, b) => `You work across large repositories: FrontierCode 2.0 ${a} against ${b}.`],
  ["intelligence", (a, b) => `You also need broad reasoning: Intelligence Index ${a} against ${b}.`],
];

function chooseReasons(x: ModelRelease, y: ModelRelease, cat: Catalog): string[] {
  const reasons: string[] = [];
  const bx = bestEffort(x);
  const by = bestEffort(y);
  if (bx.scores.coding > by.scores.coding + 0.05) {
    reasons.push(
      `You want the higher coding score: ${pct(bx)} at ${level(bx)} effort against ${pct(by)}.`,
    );
  }
  const cx = cheapestEffort(x);
  const cy = cheapestEffort(y);
  if (cx.costUsdPerTask.total < cy.costUsdPerTask.total) {
    reasons.push(
      `You want the lowest cost per task: ${level(cx)} effort runs ${cost(cx)} (${pct(cx)}), against ${cost(cy)} for ${y.name}'s cheapest setting.`,
    );
  }
  const segments = frontierSegments(x, y);
  // Past two crossovers the bands get too narrow to act on; the lead says how often it flips.
  if (segments.length > 1 && segments.length <= 3) {
    segments.forEach((segment, i) => {
      if (segment.release.slug !== x.slug) return;
      const start = segment.efforts[0]!;
      const next = segments[i + 1]?.efforts[0];
      const top = segment.efforts[segment.efforts.length - 1]!;
      if (i === 0 && next) {
        reasons.push(`Your budget is under ${cost(next)} per task: ${x.name} scores higher there.`);
      } else if (!next) {
        reasons.push(
          `You can spend ${cost(start)} or more per task: from there ${x.name} scores higher, up to ${pct(top)}.`,
        );
      } else {
        reasons.push(
          `Your budget is between ${cost(start)} and ${cost(next)} per task: ${x.name} scores higher there.`,
        );
      }
    });
  }
  for (const [benchmark, text] of BENCH_REASONS) {
    const a = bestEffort(x, benchmark);
    const b = bestEffort(y, benchmark);
    if (a.scores[benchmark] > b.scores[benchmark] + 1) {
      reasons.push(text(pct(a, benchmark), pct(b, benchmark)));
    }
  }
  if (x.provider !== y.provider) {
    const agent = x.efforts
      .filter((e) => e.cliEval)
      .reduce<EffortPoint | null>(
        (top, e) => (!top || e.cliEval!.codingAgentScore > top.cliEval!.codingAgentScore ? e : top),
        null,
      );
    reasons.push(
      `You work in ${PROVIDERS[x.provider].harness}${
        agent
          ? `, where it scored ${agent.cliEval!.codingAgentScore.toFixed(1)} on Artificial Analysis's Coding Agent Index at ${level(agent)} effort`
          : `, ${lab(x)}'s own coding agent`
      }.`,
    );
  }
  if (x.pricing.contextWindowTokens > y.pricing.contextWindowTokens) {
    reasons.push(
      `You need a longer context window: ${formatContext(x.pricing.contextWindowTokens)} tokens against ${formatContext(y.pricing.contextWindowTokens)}.`,
    );
  }
  if (
    x.pricing.outputPer1M < y.pricing.outputPer1M &&
    x.pricing.inputPer1M <= y.pricing.inputPer1M
  ) {
    reasons.push(
      `You pay by the token: ${priceText(x)} per million input/output tokens against ${priceText(y)}.`,
    );
  }
  const sx = defaultEffort(x).speedTokPerSec;
  const sy = defaultEffort(y).speedTokPerSec;
  if (sx && sy && sx > sy * 1.1) {
    reasons.push(
      `You want faster output: ${Math.round(sx)} tokens per second at its default effort against ${Math.round(sy)}.`,
    );
  }
  if (!x.deprecated && y.deprecated) {
    reasons.push(`You want a current model: ${supersededText(y, cat, y.name)}`);
  }
  if (x.deprecated) {
    reasons.push(`You have a setup pinned to it, though ${supersededText(x, cat)}`);
  }
  if (reasons.length === 0) {
    reasons.push(
      `Few reasons in this data: ${y.name} scores at least as high for no more per task at every setting measured.`,
    );
  }
  return reasons;
}

export function budgetText(a: ModelRelease, b: ModelRelease): string {
  const segments = frontierSegments(a, b);
  if (segments.length === 1) {
    const winner = segments[0]!.release;
    const other = winner.slug === a.slug ? b : a;
    return `Every ${other.name} setting is matched or beaten by a ${winner.name} setting that costs no more per task.`;
  }
  if (segments.length === 2) {
    const [low, high] = segments as [(typeof segments)[0], (typeof segments)[0]];
    const turn = high.efforts[0]!;
    return `Below ${cost(turn)} per task ${low.release.name} gives the higher score; from ${cost(turn)}, ${high.release.name} does, up to ${pct(high.efforts[high.efforts.length - 1]!)}.`;
  }
  const first = segments[0]!.efforts[0]!;
  const lastSegment = segments[segments.length - 1]!;
  const last = lastSegment.efforts[lastSegment.efforts.length - 1]!;
  return `The lead changes ${segments.length - 1} times between ${cost(first)} and ${cost(last)} per task; ${lastSegment.release.name} holds the top, ${pct(last)}.`;
}

export function pairCopy(pair: ReleasePair, cat: Catalog = defaultCatalog): PairCopy {
  const { first: a, second: b } = pair;
  const ba = bestEffort(a);
  const bb = bestEffort(b);
  const gap = ba.scores.coding - bb.scores.coding;
  const leader = gap > 0.05 ? a : gap < -0.05 ? b : null;

  let lead: string;
  if (leader) {
    const rival = leader === a ? b : a;
    const top = bestEffort(leader);
    const rivalTop = bestEffort(rival);
    const match = matchingEffort(leader, rival);
    lead = `${leader.name} scores higher on the coding composite: ${pct(top)} at ${level(top)} effort for ${cost(top)} per task, against ${pct(rivalTop)} for ${rival.name} at ${level(rivalTop)} (${cost(rivalTop)}).`;
    if (match && match.effortSlug !== top.effortSlug) {
      lead +=
        match.costUsdPerTask.total < rivalTop.costUsdPerTask.total
          ? ` It already matches ${rival.name}'s best at ${level(match)} effort, for ${cost(match)} per task instead of ${cost(rivalTop)}.`
          : ` Matching ${rival.name}'s best takes its ${level(match)} setting, at ${cost(match)} per task against ${cost(rivalTop)}.`;
    }
  } else {
    lead = `${a.name} and ${b.name} reach the same coding score at their best settings, ${pct(ba)}: ${a.name} at ${level(ba)} for ${cost(ba)} per task and ${b.name} at ${level(bb)} for ${cost(bb)}.`;
  }

  const ca = cheapestEffort(a);
  const cb = cheapestEffort(b);
  const cheaper = ca.costUsdPerTask.total <= cb.costUsdPerTask.total ? a : b;
  const cheaperEffort = cheaper === a ? ca : cb;
  const ea = efficientEffort(a);
  const eb = efficientEffort(b);

  const questions: QA[] = [
    {
      q: `Is ${a.name} better than ${b.name} for coding?`,
      a: `${lead} ${budgetText(a, b)}`,
    },
    {
      q: `Which is cheaper, ${a.name} or ${b.name}?`,
      a: `${cheaper.name} has the cheaper setting: ${level(cheaperEffort)} effort costs ${cost(cheaperEffort)} per task. At default effort ${a.name} costs ${cost(defaultEffort(a))} and ${b.name} ${cost(defaultEffort(b))}. Per million input/output tokens, ${a.name} charges ${priceText(a)} and ${b.name} ${priceText(b)}.`,
    },
    {
      q: `Which effort level should I use for each?`,
      a: `For coding, ${a.name} comes within a point of its best at ${level(ea)} effort, for ${cost(ea)} per task; ${b.name} does at ${level(eb)}, for ${cost(eb)}.`,
    },
    {
      q: `When were ${a.name} and ${b.name} released?`,
      a: `${lab(a)} released ${a.name} on ${formatFullDate(a.releaseDate)}; ${lab(b)} released ${b.name} on ${formatFullDate(b.releaseDate)}.${a.deprecated ? ` ${supersededText(a, cat, a.name)}` : ""}${b.deprecated ? ` ${supersededText(b, cat, b.name)}` : ""}`,
    },
  ];

  return {
    description: `${a.name} vs ${b.name} on coding: ${pct(ba)} against ${pct(bb)} at best effort, ${cost(ba)} against ${cost(bb)} per task. Both effort curves, side by side, from Artificial Analysis data.`,
    lead,
    budget: budgetText(a, b),
    choose: [
      { release: a, reasons: chooseReasons(a, b, cat) },
      { release: b, reasons: chooseReasons(b, a, cat) },
    ],
    questions,
  };
}

const EFFORT_ORDER: readonly EffortSlug[] = ["none", "low", "medium", "high", "xhigh", "max"];

/** "XHigh vs High": the higher setting first, as people search for it. */
export function effortStepTitle(step: EffortStep): string {
  return `${EFFORT_NAMES[step.higher]} vs ${EFFORT_NAMES[step.lower]}`;
}

/** Steps from the lowest setting up, the order a reader climbs them. */
export function orderedEffortSteps(steps: readonly EffortStep[]): EffortStep[] {
  return [...steps].sort(
    (x, y) =>
      EFFORT_ORDER.indexOf(x.lower) - EFFORT_ORDER.indexOf(y.lower) ||
      EFFORT_ORDER.indexOf(x.higher) - EFFORT_ORDER.indexOf(y.higher),
  );
}

function gainText(delta: number): string {
  return delta >= 0
    ? `adds a median ${formatDelta(delta)} points`
    : `scores a median ${Math.abs(delta).toFixed(1)} points lower`;
}

export type LabStepSummary = Readonly<{ provider: ProviderId; text: string }>;

export type EffortStepCopy = Readonly<{
  title: string;
  description: string;
  lead: string;
  byLab: readonly LabStepSummary[];
  questions: readonly QA[];
}>;

export function effortStepCopy(step: EffortStep, cat: Catalog = defaultCatalog): EffortStepCopy {
  const rows = effortStepRows(step, cat.releases);
  const summary = summarizeEffortStep(rows);
  const hi = EFFORT_NAMES[step.higher];
  const lo = EFFORT_NAMES[step.lower];
  const title = effortStepTitle(step);
  const currentCount = rows.filter((r) => !r.release.deprecated).length;
  const top = rows[0]!;
  const byCost = [...rows].sort((a, b) => a.costRatio - b.costRatio);
  const cheapestStep = byCost[0]!;
  const dearestStep = byCost[byCost.length - 1]!;
  const dropNames = summary.drops.map((r) => r.release.name);
  const dropText =
    dropNames.length > 0
      ? ` For ${listNames(dropNames)}, ${hi} scores lower than ${lo}.`
      : ` Every model measured scores at least as high at ${hi}.`;

  const topText =
    top.scoreDelta.coding >= 0
      ? `${top.release.name} gains the most: ${formatDelta(top.scoreDelta.coding)} points for ${formatRatio(top.costRatio)} the cost.`
      : `${top.release.name} loses the least: ${Math.abs(top.scoreDelta.coding).toFixed(1)} points for ${formatRatio(top.costRatio)} the cost.`;
  const lead = `Across ${rows.length} models measured at both settings (${currentCount} current), ${hi} ${gainText(summary.medianDelta.coding)} on the coding composite ${summary.medianDelta.coding >= 0 ? "over" : "than"} ${lo} and costs a median ${formatRatio(summary.medianCostRatio)} as much per task.${dropText} ${topText}`;

  const providers = (Object.keys(PROVIDERS) as ProviderId[]).filter((p) =>
    rows.some((r) => r.release.provider === p),
  );
  const byLab = providers.map((provider) => {
    const labRows = rows.filter((r) => r.release.provider === provider);
    const labSummary = summarizeEffortStep(labRows);
    const info = PROVIDERS[provider];
    return {
      provider,
      text: `${info.name} (${LAB_SETTING_NAMES[provider]} in ${info.harness}): ${hi} ${gainText(labSummary.medianDelta.coding)} for a median ${formatRatio(labSummary.medianCostRatio)} the cost, across ${labRows.length} model${labRows.length === 1 ? "" : "s"}.`,
    };
  });

  const higherCount = rows.filter((r) => r.scoreDelta.coding > 0).length;
  const questions: QA[] = [
    {
      q: `Is ${hi} better than ${lo}?`,
      a: `${hi} scores higher than ${lo} on the coding composite for ${higherCount} of ${rows.length} models, by a median ${formatDelta(summary.medianDelta.coding)} points.${dropText} On Terminal-Bench 4.0 the median change is ${formatDelta(summary.medianDelta.terminalBench4)} points and on FrontierCode 2.0 ${formatDelta(summary.medianDelta.frontierCode2)}.`,
    },
    {
      q: `How much more does ${hi} cost than ${lo}?`,
      a: `A median ${formatRatio(summary.medianCostRatio)} as much per task, because ${hi} spends a median ${formatRatio(summary.medianTokenRatio)} the output tokens. The multiple runs from ${formatRatio(cheapestStep.costRatio)} for ${cheapestStep.release.name} to ${formatRatio(dearestStep.costRatio)} for ${dearestStep.release.name}.`,
    },
    {
      q: `Which model gains the most from ${hi} effort?`,
      a: `${top.release.name}: ${formatDelta(top.scoreDelta.coding)} points on the coding composite (${pct(top.lower)} at ${lo}, ${pct(top.higher)} at ${hi}) for ${formatRatio(top.costRatio)} the cost per task (${cost(top.lower)} → ${cost(top.higher)}).`,
    },
    {
      q: `What do the labs call this setting?`,
      a: `${listNames(
        (Object.keys(PROVIDERS) as ProviderId[]).map(
          (p) => `${PROVIDERS[p].name} calls it ${LAB_SETTING_NAMES[p]} (${PROVIDERS[p].harness})`,
        ),
      )}. Models from ${listNames(providers.map((p) => PROVIDERS[p].name))} were measured at both ${lo} and ${hi} here.`,
    },
  ];

  return {
    title,
    description: `${title} effort across ${rows.length} AI models: ${hi} ${gainText(summary.medianDelta.coding)} on coding for a median ${formatRatio(summary.medianCostRatio)} the cost per task. Every model's gain, cost and token multiple.`,
    lead,
    byLab,
    questions,
  };
}

export type EffortHubCopy = Readonly<{
  description: string;
  lead: string;
  questions: readonly QA[];
}>;

export function effortHubCopy(cat: Catalog = defaultCatalog): EffortHubCopy {
  const steps = orderedEffortSteps(publishedEffortSteps(cat.releases)).map((step) => ({
    step,
    summary: summarizeEffortStep(effortStepRows(step, cat.releases)),
  }));
  // One level up at a time, from Low: the climb a reader weighs.
  const climb = steps.filter(
    ({ step }) =>
      step.lower !== "none" &&
      EFFORT_ORDER.indexOf(step.higher) - EFFORT_ORDER.indexOf(step.lower) === 1,
  );
  const climbText = climb
    .map(({ step, summary }) => {
      const d = summary.medianDelta.coding;
      return `${EFFORT_NAMES[step.lower]} to ${EFFORT_NAMES[step.higher]} ${d >= 0 ? "adds" : "loses"} ${Math.abs(d).toFixed(1)} points for ${formatRatio(summary.medianCostRatio)} the cost`;
    })
    .join("; ");
  const gains = climb.map(({ summary }) => summary.medianDelta.coding);
  const shrinking = gains.length > 2 && gains.every((g, i) => i === 0 || g <= gains[i - 1]!);
  const drops = climb.flatMap(({ step, summary }) => {
    const names = summary.drops.filter((row) => row.costRatio > 1).map((row) => row.release.name);
    if (names.length === 0) return [];
    return [
      `at ${EFFORT_NAMES[step.higher]}, ${listNames(names)} ${names.length === 1 ? "scores" : "score"} lower than at ${EFFORT_NAMES[step.lower]}`,
    ];
  });
  const current = cat.current;
  const defaults = new Map<EffortSlug, number>();
  for (const release of current) {
    const slug = defaultEffort(release).effortSlug;
    defaults.set(slug, (defaults.get(slug) ?? 0) + 1);
  }
  const defaultText = listNames(
    [...defaults.entries()]
      .sort((a, b) => b[1] - a[1] || EFFORT_ORDER.indexOf(a[0]) - EFFORT_ORDER.indexOf(b[0]))
      .map(([slug, n]) => `${EFFORT_NAMES[slug]} for ${n}`),
  );
  const efficientAtDefault = current.filter(
    (r) => efficientEffort(r).effortSlug === defaultEffort(r).effortSlug,
  ).length;

  const lead = `One setting trades cost for score: OpenAI calls it reasoning effort, Anthropic effort, and Google thinking level. Measured across ${cat.releases.length} models, the median step ${climbText ? `from ${climbText}` : "varies"}.${shrinking ? " Each level up costs a multiple more per task while the score gain shrinks." : ""}`;

  return {
    description: `What each AI effort level buys on coding and what it costs: median score gains and cost multiples from Low to Max across ${cat.releases.length} OpenAI, Anthropic and Google models, plus every model's default.`,
    lead,
    questions: [
      {
        q: "What are effort levels?",
        a: "A setting that tells a model how much to reason before it answers. Higher settings usually spend more reasoning tokens per task, so they cost more and often score higher. OpenAI calls it reasoning effort (Codex), Anthropic effort (Claude Code), and Google thinking level (Antigravity CLI).",
      },
      {
        q: "Does higher effort always score higher?",
        a:
          drops.length > 0
            ? `No. In this data, ${drops.join("; ")}, while costing more per task.`
            : "In this data every step up scores at least as high, though the gain varies by model.",
      },
      {
        q: "What is the default effort level?",
        a: `Each lab sets its own. Among the ${current.length} current models the default is ${defaultText}; aicharts measures every setting each model offers.`,
      },
      {
        q: "Which effort level should I use?",
        a: `aicharts suggests the cheapest setting within a point of a model's best coding score. For ${efficientAtDefault} of the ${current.length} current models that is the default; each model page names it and what every setting costs per task.`,
      },
    ],
  };
}
