import { expect, test } from "bun:test";

import {
  CLAUDE_OPUS_55_CODING_CONFIGURATION,
  CLAUDE_SONNET_55_CODING_CONFIGURATION,
  codingEffortLadder,
  sonnet55CodingAgentPlacement,
} from "./claude-sonnet-5-5-placement";
import { aaIndexCostFrontier } from "./coding-agent-snapshot-rows";
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
const settingArb = fc.constantFrom("low", "medium", "high", "xhigh", "max");
const codingChartArb = fc.record({
  others: fc.array(codingRowArb, { maxLength: 24 })
    .map(shapes => shapes.map((shape, position) => codingAgentRecord({ ...shape, id: `other-${position}` }))),
  siblings: fc.array(fc.record({
    costUsd: costArb,
    setting: settingArb,
  }), { maxLength: 4 }).map(items => items.map((item, position) => codingAgentRecord({
    ...CLAUDE_SONNET_55_CODING_CONFIGURATION,
    aaIndex: 40 + position,
    costUsd: item.costUsd,
    id: `sonnet-sibling-${item.setting}-${position}`,
    setting: item.setting,
  }))),
  sonnet: codingRowArb.map(shape => codingAgentRecord({
    ...shape,
    ...CLAUDE_SONNET_55_CODING_CONFIGURATION,
    aaIndex: shape.aaIndex ?? 50,
    costUsd: shape.costUsd ?? 5,
    id: "sonnet-5-5",
    setting: "max",
  })),
});

test("the frontier below the placed row is exactly the frontier’s lower-scoring vertices, and cost falls with score along it", () => {
  assertProperty(fc.property(codingChartArb, ({ others, siblings, sonnet }) => {
    const records = [...others, ...siblings, sonnet];
    const placement = sonnet55CodingAgentPlacement(records);
    if (placement === undefined) throw new Error("Sonnet row must carry an index and a cost.");
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
      expect(previous.pointsBelow).toBeLessThanOrEqual(current.pointsBelow);
      expect(previous.costMultiple).toBeGreaterThanOrEqual(current.costMultiple);
    }
  }));
});

test("each component contrast names the best other row and the signed gap to it", () => {
  assertProperty(fc.property(codingChartArb, ({ others, siblings, sonnet }) => {
    const records = [...others, ...siblings, sonnet];
    const placement = sonnet55CodingAgentPlacement(records);
    if (placement === undefined) throw new Error("Sonnet row must carry an index and a cost.");
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
  assertProperty(fc.property(codingChartArb, fc.nat({ max: 8 }), ({ others, siblings, sonnet }, count) => {
    const records = [...others, ...siblings, sonnet];
    const placement = sonnet55CodingAgentPlacement(records, 1, count);
    if (placement === undefined) throw new Error("Sonnet row must carry an index and a cost.");
    const index = placement.record.benchmarks.aaIndex;
    const expected = records
      .filter(record => (
        record.id !== placement.record.id
        && record.benchmarks.aaIndex !== null && record.economics.costUsd !== null && record.economics.costUsd > 0
        && record.benchmarks.aaIndex <= index
      ))
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

test("the cost rank counts the costed rows that cost strictly more, and the leader is always on the frontier", () => {
  assertProperty(fc.property(codingChartArb, ({ others, siblings, sonnet }) => {
    const records = [...others, ...siblings, sonnet];
    const placement = sonnet55CodingAgentPlacement(records);
    if (placement === undefined) throw new Error("Sonnet row must carry an index and a cost.");
    const costed = records.filter(record => (
      record.benchmarks.aaIndex !== null && record.economics.costUsd !== null && record.economics.costUsd > 0
    ));
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

test("the effort ladder is the costed Claude Code · Sonnet 5.5 rows cheapest first, with each step measured against the row before", () => {
  assertProperty(fc.property(codingChartArb, ({ others, siblings, sonnet }) => {
    const records = [...others, ...siblings, sonnet];
    const placement = sonnet55CodingAgentPlacement(records);
    if (placement === undefined) throw new Error("Sonnet row must carry an index and a cost.");
    const expected = records.filter(record => (
      record.agent === CLAUDE_SONNET_55_CODING_CONFIGURATION.agent
      && record.model === CLAUDE_SONNET_55_CODING_CONFIGURATION.model
      && record.providerId === CLAUDE_SONNET_55_CODING_CONFIGURATION.providerId
      && record.benchmarks.aaIndex !== null
      && record.economics.costUsd !== null
      && record.economics.costUsd > 0
    )).toSorted((left, right) => (
      (left.economics.costUsd ?? Number.NaN) - (right.economics.costUsd ?? Number.NaN) || left.id.localeCompare(right.id)
    ));
    expect(placement.effortLadder.map(step => step.record.id)).toEqual(expected.map(record => record.id));
    const rebuilt = codingEffortLadder(placement.effortLadder.map(step => step.record));
    expect(rebuilt.map(step => step.record.id)).toEqual(placement.effortLadder.map(step => step.record.id));
    for (let position = 0; position < placement.effortLadder.length; position += 1) {
      const current = placement.effortLadder[position];
      const previous = placement.effortLadder[position - 1];
      if (current === undefined) throw new Error("Ladder is short.");
      if (previous === undefined) {
        expect(current.pointsOverCheaper).toBeNull();
        expect(current.costMultipleOverCheaper).toBeNull();
        continue;
      }
      expect(current.pointsOverCheaper)
        .toBeCloseTo(current.record.benchmarks.aaIndex - previous.record.benchmarks.aaIndex, 9);
      expect(current.costMultipleOverCheaper)
        .toBeCloseTo(current.record.economics.costUsd / previous.record.economics.costUsd, 9);
      expect(current.record.economics.costUsd).toBeGreaterThanOrEqual(previous.record.economics.costUsd);
    }
  }));
});

test("same-harness Opus is the Claude Code · Opus 5.5 row at the placed setting, when the snapshot stores one", () => {
  assertProperty(fc.property(codingChartArb, fc.boolean(), ({ others, siblings, sonnet }, includeOpus) => {
    const opus = includeOpus
      ? codingAgentRecord({
          ...CLAUDE_OPUS_55_CODING_CONFIGURATION,
          aaIndex: 60,
          costUsd: 10,
          id: "opus-same-setting",
          setting: sonnet.setting,
        })
      : undefined;
    const records = [...others, ...siblings, sonnet, ...(opus === undefined ? [] : [opus])];
    const placement = sonnet55CodingAgentPlacement(records);
    if (placement === undefined) throw new Error("Sonnet row must carry an index and a cost.");
    if (opus === undefined) {
      expect(placement.sameHarnessOpus).toBeUndefined();
      return;
    }
    expect(placement.sameHarnessOpus?.id).toBe("opus-same-setting");
    expect(placement.sameHarnessOpus?.setting).toBe(placement.record.setting);
  }));
});
