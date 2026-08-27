import { describe, expect, test } from "bun:test";

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
import { MODEL_CARD_PRESENTATIONS } from "@/lib/model-card-collection";

import robots from "./robots";
import sitemap, { indexableModelCards } from "./sitemap";

describe("public search discovery", () => {
  test("publishes unique canonical URLs with truthful benchmark freshness", () => {
    const parsed = parseCodingAgentSnapshot(codingAgentData);
    if (!parsed.ok) throw parsed.error;
    const modifiedAt = codingAgentDatasetModifiedAt(parsed.value);
    const entries = sitemap();
    const urls = entries.map(entry => entry.url);

    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every(url => new URL(url).origin === "https://aicharts.io")).toBeTrue();
    expect(entries.find(entry => entry.url === "https://aicharts.io/")?.lastModified)
      .toBe(modifiedAt);
    expect(entries.find(entry => entry.url.endsWith(CODING_AGENT_DATASET_PATH))?.lastModified)
      .toBe(modifiedAt);
    const subsidy = parseGptSubsidySnapshot(gptSubsidyData);
    if (!subsidy.ok) throw subsidy.error;
    expect(entries.find(entry => entry.url.endsWith("/gpt-subsidy"))?.lastModified)
      .toBe(gptSubsidyPageModifiedAt(subsidy.value));
    const cardEntries = entries.filter(entry => entry.url.includes("/models/"));
    const modelsEntry = entries.find(entry => entry.url.endsWith("/models"));
    expect(modelsEntry?.lastModified).toBe(modifiedAt);
    expect(modelsEntry?.images).toEqual([
      "https://aicharts.io/models/opengraph-image",
    ]);
    expect(cardEntries).toHaveLength(indexableModelCards().length);
    expect(cardEntries.every(entry => entry.lastModified === modifiedAt)).toBe(true);
    expect(cardEntries.every(entry => entry.images?.length === 1)).toBe(true);
    expect(new Date(modifiedAt).getTime())
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
