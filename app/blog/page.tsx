import type { Metadata } from "next";

import { BlogIndex } from "./blog-index";
import { blogCollectionMetadata } from "./seo";

export const metadata: Metadata = blogCollectionMetadata;

export default function BlogIndexPage() {
  return <BlogIndex />;
}
