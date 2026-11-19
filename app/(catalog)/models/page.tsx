import type { Metadata } from "next";
import { ProviderLogo } from "@/components/brand-icon";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { FrontierStars } from "@/components/frontier-stars";
import { pageMetadata } from "@/journal/content";
import { bestEffort, catalog, cheapestEffort, defaultEffort, effortName } from "@/lib/catalog";
import { formatFullDate, formatPrice, formatScore, formatUsd } from "@/lib/format";
import { PROVIDERS, type ModelRelease } from "@/lib/types";

export const metadata: Metadata = pageMetadata(
  "AI models: coding scores, cost per task and effort levels",
  `Every model release aicharts tracks from OpenAI, Anthropic and Google, with coding scores, cost per task and the frontier stars each effort setting earns. ${catalog.current.length} current, ${catalog.superseded.length} superseded.`,
  "/models",
);

function ModelTable({
  id,
  caption,
  releases,
  superseded = false,
}: Readonly<{ id: string; caption: string; releases: readonly ModelRelease[]; superseded?: boolean }>) {
  const live = catalog.liveFrontier("coding");
  return (
    <div className="table-scroll" role="region" aria-labelledby={id} tabIndex={0}>
      <table className="data-table model-table">
        <caption id={id}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Released</th>
            <th scope="col">Best coding</th>
            <th scope="col">Default effort</th>
            <th scope="col">Lowest cost</th>
            <th scope="col">Price per 1M</th>
            <th scope="col">{superseded ? "Replaced by" : "Frontier"}</th>
          </tr>
        </thead>
        <tbody>
          {releases.map((release) => {
            const best = bestEffort(release);
            const preset = defaultEffort(release);
            const cheapest = cheapestEffort(release);
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
                  {formatScore(best.scores.coding, "%")}
                  <span className="cell-note">{effortName(best.effortSlug)}</span>
                </td>
                <td>
                  {effortName(preset.effortSlug)}
                  <span className="cell-note">{formatUsd(preset.costUsdPerTask.total)}</span>
                </td>
                <td>
                  {formatUsd(cheapest.costUsdPerTask.total)}
                  <span className="cell-note">{effortName(cheapest.effortSlug)}</span>
                </td>
                <td>
                  {formatPrice(release.pricing.inputPer1M)}/{formatPrice(release.pricing.outputPer1M)}
                </td>
                <td>
                  {superseded ? (
                    next ? (
                      <a href={`/models/${next.slug}`}>{next.name}</a>
                    ) : (
                      "—"
                    )
                  ) : (
                    <FrontierStars efforts={live.get(release.slug) ?? []} size={9} />
                  )}
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
        measured at each effort setting it offers. Stars count the settings on the live cost
        frontier: for that spend per task, no current model scores higher on coding.
      </p>
      <section aria-labelledby="current">
        <h2 id="current">Current models</h2>
        <ModelTable
          id="current-caption"
          caption="Current releases, newest first. Best coding is the highest score across effort settings."
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
