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

  test("admits Claude Opus 5.5 on its own Index route instead of Opus 5 Max", () => {
    const opus55 = snapshotRelease("claude-opus-5-5");
    const page = INDEX_MODEL_PAGES.find(candidate => (
      candidate.canonicalModelId === "anthropic/claude-opus-5-5"
    ));
    expect(page).toMatchObject({
      creatorSlug: "anthropic",
      detailsUrl: "https://artificialanalysis.ai/models/claude-opus-5-5",
      displayTitle: "Claude Opus 5.5",
      intelligenceIndex: opus55.intelligenceIndex,
      modelSlug: "claude-opus-5-5",
      path: "/models/anthropic/claude-opus-5-5/index",
      profileSlug: INDEX_MODEL_PROFILE_SLUG,
      providerId: "anthropic",
      providerName: "Anthropic",
      releaseDate: "2026-09-22",
    });
    expect(page?.costUsdPerTask).toBe(opus55.costUsdPerTask?.total ?? null);
    expect(findIndexModelPage({
      creatorSlug: "anthropic",
      modelSlug: "claude-opus-5-5",
      profileSlug: "index",
    })?.path).toBe("/models/anthropic/claude-opus-5-5/index");
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

  test("keeps effort suffixes on the same model and rejects version digits", () => {
    expect(identityTokenCovers("Claude Opus 5.5 (max with fallback)", "Claude Opus 5.5")).toBeTrue();
    expect(identityTokenCovers("claude-opus-5-max", "claude-opus-5")).toBeTrue();
    expect(identityTokenCovers("claude-opus-5-5", "claude-opus-5")).toBeFalse();
    expect(identityTokenCovers("claude-opus-5.5", "Claude Opus 5")).toBeFalse();
    expect(identityTokenCovers("Claude Fable 5.1", "Claude Fable 5")).toBeFalse();
  });
});
