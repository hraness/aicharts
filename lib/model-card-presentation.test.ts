import { describe, expect, test } from "bun:test";

import {
  MODEL_CARD_PRESENTATIONS,
  MODEL_CARD_SNAPSHOT,
  MODEL_CARD_VARIANTS,
} from "./model-card-collection";
import {
  cleanModelCardDisplayName,
  compactModelCardHarnessLabel,
  createModelCardPresentation,
  formatModelCardDisplayTitle,
  formatModelCardMetricRange,
  formatModelCardReleaseDate,
  formatModelCardReleaseDateLong,
  formatModelCardReleaseStage,
  formatModelCardSourceDate,
  modelCardIndexingPolicy,
  modelCardReleaseAccessibleLabel,
  modelCardReleaseLabel,
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

  test("presents checked first-party release dates with official provenance", () => {
    const released = MODEL_CARD_PRESENTATIONS.find(card => (
      card.canonicalModelId === "google/gemini-3.7-flash"
    ));
    expect(released?.release).toMatchObject({
      releasedOn: "2026-08-13",
      stage: "public-release",
      status: "verified",
    });
    if (released?.release.status !== "verified") {
      throw new Error("Expected a current card with verified official release metadata.");
    }
    expect(formatModelCardReleaseDate(released.release.releasedOn)).toBe("13 AUG 2026");
    expect(formatModelCardReleaseDateLong(released.release.releasedOn)).toBe("Aug 13, 2026");
    expect(formatModelCardReleaseStage(released.release.stage)).toBe("Public release");
    expect(modelCardReleaseAccessibleLabel(released.release)).toBe(
      "Official release date: Aug 13, 2026. Verified from Introducing Gemini 3.7 Flash.",
    );
  });

  test("rejects malformed and impossible official release dates", () => {
    expect(() => formatModelCardReleaseDate("Aug 13, 2026"))
      .toThrow("valid ISO calendar date");
    expect(() => formatModelCardReleaseDate("2026-02-30"))
      .toThrow("valid ISO calendar date");
    expect(modelCardReleaseAccessibleLabel({
      canonicalModelId: "openai/example",
      reason: "No official date found.",
      researchedOn: "2026-08-13",
      status: "pending",
    })).toBe(
      "Official release date pending verification; researched Aug 13, 2026.",
    );
    expect(modelCardReleaseAccessibleLabel({
      canonicalModelId: "unlisted/example.1234567890abcdef12345678",
      observedOn: "2026-08-28",
      reason: "Awaiting first-party research.",
      status: "unreviewed",
    })).toBe(
      "Official release date pending review for this newly observed model identity; first observed in the benchmark snapshot on Aug 28, 2026.",
    );
  });

  test("discloses when a verified date applies to the base model", () => {
    const cognition = MODEL_CARD_PRESENTATIONS.find(card => (
      card.canonicalModelId === "cognition/swe-1.7"
    ));
    if (cognition?.release.status !== "verified") {
      throw new Error("Expected checked Cognition base-model release metadata.");
    }
    expect(modelCardReleaseLabel(cognition.release)).toBe("Base released");
    expect(modelCardReleaseAccessibleLabel(cognition.release)).toBe(
      "Official base-model release date for SWE-1.7: Jul 8, 2026. Verified from SWE-1.7: Frontier Intelligence at a Fraction of the Cost.",
    );
  });

  test("refuses to attach another model identity's release provenance", () => {
    const variant = MODEL_CARD_VARIANTS[0];
    const otherCard = MODEL_CARD_PRESENTATIONS.find(card => (
      card.canonicalModelId !== variant?.canonicalModelId
    ));
    if (variant === undefined || otherCard === undefined) {
      throw new Error("Expected two distinct model-card fixtures.");
    }
    expect(() => createModelCardPresentation(
      variant,
      1,
      1,
      MODEL_CARD_SNAPSHOT.source.retrievedAt,
      otherCard.release,
    )).toThrow("must match");
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
