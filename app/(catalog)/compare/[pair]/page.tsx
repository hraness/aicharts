import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProviderLogo } from "@/components/brand-icon";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { CatalogChart } from "@/components/catalog/catalog-chart";
import { FactCell, type Cell } from "@/components/catalog/fact-cell";
import { PairList } from "@/components/catalog/pair-list";
import { Questions } from "@/components/catalog/questions";
import { Cite, Sources, type Source } from "@/components/catalog/sources";
import { pageMetadata } from "@/journal/content";
import { agentPairs } from "@/lib/agents";
import { bestEpoch, catalog, effortName, isComparable, TB_TIE } from "@/lib/catalog";
import { epochTie, pairCopy } from "@/lib/copy";
import {
  formatContext,
  formatFullDate,
  formatPrice,
  formatScore,
  formatTokens,
  formatUsd,
} from "@/lib/format";
import { EPOCH_BENCHMARKS, EPOCH_BENCHMARKS_URL, PROVIDERS, TERMINAL_BENCH, type ModelRelease } from "@/lib/types";

type Params = Promise<{ pair: string }>;

export const dynamicParams = false;

export function generateStaticParams() {
  return catalog.pairs.map((p) => ({ pair: p.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const pair = catalog.findPair((await params).pair);
  if (!pair) return {};
  const metadata = pageMetadata(
    `${pair.first.name} vs ${pair.second.name}: coding scores and cost per task`,
    pairCopy(pair).description,
    `/compare/${pair.slug}`,
  );
  // Two models with no result in common make a thin page: keep it for
  // readers who follow a link, out of search results until data arrives.
  return isComparable(pair) ? metadata : { ...metadata, robots: { index: false, follow: true } };
}

type Row = Readonly<{ label: string; a: Cell; b: Cell }>;

const pct = (value: number) => formatScore(value, "%");

/** Marks the higher value when it leads by at least `floor`. */
function higher(a: number | null, b: number | null, floor: number, word: string): [string?, string?] {
  if (a === null || b === null || Math.abs(a - b) < floor || a === b) return [];
  return a > b ? [word] : [undefined, word];
}

/** Marks the lower value when the other is at least `ratio` times it. */
function lower(a: number | null, b: number | null, ratio: number, word: string): [string?, string?] {
  if (a === null || b === null || a <= 0 || b <= 0) return [];
  if (b / a >= ratio) return [word];
  if (a / b >= ratio) return [undefined, word];
  return [];
}

/** Marks the larger value when it is at least `ratio` times the other. */
function larger(a: number | null, b: number | null, ratio: number, word: string): [string?, string?] {
  const [x, y] = lower(a, b, ratio, word);
  return x ? [undefined, x] : y ? [y] : [];
}

export default async function ComparePairPage({ params }: { params: Params }) {
  const pair = catalog.findPair((await params).pair);
  if (!pair) notFound();
  const { first: a, second: b } = pair;
  const copy = pairCopy(pair);
  const labA = PROVIDERS[a.provider];
  const labB = PROVIDERS[b.provider];
  const ra = a.terminalBench;
  const rb = b.terminalBench;

  // Sources are numbered in the order they are added; duplicates share a number.
  const sources: Source[] = [];
  const add = (source: Source) => {
    const found = sources.findIndex((s) => s.url === source.url);
    return found >= 0 ? found + 1 : sources.push(source);
  };
  const tbSource = (r: ModelRelease) =>
    r.terminalBench
      ? add({ name: `Terminal-Bench leaderboard: ${r.terminalBench.agent} with ${r.name}`, url: r.terminalBench.sourceUrl })
      : add({ name: "Terminal-Bench leaderboard", url: TERMINAL_BENCH.url });
  const [tbA, tbB] = [tbSource(a), tbSource(b)];
  const epoch = add({ name: "Epoch AI, Capabilities & benchmarking (CC BY 4.0)", url: EPOCH_BENCHMARKS_URL });
  const litellm = catalog.dataset.sources.find((s) => s.id === "litellm")!;
  const prices = add({ name: `${litellm.name} (MIT)`, url: litellm.url });
  const labSource = (r: ModelRelease) =>
    r.announcementUrl ? add({ name: `${PROVIDERS[r.provider].name}: ${r.name}`, url: r.announcementUrl }) : undefined;
  const [labCiteA, labCiteB] = [labSource(a), labSource(b)];

  const status = (r: ModelRelease) =>
    r.supersededOn ? `Superseded ${formatFullDate(r.supersededOn)}` : "Current";
  const star = (r: ModelRelease): Cell =>
    r.deprecated
      ? { value: "Superseded" }
      : catalog.liveFrontier.has(r.slug)
        ? { value: "★", note: "On today's cost frontier" }
        : { value: "None" };
  const runCell = (r: ModelRelease, win: string | undefined, cite: number): Cell => {
    const run = r.terminalBench;
    return run
      ? { value: pct(run.accuracy), note: `${run.agent} · ${effortName(run.effort)}`, win, cite }
      : { value: "No run yet", cite };
  };
  const costOf = (r: ModelRelease) => r.terminalBench?.costPerTaskUsd ?? null;
  const tokensOf = (r: ModelRelease) => r.terminalBench?.tokensPerTask.output ?? null;
  const minutesOf = (r: ModelRelease) => r.terminalBench?.minutesPerTask ?? null;

  const [tbWinA, tbWinB] = higher(ra?.accuracy ?? null, rb?.accuracy ?? null, TB_TIE, "Higher");
  const [costWinA, costWinB] = lower(costOf(a), costOf(b), 1.2, "Lower");
  const [tokWinA, tokWinB] = lower(tokensOf(a), tokensOf(b), 1.2, "Fewer");
  const [minWinA, minWinB] = lower(minutesOf(a), minutesOf(b), 1.2, "Quicker");
  const [ctxWinA, ctxWinB] = larger(
    a.pricing?.maxInputTokens ?? null,
    b.pricing?.maxInputTokens ?? null,
    1.2,
    "Longer",
  );

  const rows: Row[] = [
    {
      label: "Released",
      a: { value: formatFullDate(a.releaseDate), note: `${labA.name} · ${status(a)}`, cite: labCiteA },
      b: { value: formatFullDate(b.releaseDate), note: `${labB.name} · ${status(b)}`, cite: labCiteB },
    },
    { label: "Terminal-Bench", a: runCell(a, tbWinA, tbA), b: runCell(b, tbWinB, tbB) },
  ];
  if (ra || rb) {
    const money = (r: ModelRelease, win: string | undefined, cite: number): Cell => {
      const run = r.terminalBench;
      if (!run) return { value: "—" };
      return run.costPerTaskUsd === null
        ? { value: "Not reported" }
        : { value: formatUsd(run.costPerTaskUsd), win, cite };
    };
    rows.push(
      { label: "Cost per task", a: money(a, costWinA, tbA), b: money(b, costWinB, tbB) },
      {
        label: "Output tokens per task",
        a: ra ? { value: formatTokens(ra.tokensPerTask.output), win: tokWinA, cite: tbA } : { value: "—" },
        b: rb ? { value: formatTokens(rb.tokensPerTask.output), win: tokWinB, cite: tbB } : { value: "—" },
      },
      {
        label: "Minutes per task",
        a: ra?.minutesPerTask != null ? { value: `${Math.round(ra.minutesPerTask)} min`, win: minWinA, cite: tbA } : { value: "—" },
        b: rb?.minutesPerTask != null ? { value: `${Math.round(rb.minutesPerTask)} min`, win: minWinB, cite: tbB } : { value: "—" },
      },
    );
  }
  for (const meta of EPOCH_BENCHMARKS) {
    const x = bestEpoch(a, meta.id);
    const y = bestEpoch(b, meta.id);
    if (!x && !y) continue;
    const tie = x && y ? epochTie(x, y) : 0;
    const [wa, wb] = higher(x?.score ?? null, y?.score ?? null, tie, "Higher");
    const cell = (s: typeof x, win: string | undefined): Cell =>
      s ? { value: pct(s.score), note: `${effortName(s.effort)} · Epoch AI`, win, cite: epoch } : { value: "Not run" };
    rows.push({ label: meta.label, a: cell(x, wa), b: cell(y, wb) });
  }
  const priceCell = (r: ModelRelease): Cell =>
    r.pricing
      ? {
          value: `${formatPrice(r.pricing.inputPer1M)}/${formatPrice(r.pricing.outputPer1M)}`,
          note: "Per 1M input/output tokens",
          cite: prices,
        }
      : { value: "Not listed" };
  const inputCell = (r: ModelRelease, win: string | undefined): Cell =>
    r.pricing?.maxInputTokens
      ? { value: `${formatContext(r.pricing.maxInputTokens)} tokens`, win, cite: prices }
      : { value: "Not listed" };
  rows.push(
    { label: "API price", a: priceCell(a), b: priceCell(b) },
    { label: "Longest input", a: inputCell(a, ctxWinA), b: inputCell(b, ctxWinB) },
    { label: "Frontier star", a: star(a), b: star(b) },
  );

  const agentPage = agentPairs().find(
    (p) =>
      a.provider !== b.provider &&
      [p.first.provider, p.second.provider].sort().join() === [a.provider, b.provider].sort().join(),
  );
  const related = (r: ModelRelease) =>
    catalog
      .pairsFor(r)
      .filter((p) => p.slug !== pair.slug && isComparable(p))
      .slice(0, 6);
  // The chart shows both models against today's field; it needs a run to draw.
  const charted = [a, b].filter((r) => r.terminalBench);
  const field = [...new Map([...catalog.current, a, b].map((r) => [r.slug, r])).values()];

  return (
    <article className="catalog-page">
      <Breadcrumbs
        trail={[
          { name: "Compare", href: "/compare" },
          { name: `${a.name} vs ${b.name}`, href: `/compare/${pair.slug}` },
        ]}
      />
      <header className="page-head">
        <h1 className="pair-title">
          <span>
            <ProviderLogo provider={a.provider} size={26} />
            {a.name}
          </span>
          <span className="pair-title__vs">vs</span>
          <span>
            <ProviderLogo provider={b.provider} size={26} />
            {b.name}
          </span>
        </h1>
        <p className="page-meta">
          <span>Terminal-Bench, Epoch AI scores and cost per task</span>
          <span>
            Data checked{" "}
            <time dateTime={catalog.dataset.snapshotDate}>
              {formatFullDate(catalog.dataset.snapshotDate)}
            </time>
          </span>
          <a href="/compare">All comparisons</a>
        </p>
      </header>

      <section aria-labelledby="answer">
        <h2 id="answer" className="sr-only">
          Answer
        </h2>
        <p className="lead">
          {copy.lead}
          {ra && <Cite n={tbA} />}
          {rb && <Cite n={tbB} />}
          {!ra && !rb && (a.epoch.length > 0 || b.epoch.length > 0) && <Cite n={epoch} />}{" "}
          {copy.budget}
        </p>
      </section>

      {charted.length > 0 && (
        <CatalogChart
          releases={field}
          scale={catalog.chartScale}
          selectedSlug={charted[0]!.slug}
          compareSlug={charted[1]?.slug}
          caption={`${listOf(charted)} against every current model, one dot per model's Terminal-Bench run. The dashed line is the cost frontier: no model scores higher for less.`}
        />
      )}

      <section aria-labelledby="glance">
        <h2 id="glance">At a glance</h2>
        <p className="legend">
          <span className="mark mark--yes" aria-hidden="true">
            ✓
          </span>{" "}
          marks the better value in a row. Terminal-Bench gaps smaller than two tasks, and Epoch AI
          gaps inside the margin of error, count as level. Epoch AI rows show each model at its
          best setting.
        </p>
        <table className="facts">
          <caption className="sr-only">
            {a.name} and {b.name} compared
          </caption>
          <thead>
            <tr>
              <td />
              <th scope="col">{a.name}</th>
              <th scope="col">{b.name}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <FactCell cell={row.a} label={a.name} />
                <FactCell cell={row.b} label={b.name} />
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="choose-grid">
        {copy.choose.map(({ release, reasons }) => (
          <section key={release.slug} aria-labelledby={`choose-${release.slug}`}>
            <h2 id={`choose-${release.slug}`}>Choose {release.name} if…</h2>
            <ul>
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className="onward">
              <a href={`/models/${release.slug}`}>{release.name} benchmarks and pricing</a>
            </p>
          </section>
        ))}
      </div>

      <section aria-labelledby="related">
        <h2 id="related">Related comparisons</h2>
        {related(a).length > 0 && <PairList title={`More with ${a.name}`} pairs={related(a)} from={a} />}
        {related(b).length > 0 && <PairList title={`More with ${b.name}`} pairs={related(b)} from={b} />}
        {agentPage && (
          <p className="onward">
            In each lab&apos;s coding agent:{" "}
            <a href={`/agents/${agentPage.slug}`}>
              {agentPage.first.name} vs {agentPage.second.name}
            </a>
          </p>
        )}
      </section>

      <Questions items={copy.questions} />

      <Sources
        scope={
          <>
            Terminal-Bench results are each model&apos;s run on the official leaderboard: the agent
            attempts all {TERMINAL_BENCH.tasks} tasks at least five times, errored trials count as
            failures, and passing trials are checked for reward hacking. Each lab&apos;s run uses the
            agent and setting it was submitted with, and cost per task is what the run reported.
            Epoch AI&apos;s scores test each model alone, under CC BY 4.0. API prices come from
            LiteLLM&apos;s price list. Written by aicharts from data checked{" "}
            {formatFullDate(catalog.dataset.snapshotDate)}. Prices and scores change as labs update
            their models.
          </>
        }
        sources={sources}
      />

      <p className="page-action">
        <a href={`/?release=${a.slug}`}>Open {a.name} in the explorer</a>
      </p>
    </article>
  );
}

function listOf(releases: readonly ModelRelease[]): string {
  return releases.map((r) => r.name).join(" and ");
}
