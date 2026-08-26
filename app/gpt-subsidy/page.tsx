import { GptSubsidyChart } from "@/components/gpt-subsidy-chart";
import gptSubsidyData from "@/data/gpt-subsidy.json";
import {
  formatSubsidyDate,
  formatSubsidyDateTime,
  formatSubsidyUsd,
  GPT_SUBSIDY_DESCRIPTION,
  GPT_SUBSIDY_TITLE,
  gptSubsidyPageModifiedAt,
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
    dateModified: gptSubsidyPageModifiedAt(snapshot),
    temporalCoverage: first.periodStartedAt + "/" + last.periodEndsAt,
    inLanguage: "en-US",
    isAccessibleForFree: true,
    measurementTechnique: snapshot.methodology.formula,
    variableMeasured: [
      "Trailing-seven-day API-retail-equivalent value",
      "Trailing-31-day API-retail-equivalent value",
      "Globally deduplicated Codex task token use",
      "Account-attribution coverage",
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

      <header className="gpt-subsidy-hero plain-publication__article-header plain-publication__shell">
        <h1>ChatGPT Subsidy Chart</h1>
        <p className="plain-publication__article-meta">
          <span>{snapshot.observations.length} observations</span>
          <span>·</span>
          <time dateTime={first.observedAt}>
            {formatSubsidyDate(first.observedAt)}
          </time>
          <span>–</span>
          <time dateTime={latest.observedAt}>
            {formatSubsidyDate(latest.observedAt)}
          </time>
          <span>· Updated</span>
          <time dateTime={snapshot.generatedAt}>
            {formatSubsidyDateTime(snapshot.generatedAt)}
          </time>
        </p>
      </header>

      <section
        aria-label="Current API-equivalent values"
        className="gpt-subsidy-summary plain-publication__shell"
      >
        <div className="gpt-subsidy-summary__metric gpt-subsidy-summary__primary">
          <h2>Trailing 7 days</h2>
          <p className="gpt-subsidy-summary__value">
            {formatSubsidyUsd(latest.trailingSevenDayApiEquivalentUsd)}
          </p>
        </div>
        <div className="gpt-subsidy-summary__metric gpt-subsidy-summary__context">
          <h2>Trailing {snapshot.periodSummary.days} days</h2>
          <p className="gpt-subsidy-summary__value">
            {formatSubsidyUsd(snapshot.periodSummary.apiEquivalentUsd)}
          </p>
          <p className="gpt-subsidy-summary__period">
            <time dateTime={snapshot.periodSummary.startedAt}>
              {formatSubsidyDate(snapshot.periodSummary.startedAt)}
            </time>
            {" – "}
            <time dateTime={snapshot.periodSummary.endedAt}>
              {formatSubsidyDate(snapshot.periodSummary.endedAt)}
            </time>
          </p>
        </div>
      </section>

      <section
        aria-label="Trailing seven-day API-equivalent value history"
        className="gpt-subsidy-history plain-publication__shell"
      >
        <GptSubsidyChart snapshot={snapshot} />
      </section>

      <section
        aria-label="About the subsidy chart"
        className="gpt-subsidy-method plain-publication__shell"
      >
        <details className="gpt-subsidy-disclosure gpt-subsidy-method__details">
          <summary>About this chart</summary>
          <div className="gpt-subsidy-disclosure__body">
            <article className="plain-publication__article-body">
              <h2 id="calculation">Calculation</h2>
              <p>{GPT_SUBSIDY_DESCRIPTION}</p>
              <p>
                Available local Codex task logs, including child agents, are
                deduplicated into daily token buckets and repriced with
                model-specific API-price estimates from the checked manifest.
                Each point sums seven settled days. No monthly projection or
                one-plan normalization is applied.
              </p>
              <p className="gpt-subsidy-method__boundary">
                The line is measured local usage. It is not an allowance ledger
                or a per-subscription subsidy multiple.
              </p>
              <p className="gpt-subsidy-summary__scope">
                <strong>Subscription-adjusted multiple unavailable.</strong>{" "}
                Historical logs span account switches without durable account
                attribution, so dividing this usage by one $200 subscription
                would overstate the result.
              </p>
              <p>
                Cached input is a subset of input and reasoning tokens are a
                subset of output, so neither is counted twice. The pricing
                manifest was frozen{" "}
                <time dateTime={snapshot.pricing.manifest.frozenAt}>
                  {formatSubsidyDate(snapshot.pricing.manifest.frozenAt)}
                </time>
                {" "}(SHA-256{" "}
                <code>{snapshot.pricing.manifest.sha256.slice(0, 12)}</code>).
              </p>
              <p>
                Measurement revision{" "}
                <code>{snapshot.methodology.measurement.revision}</code> pins
                the parser, adapter, rolling-window math, and updater source. A
                changed measurement manifest requires the retained series to be
                recomputed before publication.
              </p>
              <p>{snapshot.methodology.disclaimer}</p>

              <p>
                The dataset title is <cite>{snapshot.title}</cite>. Its “20x”
                describes the advertised Pro usage tier, not a multiple
                calculated by this chart.
              </p>

              <h3 id="interpretation">Limits</h3>
              <ul>
                <li>
                  This is one user&apos;s available local logs on one machine, not
                  a platform-wide or representative ChatGPT Pro estimate.
                </li>
                <li>
                  Historical session files have no durable account attribution.
                  Account switches, multiple subscriptions,
                  API-key or otherwise API-billed usage, purchased ChatGPT
                  credits, free or reset credits, and promotions cannot be
                  separated.
                </li>
                <li>
                  The line does not reconstruct allowance resets, prove that a
                  weekly limit was exhausted, or establish how much usage one
                  subscription supplied. Historical observations publish a null
                  subscription-adjusted multiple.
                </li>
                <li>
                  Every point uses seven complete UTC days. Open current-day
                  usage is excluded until the next settled bucket, and the
                  scheduled collector&apos;s own small Codex token use appears in
                  the next settled bucket.
                </li>
                <li>
                  An unknown recorded model blocks publication. Unrecorded or
                  non-token product operations are excluded. The internal{" "}
                  <code>codex-auto-review</code> alias uses a manifest proxy
                  estimate rather than a published first-party API rate.
                </li>
              </ul>
            </article>

            <section
              aria-labelledby="subsidy-sources"
              className="plain-publication__sources"
            >
              <h3 id="subsidy-sources">Sources</h3>
              <ol>
                {sourceUrls.map((url, index) => (
                  <li key={url}>
                    <a href={url}>
                      {index === 0 ? "ChatGPT Pro plan source" : url}
                    </a>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </details>
      </section>
    </main>
  );
}
