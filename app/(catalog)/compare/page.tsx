import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { PairList } from "@/components/catalog/pair-list";
import { pageMetadata } from "@/journal/content";
import { catalog, type ReleasePair } from "@/lib/catalog";
import { formatFullDate } from "@/lib/format";

export const metadata: Metadata = pageMetadata(
  "Compare AI models: coding score against cost per task",
  `${catalog.pairs.length} head-to-head comparisons of OpenAI, Anthropic and Google models: coding scores, cost per task and both effort curves on one chart.`,
  "/compare",
);

export default function ComparePage() {
  const current = catalog.pairs.filter((p) => p.current && p.relation !== "upgrade");
  const upgrades = catalog.pairs.filter((p) => p.relation === "upgrade");
  const earlier = catalog.pairs.filter((p) => !p.current && p.relation !== "upgrade");
  const groups = new Map<string, ReleasePair[]>();
  for (const pair of current) {
    const list = groups.get(pair.first.slug) ?? [];
    list.push(pair);
    groups.set(pair.first.slug, list);
  }
  return (
    <article className="catalog-page">
      <Breadcrumbs trail={[{ name: "Compare", href: "/compare" }]} />
      <header className="page-head">
        <h1>Compare models</h1>
        <p className="page-meta">
          <span>{catalog.pairs.length} comparisons</span>
          <span>
            Data checked{" "}
            <time dateTime={catalog.dataset.snapshotDate}>
              {formatFullDate(catalog.dataset.snapshotDate)}
            </time>
          </span>
        </p>
      </header>
      <p className="lead">
        Each comparison puts two models&apos; effort curves on one chart and answers which scores
        higher on coding for what it costs per task. Pages exist for every two models that were
        current at the same time and for each model against the one it replaced.
      </p>
      <section aria-labelledby="current-pairs">
        <h2 id="current-pairs">Current models</h2>
        <div className="pair-columns">
          {[...groups.values()].map((pairs) => (
            <PairList key={pairs[0]!.first.slug} title={pairs[0]!.first.name} pairs={pairs} from={pairs[0]!.first} />
          ))}
        </div>
      </section>
      {upgrades.length > 0 && (
        <section aria-labelledby="upgrades">
          <h2 id="upgrades">Upgrades</h2>
          <p>Each model against the release that replaced it.</p>
          <PairList title="New against old" pairs={upgrades} />
        </section>
      )}
      {earlier.length > 0 && (
        <section aria-labelledby="earlier">
          <h2 id="earlier">Earlier matchups</h2>
          <p>Models that were current together before one was superseded.</p>
          <PairList title="Superseded on one side" pairs={earlier} />
        </section>
      )}
    </article>
  );
}
