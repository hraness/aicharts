import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProviderLogo } from "@/components/brand-icon";
import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { Questions } from "@/components/catalog/questions";
import { Cite, Sources } from "@/components/catalog/sources";
import { pageMetadata } from "@/journal/content";
import {
  catalog,
  EFFORT_NAMES,
  effortStepRows,
  publishedEffortSteps,
} from "@/lib/catalog";
import { effortStepCopy, effortStepTitle, orderedEffortSteps } from "@/lib/copy";
import { formatDelta, formatFullDate, formatRatio, formatScore, formatUsd } from "@/lib/format";

type Params = Promise<{ step: string }>;

export const dynamicParams = false;

const published = () => publishedEffortSteps(catalog.releases);

export function generateStaticParams() {
  return published().map((step) => ({ step: step.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = (await params).step;
  const step = published().find((s) => s.slug === slug);
  if (!step) return {};
  const copy = effortStepCopy(step);
  return pageMetadata(
    `${copy.title} effort: score gain and cost for every model`,
    copy.description,
    `/effort/${step.slug}`,
  );
}

export default async function EffortStepPage({ params }: { params: Params }) {
  const slug = (await params).step;
  const step = published().find((s) => s.slug === slug);
  if (!step) notFound();
  const copy = effortStepCopy(step);
  const rows = effortStepRows(step, catalog.releases);
  const hi = EFFORT_NAMES[step.higher];
  const lo = EFFORT_NAMES[step.lower];
  const others = orderedEffortSteps(published()).filter((s) => s.slug !== step.slug);

  return (
    <article className="catalog-page">
      <Breadcrumbs
        trail={[
          { name: "Effort levels", href: "/effort" },
          { name: copy.title, href: `/effort/${step.slug}` },
        ]}
      />
      <header className="page-head">
        <h1>{copy.title} effort</h1>
        <p className="page-meta">
          <span>{rows.length} models measured at both</span>
          <span>
            Data checked{" "}
            <time dateTime={catalog.dataset.snapshotDate}>
              {formatFullDate(catalog.dataset.snapshotDate)}
            </time>
          </span>
          <a href="/effort">All effort levels</a>
        </p>
      </header>
      <p className="lead">
        {copy.lead}
        <Cite n={1} />
      </p>

      <section aria-labelledby="by-lab">
        <h2 id="by-lab">By lab</h2>
        <ul className="lab-list">
          {copy.byLab.map((item) => (
            <li key={item.provider}>
              <ProviderLogo provider={item.provider} size={14} />
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="models">
        <h2 id="models">Model by model</h2>
        <div className="table-scroll" role="region" aria-labelledby="models-caption" tabIndex={0}>
          <table className="data-table">
            <caption id="models-caption">
              Coding score and cost per task at {lo} and {hi}, with the change on each benchmark.
              Biggest coding gain first.
              <Cite n={1} />
            </caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">{lo}</th>
                <th scope="col">{hi}</th>
                <th scope="col">Coding</th>
                <th scope="col">Terminal-Bench</th>
                <th scope="col">FrontierCode</th>
                <th scope="col">Intelligence</th>
                <th scope="col">Cost</th>
                <th scope="col">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.release.slug} className={row.scoreDelta.coding < 0 ? "is-drop" : undefined}>
                  <th scope="row">
                    <a className="model-link" href={`/models/${row.release.slug}`}>
                      <ProviderLogo provider={row.release.provider} size={14} />
                      {row.release.name}
                    </a>
                    {row.release.deprecated && <span className="tag">superseded</span>}
                  </th>
                  <td>
                    {formatScore(row.lower.scores.coding, "%")}
                    <span className="cell-note">{formatUsd(row.lower.costUsdPerTask.total)}</span>
                  </td>
                  <td>
                    {formatScore(row.higher.scores.coding, "%")}
                    <span className="cell-note">{formatUsd(row.higher.costUsdPerTask.total)}</span>
                  </td>
                  <td>{formatDelta(row.scoreDelta.coding)}</td>
                  <td>{formatDelta(row.scoreDelta.terminalBench4)}</td>
                  <td>{formatDelta(row.scoreDelta.frontierCode2)}</td>
                  <td>{formatDelta(row.scoreDelta.intelligence)}</td>
                  <td>{formatRatio(row.costRatio)}</td>
                  <td>{formatRatio(row.tokenRatio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {others.length > 0 && (
        <section aria-labelledby="other-steps">
          <h2 id="other-steps">Other steps</h2>
          <ul className="pair-links">
            {others.map((other) => (
              <li key={other.slug}>
                <a href={`/effort/${other.slug}`}>{effortStepTitle(other)}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Questions items={copy.questions} />

      <Sources
        scope={
          <>
            Each row is one model run by Artificial Analysis at both settings on the same tasks;
            the coding composite is the mean of FrontierCode 2.0 and Terminal-Bench 4.0. Medians
            cover current and superseded models. Written by aicharts from data checked{" "}
            {formatFullDate(catalog.dataset.snapshotDate)}.
          </>
        }
        sources={catalog.dataset.sources.slice(0, 1).map((s) => ({ name: s.name, url: s.url }))}
      />
    </article>
  );
}
