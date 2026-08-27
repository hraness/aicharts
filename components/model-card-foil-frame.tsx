"use client";

import {
  FoilCardSurface,
  type FoilCardIntensity,
  type FoilCardRenderMode,
} from "@hraness/design-kit/react";
import type { ReactNode } from "react";

import type { ModelCardPresentation } from "@/lib/model-card-presentation";

const modelCardOrnament = {
  fast: "rails",
  max: "facets",
  standard: "corners",
  thinking: "circuit",
} as const;

export function ModelCardFoilFrame({
  children,
  foilPreset,
  intensity = "standard",
  renderMode = "interactive",
  seed,
  visualClass,
}: Readonly<{
  children: ReactNode;
  foilPreset: ModelCardPresentation["foilPreset"];
  intensity?: FoilCardIntensity;
  renderMode?: FoilCardRenderMode;
  seed: string;
  visualClass: ModelCardPresentation["visualClass"];
}>) {
  return (
    <FoilCardSurface
      className="model-card-frame"
      intensity={intensity}
      ornament={modelCardOrnament[visualClass]}
      preset={foilPreset}
      renderMode={renderMode}
      seed={seed}
    >
      {children}
    </FoilCardSurface>
  );
}
