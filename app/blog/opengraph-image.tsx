import { socialImageContentType } from "@hraness/web-discovery/social-image";

import { aichartsSocialImageAlt, blogCollectionSocialImagePage } from "../social-image-site";
import { BLOG_IMAGE_SIZE, renderBlogCollectionImage } from "./article-image";

export const size = BLOG_IMAGE_SIZE;
export const contentType = socialImageContentType;
export const alt = aichartsSocialImageAlt(blogCollectionSocialImagePage);

export default function OpenGraphImage() {
  return renderBlogCollectionImage();
}
