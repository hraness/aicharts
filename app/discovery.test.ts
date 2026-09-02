import { describe, expect, test } from "bun:test";

import codingAgentData from "@/data/coding-agents.json";
import gptSubsidyData from "@/data/gpt-subsidy.json";
import terminalBenchData from "@/data/terminal-bench.json";
import terminalBenchScienceData from "@/data/terminal-bench-science.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import { FIRST_PARTY_RELEASE_HIGHLIGHTS } from "@/lib/first-party-release-collection";
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
} from "@/lib/model-card-collection";
import { parseTerminalBenchSnapshot } from "@/lib/terminal-bench-data";
import { parseTerminalBenchScienceSnapshot } from "@/lib/terminal-bench-science-data";

import robots from "./robots";
import sitemap, { indexableModelCards } from "./sitemap";

describe("public search discovery", () => {
  test("publishes unique canonical URLs with truthful benchmark freshness", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const datasetModifiedAt = codingAgentDatasetModifiedAt(parsed.value);
    const terminalBench = parseTerminalBenchSnapshot(terminalBenchData);
    if (!terminalBench.ok) throw terminalBench.error;
    const terminalBenchScience = parseTerminalBenchScienceSnapshot(
      terminalBenchScienceData,
    );
    if (!terminalBenchScience.ok) throw terminalBenchScience.error;
    const benchmarkPortfolioModifiedAt = [
      datasetModifiedAt,
      terminalBench.value.source.retrievedAt,
      terminalBenchScience.value.source.retrievedAt,
    ].sort((left, right) => Date.parse(right) - Date.parse(left))[0];
    if (benchmarkPortfolioModifiedAt === undefined) {
      throw new Error("Expected benchmark portfolio freshness.");
    }
    const modelCollectionModifiedAt = [
      datasetModifiedAt,
      ...FIRST_PARTY_RELEASE_HIGHLIGHTS.map(release => release.sourceModifiedAt),
    ].sort((left, right) => Date.parse(right) - Date.parse(left))[0];
    if (modelCollectionModifiedAt === undefined) {
      throw new Error("Expected model collection freshness.");
    }
    const entries = sitemap();
    const urls = entries.map(entry => entry.url);

    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every(url => new URL(url).origin === "https://aicharts.io")).toBeTrue();
    expect(urls).not.toContain("https://aicharts.io/preview");
    expect(urls).not.toContain("https://aicharts.io/models/preview");
    expect(entries.find(entry => entry.url === "https://aicharts.io/")?.lastModified)
      .toBe(benchmarkPortfolioModifiedAt);
    expect(entries.find(entry => entry.url.endsWith(CODING_AGENT_DATASET_PATH))?.lastModified)
      .toBe(benchmarkPortfolioModifiedAt);
    const subsidy = parseGptSubsidySnapshot(gptSubsidyData);
    if (!subsidy.ok) throw subsidy.error;
    expect(entries.find(entry => entry.url.endsWith("/gpt-subsidy"))?.lastModified)
      .toBe(gptSubsidyPageModifiedAt(subsidy.value));
    const cardEntries = entries.filter(entry => entry.url.includes("/models/"));
    const modelsEntry = entries.find(entry => entry.url.endsWith("/models"));
    expect(modelsEntry?.lastModified).toBe(modelCollectionModifiedAt);
    expect(modelsEntry?.images).toEqual([
      new URL(MODEL_CARD_COLLECTION_SOCIAL_IMAGE_URL, "https://aicharts.io").toString(),
    ]);
    expect(cardEntries).toHaveLength(indexableModelCards().length);
    expect(cardEntries.every(entry => entry.lastModified === datasetModifiedAt)).toBe(true);
    expect(cardEntries.every(entry => entry.images?.length === 1)).toBe(true);
    expect(new Date(datasetModifiedAt).getTime())
      .toBeLessThanOrEqual(new Date(parsed.value.source.retrievedAt).getTime());
  });

  test("keeps provisional model-card routes out of the sitemap", () => {
    const canonical = MODEL_CARD_PRESENTATIONS[0];
    if (canonical === undefined) throw new Error("Expected a model-card fixture.");
    const provisionalIdentity = {
      ...canonical,
      canonicalModelId: "unlisted/new-model.1234567890abcdef12345678",
      path: "/models/unlisted/new-model.1234567890abcdef12345678/max" as const,
    };
    const provisionalProfile = {
      ...canonical,
      path: "/models/openai/gpt-5.6-sol/upstream.preview.1234567890abcdef12345678" as const,
      profileSlug: "upstream.preview.1234567890abcdef12345678",
    };

    expect(indexableModelCards([
      canonical,
      provisionalIdentity,
      provisionalProfile,
    ])).toEqual([canonical]);
  });

  test("allows ordinary search and ChatGPT Search crawlers", () => {
    expect(robots()).toEqual({
      host: "https://aicharts.io",
      rules: [
        { allow: "/", userAgent: "*" },
        { allow: "/", userAgent: "OAI-SearchBot" },
      ],
      sitemap: "https://aicharts.io/sitemap.xml",
    });
  });
});
