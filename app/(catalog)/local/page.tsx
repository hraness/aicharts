import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import benchmarks from "@/data/local-benchmarks.json";
import { pageMetadata } from "@/journal/content";
import "./local.css";

export const metadata = pageMetadata(
  "Local AI benchmarks by workload",
  "Compare published quality scores for local language, embedding, image, transcription, speech synthesis and vision models.",
  "/local",
);

export default function LocalBenchmarksPage() {
  return (
    <article className="catalog-page">
      <Breadcrumbs trail={[{ name: "Local benchmarks", href: "/local" }]} />
      <header className="page-head"><h1>Local AI benchmarks</h1></header>
      <p className="lead">Compare models you can run locally. Each chart uses one published evaluation and its scoring scale.</p>
      <div className="local-charts">
        {benchmarks.workloads.map((group) => (
          <section key={group.name}>
            <h2>{group.name}</h2>
            <p><strong>{group.metric}</strong> · {group.lowerIsBetter ? "Lower" : "Higher"} is better</p>
            <ol aria-label={group.metric}>
              {group.models.map((model) => (
                <li key={model.name}>
                  <span>{model.name}</span><strong>{model.score}{group.unit}</strong>
                  <div className="local-track" aria-hidden="true"><i style={{ width: (100 * model.score / group.maximum) + "%" }} /></div>
                </li>
              ))}
            </ol>
            <p>{group.description}</p>
            <a href={group.source}>{group.publisher}</a>
          </section>
        ))}
      </div>
      <p><a href="/api/local">Download scores and sources (JSON)</a></p>
    </article>
  );
}
