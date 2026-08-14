import {
  BLOG_IMAGE_SIZE,
  renderBlogCollectionImage,
} from "./article-image";

export const size = BLOG_IMAGE_SIZE;
export const contentType = "image/png";
export const alt = "AI Charts analysis of AI model and agent benchmarks";

export default function OpenGraphImage() {
  return renderBlogCollectionImage();
}
