import { createPublicSiteMetadata } from "@hraness/web-discovery";
import Link from "next/link";
import type { CSSProperties } from "react";

import {
  ModelCardGalleryFilters,
  ModelCardGalleryItems,
  type ModelCardProviderFilter,
} from "@/components/model-card-gallery-filters";
import {
  ModelLogoCard,
  logoCardFromIndexPage,
  logoCardFromPresentation,
} from "@/components/model-logo-card";
import {
  MODEL_CARD_COLLECTION_SOCIAL_IMAGE_PATH,
  MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL,
  MODEL_CARD_PRESENTATIONS,
  MODEL_CARD_SNAPSHOT,
  MODEL_CARD_TOP_PATHS,
} from "@/lib/model-card-collection";
import { formatRetrievedAt, formatUpdateDate } from "@/lib/coding-agent-updates";
import {
  DIRECT_DEEP_SWE_EVIDENCE,
  directDeepSweEvidenceForRelease,
} from "@/lib/deep-swe-evidence-collection";
import {
  DEEP_SWE_LEADERBOARD_URL,
  formatDeepSweEvidenceScore,
} from "@/lib/deep-swe-evidence";
import {
  FIRST_PARTY_RELEASE_HIGHLIGHTS,
  FIRST_PARTY_RELEASE_SOURCE_SUMMARY,
} from "@/lib/first-party-release-collection";
import { INDEX_MODEL_PAGES } from "@/lib/index-model-pages";
import { modelCardArtDirection } from "@/lib/model-card-art-direction";
import { formatModelCardReleaseDateLong, modelCardReleaseAccessibleLabel } from "@/lib/model-card-presentation";
import {
  MODEL_RELEASE_RADAR,
  MODEL_RELEASES_AWAITING_BENCHMARK,
  MODEL_RELEASES_WITH_EARLY_DEEP_SWE,
  modelReleaseRadarHighlightsExcluding,
} from "@/lib/model-release-collection";

import {
  modelCardsDescription,
  modelCardsEyebrow,
  modelCardsHeading,
  modelCardsLede,
  modelCardsTitle,
  searchSite,
} from "../site";

const MODEL_RELEASE_RADAR_PAGE_HIGHLIGHTS = modelReleaseRadarHighlightsExcluding(
  FIRST_PARTY_RELEASE_HIGHLIGHTS.flatMap(release => release.namedModels),
);

const modelCardsSearchSite = {
  ...searchSite,
  description: modelCardsDescription,
  socialImage: {
    alt: "AI Charts model pages with provider logos and Intelligence Index scores",
    path: MODEL_CARD_COLLECTION_SOCIAL_IMAGE_PATH,
  },
  socialTitle: modelCardsTitle,
  title: modelCardsTitle,
} as const;

const modelCardsMetadata = createPublicSiteMetadata(modelCardsSearchSite, {
  canonicalPath: "/models",
});
const modelCardsSocialImage = {
  alt: modelCardsSearchSite.socialImage.alt,
  height: 630,
  type: "image/png",
  url: MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL,
  width: 1200,
} as const;
export const metadata = {
  ...modelCardsMetadata,
  openGraph: {
    ...modelCardsMetadata.openGraph,
    images: [modelCardsSocialImage],
  },
  twitter: {
    ...modelCardsMetadata.twitter,
    card: "summary_large_image",
    images: [modelCardsSocialImage],
  },
};

export default function ModelCardsPage() {
  const topPaths = new Set(MODEL_CARD_TOP_PATHS);
  const galleryItems = [
    ...MODEL_CARD_PRESENTATIONS.map(card => ({
      href: card.path,
      isTop: topPaths.has(card.path),
      label: `Open ${card.displayTitle} model page; ${card.classLabel} class. ${modelCardReleaseAccessibleLabel(card.release)}`,
      providerColor: card.providerColor,
      providerId: card.providerId,
      providerName: card.providerName,
      releasedOn: card.release.status === "verified" ? card.release.releasedOn : null,
      view: logoCardFromPresentation(card),
    })),
    ...INDEX_MODEL_PAGES.map(page => ({
      href: page.path,
      isTop: false,
      label: `Open ${page.displayTitle} model page. First listed on the Intelligence Index on ${formatModelCardReleaseDateLong(page.releaseDate)}.`,
      providerColor: page.providerColor,
      providerId: page.providerId,
      providerName: page.providerName,
      releasedOn: page.releaseDate,
      view: logoCardFromIndexPage(page),
    })),
  ];
  const providerMap = new Map<string, ModelCardProviderFilter>();
  for (const item of galleryItems) {
    const provider = providerMap.get(item.providerId);
    providerMap.set(item.providerId, {
      color: item.providerColor,
      count: (provider?.count ?? 0) + 1,
      id: item.providerId,
      name: item.providerName,
      topCount: (provider?.topCount ?? 0) + (item.isTop ? 1 : 0),
    });
  }
  const providers = [...providerMap.values()].sort((left, right) => (
    left.name.localeCompare(right.name)
  ));
  const gridId = "model-card-grid";
  return (
    <main
      className="model-card-gallery"
      data-analytics-surface="models_gallery"
      id="model-cards-content"
    >
      <header
        aria-labelledby="model-cards-title"
        className="hraness-marketing-hero model-card-gallery__hero"
        data-align="center"
        data-analytics-surface="models_header"
        data-hraness-marketing="hero"
        data-tone="paper"
      >
        <div className="hraness-marketing-hero__copy">
          <p className="hraness-marketing-hero__eyebrow">{modelCardsEyebrow}</p>
          <h1 className="hraness-marketing-hero__heading" id="model-cards-title">{modelCardsHeading}</h1>
          <p className="hraness-marketing-hero__summary model-card-gallery__lede">{modelCardsLede}</p>
          <p className="hraness-marketing-hero__boundary model-card-gallery__meta">
            <span>{galleryItems.length} model pages across {providers.length} providers</span>
            <span>
              <a href={MODEL_CARD_SNAPSHOT.source.url}>{MODEL_CARD_SNAPSHOT.source.name}</a>
              {" · retrieved "}
              <time dateTime={MODEL_CARD_SNAPSHOT.source.retrievedAt}>{formatRetrievedAt(MODEL_CARD_SNAPSHOT.source.retrievedAt)}</time>
            </span>
          </p>
        </div>
      </header>
      <ModelCardGalleryFilters
        gridId={gridId}
        providers={providers}
        topCount={topPaths.size}
        totalCount={galleryItems.length}
      >
        <ModelCardGalleryItems
          className="model-card-grid"
          id={gridId}
          items={galleryItems.map(item => ({
            isTop: item.isTop,
            providerId: item.providerId,
            releasedOn: item.releasedOn,
          }))}
        >
          {galleryItems.map(item => (
            <Link
              aria-label={item.label}
              className="model-card-grid__link"
              href={item.href}
              key={item.href}
            >
              <ModelLogoCard card={item.view} />
            </Link>
          ))}
        </ModelCardGalleryItems>
      </ModelCardGalleryFilters>
      {FIRST_PARTY_RELEASE_HIGHLIGHTS.length > 0 && (
        <section
          aria-labelledby="first-party-release-radar-title"
          className="model-release-radar"
          data-analytics-surface="model_release_radar"
        >
          <div className="model-release-radar__heading">
            <p>First-party release radar</p>
            <h2 id="first-party-release-radar-title">New releases found at first-party sources</h2>
            <small>
              {FIRST_PARTY_RELEASE_SOURCE_SUMMARY.labCount} labs · {FIRST_PARTY_RELEASE_SOURCE_SUMMARY.sourceCount} first-party sources · reviewed URL evidence
            </small>
          </div>
          <ul>
            {FIRST_PARTY_RELEASE_HIGHLIGHTS.map(release => (
              <li
                key={release.id}
                style={{
                  "--release-provider": modelCardArtDirection(
                    release.providerId,
                    "standard",
                    "default",
                  ).providerColor,
                } as CSSProperties}
              >
                <a href={release.canonicalUrl}>
                  <i aria-hidden="true" />
                  <span>
                    <strong>{release.namedModels.join(" and ")}</strong>
                    <small>
                      {release.providerName} · first observed{" "}
                      <time dateTime={release.firstSeenAt}>
                        {formatUpdateDate(release.firstSeenAt)}
                      </time>
                    </small>
                  </span>
                  <span aria-hidden="true">↗</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="model-release-radar__note">
            Lab-owned release sources supply announcement candidates before an
            aggregator may list every model. A newly observed canonical URL is
            discovery evidence. Source timestamps and later edits are not official
            release dates or benchmark scores; reviewed dates and scores keep their
            own sources.
          </p>
        </section>
      )}
      {MODEL_RELEASE_RADAR_PAGE_HIGHLIGHTS.length > 0 && (
        <section
          aria-labelledby="model-release-radar-title"
          className="model-release-radar"
          data-analytics-surface="model_release_radar"
        >
          <div className="model-release-radar__heading">
            <p>Release radar</p>
            <h2 id="model-release-radar-title">New, awaiting complete benchmark coverage</h2>
            <small>
              {MODEL_RELEASES_AWAITING_BENCHMARK.length} incomplete · {MODEL_RELEASES_WITH_EARLY_DEEP_SWE.length} with early DeepSWE · OpenRouter checked{" "}
              <time dateTime={MODEL_RELEASE_RADAR.source.retrievedAt}>
                {formatUpdateDate(MODEL_RELEASE_RADAR.source.retrievedAt)}
              </time>
            </small>
          </div>
          <ul>
            {MODEL_RELEASE_RADAR_PAGE_HIGHLIGHTS.map(release => {
              const earlyEvidence = directDeepSweEvidenceForRelease(release);
              return (
                <li
                  key={release.id}
                  style={{
                    "--release-provider": modelCardArtDirection(
                      release.providerId,
                      "standard",
                      "default",
                    ).providerColor,
                  } as CSSProperties}
                >
                  <a href={release.modelUrl}>
                    <i aria-hidden="true" />
                    <span>
                      <strong>{release.model}</strong>
                      <small>
                        {release.providerName} · first observed{" "}
                        <time dateTime={release.sourceAddedAt}>
                          {formatUpdateDate(release.sourceAddedAt)}
                        </time>
                      </small>
                      {earlyEvidence !== null && (
                        <small className="model-release-radar__early-score">
                          Early DeepSWE {formatDeepSweEvidenceScore(earlyEvidence.passAt1)} pass@1
                          {" · "}{earlyEvidence.reasoningEffort ?? "default"}
                          {" · "}{earlyEvidence.runs} runs
                          {" · "}{earlyEvidence.identity.resolver.name} match
                        </small>
                      )}
                    </span>
                    <span aria-hidden="true">↗</span>
                  </a>
                </li>
              );
            })}
          </ul>
          <p className="model-release-radar__note">
            Discovery is not a score. OpenRouter is the first-line model-identity
            catalog, with Artificial Analysis used only when a model is unresolved;
            when shown, early{" "}
            <a href={DEEP_SWE_LEADERBOARD_URL}>DeepSWE v{DIRECT_DEEP_SWE_EVIDENCE.source.benchmarkVersion}</a>
            {" "}pass@1 comes directly from DataCurve&apos;s mini-swe-agent leaderboard.
            The direct result is harness-specific and stays off the Artificial
            Analysis chart and cards. Partial Artificial Analysis observations can
            appear there with missing metrics shown explicitly.
          </p>
        </section>
      )}
    </main>
  );
}
