import { describe, expect, test } from "bun:test";
import rawDataset from "../data/releases.json";
import { API_OBJECTS, type ApiObject } from "./api";
import type { ReleaseDataset } from "./types";

const dataset = rawDataset as unknown as ReleaseDataset;

const documented = (id: ApiObject["id"]) =>
  API_OBJECTS.find((o) => o.id === id)!.fields.map((f) => f.name);

/** Each distinct key order among the objects; keys in `inline` list their children as `parent.child`. */
function keyOrders(objects: readonly object[], inline: readonly string[] = []): string[][] {
  const seen = new Map<string, string[]>();
  for (const value of objects) {
    const names = Object.entries(value).flatMap(([key, child]) =>
      inline.includes(key) ? Object.keys(child as object).map((sub) => `${key}.${sub}`) : [key],
    );
    seen.set(names.join(), names);
  }
  return [...seen.values()];
}

describe("API reference", () => {
  const releases = dataset.releases;
  const cases: readonly (readonly [ApiObject["id"], readonly object[], readonly string[]])[] = [
    ["response", [dataset], []],
    ["release", releases, []],
    ["terminalBench", releases.flatMap((r) => (r.terminalBench ? [r.terminalBench] : [])), ["tokensPerTask"]],
    ["epoch", releases.flatMap((r) => r.epoch), []],
    ["pricing", releases.flatMap((r) => (r.pricing ? [r.pricing] : [])), []],
    ["source", dataset.sources, []],
  ];

  for (const [id, objects, inline] of cases) {
    test(`lists every ${id} field in the order the data has them`, () => {
      expect(objects.length).toBeGreaterThan(0);
      expect(keyOrders(objects, inline)).toEqual([documented(id)]);
    });
  }

  test("documents each object once", () => {
    expect(new Set(API_OBJECTS.map((o) => o.id)).size).toBe(API_OBJECTS.length);
    expect(API_OBJECTS.map((o) => o.id).sort()).toEqual(cases.map(([id]) => id).sort());
  });
});
