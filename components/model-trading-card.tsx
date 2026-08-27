"use client";

import {
  type FoilCardIntensity,
  type FoilCardRenderMode,
} from "@hraness/design-kit/react";

import type { ModelCardPresentation } from "@/lib/model-card-presentation";

import { ModelCardFace } from "./model-card-face";
import { ModelCardFoilFrame } from "./model-card-foil-frame";

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
    <ModelCardFoilFrame
      foilPreset={card.foilPreset}
      intensity={intensity}
      renderMode={renderMode}
      seed={card.seed}
      visualClass={card.visualClass}
    >
      <ModelCardFace card={card} />
    </ModelCardFoilFrame>
  );
}
