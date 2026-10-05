import { describe, expect, test } from "bun:test";

import {
  INDEX_MODEL_PAGES,
  INDEX_MODEL_PROFILE_SLUG,
  INDEX_MODEL_SNAPSHOT,
  findIndexModelPage,
  identityTokenCovers,
  intelligenceObservationForCard,
  intelligenceRecordCoversCard,
} from "./index-model-pages";
import { MODEL_CARD_PRESENTATIONS } from "./model-card-collection";

const opus5Card = {
  canonicalModelId: "anthropic/claude-opus-5",
  displayTitle: "Claude Opus 5",
  model: "Opus 5",
} as const;

function snapshotRelease(slug: string) {
  const record = INDEX_MODEL_SNAPSHOT.records.find(candidate => (
    candidate.release.slug === slug
  ));
  if (record === undefined) {
    throw new Error(`Expected an Intelligence record for ${slug}.`);
  }
  return record;
}

describe("Index-only model pages", () => {
  test("publishes recent Index releases that coding cards do not already cover", () => {
    expect(INDEX_MODEL_PAGES.length).toBeGreaterThan(0);
    const mimo = INDEX_MODEL_PAGES.find(page => page.canonicalModelId === "xiaomi/mimo-v2-6-pro");
    expect(mimo).toMatchObject({
      displayTitle: "MiMo-V2.6-Pro",
      path: "/models/xiaomi/mimo-v2-6-pro/index",
      profileSlug: INDEX_MODEL_PROFILE_SLUG,
      providerId: "xiaomi",
    });
    expect(mimo?.intelligenceIndex).toBeGreaterThan(0);
    expect(findIndexModelPage({
      creatorSlug: "xiaomi",
      modelSlug: "mimo-v2-6-pro",
      profileSlug: "index",
    })?.path).toBe("/models/xiaomi/mimo-v2-6-pro/index");
    for (const page of INDEX_MODEL_PAGES) {
      expect(MODEL_CARD_PRESENTATIONS.some(card => card.path === page.path)).toBeFalse();
    }
  });

  test("folds Claude Opus 5.5 into its coding card instead of an Index-only page", () => {
    const opus55 = snapshotRelease("claude-opus-5-5");
    const opus55Card = MODEL_CARD_PRESENTATIONS.find(card => (
      card.canonicalModelId === "anthropic/claude-opus-5.5"
    ));
    expect(opus55Card?.path).toBe("/models/anthropic/claude-opus-5.5/max");
    expect(opus55Card === undefined
      ? undefined
      : intelligenceObservationForCard(opus55Card)?.release.slug).toBe("claude-opus-5-5");
    expect(opus55.releaseDate).toBe("2026-09-22");
    expect(INDEX_MODEL_PAGES.some(page => (
      page.path === "/models/anthropic/claude-opus-5-5/index"
    ))).toBeFalse();
    expect(findIndexModelPage({
      creatorSlug: "anthropic",
      modelSlug: "claude-opus-5-5",
      profileSlug: "index",
    })).toBeUndefined();
    expect(findIndexModelPage({
      creatorSlug: "anthropic",
      modelSlug: "claude-opus-5",
      profileSlug: "index",
    })).toBeUndefined();
    expect(intelligenceRecordCoversCard(opus55, opus5Card)).toBeFalse();
    expect(MODEL_CARD_PRESENTATIONS.some(card => (
      card.canonicalModelId === "anthropic/claude-opus-5"
      && intelligenceObservationForCard(card)?.release.slug === "claude-opus-5-5"
    ))).toBeFalse();
  });

  test("gives no Index-only page to a model that has a catalogued coding card", () => {
    for (const retired of [
      "/models/anthropic/claude-opus-5-5/index",
      "/models/anthropic/claude-sonnet-5-5/index",
      "/models/google/gemini-4-argon/index",
      "/models/openai/gpt-6-sol/index",
      "/models/openai/gpt-6-luna/index",
      "/models/openai/gpt-6-1-sol/index",
      "/models/xai/grok-4-7/index",
    ]) {
      expect(INDEX_MODEL_PAGES.some(page => page.path === retired)).toBeFalse();
    }
  });

  test("keeps effort suffixes on the same model and rejects version digits", () => {
    expect(identityTokenCovers("Claude Opus 5.5 (max with fallback)", "Claude Opus 5.5")).toBeTrue();
    expect(identityTokenCovers("claude-opus-5-max", "claude-opus-5")).toBeTrue();
    expect(identityTokenCovers("claude-opus-5-5", "claude-opus-5")).toBeFalse();
    expect(identityTokenCovers("claude-opus-5.5", "Claude Opus 5")).toBeFalse();
    expect(identityTokenCovers("Claude Fable 5.1", "Claude Fable 5")).toBeFalse();
  });
});
