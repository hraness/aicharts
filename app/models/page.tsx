import { createPublicSiteMetadata } from "@hraness/web-discovery";
import { FoilCardDeck } from "@hraness/design-kit/react";
import Link from "next/link";
import type { CSSProperties } from "react";

import { ModelCardFace } from "@/components/model-card-face";
import { ModelCardFoilFrame } from "@/components/model-card-foil-frame";
import {
  ModelCardGalleryFilterItem,
  ModelCardGalleryFilters,
  type ModelCardProviderFilter,
} from "@/components/model-card-gallery-filters";
import {
  MODEL_CARD_COLLECTION_SOCIAL_IMAGE_PATH,
  MODEL_CARD_PRESENTATIONS,
  MODEL_CARD_SNAPSHOT,
  MODEL_CARD_TOP_PATHS,
} from "@/lib/model-card-collection";
import { formatRetrievedAt, formatUpdateDate } from "@/lib/coding-agent-updates";
import { modelCardArtDirection } from "@/lib/model-card-art-direction";
import {
  MODEL_RELEASE_RADAR,
  MODEL_RELEASE_RADAR_HIGHLIGHTS,
  MODEL_RELEASES_AWAITING_BENCHMARK,
} from "@/lib/model-release-collection";

import { searchSite } from "../site";

const modelCardsSearchSite = {
  ...searchSite,
  description: "Shareable model trading cards for the current Artificial Analysis coding-agent benchmark snapshot.",
  socialImage: {
    alt: "Illuminated AI model benchmark atlas with distinct provider sigils",
    path: MODEL_CARD_COLLECTION_SOCIAL_IMAGE_PATH,
  },
  socialTitle: "AI Model Benchmark Cards | AI Charts",
  title: "AI Model Benchmark Cards | AI Charts",
} as const;

export const metadata = createPublicSiteMetadata(modelCardsSearchSite, {
  canonicalPath: "/models",
});

export default function ModelCardsPage() {
  const topPaths = new Set(MODEL_CARD_TOP_PATHS);
  const providerMap = new Map<string, ModelCardProviderFilter>();
  for (const card of MODEL_CARD_PRESENTATIONS) {
    const provider = providerMap.get(card.providerId);
    providerMap.set(card.providerId, {
      color: card.providerColor,
      count: (provider?.count ?? 0) + 1,
      id: card.providerId,
      name: card.providerName,
      topCount: (provider?.topCount ?? 0) + (topPaths.has(card.path) ? 1 : 0),
    });
  }
  const providers = [...providerMap.values()].sort((left, right) => (
    left.name.localeCompare(right.name)
  ));
  const gridId = "model-card-grid";
  return (
    <main className="model-card-gallery" id="model-cards-content">
      <header className="model-card-gallery__header">
        <h1>Model cards</h1>
        <p className="model-card-gallery__meta">
          <span>{MODEL_CARD_PRESENTATIONS.length} benchmark profiles across {providers.length} providers</span>
          <span>
            <a href={MODEL_CARD_SNAPSHOT.source.url}>{MODEL_CARD_SNAPSHOT.source.name}</a>
            {" · retrieved "}
            <time dateTime={MODEL_CARD_SNAPSHOT.source.retrievedAt}>{formatRetrievedAt(MODEL_CARD_SNAPSHOT.source.retrievedAt)}</time>
          </span>
        </p>
      </header>
      {MODEL_RELEASE_RADAR_HIGHLIGHTS.length > 0 && (
        <section
          aria-labelledby="model-release-radar-title"
          className="model-release-radar"
        >
          <div className="model-release-radar__heading">
            <p>Release radar</p>
            <h2 id="model-release-radar-title">New, awaiting comparable results</h2>
            <small>
              {MODEL_RELEASES_AWAITING_BENCHMARK.length} awaiting · OpenRouter checked{" "}
              <time dateTime={MODEL_RELEASE_RADAR.source.retrievedAt}>
                {formatUpdateDate(MODEL_RELEASE_RADAR.source.retrievedAt)}
              </time>
            </small>
          </div>
          <ul>
            {MODEL_RELEASE_RADAR_HIGHLIGHTS.map(release => (
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
                      {release.providerName} · listed{" "}
                      <time dateTime={release.sourceAddedAt}>
                        {formatUpdateDate(release.sourceAddedAt)}
                      </time>
                    </small>
                  </span>
                  <span aria-hidden="true">↗</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="model-release-radar__note">
            Discovery is not a score. These models stay off the chart and cards
            until Artificial Analysis publishes comparable coding-agent results.
          </p>
        </section>
      )}
      <ModelCardGalleryFilters
        gridId={gridId}
        providers={providers}
        topCount={topPaths.size}
        totalCount={MODEL_CARD_PRESENTATIONS.length}
      >
        <FoilCardDeck className="model-card-grid" id={gridId}>
          {MODEL_CARD_PRESENTATIONS.map(card => (
            <ModelCardGalleryFilterItem
              isTop={topPaths.has(card.path)}
              key={card.path}
              providerId={card.providerId}
            >
              <Link
                aria-label={`Open ${card.displayTitle} model card; ${card.classLabel} class`}
                className="model-card-grid__link"
                href={card.path}
              >
                <div className="model-card-grid__bleed">
                  <ModelCardFoilFrame
                    foilPreset={card.foilPreset}
                    seed={card.seed}
                  >
                    <ModelCardFace card={card} illuminationMode="gallery" />
                  </ModelCardFoilFrame>
                </div>
              </Link>
            </ModelCardGalleryFilterItem>
          ))}
        </FoilCardDeck>
      </ModelCardGalleryFilters>
    </main>
  );
}
