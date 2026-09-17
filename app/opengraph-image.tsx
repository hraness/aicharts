import {
  socialImageContentType,
  socialImageSize,
} from "@hraness/web-discovery/social-image";

import { homeHeading, searchSite, site } from "./site";
import { aichartsSocialImage } from "./social-card";

export const alt = searchSite.socialImage.alt;
export const contentType = socialImageContentType;
export const size = socialImageSize;

export default function Image() {
  return aichartsSocialImage({
    description: site.description,
    eyebrow: site.name,
    title: homeHeading,
  });
}
