import { expect, test } from "bun:test";
import { assertProperty, fc } from "@/lib/property-test";
import { assignSeriesSlots, OTHER_SERIES_SLOT, SERIES_SLOTS, seriesIdFromKey } from "./series-colors";

test("known clients keep their hue regardless of rank; others fill free hues", () => {
  expect(assignSeriesSlots("client", ["claude", "codex"])).toEqual([3, 0]);
  expect(assignSeriesSlots("client", ["codex", "claude"])).toEqual([0, 3]);
  expect(assignSeriesSlots("client", ["amp", "claude", "cline"])).toEqual([0, 3, 1]);
  expect(assignSeriesSlots("model", ["a", "b", "c", "d", "e", "f", null])).toEqual([0, 1, 2, 3, 4, OTHER_SERIES_SLOT, OTHER_SERIES_SLOT]);
  expect(assignSeriesSlots("provider", ["anthropic", "openai", "google"])).toEqual([3, 0, 1]);
});

test("one-dimension group keys resolve to their raw value", () => {
  expect(seriesIdFromKey('["codex"]')).toBe("codex");
  expect(seriesIdFromKey('["codex","gpt-5"]')).toBeNull();
  expect(seriesIdFromKey("other")).toBeNull();
  expect(seriesIdFromKey("claude")).toBe("claude");
  expect(seriesIdFromKey("[not json")).toBeNull();
});

test("no two categories share a hue while a hue is still free, and slots stay in range", () => {
  const id = fc.constantFrom("codex", "claude", "cursor", "devin-cli", "amp", "cline", "opencode", "openai", "anthropic", "google", "gpt-5", null);
  assertProperty(fc.property(fc.constantFrom("client" as const, "provider" as const, "model" as const, null), fc.uniqueArray(id, { maxLength: 9 }), (dimension, ids) => {
    const slots = assignSeriesSlots(dimension, ids);
    expect(slots).toHaveLength(ids.length);
    for (const slot of slots) expect(slot >= 0 && slot <= OTHER_SERIES_SLOT).toBe(true);
    const hues = slots.filter(slot => slot !== OTHER_SERIES_SLOT);
    expect(new Set(hues).size).toBe(hues.length);
    expect(hues.length).toBe(Math.min(ids.length, SERIES_SLOTS));
  }), { numRuns: 200 });
});
