import { GptSubsidyChart } from "@/components/gpt-subsidy-chart";
import { Breadcrumbs } from "@/components/ui";
import gptSubsidyData from "@/data/gpt-subsidy.json";
import {
  formatSubsidyDate,
  formatSubsidyDateTime,
  formatSubsidyMultiple,
  formatSubsidyUsd,
  GPT_SUBSIDY_DESCRIPTION,
  GPT_SUBSIDY_TITLE,
  latestGptSubsidyObservation,
  parseGptSubsidySnapshot,
  type GptSubsidySnapshot,
} from "@/lib/gpt-subsidy-data";
import {
  absoluteWebUrl,
  createPublicSiteMetadata,
} from "@hraness/web-discovery";
import { JsonLdScript } from "@hraness/web-discovery/json-ld";
import type { Metadata } from "next";

import { searchSite, site } from "../site";

const canonicalPath = "/gpt-subsidy" as const;
const socialImagePath = "/gpt-subsidy/opengraph-image" as const;

const subsidySearchSite = {
  ...searchSite,
  description: GPT_SUBSIDY_DESCRIPTION,
  socialImage: {
    alt: GPT_SUBSIDY_TITLE + " historical chart",
    path: socialImagePath,
  },
  socialTitle: GPT_SUBSIDY_TITLE + " | AI Charts",
  title: GPT_SUBSIDY_TITLE + " | AI Charts",
} as const;

export const metadata: Metadata = createPublicSiteMetadata(
  subsidySearchSite,
  { canonicalPath },
);

function checkedSnapshot(): GptSubsidySnapshot {
  const input: unknown = gptSubsidyData;
  const parsed = parseGptSubsidySnapshot(input);
  if (!parsed.ok) {
    throw new Error(
      "Checked GPT subsidy snapshot is invalid: " + parsed.error.message,
      { cause: parsed.error },
    );
  }
  return parsed.value;
}

function subsidyDatasetJsonLd(snapshot: GptSubsidySnapshot) {
  const url = absoluteWebUrl(searchSite.origin, canonicalPath);
  const first = snapshot.observations[0];
  const last = snapshot.observations.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("A checked GPT subsidy snapshot must contain observations");
  }

  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": url + "#dataset",
    url,
    name: snapshot.title,
    description: GPT_SUBSIDY_DESCRIPTION,
    creator: {
      "@type": "Organization",
      name: site.name,
      url: searchSite.origin,
    },
    dateModified: snapshot.generatedAt,
    temporalCoverage: first.periodStartedAt + "/" + last.periodEndsAt,
    inLanguage: "en-US",
    isAccessibleForFree: true,
    measurementTechnique: snapshot.methodology.formula,
    variableMeasured: [
      "Monthly API-retail-equivalent value",
      "API-retail-equivalent multiple of the ChatGPT Pro monthly price",
      "Globally deduplicated Codex task token use",
    ],
    citation: Array.from(new Set([
      snapshot.plan.sourceUrl,
      snapshot.pricing.manifest.sourceUrl,
      snapshot.pricing.referenceModel.sourceUrl,
      ...snapshot.methodology.sourceUrls,
    ])),
  } as const;
}

export default function GptSubsidyPage() {
  const snapshot = checkedSnapshot();
  const latest = latestGptSubsidyObservation(snapshot);
  const first = snapshot.observations[0];
  if (first === undefined) {
    throw new Error("A checked GPT subsidy snapshot must contain observations");
  }

  const sourceUrls = Array.from(new Set([
    snapshot.plan.sourceUrl,
    snapshot.pricing.manifest.sourceUrl,
    snapshot.pricing.referenceModel.sourceUrl,
    ...snapshot.methodology.sourceUrls,
  ]));

  return (
    <main id="gpt-subsidy-content">
      <JsonLdScript
        data={subsidyDatasetJsonLd(snapshot)}
        id="aicharts-gpt-subsidy-structured-data"
      />

      <header className="plain-publication__article-header plain-publication__shell">
        <Breadcrumbs
          aria-label="Breadcrumb"
          className="plain-publication__breadcrumbs"
          items={[
            { href: "/", id: "aicharts", label: "AI Charts" },
            { id: "gpt-subsidy", label: "GPT subsidy" },
          ]}
        />
        <h1>{snapshot.title}</h1>
        <p className="plain-publication__article-dek">
          {GPT_SUBSIDY_DESCRIPTION} The 20x label names the plan&apos;s advertised
          usage tier; it is separate from the calculated API-equivalent multiple.
        </p>
        <p className="plain-publication__article-meta">
          <span>{snapshot.observations.length} observations from </span>
          <time dateTime={first.observedAt}>
            {formatSubsidyDate(first.observedAt)}
          </time>
          <span> to </span>
          <time dateTime={latest.observedAt}>
            {formatSubsidyDate(latest.observedAt)}
          </time>
          <span aria-hidden="true"> · </span>
          <span>Updated </span>
          <time dateTime={snapshot.generatedAt}>
            {formatSubsidyDateTime(snapshot.generatedAt)}
          </time>
        </p>
      </header>

      <aside className="gpt-subsidy-account-limit plain-publication__shell">
        <strong>One user&apos;s available local logs on one machine</strong>
        <p>
          This is not a platform-wide or representative ChatGPT Pro estimate.
          Codex logs do not retain a durable account ID or billing mode and
          cannot distinguish plan allowance from API-key or otherwise
          API-billed usage, purchased ChatGPT credits, free or reset credits,
          or temporary promotions. Historical account switches and usage across
          multiple subscriptions also cannot be excluded.
        </p>
      </aside>

      <section
        aria-labelledby="latest-subsidy-observation"
        className="gpt-subsidy-latest plain-publication__shell"
      >
        <h2 id="latest-subsidy-observation">Latest observation</h2>
        <dl>
          <div>
            <dt>Monthly plan-price multiple</dt>
            <dd className="gpt-subsidy-stat-value">
              {formatSubsidyMultiple(latest.planPriceMultiple)}
            </dd>
            <dd className="gpt-subsidy-stat-detail">
              Derived from seven settled UTC days
            </dd>
          </div>
          <div>
            <dt>Monthly API-price estimate</dt>
            <dd className="gpt-subsidy-stat-value">
              {formatSubsidyUsd(latest.monthlyApiEquivalentUsd)}
            </dd>
            <dd className="gpt-subsidy-stat-detail">
              Trailing week × {snapshot.methodology.weeksPerMonth}
            </dd>
          </div>
          <div>
            <dt>{snapshot.periodSummary.days}-day measured total</dt>
            <dd className="gpt-subsidy-stat-value">
              {formatSubsidyUsd(snapshot.periodSummary.apiEquivalentUsd)}
            </dd>
            <dd className="gpt-subsidy-stat-detail">
              <time dateTime={snapshot.periodSummary.startedAt}>
                {formatSubsidyDate(snapshot.periodSummary.startedAt)}
              </time>
              {" – "}
              <time dateTime={snapshot.periodSummary.endedAt}>
                {formatSubsidyDate(snapshot.periodSummary.endedAt)}
              </time>
              {" · "}
              {formatSubsidyMultiple(snapshot.periodSummary.planPriceMultiple)} of one
              $200 plan-price unit
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="subsidy-history"
        className="gpt-subsidy-history plain-publication__shell"
      >
        <div className="gpt-subsidy-section-heading">
          <h2 id="subsidy-history">Historical multiple</h2>
          <p>
            Each daily point sums the preceding seven complete UTC days of measured local
            Codex usage, values each recorded model call with its model-specific
            API-price estimate, and converts that realized weekly pace to a
            monthly $200 multiple.
          </p>
        </div>
        <GptSubsidyChart snapshot={snapshot} />
      </section>

      <div className="gpt-subsidy-method plain-publication__shell">
        <article className="plain-publication__article-body">
          <h2 id="calculation">Calculation</h2>
          <p>
            The collector reads all local Codex task logs, including child
            agents, and globally deduplicates replayed cumulative token events
            into daily buckets. Cached input is a subset of input and reasoning
            tokens are a subset of output, so neither is counted twice.
          </p>
          <p>
            Each recorded token event is assigned its model-specific API-price
            estimate from the checked OpenAI rate manifest, frozen{" "}
            <time dateTime={snapshot.pricing.manifest.frozenAt}>
              {formatSubsidyDate(snapshot.pricing.manifest.frozenAt)}
            </time>
            {" "}(SHA-256{" "}
            <code>{snapshot.pricing.manifest.sha256.slice(0, 12)}</code>). The
            chart sums each day&apos;s priced usage across the trailing seven days.
            That realized weekly value is multiplied by{" "}
            {snapshot.methodology.weeksPerMonth} weeks per month and divided by
            the {formatSubsidyUsd(snapshot.plan.monthlyPriceUsd)} plan-price unit.
          </p>
          <p>
            Measurement revision <code>{snapshot.methodology.measurement.revision}</code>{" "}
            pins the parser, adapter, rolling-window math, and updater source.
            A changed measurement manifest requires the retained series to be
            recomputed before publication.
          </p>
          <p>
            No per-refill projection is published. Active-account quota
            telemetry cannot be joined reliably to historical session usage
            across possible authentication, subscription, or credit-source
            changes.
          </p>

          <aside className="plain-publication__callout">
            <strong>What “subsidy” means here</strong>
            <p>{snapshot.methodology.disclaimer}</p>
          </aside>

          <h2 id="interpretation">Interpretation and limits</h2>
          <ul>
            <li>
              The session directory does not preserve a durable account ID.
              Historical account switches, multiple subscriptions, and
              API-key or otherwise API-billed Codex usage cannot be ruled out.
            </li>
            <li>
              Local logs cannot distinguish plan allowance from API billing,
              purchased ChatGPT credits, free or reset credits, or temporary
              promotions.
            </li>
            <li>
              The historical line shows realized local usage pace. It does not
              reconstruct allowance resets or prove how much usage one
              subscription supplied.
            </li>
            <li>
              Every point uses seven complete UTC days; open current-day usage
              is excluded until the next settled bucket.
            </li>
            <li>
              The scheduled collector&apos;s own small Codex token use is included
              in the next settled bucket.
            </li>
            <li>
              The checked manifest provides model-specific API-price estimates.
              An unknown recorded model blocks publication. Unrecorded or
              non-token product operations are excluded.
            </li>
            <li>
              <code>codex-auto-review</code> is an internal alias. Its manifest
              proxy is an estimate, not a published first-party API rate.
            </li>
          </ul>
        </article>

        <section
          aria-labelledby="subsidy-sources"
          className="plain-publication__sources"
        >
          <h2 id="subsidy-sources">Sources</h2>
          <ol>
            {sourceUrls.map((url, index) => (
              <li key={url}>
                <a href={url}>
                  {index === 0
                    ? "ChatGPT Pro plan source"
                    : url}
                </a>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
