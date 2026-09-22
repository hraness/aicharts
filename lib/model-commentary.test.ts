import { describe, expect, test } from "bun:test";

import commentaryData from "@/data/model-commentary.json";

import {
  MODEL_COMMENTARY,
  officialXStatusUrl,
  parseModelCommentary,
} from "./model-commentary";

describe("model commentary", () => {
  test("admits the checked Deedy MiMo note", () => {
    const parsed = parseModelCommentary(commentaryData);
    expect(parsed.ok).toBeTrue();
    const mimo = MODEL_COMMENTARY.notes.find(note => (
      note.canonicalModelId === "xiaomi/mimo-v2-6-pro"
    ));
    expect(mimo?.tweets).toHaveLength(1);
    const tweet = mimo?.tweets[0];
    expect(tweet).toMatchObject({
      authorHandle: "deedydas",
      statusId: "2102293684767412393",
      url: "https://x.com/deedydas/status/2102293684767412393",
    });
    if (tweet === undefined) return;
    expect(officialXStatusUrl(tweet)).toBe(tweet.url);
    expect(tweet.text).toContain("Xiaomi just dropped Mimo 2.6 Pro");
  });

  test("rejects a URL that is not the public status for that handle and id", () => {
    const parsed = parseModelCommentary({
      schemaVersion: 1,
      notes: [{
        canonicalModelId: "xiaomi/mimo-v2-6-pro",
        tweets: [{
          authorHandle: "deedydas",
          authorName: "Deedy",
          lang: "en",
          postedAt: "2026-09-22T07:07:27.000Z",
          statusId: "2102293684767412393",
          text: "Quoted text",
          url: "https://x.com/deedydas/status/2102293684767412393?s=20",
        }],
      }],
    });
    expect(parsed.ok).toBeFalse();
  });
});
