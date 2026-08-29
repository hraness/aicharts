import { createPublicSiteMetadata } from "@hraness/web-discovery";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ModelCardShare } from "@/components/model-card-share";
import { ModelTradingCard } from "@/components/model-trading-card";
import {
  MODEL_CARD_PRESENTATIONS,
  MODEL_CARD_SNAPSHOT,
  findModelCardPresentation,
  modelCardRouteStaticParams,
  versionedModelCardImagePath,
} from "@/lib/model-card-collection";
import type { ModelCardRouteParams } from "@/lib/model-card-data";
import {
  formatModelCardReleaseDateLong,
  formatModelCardReleaseStage,
  modelCardIndexingPolicy,
  modelCardReleaseLabel,
} from "@/lib/model-card-presentation";
import { modelCardRouteStatus } from "@/lib/model-card-route-status";
import { vercelGatewayModelCatalog } from "@/lib/model-card-sources";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";

import { searchSite, site } from "../../../../site";

export const dynamicParams = false;

export function generateStaticParams() {
  return [...modelCardRouteStaticParams()];
}

function emblemTerm(value: string): string {
  return value.split("-").filter(Boolean).map(term => (
    term.charAt(0).toLocaleUpperCase("en-US") + term.slice(1)
  )).join(" ");
}

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<ModelCardRouteParams> }>): Promise<Metadata> {
  const card = findModelCardPresentation(await params);
  if (card === undefined) notFound();
  const title = `${card.displayTitle} Benchmark Card | AI Charts`;
  const description = `${card.displayTitle} with available observed coding-agent benchmark, cost, time, and total-token ranges from Artificial Analysis.`;
  const base = createPublicSiteMetadata({
    ...searchSite,
    description,
    socialTitle: title,
    title,
  }, { canonicalPath: card.path });
  const imagePath = versionedModelCardImagePath(card.path, "opengraph-image");
  const imageAlt = `${card.displayTitle} benchmark card`;
  const indexingPolicy = modelCardIndexingPolicy(card);
  return {
    ...base,
    ...(indexingPolicy === undefined ? {} : { robots: indexingPolicy }),
    openGraph: {
      ...base.openGraph,
      images: [{
        alt: imageAlt,
        height: 630,
        type: "image/png",
        url: imagePath,
        width: 1200,
      }],
    },
    twitter: {
      ...base.twitter,
      card: "summary_large_image",
      images: [{ alt: imageAlt, url: imagePath }],
    },
  };
}

export default async function ModelCardPage({
  params,
}: Readonly<{ params: Promise<ModelCardRouteParams> }>) {
  const card = findModelCardPresentation(await params);
  if (card === undefined) notFound();
  const canonicalUrl = new URL(card.path, site.origin).toString();
  const imageUrl = versionedModelCardImagePath(card.path, "card.png");
  const routeStatus = modelCardRouteStatus(card);
  const relatedCards = MODEL_CARD_PRESENTATIONS.filter(candidate => (
    candidate.canonicalModelId === card.canonicalModelId
    && candidate.path !== card.path
  ));
  return (
    <main className="model-card-detail" id="model-cards-content">
      <Link className="model-card-detail__back" href="/models">← All model cards</Link>
      <div className="model-card-detail__layout">
        <section className="model-card-detail__stage" aria-label="Interactive foil model card">
          <ModelTradingCard card={card} intensity="vivid" />
          <p className="model-card-detail__interaction-hint">Move the pointer across the card to inspect the foil.</p>
        </section>
        <div className="model-card-detail__copy">
          <header>
            <p>{card.providerName}</p>
            <h1>{card.displayTitle}</h1>
            <p>{card.harnessLabel}</p>
          </header>
          <ModelCardShare
            canonicalUrl={canonicalUrl}
            card={card}
            imageUrl={imageUrl}
          />
          <section aria-labelledby="model-card-details-title" className="model-card-detail__facts">
            <h2 id="model-card-details-title">Card details</h2>
            <dl>
              <div><dt>{routeStatus.provisionalIdentity ? "Provisional ID" : "Canonical ID"}</dt><dd><code className="model-card-detail__code-token">{card.canonicalModelId}</code></dd></div>
              <div>
                <dt>{modelCardReleaseLabel(card.release)}</dt>
                <dd>
                  {card.release.status === "verified" ? (
                    <>
                      <a href={card.release.sources[0].url}>
                        <time dateTime={card.release.releasedOn}>
                          {formatModelCardReleaseDateLong(card.release.releasedOn)}
                        </time>
                        {" · "}{card.release.sources[0].title}
                      </a>
                      {" · "}{formatModelCardReleaseStage(card.release.stage)}
                    </>
                  ) : card.release.status === "pending" ? (
                    <>Official date pending verification · researched <time dateTime={card.release.researchedOn}>{formatModelCardReleaseDateLong(card.release.researchedOn)}</time></>
                  ) : (
                    <>Official date pending first-party review · first observed in the benchmark snapshot <time dateTime={card.release.observedOn}>{formatModelCardReleaseDateLong(card.release.observedOn)}</time></>
                  )}
                </dd>
              </div>
              {routeStatus.isProvisional && (
                <div>
                  <dt>Route status</dt>
                  <dd>
                    Provisional until this new upstream {routeStatus.primaryReason} is cataloged.
                  </dd>
                </div>
              )}
              <div>
                <dt>Gateway ID</dt>
                <dd>
                  {card.gatewayModelId === null ? "Not in the verified Gateway catalog" : <code className="model-card-detail__code-token">{card.gatewayModelId}</code>}
                  {" · "}
                  <a href={vercelGatewayModelCatalog.url}>catalog checked <time dateTime={vercelGatewayModelCatalog.verifiedAt}>Aug 26, 2026</time></a>
                </dd>
              </div>
              <div><dt>Profile</dt><dd><code className="model-card-detail__code-token">{card.profileSlug}</code></dd></div>
              <div>
                <dt>Sigil</dt>
                <dd>
                  {card.providerName} court
                  {" · "}{emblemTerm(card.emblemIdentity.familyId)} family seal
                  {" · "}{card.emblemIdentity.generation.join(".")} version marks
                  {" · "}{emblemTerm(card.emblemIdentity.editionId)} edition
                  {" · "}foil/detail {card.illuminationDensity}/5
                </dd>
              </div>
              <div>
                <dt>{card.agentNames.length === 1 ? "Agent harness" : "Agent harnesses"}</dt>
                <dd>
                  <ul className="model-card-detail__harnesses">
                    {card.agentNames.map(agentName => <li key={agentName}>{agentName}</li>)}
                  </ul>
                </dd>
              </div>
              <div>
                <dt>Snapshot</dt>
                <dd>
                  <a href={MODEL_CARD_SNAPSHOT.source.url}>{MODEL_CARD_SNAPSHOT.source.name}</a>
                  {" · "}
                  <time dateTime={MODEL_CARD_SNAPSHOT.source.retrievedAt}>{formatRetrievedAt(MODEL_CARD_SNAPSHOT.source.retrievedAt)}</time>
                </dd>
              </div>
            </dl>
            <p>
              Values are observed ranges across the named model, agent harness, and profile in the current source snapshot. AI Charts does not average unlike configurations.
            </p>
          </section>
          {relatedCards.length > 0 && (
            <section aria-labelledby="related-model-cards-title" className="model-card-detail__related">
              <h2 id="related-model-cards-title">Other profiles</h2>
              <div>
                {relatedCards.map(related => (
                  <Link href={related.path} key={related.path}>{related.profileLabel}</Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
