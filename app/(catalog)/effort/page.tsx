import type { Metadata } from "next";
import { ProviderLogo } from "@/components/brand-icon";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { Questions } from "@/components/catalog/questions";
import { Cite, Sources } from "@/components/catalog/sources";
import { pageMetadata } from "@/journal/content";
import {
  bestEffort,
  catalog,
  defaultEffort,
  efficientEffort,
  effortName,
  effortsByLevel,
  effortStepRows,
  LAB_SETTING_NAMES,
  publishedEffortSteps,
  summarizeEffortStep,
} from "@/lib/catalog";
import { effortHubCopy, effortStepTitle, orderedEffortSteps } from "@/lib/copy";
import { formatDelta, formatFullDate, formatRatio, formatScore, formatUsd } from "@/lib/format";
import { PROVIDERS, type EffortPoint, type EffortSlug, type ProviderId } from "@/lib/types";

const copy = effortHubCopy();

export const metadata: Metadata = pageMetadata(
  "AI effort levels compared: what Low to Max costs on coding",
  copy.description,
  "/effort",
);

const cell = (e: EffortPoint) =>
  `${formatScore(e.scores.coding, "%")} · ${formatUsd(e.costUsdPerTask.total)}`;

export default function EffortPage() {
  const steps = orderedEffortSteps(publishedEffortSteps(catalog.releases)).map((step) => ({
    step,
    summary: summarizeEffortStep(effortStepRows(step, catalog.releases)),
  }));
  const labs = (Object.keys(PROVIDERS) as ProviderId[]).map((provider) => {
    const releases = catalog.current.filter((r) => r.provider === provider);
    const offered = new Set<EffortSlug>();
    const defaults = new Map<EffortSlug, number>();
    for (const release of releases) {
      for (const e of effortsByLevel(release)) offered.add(e.effortSlug);
      const slug = defaultEffort(release).effortSlug;
      defaults.set(slug, (defaults.get(slug) ?? 0) + 1);
    }
    const levels = catalog.releases
      .flatMap((r) => r.efforts)
      .sort((a, b) => a.effortLevel - b.effortLevel)
      .map((e) => e.effortSlug)
      .filter((slug, i, all) => offered.has(slug) && all.indexOf(slug) === i);
    return { provider, releases, levels, defaults: [...defaults.entries()].sort((a, b) => b[1] - a[1]) };
  });

  return (
    <article className="catalog-page">
      <Breadcrumbs trail={[{ name: "Effort levels", href: "/effort" }]} />
      <header className="page-head">
        <h1>Effort levels</h1>
        <p className="page-meta">
          <span>{catalog.releases.length} models, every setting measured</span>
          <span>
            Data checked{" "}
            <time dateTime={catalog.dataset.snapshotDate}>
              {formatFullDate(catalog.dataset.snapshotDate)}
            </time>
          </span>
        </p>
      </header>
      <p className="lead">
        {copy.lead}
        <Cite n={1} />
      </p>

      <section aria-labelledby="steps">
        <h2 id="steps">What each step up buys</h2>
        <div className="table-scroll" role="region" aria-labelledby="steps-caption" tabIndex={0}>
          <table className="data-table">
            <caption id="steps-caption">
              Median change on the coding composite for models measured at both settings.
              <Cite n={1} />
            </caption>
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Models</th>
                <th scope="col">Coding gain</th>
                <th scope="col">Cost per task</th>
                <th scope="col">Output tokens</th>
                <th scope="col">Scored lower</th>
              </tr>
            </thead>
            <tbody>
              {steps.map(({ step, summary }) => (
                <tr key={step.slug}>
                  <th scope="row">
                    <a href={`/effort/${step.slug}`}>{effortStepTitle(step)}</a>
                  </th>
                  <td>{summary.count}</td>
                  <td>{formatDelta(summary.medianDelta.coding)}</td>
                  <td>{formatRatio(summary.medianCostRatio)}</td>
                  <td>{formatRatio(summary.medianTokenRatio)}</td>
                  <td>{summary.drops.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="labs">
        <h2 id="labs">What each lab calls it</h2>
        <div className="table-scroll" role="region" aria-labelledby="labs-caption" tabIndex={0}>
          <table className="data-table">
            <caption id="labs-caption">Settings offered by each lab&apos;s current models.</caption>
            <thead>
              <tr>
                <th scope="col">Lab</th>
                <th scope="col">Setting</th>
                <th scope="col">Coding agent</th>
                <th scope="col">Levels</th>
                <th scope="col">Default</th>
              </tr>
            </thead>
            <tbody>
              {labs.map(({ provider, levels, defaults }) => (
                <tr key={provider}>
                  <th scope="row">
                    <span className="model-link">
                      <ProviderLogo provider={provider} size={14} />
                      {PROVIDERS[provider].name}
                    </span>
                  </th>
                  <td>{LAB_SETTING_NAMES[provider]}</td>
                  <td>{PROVIDERS[provider].harness}</td>
                  <td>{levels.map(effortName).join(", ")}</td>
                  <td>
                    {defaults
                      .map(([slug, n]) => `${effortName(slug)} (${n})`)
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="defaults">
        <h2 id="defaults">Each model&apos;s default and better buy</h2>
        <div className="table-scroll" role="region" aria-labelledby="defaults-caption" tabIndex={0}>
          <table className="data-table">
            <caption id="defaults-caption">
              Coding score and cost per task. The better buy is the cheapest setting within a point
              of the model&apos;s best.
              <Cite n={1} />
            </caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Default</th>
                <th scope="col">Best</th>
                <th scope="col">Better buy</th>
              </tr>
            </thead>
            <tbody>
              {catalog.current.map((release) => {
                const preset = defaultEffort(release);
                const best = bestEffort(release);
                const buy = efficientEffort(release);
                return (
                  <tr key={release.slug}>
                    <th scope="row">
                      <a className="model-link" href={`/models/${release.slug}`}>
                        <ProviderLogo provider={release.provider} size={14} />
                        {release.name}
                      </a>
                    </th>
                    <td>
                      {effortName(preset.effortSlug)}
                      <span className="cell-note">{cell(preset)}</span>
                    </td>
                    <td>
                      {effortName(best.effortSlug)}
                      <span className="cell-note">{cell(best)}</span>
                    </td>
                    <td>
                      {effortName(buy.effortSlug)}
                      <span className="cell-note">{cell(buy)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Questions items={copy.questions} />

      <Sources
        scope={
          <>
            Artificial Analysis runs each model at every effort setting its lab offers, on the same
            tasks; the coding composite is the mean of FrontierCode 2.0 and Terminal-Bench 4.0.
            Medians cover current and superseded models. Written by aicharts from data checked{" "}
            {formatFullDate(catalog.dataset.snapshotDate)}.
          </>
        }
        sources={catalog.dataset.sources.slice(0, 1).map((s) => ({ name: s.name, url: s.url }))}
      />
    </article>
  );
}
