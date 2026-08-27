import { createPublicSiteMetadata } from "@hraness/web-discovery";
import { FoilCardDeck } from "@hraness/design-kit/react";
import Link from "next/link";

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
import { formatRetrievedAt } from "@/lib/coding-agent-updates";

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
