import { describe, expect, test } from "bun:test";

import codingAgentData from "@/data/coding-agents.json";
import gptSubsidyData from "@/data/gpt-subsidy.json";
import { parseCodingAgentSnapshot } from "@/lib/coding-agent-data";
import {
  CODING_AGENT_DATASET_PATH,
  codingAgentDatasetModifiedAt,
} from "@/lib/coding-agent-dataset";
import { parseGptSubsidySnapshot } from "@/lib/gpt-subsidy-data";

import robots from "./robots";
import sitemap from "./sitemap";

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
      .toBe(subsidy.value.generatedAt);
    expect(new Date(modifiedAt).getTime())
      .toBeLessThanOrEqual(new Date(parsed.value.source.retrievedAt).getTime());
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
