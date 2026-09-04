import { describe, expect, test } from "bun:test";

import snapshotJson from "../data/artificial-analysis-intelligence.json";
import {
  ARTIFICIAL_ANALYSIS_INTELLIGENCE_VERSION,
  parseArtificialAnalysisIntelligenceSnapshot,
  validateArtificialAnalysisIntelligenceReplacement,
  type ArtificialAnalysisIntelligenceSnapshot,
} from "./artificial-analysis-intelligence-data";

function checkedSnapshot(): ArtificialAnalysisIntelligenceSnapshot {
  const parsed = parseArtificialAnalysisIntelligenceSnapshot(snapshotJson);
  if (!parsed.ok) throw parsed.error;
  return structuredClone(parsed.value);
}

function reparsed(
  candidate: ArtificialAnalysisIntelligenceSnapshot,
): ArtificialAnalysisIntelligenceSnapshot {
  const parsed = parseArtificialAnalysisIntelligenceSnapshot(candidate);
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
}

describe("Artificial Analysis Intelligence snapshot", () => {
  test("validates the checked v4.1.1 snapshot and its source selection summary", () => {
    const snapshot = checkedSnapshot();

    expect(snapshot.benchmark.version).toBe(ARTIFICIAL_ANALYSIS_INTELLIGENCE_VERSION);
    expect(snapshot.benchmark.evaluations).toHaveLength(9);
    expect(snapshot.selection.measuredCompleteRecordCount).toBe(snapshot.records.length);
    expect(snapshot.selection.sourceRecordCount).toBeGreaterThanOrEqual(snapshot.records.length);
    expect(snapshot.selection.positiveCostRecordCount).toBe(
      snapshot.records.filter(record => record.costUsdPerTask !== null).length,
    );
  });

  test("retains complete GPT-6 Astra and GPT-5.6 Sol max observations", () => {
    const snapshot = checkedSnapshot();
    const astra = snapshot.records.find(record => record.slug === "gpt-6-astra");
    const sol = snapshot.records.find(record => record.slug === "gpt-5-6-sol");

    expect(astra).toMatchObject({
      creator: { slug: "openai" },
      effort: { slug: "max" },
      release: { slug: "gpt-6-astra" },
    });
    expect(sol).toMatchObject({
      creator: { slug: "openai" },
      effort: { slug: "max" },
      release: { slug: "gpt-5-6-sol" },
    });
    expect(astra?.intelligenceIndex).toBeGreaterThanOrEqual(0);
    expect(astra?.outputTokensPerTask.total).toBeGreaterThan(0);
    expect(astra?.costUsdPerTask?.total).toBeGreaterThan(0);
    expect(sol?.intelligenceIndex).toBeGreaterThanOrEqual(0);
    expect(sol?.outputTokensPerTask.total).toBeGreaterThan(0);
    expect(sol?.costUsdPerTask?.total).toBeGreaterThan(0);
  });

  test("rejects version drift, inconsistent sums, duplicate ids, and noncanonical URLs", () => {
    const wrongVersion: unknown = checkedSnapshot();
    (wrongVersion as { benchmark: { version: string } }).benchmark.version = "4.1.2";
    expect(parseArtificialAnalysisIntelligenceSnapshot(wrongVersion).ok).toBeFalse();

    const negativeIndex = checkedSnapshot();
    negativeIndex.records[0]!.intelligenceIndex = -1;
    expect(parseArtificialAnalysisIntelligenceSnapshot(negativeIndex).ok).toBeFalse();

    const aboveScaleIndex = checkedSnapshot();
    aboveScaleIndex.records[0]!.intelligenceIndex = 100.000_001;
    expect(parseArtificialAnalysisIntelligenceSnapshot(aboveScaleIndex).ok).toBeFalse();

    const wrongTokenSum = checkedSnapshot();
    wrongTokenSum.records[0]!.outputTokensPerTask.total += 1;
    expect(parseArtificialAnalysisIntelligenceSnapshot(wrongTokenSum).ok).toBeFalse();

    const wrongCostSum = checkedSnapshot();
    wrongCostSum.records[0]!.costUsdPerTask!.input += 1;
    expect(parseArtificialAnalysisIntelligenceSnapshot(wrongCostSum).ok).toBeFalse();

    const duplicateId = checkedSnapshot();
    duplicateId.records[1]!.id = duplicateId.records[0]!.id;
    expect(parseArtificialAnalysisIntelligenceSnapshot(duplicateId).ok).toBeFalse();

    const wrongUrl = checkedSnapshot();
    wrongUrl.records[0]!.detailsUrl = "https://artificialanalysis.ai/models/not-this-model";
    expect(parseArtificialAnalysisIntelligenceSnapshot(wrongUrl).ok).toBeFalse();
  });

  test("rejects count, stable-id, semantic-slug, and positive-cost coverage regressions", () => {
    const previous = checkedSnapshot();

    const rowDrop = checkedSnapshot();
    rowDrop.records = rowDrop.records.slice(
      0,
      Math.max(50, Math.floor(previous.records.length * 0.79)),
    );
    rowDrop.selection.measuredCompleteRecordCount = rowDrop.records.length;
    rowDrop.selection.positiveCostRecordCount = rowDrop.records.filter(
      record => record.costUsdPerTask !== null,
    ).length;
    expect(validateArtificialAnalysisIntelligenceReplacement(
      previous,
      reparsed(rowDrop),
    ).ok).toBeFalse();

    const idDrift = checkedSnapshot();
    const overlapRegressionCount = Math.ceil(previous.records.length * 0.21);
    idDrift.records.slice(0, overlapRegressionCount).forEach((record, index) => {
      record.id = `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    });
    expect(validateArtificialAnalysisIntelligenceReplacement(
      previous,
      reparsed(idDrift),
    ).ok).toBeFalse();

    const slugDrift = checkedSnapshot();
    slugDrift.records.slice(0, overlapRegressionCount).forEach((record, index) => {
      record.slug = `replacement-model-${index}`;
      record.detailsUrl = `https://artificialanalysis.ai/models/${record.slug}`;
    });
    expect(validateArtificialAnalysisIntelligenceReplacement(
      previous,
      reparsed(slugDrift),
    ).ok).toBeFalse();

    const costDrop = checkedSnapshot();
    const costRegressionCount = Math.ceil(
      previous.selection.positiveCostRecordCount * 0.21,
    );
    costDrop.records.filter(record => record.costUsdPerTask !== null)
      .slice(0, costRegressionCount)
      .forEach(record => { record.costUsdPerTask = null; });
    costDrop.selection.positiveCostRecordCount = costDrop.records.filter(
      record => record.costUsdPerTask !== null,
    ).length;
    expect(validateArtificialAnalysisIntelligenceReplacement(
      previous,
      reparsed(costDrop),
    ).ok).toBeFalse();
  });
});
