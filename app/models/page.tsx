import { createPublicSiteMetadata } from "@hraness/web-discovery";
import Link from "next/link";

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
import { ModelReleaseRadars } from "@/components/release-radar";
import {
  MODEL_CARD_COLLECTION_SOCIAL_IMAGE_PATH,
  MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL,
  MODEL_CARD_PRESENTATIONS,
  MODEL_CARD_SNAPSHOT,
  MODEL_CARD_TOP_PATHS,
} from "@/lib/model-card-collection";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";
import { INDEX_MODEL_PAGES } from "@/lib/index-model-pages";
import { formatModelCardReleaseDateLong, modelCardReleaseAccessibleLabel } from "@/lib/model-card-presentation";

import {
  modelCardsDescription,
  modelCardsEyebrow,
  modelCardsHeading,
  modelCardsLede,
  modelCardsTitle,
  searchSite,
} from "../site";

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
    <main tabIndex={-1}
      className="model-card-gallery hraness-marketing-main"
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
      <ModelReleaseRadars />
    </main>
  );
}
