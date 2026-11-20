import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { ChooseModelPair } from "@/components/catalog/choose-model-pair";
import { PairList } from "@/components/catalog/pair-list";
import { pageMetadata } from "@/journal/content";
import { catalog, isComparable, type ReleasePair } from "@/lib/catalog";
import { formatFullDate } from "@/lib/format";

// Only pairs with a result in common get listed; the rest have little to compare.
const pairs = catalog.pairs.filter(isComparable);

export const metadata: Metadata = pageMetadata(
  "AI Model Comparison | Compare Benchmark Scores and Cost",
  `${pairs.length} head-to-head comparisons of OpenAI, Anthropic and Google models: Terminal-Bench scores, cost per task, Epoch AI scores and API prices side by side.`,
  "/compare",
);

export default function ComparePage() {
  const current = pairs.filter((p) => p.current && p.relation !== "upgrade");
  const upgrades = pairs.filter((p) => p.relation === "upgrade");
  const earlier = pairs.filter((p) => !p.current && p.relation !== "upgrade");
  const eligible = new Set(current.flatMap(pair => [pair.first.slug, pair.second.slug]));
  const options = catalog.current.filter(model => eligible.has(model.slug)).map(({ slug, name }) => ({ slug, name }));
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
        <h1>AI model comparison</h1>
        <p className="page-meta">
          <span>{pairs.length} comparisons</span>
          <span>
            Data checked{" "}
            <time dateTime={catalog.dataset.snapshotDate}>
              {formatFullDate(catalog.dataset.snapshotDate)}
            </time>
          </span>
        </p>
      </header>
      <p className="lead">
        Each comparison puts two models on one chart and answers which passes more of
        Terminal-Bench for what it costs per task, with Epoch AI&apos;s scores and API prices beside
        them. Pages exist for every two models that were current at the same time and for each
        model against the one it replaced.
      </p>
      <ChooseModelPair models={options} pairs={current.map(pair => ({
        first: pair.first.slug, second: pair.second.slug, path: `/compare/${pair.slug}`,
      }))} />
      <p><a href="/benchmarks/terminal-bench">See the Terminal-Bench leaderboard</a></p>
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
