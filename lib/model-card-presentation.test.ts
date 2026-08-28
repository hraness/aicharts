import { describe, expect, test } from "bun:test";

import { MODEL_CARD_PRESENTATIONS } from "./model-card-collection";
import {
  cleanModelCardDisplayName,
  compactModelCardHarnessLabel,
  formatModelCardListingDate,
  formatModelCardDisplayTitle,
  formatModelCardMetricRange,
  formatModelCardSourceDate,
  modelCardListingAccessibleLabel,
  modelCardIndexingPolicy,
} from "./model-card-presentation";
import { assertProperty, fc } from "./property-test";

describe("model card presentation", () => {
  test("shows one observed value without inventing precision", () => {
    expect(formatModelCardMetricRange("aaIndex", {
      max: 61,
      min: 61,
      observationCount: 1,
    })).toBe("61.0");
  });

  test("preserves honest observed ranges", () => {
    expect(formatModelCardMetricRange("costUsd", {
      max: 7.08,
      min: 5.07,
      observationCount: 2,
    })).toBe("$5.07–$7.08");
  });

  test("keeps missing observations explicit", () => {
    expect(formatModelCardMetricRange("totalTokens", {
      max: null,
      min: null,
      observationCount: 0,
    })).toBe("–");
  });

  test("marks provisional routes noindex while allowing link discovery", () => {
    expect(modelCardIndexingPolicy({
      canonicalModelId: "openai/gpt-5.6-sol",
      profileSlug: "max",
    })).toBeUndefined();
    expect(modelCardIndexingPolicy({
      canonicalModelId: "unlisted/new-model.1234567890abcdef12345678",
      profileSlug: "max",
    })).toEqual({ follow: true, index: false });
    expect(modelCardIndexingPolicy({
      canonicalModelId: "openai/gpt-5.6-sol",
      profileSlug: "upstream.preview.1234567890abcdef12345678",
    })).toEqual({ follow: true, index: false });
  });

  test("derives a stable UTC source date and sorted unique harness context", () => {
    expect(formatModelCardSourceDate("2026-08-18T23:59:59.000Z")).toBe("Aug 18, 2026");
    const multiHarness = MODEL_CARD_PRESENTATIONS.find(card => card.agentNames.length > 1);
    if (multiHarness === undefined) throw new Error("Expected a multi-harness card fixture.");
    expect(multiHarness.agentNames).toEqual([...multiHarness.agentNames].sort());
    expect(new Set(multiHarness.agentNames).size).toBe(multiHarness.agentNames.length);
    expect(compactModelCardHarnessLabel(multiHarness.agentNames)).toBe(
      `${multiHarness.agentNames[0]} +${multiHarness.agentNames.length - 1}`,
    );
  });

  test("presents source-listing dates with explicit OpenRouter provenance", () => {
    const listed = MODEL_CARD_PRESENTATIONS.find(card => (
      card.listing?.sourceAddedAt === "2026-08-13T17:03:01.000Z"
    ));
    expect(listed?.listing).toEqual({
      id: "google/gemini-3.7-flash",
      source: "OpenRouter",
      sourceAddedAt: "2026-08-13T17:03:01.000Z",
    });
    if (listed?.listing === null || listed?.listing === undefined) {
      throw new Error("Expected a current card with OpenRouter listing metadata.");
    }
    expect(formatModelCardListingDate(listed.listing.sourceAddedAt)).toBe("13 AUG 2026");
    expect(modelCardListingAccessibleLabel(listed.listing)).toBe(
      "Listed by OpenRouter on Aug 13, 2026; not an official release date.",
    );
  });

  test("rejects malformed and impossible source-listing timestamps", () => {
    expect(() => formatModelCardListingDate("Aug 13, 2026")).toThrow("valid ISO timestamp");
    expect(() => formatModelCardListingDate("2026-02-30T00:00:00.000Z"))
      .toThrow("valid ISO timestamp");
    expect(() => modelCardListingAccessibleLabel({
      id: "openai/example",
      source: "OpenRouter",
      sourceAddedAt: "2026-08-13T25:00:00.000Z",
    })).toThrow("valid ISO timestamp");
  });

  test("uses one neutral foil field so the provider and model inks own color", () => {
    expect(new Set(MODEL_CARD_PRESENTATIONS.map(card => card.foilPreset))).toEqual(
      new Set(["etched"]),
    );
  });

  test("turns operational source labels into a clean collectible title", () => {
    const fable = MODEL_CARD_PRESENTATIONS.find(card => card.model.includes("with fallback"));
    expect(fable).toMatchObject({
      canonicalModelId: "anthropic/claude-fable-5",
      classLabel: "Max",
      displayTitle: "Fable 5 Max",
      harnessLabel: "Claude Code",
      model: "Fable 5 (with fallback)",
      profileLabel: "Max",
      visualClass: "max",
    });
    expect(cleanModelCardDisplayName("Qwen3.7 Plus (thinking)")).toBe("Qwen3.7 Plus");
    expect(cleanModelCardDisplayName("Model Prime (with fallback) (thinking)")).toBe("Model Prime");
    expect(formatModelCardDisplayTitle("Qwen3.8 Max", "Standard")).toBe("Qwen3.8 Max");
    expect(formatModelCardDisplayTitle("Model Prime Max", "Max")).toBe("Model Prime Max");
    expect(formatModelCardDisplayTitle("Fable 5 (max) (with fallback)", "Max")).toBe(
      "Fable 5 Max",
    );
    expect(formatModelCardDisplayTitle("Model Prime xhigh", "X-high")).toBe(
      "Model Prime X-high",
    );
    expect(MODEL_CARD_PRESENTATIONS.find(card => card.visualClass === "thinking")).toMatchObject({
      displayTitle: "Qwen3.7 Plus Thinking",
      model: "Qwen3.7 Plus (thinking)",
    });
  });

  test("combines a non-default profile exactly once", () => {
    const word = fc.constantFrom("Model", "Alpha", "5", "Prime", "Vision");
    const baseName = fc.array(word, { minLength: 1, maxLength: 5 }).map(words => words.join(" "));
    const profile = fc.constantFrom(
      ["Standard", "standard"] as const,
      ["Low", "low"] as const,
      ["Medium", "medium"] as const,
      ["High", "high"] as const,
      ["X-high", "xhigh"] as const,
      ["Max", "max"] as const,
    );
    assertProperty(fc.property(baseName, profile, (base, [profileLabel, profileAlias]) => {
      const sourceName = profileLabel === "Standard" || base.endsWith(profileLabel)
        ? base
        : `${base} (${profileAlias})`;
      const title = formatModelCardDisplayTitle(sourceName, profileLabel);
      expect(formatModelCardDisplayTitle(title, profileLabel)).toBe(title);
      expect(title).not.toMatch(/\s{2,}/u);
      expect(title).not.toMatch(/\((?:thinking|with fallback)\)$/iu);
      expect(title).not.toMatch(/\((?:low|medium|high|max|xhigh)\)$/iu);
    }));
  });
});
