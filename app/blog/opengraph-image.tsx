import { socialImageContentType } from "@hraness/web-discovery/social-image";

import {
  BLOG_IMAGE_SIZE,
  renderBlogCollectionImage,
} from "./article-image";

export const size = BLOG_IMAGE_SIZE;
export const contentType = socialImageContentType;
export const alt = "AI Charts analysis of AI model and agent benchmarks";

export default function OpenGraphImage() {
  return renderBlogCollectionImage();
}
