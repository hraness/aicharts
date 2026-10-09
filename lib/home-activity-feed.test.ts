import { describe, expect, test } from "bun:test";

import {
  HOME_ACTIVITY_FEED,
  HOME_ACTIVITY_FEED_LIMIT,
  HOME_ACTIVITY_MODEL_LIMIT,
  HOME_ACTIVITY_NOTE_LIMIT,
} from "./home-activity-feed";
import { PUBLIC_MODEL_CARD_PATHS } from "./public-analytics-routes";

describe("home activity feed", () => {
  test("mixes recent models and notes without exceeding the compact cap", () => {
    expect(HOME_ACTIVITY_FEED.length).toBeGreaterThan(0);
    expect(HOME_ACTIVITY_FEED.length).toBeLessThanOrEqual(HOME_ACTIVITY_FEED_LIMIT);
    expect(HOME_ACTIVITY_FEED.filter(item => item.kind === "model").length)
      .toBeLessThanOrEqual(HOME_ACTIVITY_MODEL_LIMIT);
    expect(HOME_ACTIVITY_FEED.filter(item => item.kind === "note").length)
      .toBeLessThanOrEqual(HOME_ACTIVITY_NOTE_LIMIT);
    // Which models are newest changes with every data refresh, so check the
    // feed's shape: it holds models, and each links to a published model route.
    const models = HOME_ACTIVITY_FEED.filter(item => item.kind === "model");
    expect(models.length).toBeGreaterThan(0);
    for (const item of models) {
      expect(PUBLIC_MODEL_CARD_PATHS as readonly string[]).toContain(item.href);
    }
    expect(HOME_ACTIVITY_FEED.some(item => (
      item.title === "Claude Opus 5.5"
      && item.href.includes("claude-opus-5/")
    ))).toBeFalse();
    for (let index = 1; index < HOME_ACTIVITY_FEED.length; index += 1) {
      const previous = HOME_ACTIVITY_FEED[index - 1];
      const current = HOME_ACTIVITY_FEED[index];
      if (previous === undefined || current === undefined) continue;
      expect(previous.occurredOn >= current.occurredOn).toBeTrue();
    }
  });
});
