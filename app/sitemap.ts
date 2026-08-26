import type { MetadataRoute } from "next";

import codingAgentData from "@/data/coding-agents.json";
import gptSubsidyData from "@/data/gpt-subsidy.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  CODING_AGENT_DATASET_PATH,
  codingAgentDatasetModifiedAt,
} from "@/lib/coding-agent-dataset";
import {
  gptSubsidyPageModifiedAt,
  parseGptSubsidySnapshot,
} from "@/lib/gpt-subsidy-data";
import {
  MODEL_CARD_PRESENTATIONS,
  versionedModelCardImagePath,
} from "@/lib/model-card-collection";
import type { ModelCardPresentation } from "@/lib/model-card-presentation";
import { modelCardRouteStatus } from "@/lib/model-card-route-status";
import { blogArticlePath, blogArticles } from "./blog/articles";
import { BLOG_SOCIAL_IMAGE_PATH, blogArticleImagePath } from "./blog/seo";
import { searchSite, site } from "./site";

export function indexableModelCards(
  cards: readonly ModelCardPresentation[] = MODEL_CARD_PRESENTATIONS,
): readonly ModelCardPresentation[] {
  return cards.filter(card => !modelCardRouteStatus(card).isProvisional);
}

export default function sitemap(): MetadataRoute.Sitemap {
  const absolute = (path: string) => new URL(path, site.origin).toString();
  const input: unknown = codingAgentData;
  const parsed = parseCodingAgentSnapshot(input);
  if (!parsed.ok) {
    throw new Error(`Checked coding-agent snapshot is invalid: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  const datasetModifiedAt = codingAgentDatasetModifiedAt(parsed.value);
  const parsedSubsidy = parseGptSubsidySnapshot(gptSubsidyData);
  if (!parsedSubsidy.ok) {
    throw new Error(`Checked GPT subsidy snapshot is invalid: ${parsedSubsidy.error.message}`, {
      cause: parsedSubsidy.error,
    });
  }
  const siteImage = absolute(searchSite.socialImage.path);
  return [
    {
      changeFrequency: "daily",
      images: [siteImage],
      lastModified: datasetModifiedAt,
      priority: 1,
      url: absolute("/"),
    },
    {
      changeFrequency: "daily",
      images: [siteImage],
      lastModified: datasetModifiedAt,
      priority: 0.9,
      url: absolute(CODING_AGENT_DATASET_PATH),
    },
    {
      changeFrequency: "daily",
      images: [absolute("/gpt-subsidy/opengraph-image")],
      lastModified: gptSubsidyPageModifiedAt(parsedSubsidy.value),
      priority: 0.9,
      url: absolute("/gpt-subsidy"),
    },
    {
      changeFrequency: "monthly",
      images: [absolute(BLOG_SOCIAL_IMAGE_PATH)],
      lastModified: blogArticles.reduce(
        (latest, article) => article.updatedAt > latest ? article.updatedAt : latest,
        blogArticles[0]?.updatedAt ?? "2026-08-04",
      ),
      priority: 0.8,
      url: absolute("/blog"),
    },
    {
      changeFrequency: "daily",
      images: [siteImage],
      lastModified: datasetModifiedAt,
      priority: 0.9,
      url: absolute("/models"),
    },
    ...indexableModelCards().map(card => ({
      changeFrequency: "daily" as const,
      images: [absolute(versionedModelCardImagePath(card.path, "opengraph-image"))],
      lastModified: datasetModifiedAt,
      priority: 0.75,
      url: absolute(card.path),
    })),
    ...blogArticles.map((article) => ({
      changeFrequency: "monthly" as const,
      images: [absolute(blogArticleImagePath(article.slug))],
      lastModified: article.updatedAt,
      priority: 0.7,
      url: absolute(blogArticlePath(article.slug)),
    })),
  ];
}
