import { describe, expect, test } from "bun:test";

import {
  INDEX_MODEL_PAGES,
  INDEX_MODEL_PROFILE_SLUG,
  findIndexModelPage,
} from "./index-model-pages";
import { MODEL_CARD_PRESENTATIONS } from "./model-card-collection";

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
});
