import {
  createSiteSocialImageResponse,
  socialImageContentType,
  socialImageSize,
} from "@hraness/web-discovery/social-image";

import {
  aichartsSocialImageAlt,
  aichartsSocialImageSite,
  modelsSocialImagePage,
} from "../social-image-site";

export const alt = aichartsSocialImageAlt(modelsSocialImagePage);
export const contentType = socialImageContentType;
export const size = socialImageSize;

export default function OpenGraphImage() {
  return createSiteSocialImageResponse(aichartsSocialImageSite, modelsSocialImagePage);
}
