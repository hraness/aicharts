import { expect, test } from "bun:test";

import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
import {
  GEMINI_4_ARGON_CODING_CONFIGURATION,
  GEMINI_4_ARGON_CODING_MODEL,
  gemini4ArgonCodingAgentPlacement,
  higherCostShares,
} from "./gemini-4-argon-placement";
import { codingAgentRecord } from "./grok-4-7-placement.test";
import { assertProperty, fc } from "./property-test";
import { CODING_COMPONENT_METRICS } from "./snapshot-placement";

const scoreArb = fc.double({ min: 0, max: 100, noNaN: true });
const costArb = fc.double({ min: 0.001, max: 50, noNaN: true });
const componentArb = fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null });
const codingRowArb = fc.record({
  aaIndex: fc.option(scoreArb, { nil: null }),
  costUsd: fc.option(costArb, { nil: null }),
  deepSwe: componentArb,
  sweAtlas: componentArb,
  terminalBench: componentArb,
});
const codingChartArb = fc.record({
  argon: codingRowArb.map(shape => codingAgentRecord({
    ...shape,
    ...GEMINI_4_ARGON_CODING_CONFIGURATION,
    aaIndex: shape.aaIndex ?? 50,
    costUsd: shape.costUsd ?? 5,
    id: "gemini-4-argon",
    setting: "default",
    settingRank: 0,
  })),
  googleRows: fc.array(codingRowArb, { maxLength: 4 })
    .map(shapes => shapes.map((shape, position) => codingAgentRecord({
      ...shape,
      ...GEMINI_4_ARGON_CODING_MODEL,
      agent: position % 2 === 0 ? "Antigravity SDK" : "Antigravity CLI",
      id: `google-${position}`,
      model: position % 2 === 0 ? GEMINI_4_ARGON_CODING_MODEL.model : "Gemini 3.8 Flash",
    }))),
  others: fc.array(codingRowArb, { maxLength: 24 })
    .map(shapes => shapes.map((shape, position) => codingAgentRecord({ ...shape, id: `other-${position}` }))),
});

function isCosted(record: ReturnType<typeof codingAgentRecord>): boolean {
  return record.benchmarks.aaIndex !== null && record.economics.costUsd !== null && record.economics.costUsd > 0;
}

test("the frontier below the placed row is exactly the frontier’s lower-scoring vertices, and cost falls with score along it", () => {
  assertProperty(fc.property(codingChartArb, ({ argon, googleRows, others }) => {
    const records = [...others, ...googleRows, argon];
    const placement = gemini4ArgonCodingAgentPlacement(records);
    if (placement === undefined) throw new Error("Argon row must carry an index and a cost.");
    const index = placement.record.benchmarks.aaIndex;
    const expected = aaIndexCostFrontier(records)
      .map(point => point.record)
      .filter(vertex => vertex.id !== placement.record.id && (vertex.benchmarks.aaIndex ?? Number.NaN) < index)
      .map(vertex => vertex.id)
      .toSorted();
    expect(placement.frontierBelow.map(step => step.record.id).toSorted()).toEqual(expected);
    for (let position = 0; position < placement.frontierBelow.length; position += 1) {
      const current = placement.frontierBelow[position];
      if (current === undefined) throw new Error("Descent is short.");
      expect(current.pointsBelow).toBeCloseTo(index - current.record.benchmarks.aaIndex, 9);
      expect(current.pointsBelow).toBeGreaterThan(0);
      expect(current.costMultiple).toBeCloseTo(current.record.economics.costUsd / placement.record.economics.costUsd, 9);
      const previous = placement.frontierBelow[position - 1];
      if (previous === undefined) continue;
      expect(previous.record.benchmarks.aaIndex).toBeGreaterThan(current.record.benchmarks.aaIndex);
      expect(previous.record.economics.costUsd).toBeGreaterThan(current.record.economics.costUsd);
    }
  }));
});

test("each component contrast names the best other row and the signed gap to it", () => {
  assertProperty(fc.property(codingChartArb, ({ argon, googleRows, others }) => {
    const records = [...others, ...googleRows, argon];
    const placement = gemini4ArgonCodingAgentPlacement(records);
    if (placement === undefined) throw new Error("Argon row must carry an index and a cost.");
    const contrasted = new Set(placement.componentContrasts.map(contrast => contrast.metric));
    for (const metric of CODING_COMPONENT_METRICS) {
      const value = placement.record.benchmarks[metric];
      const otherValues = records
        .filter(record => record.id !== placement.record.id)
        .map(record => record.benchmarks[metric])
        .filter((candidate): candidate is number => candidate !== null);
      const contrast = placement.componentContrasts.find(candidate => candidate.metric === metric);
      if (value === null || otherValues.length === 0) {
        expect(contrast).toBeUndefined();
        continue;
      }
      expect(contrasted.has(metric)).toBeTrue();
      if (contrast === undefined) throw new Error("Contrast must exist.");
      const best = Math.max(...otherValues);
      expect(contrast.value).toBe(value);
      expect(contrast.bestOther.benchmarks[metric]).toBe(best);
      expect(contrast.bestOther.id).not.toBe(placement.record.id);
      expect(contrast.gapPoints).toBeCloseTo(value - best, 9);
    }
    expect(placement.componentContrasts.length).toBe(contrasted.size);
  }));
});

test("the closest coding rows below are the highest-scoring other costed rows at or under the placed score, capped at the count", () => {
  assertProperty(fc.property(codingChartArb, fc.nat({ max: 8 }), ({ argon, googleRows, others }, count) => {
    const records = [...others, ...googleRows, argon];
    const placement = gemini4ArgonCodingAgentPlacement(records, 1, count);
    if (placement === undefined) throw new Error("Argon row must carry an index and a cost.");
    const index = placement.record.benchmarks.aaIndex;
    const expected = records
      .filter(record => record.id !== placement.record.id && isCosted(record) && (record.benchmarks.aaIndex ?? Number.NaN) <= index)
      .toSorted((left, right) => (
        (right.benchmarks.aaIndex ?? Number.NaN) - (left.benchmarks.aaIndex ?? Number.NaN) || left.id.localeCompare(right.id)
      ))
      .slice(0, count)
      .map(record => record.id);
    expect(placement.closestBelow.map(step => step.record.id)).toEqual(expected);
    for (const step of placement.closestBelow) {
      expect(step.pointsBelow).toBeCloseTo(index - step.record.benchmarks.aaIndex, 9);
      expect(step.pointsBelow).toBeGreaterThanOrEqual(0);
      expect(step.costMultiple).toBeGreaterThan(0);
    }
  }));
});

test("the cost rank counts the costed rows that cost strictly more, and an unmatched leader is always on the frontier", () => {
  assertProperty(fc.property(codingChartArb, ({ argon, googleRows, others }) => {
    const records = [...others, ...googleRows, argon];
    const placement = gemini4ArgonCodingAgentPlacement(records);
    if (placement === undefined) throw new Error("Argon row must carry an index and a cost.");
    const costed = records.filter(isCosted);
    expect(placement.costedCount).toBe(costed.length);
    expect(placement.costRank).toBe(
      costed.filter(record => (record.economics.costUsd ?? 0) > placement.record.economics.costUsd).length + 1,
    );
    expect(placement.costRank).toBeGreaterThanOrEqual(1);
    expect(placement.costRank).toBeLessThanOrEqual(placement.costedCount);
    if (placement.rank === 1 && placement.higher.length === 0) {
      const tiedLeaders = costed.filter(record => (
        record.id !== placement.record.id && record.benchmarks.aaIndex === placement.record.benchmarks.aaIndex
      ));
      if (tiedLeaders.length === 0) expect(placement.onCostFrontier).toBeTrue();
    }
  }));
});

test("the higher cost shares cover exactly the costed rows above the placed row, highest first, and the cheapest of them is the cheapest higher row", () => {
  assertProperty(fc.property(codingChartArb, ({ argon, googleRows, others }) => {
    const records = [...others, ...googleRows, argon];
    const placement = gemini4ArgonCodingAgentPlacement(records);
    if (placement === undefined) throw new Error("Argon row must carry an index and a cost.");
    const index = placement.record.benchmarks.aaIndex;
    const cost = placement.record.economics.costUsd;
    const expected = records
      .filter(record => record.id !== placement.record.id && isCosted(record) && (record.benchmarks.aaIndex ?? Number.NaN) > index)
      .toSorted((left, right) => (
        (right.benchmarks.aaIndex ?? Number.NaN) - (left.benchmarks.aaIndex ?? Number.NaN) || left.id.localeCompare(right.id)
      ))
      .map(record => record.id);
    expect(placement.higherCostShares.map(share => share.record.id)).toEqual(expected);
    expect(higherCostShares(records, placement.record).map(share => share.record.id)).toEqual(expected);
    for (const share of placement.higherCostShares) {
      expect(share.pointsAbove).toBeCloseTo(share.record.benchmarks.aaIndex - index, 9);
      expect(share.pointsAbove).toBeGreaterThan(0);
      expect(share.costShare).toBeCloseTo(cost / share.record.economics.costUsd, 9);
      expect(share.costShare).toBeGreaterThan(0);
    }
    const costedHigher = placement.higher.filter(isCosted);
    expect(placement.higherCostShares.length).toBe(costedHigher.length);
    const cheapest = placement.higherCostShares.toSorted((left, right) => (
      left.record.economics.costUsd - right.record.economics.costUsd || left.record.id.localeCompare(right.record.id)
    ))[0];
    if (cheapest === undefined) {
      expect(placement.cheapestHigher).toBeUndefined();
    } else {
      expect(placement.cheapestHigher?.record.economics.costUsd).toBe(cheapest.record.economics.costUsd);
      expect(placement.cheapestHigher?.multiple).toBeCloseTo(1 / cheapest.costShare, 9);
    }
  }));
});

test("the other provider rows are every other costed Google row in any harness, highest index first", () => {
  assertProperty(fc.property(codingChartArb, ({ argon, googleRows, others }) => {
    const records = [...others, ...googleRows, argon];
    const placement = gemini4ArgonCodingAgentPlacement(records);
    if (placement === undefined) throw new Error("Argon row must carry an index and a cost.");
    const expected = records
      .filter(record => (
        record.id !== placement.record.id
        && record.providerId === GEMINI_4_ARGON_CODING_MODEL.providerId
        && isCosted(record)
      ))
      .toSorted((left, right) => (
        (right.benchmarks.aaIndex ?? Number.NaN) - (left.benchmarks.aaIndex ?? Number.NaN) || left.id.localeCompare(right.id)
      ))
      .map(record => record.id);
    expect(placement.otherProviderRows.map(record => record.id)).toEqual(expected);
    for (const row of placement.otherProviderRows) {
      expect(row.providerId).toBe(GEMINI_4_ARGON_CODING_MODEL.providerId);
    }
  }));
});
