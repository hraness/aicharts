import type { MetadataRoute } from "next";

import { site } from "./site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: site.origin, changeFrequency: "daily", priority: 1 }];
}
