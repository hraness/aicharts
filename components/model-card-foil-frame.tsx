"use client";

import {
  FoilCardSurface,
  type FoilCardIntensity,
  type FoilCardRenderMode,
} from "@hraness/design-kit/react";
import type { ReactNode } from "react";

import type { ModelCardPresentation } from "@/lib/model-card-presentation";

export function ModelCardFoilFrame({
  children,
  foilPreset,
  intensity = "standard",
  renderMode = "interactive",
  seed,
}: Readonly<{
  children: ReactNode;
  foilPreset: ModelCardPresentation["foilPreset"];
  intensity?: FoilCardIntensity;
  renderMode?: FoilCardRenderMode;
  seed: string;
}>) {
  return (
    <FoilCardSurface
      className="model-card-frame"
      intensity={intensity}
      ornament="none"
      preset={foilPreset}
      renderMode={renderMode}
      seed={seed}
    >
      {children}
    </FoilCardSurface>
  );
}
