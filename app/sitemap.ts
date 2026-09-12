import type { MetadataRoute } from "next";
import { atlasContentModifiedAt } from "@/lib/benchmark-atlas-distribution";

import artificialAnalysisIntelligenceData from "@/data/artificial-analysis-intelligence-v4-3.json";
import calculatorInputsData from "@/data/calculator-inputs.json";
import codingAgentData from "@/data/coding-agents.json";
import terminalBenchData from "@/data/terminal-bench.json";
import terminalBenchScienceData from "@/data/terminal-bench-science.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  calculatorInputsModifiedAt,
  parseCalculatorInputsSnapshot,
} from "@/lib/calculator-inputs-data";
import { parseArtificialAnalysisIntelligenceV43Snapshot } from "@/lib/artificial-analysis-intelligence-v4-3-data";
import {
  FIRST_PARTY_RELEASE_HIGHLIGHTS,
} from "@/lib/first-party-release-collection";
import {
  CODING_AGENT_DATASET_PATH,
  codingAgentDatasetModifiedAt,
} from "@/lib/coding-agent-dataset";
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
  const parsedIntelligence = parseArtificialAnalysisIntelligenceV43Snapshot(
    artificialAnalysisIntelligenceData,
  );
  if (!parsedIntelligence.ok) {
    throw new Error(
      `Checked Artificial Analysis Intelligence snapshot is invalid: ${parsedIntelligence.error.message}`,
      { cause: parsedIntelligence.error },
    );
  }
  const parsedCalculatorInputs = parseCalculatorInputsSnapshot(calculatorInputsData);
  if (!parsedCalculatorInputs.ok) {
    throw new Error(
      `Checked calculator inputs are invalid: ${parsedCalculatorInputs.error.message}`,
      { cause: parsedCalculatorInputs.error },
    );
  }
  const navigationUpdatedAt = "2026-09-09T02:50:00Z";
  const homeModifiedAt = [navigationUpdatedAt, parsedIntelligence.value.source.retrievedAt]
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]!;
  const codingModifiedAt = [navigationUpdatedAt, datasetModifiedAt]
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]!;
  const benchmarkPortfolioModifiedAt = [
    navigationUpdatedAt,
    atlasContentModifiedAt(),
    datasetModifiedAt,
    parsedTerminalBench.value.source.retrievedAt,
    parsedTerminalBenchScience.value.source.retrievedAt,
    parsedIntelligence.value.source.retrievedAt,
  ].sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? datasetModifiedAt;
  const modelCollectionModifiedAt = [
    datasetModifiedAt,
    ...FIRST_PARTY_RELEASE_HIGHLIGHTS.map(release => release.firstSeenAt),
  ].sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? datasetModifiedAt;
  const siteImage = absolute(searchSite.socialImage.path);
  return [
    {
      changeFrequency: "daily",
      images: [siteImage],
      lastModified: homeModifiedAt,
      priority: 1,
      url: absolute("/"),
    },
    {
      changeFrequency: "daily",
      images: [siteImage],
      lastModified: codingModifiedAt,
      priority: 0.9,
      url: absolute("/coding"),
    },
    {
      changeFrequency: "daily",
      images: [siteImage],
      lastModified: atlasContentModifiedAt(),
      priority: 0.9,
      url: absolute("/benchmarks"),
    },
    {
      changeFrequency: "daily",
      images: [siteImage],
      lastModified: calculatorInputsModifiedAt(parsedCalculatorInputs.value),
      priority: 0.8,
      url: absolute("/calculator"),
    },
    {
      changeFrequency: "monthly",
      images: [siteImage],
      lastModified: navigationUpdatedAt,
      priority: 0.7,
      url: absolute("/usage"),
    },
    {
      changeFrequency: "monthly",
      images: [siteImage],
      lastModified: navigationUpdatedAt,
      priority: 0.6,
      url: absolute("/leaderboard"),
    },
    {
      changeFrequency: "daily",
      images: [siteImage],
      lastModified: benchmarkPortfolioModifiedAt,
      priority: 0.9,
      url: absolute(CODING_AGENT_DATASET_PATH),
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
