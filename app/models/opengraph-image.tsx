import {
  socialImageContentType,
  socialImageSize,
} from "@hraness/web-discovery/social-image";

import {
  modelCardsDescription,
  modelCardsEyebrow,
  modelCardsTitle,
} from "../site";
import { aichartsSocialImage } from "../social-card";

export const alt = "Illuminated AI model benchmark atlas with distinct provider sigils";
export const contentType = socialImageContentType;
export const size = socialImageSize;

export default function OpenGraphImage() {
  return aichartsSocialImage({
    description: modelCardsDescription,
    eyebrow: modelCardsEyebrow,
    title: modelCardsTitle,
  });
}
