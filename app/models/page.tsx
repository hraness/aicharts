import { createPublicSiteMetadata } from "@hraness/web-discovery";
import { FoilCardDeck } from "@hraness/design-kit/react";
import Link from "next/link";

import { ModelCardFace } from "@/components/model-card-face";
import { ModelCardFoilFrame } from "@/components/model-card-foil-frame";
import {
  MODEL_CARD_PRESENTATIONS,
  MODEL_CARD_SNAPSHOT,
} from "@/lib/model-card-collection";
import { formatRetrievedAt } from "@/lib/coding-agent-updates";

import { searchSite } from "../site";

const modelCardsSearchSite = {
  ...searchSite,
  description: "Shareable model trading cards for the current Artificial Analysis coding-agent benchmark snapshot.",
  socialTitle: "AI Model Benchmark Cards | AI Charts",
  title: "AI Model Benchmark Cards | AI Charts",
} as const;

export const metadata = createPublicSiteMetadata(modelCardsSearchSite, {
  canonicalPath: "/models",
});

export default function ModelCardsPage() {
  const providers = new Set(MODEL_CARD_PRESENTATIONS.map(card => card.providerName)).size;
  return (
    <main className="model-card-gallery" id="model-cards-content">
      <header className="model-card-gallery__header">
        <div>
          <h1>Model cards</h1>
          <p>
            {MODEL_CARD_PRESENTATIONS.length} benchmark profiles across {providers} providers.
          </p>
        </div>
        <p>
          <a href={MODEL_CARD_SNAPSHOT.source.url}>{MODEL_CARD_SNAPSHOT.source.name}</a>
          {" snapshot retrieved "}
          <time dateTime={MODEL_CARD_SNAPSHOT.source.retrievedAt}>{formatRetrievedAt(MODEL_CARD_SNAPSHOT.source.retrievedAt)}</time>
        </p>
      </header>
      <FoilCardDeck className="model-card-grid">
        {MODEL_CARD_PRESENTATIONS.map(card => (
          <Link
            aria-label={`Open ${card.displayTitle} model card`}
            className="model-card-grid__link"
            href={card.path}
            key={card.path}
          >
            <ModelCardFoilFrame
              foilPreset={card.foilPreset}
              seed={card.seed}
              visualClass={card.visualClass}
            >
              <ModelCardFace card={card} />
            </ModelCardFoilFrame>
          </Link>
        ))}
      </FoilCardDeck>
    </main>
  );
}
