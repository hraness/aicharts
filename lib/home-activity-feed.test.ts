import { describe, expect, test } from "bun:test";

import {
  HOME_ACTIVITY_FEED,
  HOME_ACTIVITY_FEED_LIMIT,
  HOME_ACTIVITY_MODEL_LIMIT,
  HOME_ACTIVITY_NOTE_LIMIT,
} from "./home-activity-feed";

describe("home activity feed", () => {
  test("mixes recent models and notes without exceeding the compact cap", () => {
    expect(HOME_ACTIVITY_FEED.length).toBeGreaterThan(0);
    expect(HOME_ACTIVITY_FEED.length).toBeLessThanOrEqual(HOME_ACTIVITY_FEED_LIMIT);
    expect(HOME_ACTIVITY_FEED.filter(item => item.kind === "model").length)
      .toBeLessThanOrEqual(HOME_ACTIVITY_MODEL_LIMIT);
    expect(HOME_ACTIVITY_FEED.filter(item => item.kind === "note").length)
      .toBeLessThanOrEqual(HOME_ACTIVITY_NOTE_LIMIT);
    expect(HOME_ACTIVITY_FEED.some(item => (
      item.href === "/models/xiaomi/mimo-v2-6-pro/index"
      && item.title === "MiMo-V2.6-Pro"
    ))).toBeTrue();
    expect(HOME_ACTIVITY_FEED.some(item => (
      item.href === "/models/anthropic/claude-opus-5-5/index"
      && item.title === "Claude Opus 5.5"
    ))).toBeTrue();
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
