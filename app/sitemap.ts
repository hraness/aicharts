import type { MetadataRoute } from "next";
import { entries, guide } from "@/journal/content";
import rawDataset from "@/data/releases.json";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://aicharts.io",
      lastModified: new Date(rawDataset.updatedAt),
      changeFrequency: "daily",
      priority: 1,
    },
    ...["/changelog", "/blog"].map((path) => ({
      url: "https://aicharts.io" + path,
      lastModified: entries[0]!.date,
    })),
    { url: "https://aicharts.io" + guide.href, lastModified: guide.published },
  ];
}
