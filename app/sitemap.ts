import type { MetadataRoute } from "next";
import rawDataset from "@/data/releases.json";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://aicharts.io",
      lastModified: new Date(rawDataset.updatedAt),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
