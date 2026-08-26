"use client";

import {
  FoilCardSurface,
  type FoilCardIntensity,
  type FoilCardRenderMode,
} from "@hraness/design-kit/react";

import type { ModelCardPresentation } from "@/lib/model-card-presentation";

import { ModelCardFace } from "./model-card-face";

export function ModelTradingCard({
  card,
  intensity = "standard",
  renderMode = "interactive",
}: Readonly<{
  card: ModelCardPresentation;
  intensity?: FoilCardIntensity;
  renderMode?: FoilCardRenderMode;
}>) {
  return (
    <FoilCardSurface
      className="model-card-frame"
      intensity={intensity}
      preset={card.foilPreset}
      renderMode={renderMode}
      seed={card.seed}
    >
      <ModelCardFace card={card} />
    </FoilCardSurface>
  );
}
