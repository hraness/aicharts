import { createPublicSiteMetadata } from "@hraness/web-discovery";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ModelCardShare } from "@/components/model-card-share";
import { ModelCommentary } from "@/components/model-commentary";
import { ModelLogoCard, logoCardFromIndexPage, logoCardFromPresentation } from "@/components/model-logo-card";
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
import {
  findIndexModelPage,
  formatIntelligenceCost,
  formatIntelligenceIndex,
  indexModelRouteStaticParams,
  intelligenceObservationForCard,
} from "@/lib/index-model-pages";
import { modelCommentaryForCanonicalId } from "@/lib/model-commentary";

import {
  modelCardDescription,
  modelCardTitle,
  searchSite,
  site,
} from "../../../../site";

export const dynamicParams = false;

export function generateStaticParams() {
  return [...modelCardRouteStaticParams(), ...indexModelRouteStaticParams()];
}

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<ModelCardRouteParams> }>): Promise<Metadata> {
  const resolved = await params;
  const card = findModelCardPresentation(resolved);
  const indexPage = card === undefined ? findIndexModelPage(resolved) : undefined;
  const displayTitle = card?.displayTitle ?? indexPage?.displayTitle;
  const path = card?.path ?? indexPage?.path;
  if (displayTitle === undefined || path === undefined) notFound();
  const title = modelCardTitle(displayTitle);
  const description = modelCardDescription(displayTitle);
  const base = createPublicSiteMetadata({
    ...searchSite,
    description,
    socialTitle: title,
    title,
  }, { canonicalPath: path });
  const imagePath = versionedModelCardImagePath(
    path as `/models/${string}/${string}/${string}`,
    "opengraph-image",
  );
  const imageAlt = `${displayTitle} model page`;
  const indexingPolicy = card === undefined ? undefined : modelCardIndexingPolicy(card);
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

function CodingModelPage({
  card,
}: Readonly<{
  card: NonNullable<ReturnType<typeof findModelCardPresentation>>;
}>) {
  const canonicalUrl = new URL(card.path, site.origin).toString();
  const imageUrl = versionedModelCardImagePath(card.path, "card.png");
  const routeStatus = modelCardRouteStatus(card);
  const relatedCards = MODEL_CARD_PRESENTATIONS.filter(candidate => (
    candidate.canonicalModelId === card.canonicalModelId
    && candidate.path !== card.path
  ));
  const commentary = modelCommentaryForCanonicalId(card.canonicalModelId);
  const intelligence = intelligenceObservationForCard(card);
  return (
    <main
      className="model-card-detail"
      data-analytics-surface="model_card"
      id="model-cards-content"
    >
      <Link className="model-card-detail__back" href="/models">← All models</Link>
      <div className="model-card-detail__layout">
        <section className="model-card-detail__stage" aria-label={`${card.displayTitle} model card`}>
          <ModelLogoCard card={logoCardFromPresentation(card)} />
          {commentary !== undefined && <ModelCommentary note={commentary} />}
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
          {intelligence !== undefined && (
            <section aria-labelledby="model-index-stats-title" className="model-card-detail__facts">
              <h2 id="model-index-stats-title">Intelligence Index</h2>
              <dl>
                <div><dt>Index</dt><dd>{formatIntelligenceIndex(intelligence.intelligenceIndex)}</dd></div>
                <div>
                  <dt>Cost per task</dt>
                  <dd>
                    {intelligence.costUsdPerTask === null
                      ? "Not reported"
                      : formatIntelligenceCost(intelligence.costUsdPerTask.total)}
                  </dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>
                    <a href={intelligence.detailsUrl}>Artificial Analysis model page</a>
                  </dd>
                </div>
              </dl>
            </section>
          )}
          <section aria-labelledby="model-card-details-title" className="model-card-detail__facts">
            <h2 id="model-card-details-title">Coding-agent observations</h2>
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

function IndexModelDetailPage({
  page,
}: Readonly<{
  page: NonNullable<ReturnType<typeof findIndexModelPage>>;
}>) {
  const commentary = modelCommentaryForCanonicalId(page.canonicalModelId);
  return (
    <main
      className="model-card-detail"
      data-analytics-surface="model_card"
      id="model-cards-content"
    >
      <Link className="model-card-detail__back" href="/models">← All models</Link>
      <div className="model-card-detail__layout">
        <section className="model-card-detail__stage" aria-label={`${page.displayTitle} model card`}>
          <ModelLogoCard card={logoCardFromIndexPage(page)} />
          {commentary !== undefined && <ModelCommentary note={commentary} />}
        </section>
        <div className="model-card-detail__copy">
          <header>
            <p>{page.providerName}</p>
            <h1>{page.displayTitle}</h1>
            <p>{page.sourceName}</p>
          </header>
          <section aria-labelledby="model-index-stats-title" className="model-card-detail__facts">
            <h2 id="model-index-stats-title">Intelligence Index</h2>
            <dl>
              <div><dt>Index</dt><dd>{formatIntelligenceIndex(page.intelligenceIndex)}</dd></div>
              <div>
                <dt>Cost per task</dt>
                <dd>
                  {page.costUsdPerTask === null
                    ? "Not reported"
                    : formatIntelligenceCost(page.costUsdPerTask)}
                </dd>
              </div>
              <div>
                <dt>Canonical ID</dt>
                <dd><code className="model-card-detail__code-token">{page.canonicalModelId}</code></dd>
              </div>
              <div>
                <dt>Listed on Index</dt>
                <dd>
                  <time dateTime={page.releaseDate}>{formatModelCardReleaseDateLong(page.releaseDate)}</time>
                  {" · snapshot date, not a verified first-party release date"}
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  <a href={page.detailsUrl}>{page.displayTitle} on Artificial Analysis</a>
                  {" · "}
                  <a href={page.sourceUrl}>{page.sourceName}</a>
                  {" · retrieved "}
                  <time dateTime={page.sourceRetrievedAt}>{formatRetrievedAt(page.sourceRetrievedAt)}</time>
                </dd>
              </div>
            </dl>
            <p>
              These values come from the checked Intelligence Index snapshot. AI Charts does not invent missing coding-agent scores.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

export default async function ModelCardPage({
  params,
}: Readonly<{ params: Promise<ModelCardRouteParams> }>) {
  const resolved = await params;
  const card = findModelCardPresentation(resolved);
  if (card !== undefined) return <CodingModelPage card={card} />;
  const indexPage = findIndexModelPage(resolved);
  if (indexPage !== undefined) return <IndexModelDetailPage page={indexPage} />;
  notFound();
}
