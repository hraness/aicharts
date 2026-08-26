import { describe, expect, test } from "bun:test";

import { MODEL_CARD_PRESENTATIONS } from "./model-card-collection";
import {
  compactModelCardHarnessLabel,
  formatModelCardMetricRange,
  formatModelCardSourceDate,
  modelCardIndexingPolicy,
} from "./model-card-presentation";

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
    const missing = MODEL_CARD_PRESENTATIONS
      .flatMap(card => [...card.performance, ...card.economics])
      .find(stat => !stat.available);
    expect(missing).toMatchObject({ available: false, value: "–" });
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

  test("preserves the dedicated fast and max foil identities", () => {
    expect(MODEL_CARD_PRESENTATIONS.find(card => card.cardClass === "fast")?.foilPreset).toBe("fast");
    expect(MODEL_CARD_PRESENTATIONS.find(card => card.cardClass === "max")?.foilPreset).toBe("max");
  });
});
