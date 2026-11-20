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
import {
  bestEffort,
  catalog,
  cheapestEffort,
  defaultEffort,
  effortName,
  effortsByLevel,
} from "@/lib/catalog";
import { agentPairs } from "@/lib/agents";
import { listNames, pairCopy } from "@/lib/copy";
import {
  formatContext,
  formatFullDate,
  formatPrice,
  formatScore,
  formatTokens,
  formatUsd,
} from "@/lib/format";
import {
  PROVIDERS,
  type BenchmarkId,
  type EffortPoint,
  type EffortSlug,
  type ModelRelease,
} from "@/lib/types";

type Params = Promise<{ pair: string }>;

export const dynamicParams = false;

export function generateStaticParams() {
  return catalog.pairs.map((p) => ({ pair: p.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const pair = catalog.findPair((await params).pair);
  if (!pair) return {};
  return pageMetadata(
    `${pair.first.name} vs ${pair.second.name}: coding scores and cost per task`,
    pairCopy(pair).description,
    `/compare/${pair.slug}`,
  );
}

type Row = Readonly<{ label: string; a: Cell; b: Cell }>;

const score = (e: EffortPoint, id: BenchmarkId) =>
  formatScore(e.scores[id], id === "intelligence" ? "pts" : "%");
const cost = (e: EffortPoint) => formatUsd(e.costUsdPerTask.total);

/** Marks the better side of a row; equal values mark neither. */
function better(a: number, b: number, higherWins: boolean, word: string): [string?, string?] {
  if (a === b) return [];
  return (a > b) === higherWins ? [word] : [undefined, word];
}

function benchmarkRow(label: string, id: BenchmarkId, a: ModelRelease, b: ModelRelease): Row {
  const ea = bestEffort(a, id);
  const eb = bestEffort(b, id);
  const [wa, wb] = better(ea.scores[id], eb.scores[id], true, "Higher");
  return {
    label,
    a: { value: score(ea, id), note: `${effortName(ea.effortSlug)} effort`, win: wa, cite: 1 },
    b: { value: score(eb, id), note: `${effortName(eb.effortSlug)} effort`, win: wb, cite: 2 },
  };
}

function agentCell(release: ModelRelease, cite: number | null): Cell {
  const runs = release.efforts.filter((e) => e.cliEval);
  const harness = PROVIDERS[release.provider].harness;
  if (runs.length === 0 || cite === null) return { value: harness, note: "Not measured" };
  const top = runs.reduce((x, y) =>
    y.cliEval!.codingAgentScore > x.cliEval!.codingAgentScore ? y : x,
  );
  return {
    value: harness,
    note: `${top.cliEval!.codingAgentScore.toFixed(1)} on the Coding Agent Index at ${effortName(top.effortSlug)}`,
    cite,
  };
}

export default async function ComparePairPage({ params }: { params: Params }) {
  const pair = catalog.findPair((await params).pair);
  if (!pair) notFound();
  const { first: a, second: b } = pair;
  const copy = pairCopy(pair);
  const labA = PROVIDERS[a.provider];
  const labB = PROVIDERS[b.provider];

  const sources: Source[] = [
    { name: `Artificial Analysis: ${a.name} evaluations`, url: a.benchmarkUrl },
    { name: `Artificial Analysis: ${b.name} evaluations`, url: b.benchmarkUrl },
    { name: `${labA.name}: ${a.name}`, url: a.announcementUrl },
    { name: `${labB.name}: ${b.name}`, url: b.announcementUrl },
  ];
  const measuredInAgent = [a, b].some((r) => r.efforts.some((e) => e.cliEval));
  // push() returns the new length, which is the 1-based citation number.
  const agentSource = measuredInAgent
    ? sources.push({
        name: "Artificial Analysis: Coding Agents",
        url: "https://artificialanalysis.ai/agents/coding-agents/",
      })
    : null;

  const [pa, pb] = [defaultEffort(a), defaultEffort(b)];
  const [ca, cb] = [cheapestEffort(a), cheapestEffort(b)];
  const status = (r: ModelRelease) =>
    r.supersededOn ? `Superseded ${formatFullDate(r.supersededOn)}` : "Current";
  const stars = (r: ModelRelease) => {
    if (r.deprecated) return { value: "Superseded" };
    const efforts = catalog.liveFrontier("coding").get(r.slug) ?? [];
    return efforts.length
      ? {
          value: "★".repeat(efforts.length),
          note: listNames(efforts.map((e) => effortName(e.effortSlug))),
        }
      : { value: "None" };
  };
  const [costWinA, costWinB] = better(ca.costUsdPerTask.total, cb.costUsdPerTask.total, false, "Lower");
  const [tokWinA, tokWinB] = better(
    pa.tokensPerTask.total,
    pb.tokensPerTask.total,
    false,
    "Fewer",
  );
  const [ctxWinA, ctxWinB] = better(
    a.pricing.contextWindowTokens,
    b.pricing.contextWindowTokens,
    true,
    "Larger",
  );
  const rows: Row[] = [
    {
      label: "Released",
      a: { value: formatFullDate(a.releaseDate), note: `${labA.name} · ${status(a)}`, cite: 3 },
      b: { value: formatFullDate(b.releaseDate), note: `${labB.name} · ${status(b)}`, cite: 4 },
    },
    benchmarkRow("Best coding score", "coding", a, b),
    {
      label: "Default effort",
      a: { value: effortName(pa.effortSlug), note: `${score(pa, "coding")} · ${cost(pa)} per task` },
      b: { value: effortName(pb.effortSlug), note: `${score(pb, "coding")} · ${cost(pb)} per task` },
    },
    {
      label: "Lowest cost per task",
      a: { value: cost(ca), note: `${effortName(ca.effortSlug)} · ${score(ca, "coding")}`, win: costWinA, cite: 1 },
      b: { value: cost(cb), note: `${effortName(cb.effortSlug)} · ${score(cb, "coding")}`, win: costWinB, cite: 2 },
    },
    benchmarkRow("Terminal-Bench 4.0", "terminalBench4", a, b),
    benchmarkRow("FrontierCode 2.0", "frontierCode2", a, b),
    benchmarkRow("Intelligence Index", "intelligence", a, b),
    {
      label: "Output tokens per task",
      a: { value: formatTokens(pa.tokensPerTask.total), note: `At ${effortName(pa.effortSlug)}`, win: tokWinA, cite: 1 },
      b: { value: formatTokens(pb.tokensPerTask.total), note: `At ${effortName(pb.effortSlug)}`, win: tokWinB, cite: 2 },
    },
    {
      label: "API price",
      a: {
        value: `${formatPrice(a.pricing.inputPer1M)}/${formatPrice(a.pricing.outputPer1M)}`,
        note: "Per 1M input/output tokens",
        cite: 1,
      },
      b: {
        value: `${formatPrice(b.pricing.inputPer1M)}/${formatPrice(b.pricing.outputPer1M)}`,
        note: "Per 1M input/output tokens",
        cite: 2,
      },
    },
    {
      label: "Context window",
      a: { value: `${formatContext(a.pricing.contextWindowTokens)} tokens`, win: ctxWinA, cite: 1 },
      b: { value: `${formatContext(b.pricing.contextWindowTokens)} tokens`, win: ctxWinB, cite: 2 },
    },
    {
      label: "Frontier stars",
      a: stars(a),
      b: stars(b),
    },
    {
      label: "Own coding agent",
      a: agentCell(a, agentSource),
      b: agentCell(b, agentSource),
    },
  ];

  const agentPage = agentPairs().find(
    (p) =>
      a.provider !== b.provider &&
      [p.first.provider, p.second.provider].sort().join() === [a.provider, b.provider].sort().join(),
  );
  const levels = [...new Set([...effortsByLevel(a), ...effortsByLevel(b)]
    .sort((x, y) => x.effortLevel - y.effortLevel)
    .map((e) => e.effortSlug))] as EffortSlug[];
  const related = (r: ModelRelease) =>
    catalog
      .pairsFor(r)
      .filter((p) => p.slug !== pair.slug)
      .slice(0, 6);

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
          <span>Coding scores and cost per task at every effort setting</span>
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
          <Cite n={1} />
          <Cite n={2} /> {copy.budget}
        </p>
      </section>

      <CatalogChart
        releases={[a, b]}
        scale={catalog.chartScale}
        selectedSlug={a.slug}
        compareSlug={b.slug}
        caption={`Each point is one effort setting. The dashed grey line is the cost frontier of the two models: whichever owns it at a budget gives the higher score for that spend.`}
      />

      <section aria-labelledby="glance">
        <h2 id="glance">At a glance</h2>
        <p className="legend">
          <span className="mark mark--yes" aria-hidden="true">
            ✓
          </span>{" "}
          marks the better value in a row. Benchmark rows show each model at its best setting.
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

      <section aria-labelledby="by-effort">
        <h2 id="by-effort">Effort by effort</h2>
        <div className="table-scroll" role="region" aria-labelledby="by-effort-caption" tabIndex={0}>
          <table className="data-table">
            <caption id="by-effort-caption">
              Coding score and cost per task at each setting either model offers.
              <Cite n={1} />
              <Cite n={2} />
            </caption>
            <thead>
              <tr>
                <th scope="col">Effort</th>
                <th scope="col">{a.name}</th>
                <th scope="col">Cost</th>
                <th scope="col">{b.name}</th>
                <th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((slug) => {
                const ea = a.efforts.find((e) => e.effortSlug === slug);
                const eb = b.efforts.find((e) => e.effortSlug === slug);
                return (
                  <tr key={slug}>
                    <th scope="row">{effortName(slug)}</th>
                    <td>{ea ? score(ea, "coding") : "—"}</td>
                    <td>{ea ? cost(ea) : "—"}</td>
                    <td>{eb ? score(eb, "coding") : "—"}</td>
                    <td>{eb ? cost(eb) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
            Both models are measured on the same Artificial Analysis tasks at each effort setting
            they offer; the coding composite is the mean of FrontierCode 2.0 and Terminal-Bench 4.0,
            and cost per task is the API bill for one task at list prices. Written by aicharts from
            data checked {formatFullDate(catalog.dataset.snapshotDate)}. Prices and scores change as
            labs update their models.
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
