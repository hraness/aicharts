import type { MetadataRoute } from "next";

import artificialAnalysisIntelligenceData from "@/data/artificial-analysis-intelligence.json";
import codingAgentData from "@/data/coding-agents.json";
import gptSubsidyData from "@/data/gpt-subsidy.json";
import terminalBenchData from "@/data/terminal-bench.json";
import terminalBenchScienceData from "@/data/terminal-bench-science.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { parseArtificialAnalysisIntelligenceSnapshot } from "@/lib/artificial-analysis-intelligence-data";
import {
  FIRST_PARTY_RELEASE_HIGHLIGHTS,
} from "@/lib/first-party-release-collection";
import {
  CODING_AGENT_DATASET_PATH,
  codingAgentDatasetModifiedAt,
} from "@/lib/coding-agent-dataset";
import {
  gptSubsidyPageModifiedAt,
  parseGptSubsidySnapshot,
} from "@/lib/gpt-subsidy-data";
import {
  MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL,
  MODEL_CARD_PRESENTATIONS,
  versionedModelCardImagePath,
} from "@/lib/model-card-collection";
import type { ModelCardPresentation } from "@/lib/model-card-presentation";
import { modelCardRouteStatus } from "@/lib/model-card-route-status";
import { parseTerminalBenchSnapshot } from "@/lib/terminal-bench-data";
import { parseTerminalBenchScienceSnapshot } from "@/lib/terminal-bench-science-data";
import { blogArticlePath, blogArticles } from "./blog/articles";
import { blogEditorialImage, type BlogEditorialImage } from "./blog/editorial-images";
import { BLOG_SOCIAL_IMAGE_PATH } from "./blog/seo";
import { searchSite, site } from "./site";

export function indexableModelCards(
  cards: readonly ModelCardPresentation[] = MODEL_CARD_PRESENTATIONS,
): readonly ModelCardPresentation[] {
  return cards.filter(card => !modelCardRouteStatus(card).isProvisional);
}

export function blogSitemapEntries(
  imageForSlug: (slug: (typeof blogArticles)[number]["slug"])
    => BlogEditorialImage | undefined = blogEditorialImage,
): MetadataRoute.Sitemap {
  const absolute = (path: string) => new URL(path, site.origin).toString();
  return blogArticles.map((article) => {
    const editorialImage = imageForSlug(article.slug);
    return {
      changeFrequency: "monthly" as const,
      ...(editorialImage === undefined
        ? {}
        : { images: [absolute(editorialImage.src)] }),
      lastModified: article.updatedAt,
      priority: 0.7,
      url: absolute(blogArticlePath(article.slug)),
    };
  });
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
  const parsedTerminalBench = parseTerminalBenchSnapshot(terminalBenchData);
  if (!parsedTerminalBench.ok) {
    throw new Error(`Checked Terminal-Bench snapshot is invalid: ${parsedTerminalBench.error.message}`, {
      cause: parsedTerminalBench.error,
    });
  }
  const parsedTerminalBenchScience = parseTerminalBenchScienceSnapshot(
    terminalBenchScienceData,
  );
  if (!parsedTerminalBenchScience.ok) {
    throw new Error(
      `Checked Terminal-Bench-Science snapshot is invalid: ${parsedTerminalBenchScience.error.message}`,
      { cause: parsedTerminalBenchScience.error },
    );
  }
  const parsedIntelligence = parseArtificialAnalysisIntelligenceSnapshot(
    artificialAnalysisIntelligenceData,
  );
  if (!parsedIntelligence.ok) {
    throw new Error(
      `Checked Artificial Analysis Intelligence snapshot is invalid: ${parsedIntelligence.error.message}`,
      { cause: parsedIntelligence.error },
    );
  }
  const benchmarkPortfolioModifiedAt = [
    datasetModifiedAt,
    parsedTerminalBench.value.source.retrievedAt,
    parsedTerminalBenchScience.value.source.retrievedAt,
    parsedIntelligence.value.source.retrievedAt,
  ].sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? datasetModifiedAt;
  const modelCollectionModifiedAt = [
    datasetModifiedAt,
    ...FIRST_PARTY_RELEASE_HIGHLIGHTS.map(release => release.firstSeenAt),
  ].sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? datasetModifiedAt;
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
      lastModified: benchmarkPortfolioModifiedAt,
      priority: 1,
      url: absolute("/"),
    },
    {
      changeFrequency: "daily",
      images: [siteImage],
      lastModified: benchmarkPortfolioModifiedAt,
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
      images: [absolute(MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL)],
      lastModified: modelCollectionModifiedAt,
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
    ...blogSitemapEntries(),
  ];
}
