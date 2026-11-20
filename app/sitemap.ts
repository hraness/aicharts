import type { MetadataRoute } from "next";
import { entries, guide } from "@/journal/content";
import { agentPairs } from "@/lib/agents";
import { catalog, isComparable, SITE_URL } from "@/lib/catalog";

export default function sitemap(): MetadataRoute.Sitemap {
  const updated = new Date(catalog.dataset.updatedAt);
  const data = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({
    url: SITE_URL + path,
    lastModified: updated,
    changeFrequency: "daily",
    priority,
  });
  // Pairs without a result in common are noindex; leave them out.
  const pairs = catalog.pairs.filter(isComparable);
  return [
    data("", 1),
    data("/models", 0.9),
    data("/compare", 0.8),
    data("/agents", 0.8),
    ...agentPairs().map((p) => data(`/agents/${p.slug}`, 0.7)),
    data("/api", 0.5),
    ...catalog.current.map((r) => data(`/models/${r.slug}`, 0.8)),
    ...pairs.filter((p) => p.current).map((p) => data(`/compare/${p.slug}`, 0.6)),
    ...catalog.superseded.map((r) => data(`/models/${r.slug}`, 0.5)),
    ...pairs.filter((p) => !p.current).map((p) => data(`/compare/${p.slug}`, 0.4)),
    ...["/changelog", "/blog"].map((path) => ({
      url: SITE_URL + path,
      lastModified: entries[0]!.date,
    })),
    { url: SITE_URL + guide.href, lastModified: guide.published },
  ];
}
