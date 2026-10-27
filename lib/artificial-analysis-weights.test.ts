import { describe, expect, test } from "bun:test";

import intelligenceV43 from "@/data/artificial-analysis-intelligence-v4-3.json";
import weightsRoster from "@/data/artificial-analysis-weights.json";

import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import {
  ARTIFICIAL_ANALYSIS_WEIGHTS_SCHEMA_VERSION,
  commitArtificialAnalysisWeights,
  deriveArtificialAnalysisWeightRecords,
  deriveArtificialAnalysisWeightsSnapshot,
  parseArtificialAnalysisWeightsSnapshot,
  preserveArtificialAnalysisWeightsRetrievalTime,
  type ArtificialAnalysisWeightSourceModel,
} from "./artificial-analysis-weights";
import { ok } from "./result";

const parsedWeights = parseArtificialAnalysisWeightsSnapshot(weightsRoster);
if (!parsedWeights.ok) throw parsedWeights.error;
const snapshot = parsedWeights.value;

const parsedIntelligence = parseArtificialAnalysisIntelligenceV43Snapshot(intelligenceV43);
if (!parsedIntelligence.ok) throw parsedIntelligence.error;

function sourceModel(
  overrides: Partial<ArtificialAnalysisWeightSourceModel> & Pick<ArtificialAnalysisWeightSourceModel, "slug">,
): ArtificialAnalysisWeightSourceModel {
  return {
    creator: { slug: overrides.creator?.slug ?? "kimi" },
    deprecated: overrides.deprecated ?? false,
    isOpenWeights: overrides.isOpenWeights ?? true,
    release: { slug: overrides.release?.slug ?? overrides.slug },
    slug: overrides.slug,
  };
}

describe("Artificial Analysis weights roster", () => {
  test("parses the committed full roster including deprecated identities", () => {
    expect(snapshot.schemaVersion).toBe(ARTIFICIAL_ANALYSIS_WEIGHTS_SCHEMA_VERSION);
    expect(snapshot.records.length).toBe(snapshot.source.sourceRecordCount);
    expect(snapshot.records.length).toBeGreaterThanOrEqual(100);
    expect(snapshot.records.length).toBeGreaterThan(parsedIntelligence.value.records.length);

    const kimiK3 = snapshot.records.find(record => record.slug === "kimi-k3");
    expect(kimiK3).toEqual({
      creatorSlug: "kimi",
      deprecated: true,
      open: true,
      releaseSlug: "kimi-k3",
      slug: "kimi-k3",
    });
    expect(snapshot.records.find(record => record.slug === "kimi-k3-1-pro")).toMatchObject({
      deprecated: false,
      open: false,
    });
    expect(snapshot.records.find(record => record.slug === "deepseek-v4-1-flash")).toMatchObject({
      open: true,
    });
    expect(snapshot.records.find(record => record.slug === "muse-wonder-full")).toMatchObject({
      open: false,
    });
    expect(snapshot.records.find(record => record.slug === "muse-spark-1-3")).toMatchObject({
      open: false,
    });
    expect(snapshot.records.find(record => record.slug === "claude-opus-5-5")).toMatchObject({
      creatorSlug: "anthropic",
      open: false,
    });
  });

  test("keeps Intelligence v4.3 isOpenWeights in agreement with the roster slug", () => {
    const bySlug = new Map(snapshot.records.map(record => [record.slug, record]));
    for (const record of parsedIntelligence.value.records) {
      if (record.weights === undefined) continue;
      const roster = bySlug.get(record.slug);
      expect(roster, record.slug).toBeDefined();
      expect(roster?.open).toBe(record.weights.open);
      expect(roster?.creatorSlug).toBe(record.creator.slug);
    }
  });

  test("derives sorted identities from the source models payload", () => {
    const records = deriveArtificialAnalysisWeightRecords([
      sourceModel({ slug: "kimi-k3-1-pro", isOpenWeights: false }),
      sourceModel({ slug: "kimi-k3", deprecated: true, isOpenWeights: true }),
    ]);
    expect(records.map(record => record.slug)).toEqual(["kimi-k3", "kimi-k3-1-pro"]);
    expect(records[0]?.deprecated).toBeTrue();
    expect(records[0]?.open).toBeTrue();
    expect(records[1]?.open).toBeFalse();
  });

  test("preserves retrieval time when only the clock moved", async () => {
    const models = Array.from({ length: 100 }, (_, index) => sourceModel({
      slug: index === 0 ? "kimi-k3" : `excluded-${index}`,
      deprecated: index === 0,
    }));
    const derived = deriveArtificialAnalysisWeightsSnapshot(
      models,
      "2026-10-27T08:20:03.356Z",
    );
    if (!derived.ok) throw derived.error;
    const later = {
      ...derived.value,
      source: { ...derived.value.source, retrievedAt: "2026-10-27T09:00:00.000Z" },
    };
    expect(preserveArtificialAnalysisWeightsRetrievalTime(derived.value, later)).toBe(derived.value);

    const writes: unknown[] = [];
    const committed = await commitArtificialAnalysisWeights(
      models,
      "2026-10-27T09:00:00.000Z",
      {
        read: async () => ok(derived.value),
        write: async snapshotValue => { writes.push(snapshotValue); },
      },
    );
    expect(committed.ok).toBeTrue();
    expect(writes).toEqual([derived.value]);
  });
});
