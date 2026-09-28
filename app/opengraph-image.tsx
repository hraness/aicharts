import {
  createSiteSocialImageResponse,
  socialImageContentType,
  socialImageSize,
} from "@hraness/web-discovery/social-image";

import { aichartsSocialImageAlt, aichartsSocialImageSite } from "./social-image-site";

export const alt = aichartsSocialImageAlt();
export const contentType = socialImageContentType;
export const size = socialImageSize;

export default function Image() {
  return createSiteSocialImageResponse(aichartsSocialImageSite);
}
