import type { ModelCardPresentation } from "@/lib/model-card-presentation";

import { logoCardFromPresentation, ModelLogoCard } from "./model-logo-card";

export function ModelCardFace({
  card,
}: Readonly<{
  card: ModelCardPresentation;
}>) {
  return <ModelLogoCard card={logoCardFromPresentation(card)} />;
}
