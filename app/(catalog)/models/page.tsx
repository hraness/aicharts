import type { Metadata } from "next";
import { ProviderLogo } from "@/components/brand-icon";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { FrontierStar } from "@/components/frontier-stars";
import { pageMetadata } from "@/journal/content";
import { bestEpoch, catalog, effortName } from "@/lib/catalog";
import { formatFullDate, formatPrice, formatScore, formatUsd } from "@/lib/format";
import { PROVIDERS, type ModelRelease } from "@/lib/types";

export const metadata: Metadata = pageMetadata(
  "AI models: Terminal-Bench scores, cost per task and API prices",
  `Every model release aicharts tracks from OpenAI, Anthropic and Google, with Terminal-Bench scores, cost per task, Epoch AI scores and API prices. ${catalog.current.length} current, ${catalog.superseded.length} superseded.`,
  "/models",
);

function ModelTable({
  id,
  caption,
  releases,
  superseded = false,
}: Readonly<{ id: string; caption: string; releases: readonly ModelRelease[]; superseded?: boolean }>) {
  return (
    <div className="table-scroll" role="region" aria-labelledby={id} tabIndex={0}>
      <table className="data-table model-table">
        <caption id={id}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Released</th>
            <th scope="col">Terminal-Bench</th>
            <th scope="col">Cost per task</th>
            <th scope="col">MirrorCode</th>
            <th scope="col">Price per 1M</th>
            <th scope="col">{superseded ? "Replaced by" : "Frontier"}</th>
          </tr>
        </thead>
        <tbody>
          {releases.map((release) => {
            const run = release.terminalBench;
            const mirror = bestEpoch(release, "mirrorCode");
            const next = catalog.successorOf(release);
            return (
              <tr key={release.slug}>
                <th scope="row">
                  <a className="model-link" href={`/models/${release.slug}`}>
                    <ProviderLogo provider={release.provider} size={14} />
                    {release.name}
                  </a>
                </th>
                <td>
                  <time dateTime={release.releaseDate}>{formatFullDate(release.releaseDate)}</time>
                </td>
                <td>
                  {run ? formatScore(run.accuracy, "%") : "—"}
                  {run && <span className="cell-note">{run.agent}</span>}
                </td>
                <td>
                  {run?.costPerTaskUsd != null ? formatUsd(run.costPerTaskUsd) : "—"}
                </td>
                <td>
                  {mirror ? formatScore(mirror.score, "%") : "—"}
                  {mirror && <span className="cell-note">{effortName(mirror.effort)}</span>}
                </td>
                <td>
                  {release.pricing
                    ? `${formatPrice(release.pricing.inputPer1M)}/${formatPrice(release.pricing.outputPer1M)}`
                    : "—"}
                </td>
                <td>
                  {superseded ? (
                    next ? (
                      <a href={`/models/${next.slug}`}>{next.name}</a>
                    ) : (
                      "—"
                    )
                  ) : catalog.liveFrontier.has(release.slug) ? (
                    <FrontierStar size={9} />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ModelsPage() {
  const byLab = Object.values(PROVIDERS).map((lab) => ({
    lab,
    count: catalog.current.filter((r) => r.provider === lab.id).length,
  }));
  return (
    <article className="catalog-page">
      <Breadcrumbs trail={[{ name: "Models", href: "/models" }]} />
      <header className="page-head">
        <h1>Models</h1>
        <p className="page-meta">
          <span>
            {catalog.current.length} current · {catalog.superseded.length} superseded
          </span>
          <span>
            Data checked{" "}
            <time dateTime={catalog.dataset.snapshotDate}>
              {formatFullDate(catalog.dataset.snapshotDate)}
            </time>
          </span>
        </p>
      </header>
      <p className="lead">
        Every release from {byLab.map(({ lab, count }) => `${lab.name} (${count} current)`).join(", ")},
        with its run on the official Terminal-Bench leaderboard, Epoch AI&apos;s scores and its API
        price. A star marks a model on the live cost frontier: for its cost per task, no current
        model scores higher on Terminal-Bench.
      </p>
      <section aria-labelledby="current">
        <h2 id="current">Current models</h2>
        <ModelTable
          id="current-caption"
          caption="Current releases, newest first. MirrorCode is Epoch AI's best score for the model alone."
          releases={catalog.current}
        />
      </section>
      {catalog.superseded.length > 0 && (
        <section aria-labelledby="superseded">
          <h2 id="superseded">Superseded models</h2>
          <ModelTable
            id="superseded-caption"
            caption="Releases their lab has replaced. Their pages stay up for comparison."
            releases={catalog.superseded}
            superseded
          />
        </section>
      )}
      <p className="page-action">
        <a href="/compare">Compare two models</a>
      </p>
    </article>
  );
}
