import {
  createSiteSocialImageResponse,
  socialImageSize,
} from "@hraness/web-discovery/social-image";
import type { ImageResponse } from "next/og";

import { aichartsSocialImageSite, blogCollectionSocialImagePage } from "../social-image-site";

export const BLOG_IMAGE_SIZE = socialImageSize;

export function renderBlogCollectionImage(): ImageResponse {
  return createSiteSocialImageResponse(aichartsSocialImageSite, blogCollectionSocialImagePage);
}
