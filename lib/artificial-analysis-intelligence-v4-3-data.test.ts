import { describe, expect, test } from "bun:test";

import historical from "../data/artificial-analysis-intelligence.json";
import current from "../data/artificial-analysis-intelligence-v4-3.json";
import { parseArtificialAnalysisIntelligenceSnapshot, validateArtificialAnalysisIntelligenceReplacement } from "./artificial-analysis-intelligence-data";
import { parseArtificialAnalysisIntelligenceV43Snapshot } from "./artificial-analysis-intelligence-v4-3-data";
import { validateAtlasCatalog } from "./benchmark-atlas";
import { INTELLIGENCE_V43_ATLAS_DATASET, INTELLIGENCE_V43_ATLAS_ENTRY } from "./benchmark-atlas-intelligence-v4-3";

describe("Artificial Analysis Intelligence v4.3 snapshot", () => {
  test("admits only the exact new version, roster, and weights; preserves the old schema", () => {
    expect(parseArtificialAnalysisIntelligenceV43Snapshot(current).ok).toBeTrue();
    expect(parseArtificialAnalysisIntelligenceSnapshot(historical).ok).toBeTrue();
    expect(parseArtificialAnalysisIntelligenceV43Snapshot(historical).ok).toBeFalse();
    expect(parseArtificialAnalysisIntelligenceSnapshot(current).ok).toBeFalse();
    for (const mutate of [
      (value: typeof current) => { value.benchmark.version = "4.4"; },
      (value: typeof current) => { value.benchmark.evaluations[3] = "Terminal-Bench v2.1"; },
      (value: typeof current) => { value.benchmark.categoryWeightsPercent.agents = 34; },
    ]) {
      const value = structuredClone(current);
      mutate(value);
      expect(parseArtificialAnalysisIntelligenceV43Snapshot(value).ok).toBeFalse();
    }
  });

  test("retains all collection and native arithmetic guards", () => {
    for (const mutate of [
      (value: typeof current) => { value.records[1]!.id = value.records[0]!.id; },
      (value: typeof current) => { value.records[0]!.outputTokensPerTask.total += 1; },
      (value: typeof current) => { value.records[0]!.costUsdPerTask!.total += 1; },
      (value: typeof current) => { value.records[0]!.detailsUrl = "https://example.com/model"; },
      (value: typeof current) => { value.selection.measuredCompleteRecordCount += 1; },
      (value: typeof current) => { value.selection.positiveCostRecordCount += 1; },
      (value: typeof current) => { value.records.reverse(); },
    ]) {
      const value = structuredClone(current);
      mutate(value);
      expect(parseArtificialAnalysisIntelligenceV43Snapshot(value).ok).toBeFalse();
    }
  });

  test("rejects retrieval regression and excessive cohort loss within v4.3", () => {
    const parsed = parseArtificialAnalysisIntelligenceV43Snapshot(current);
    if (!parsed.ok) throw parsed.error;
    const previous = parsed.value;
    expect(validateArtificialAnalysisIntelligenceReplacement(previous, previous).ok).toBeTrue();
    const regressed = structuredClone(previous);
    regressed.source.retrievedAt = "2020-01-01T00:00:00.000Z";
    expect(validateArtificialAnalysisIntelligenceReplacement(previous, regressed).ok).toBeFalse();
    const reduced = structuredClone(previous);
    reduced.records = reduced.records.slice(0, Math.floor(previous.records.length * 0.79));
    expect(validateArtificialAnalysisIntelligenceReplacement(previous, reduced).ok).toBeFalse();
  });

  test("projects native values without mixing historical scores or fabricating uncertainty", () => {
    expect(validateAtlasCatalog([INTELLIGENCE_V43_ATLAS_ENTRY], [INTELLIGENCE_V43_ATLAS_DATASET]).ok).toBeTrue();
    expect(INTELLIGENCE_V43_ATLAS_DATASET.version).toBe("4.3");
    expect(INTELLIGENCE_V43_ATLAS_DATASET.points.length).toBe(current.records.length);
    for (const point of INTELLIGENCE_V43_ATLAS_DATASET.points) {
      const record = current.records.find(candidate => candidate.id === point.id)!;
      expect(point.score).toBe(record.intelligenceIndex);
      expect(point.costUsd).toBe(record.costUsdPerTask?.total ?? null);
      expect(point.uncertainty).toBeNull();
      expect(point.sourceUrl).toBe(record.detailsUrl);
    }
  });
});
