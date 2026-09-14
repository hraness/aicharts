import { expect, test } from "bun:test";

import type { CodingAgentRecord } from "./coding-agent-data";
import { assertProperty, fc } from "./property-test";
import {
  REAL_SWE_HARNESS_TO_SNAPSHOT_AGENT,
  matchingSnapshotRecords,
  normalizeModelName,
  realSweSnapshotOverlaps,
  snapshotAgentForHarness,
  snapshotModelMatches,
  type RealSweConfiguration,
  type RealSweHarness,
} from "./real-swe-snapshot-overlap";

const harnesses = Object.keys(REAL_SWE_HARNESS_TO_SNAPSHOT_AGENT) as RealSweHarness[];
const snapshotAgents = Object.values(REAL_SWE_HARNESS_TO_SNAPSHOT_AGENT);

const modelArb = fc.constantFrom(
  "Fable 5.1",
  "GPT-6 Astra",
  "Gemini 3.8 Flash",
  "GLM 5.3",
  "Grok 4.6",
  "Muse Spark 1.3",
  "Kimi K3",
  "GPT-5.6 Sol",
);

const separatorArb = fc.constantFrom("", " ", "-", "  ", "_", ".", " · ");

const recordsArb = fc.array(
  fc.record({
    agent: fc.constantFrom(...snapshotAgents, "Antigravity SDK", "Opencode"),
    model: fc.oneof(
      modelArb,
      modelArb.map(model => `${model} (with fallback)`),
      modelArb.map(model => `${model}.5`),
      fc.constantFrom("GLM-5.3", "GLM-5.2", "Kimi K3.5", "Muse Spark 1.2"),
    ),
    settingRank: fc.integer({ min: 0, max: 6 }),
    suffix: fc.integer({ min: 0, max: 10_000 }),
  }),
  { maxLength: 24 },
).map((items): CodingAgentRecord[] => items.map((item, index) => ({
  agent: item.agent,
  benchmarks: { aaIndex: 50, deepSwe: null, sweAtlas: null, terminalBench: null },
  completeIndex: true,
  economics: { costUsd: 1, durationSeconds: null },
  id: `${item.suffix}:${index}`,
  model: item.model,
  modelLabel: item.model,
  providerId: "provider",
  providerName: "Provider",
  seriesId: `${item.agent}:${item.model}:${index}`,
  seriesLabel: item.model,
  setting: `rank-${item.settingRank}`,
  settingRank: item.settingRank,
  usage: { totalTokens: null },
})));

const configurationArb: fc.Arbitrary<RealSweConfiguration> = fc.record({
  harness: fc.constantFrom(...harnesses),
  model: modelArb,
});

test("property: normalization is idempotent and ignores case and punctuation", () => {
  assertProperty(fc.property(fc.string(), (value) => {
    const once = normalizeModelName(value);
    expect(normalizeModelName(once)).toBe(once);
    expect(once).toMatch(/^[a-z0-9]*$/u);
    expect(normalizeModelName(value.toUpperCase())).toBe(once);
  }));
});

test("property: a Real-SWE model matches itself under any spacing or hyphenation", () => {
  assertProperty(fc.property(modelArb, separatorArb, fc.boolean(), (model, separator, upper) => {
    const spelled = model.replace(/[\s.-]/gu, separator);
    const variant = upper ? spelled.toUpperCase() : spelled.toLowerCase();
    expect(snapshotModelMatches(variant, model)).toBeTrue();
    expect(snapshotModelMatches(`${variant} (with fallback)`, model)).toBeTrue();
  }));
});

test("property: a digit continuation is a different model", () => {
  assertProperty(fc.property(modelArb, fc.integer({ min: 0, max: 9 }), (model, digit) => {
    expect(snapshotModelMatches(`${model}.${digit}`, model)).toBeFalse();
    expect(snapshotModelMatches(`${model}${digit}`, model)).toBeFalse();
  }));
});

test("property: matches keep the aliased harness and name, highest setting first", () => {
  assertProperty(fc.property(configurationArb, recordsArb, (configuration, records) => {
    const matches = matchingSnapshotRecords(configuration, records);
    const agent = snapshotAgentForHarness(configuration.harness);
    for (const record of matches) {
      expect(record.agent).toBe(agent);
      expect(snapshotModelMatches(record.model, configuration.model)).toBeTrue();
    }
    for (let index = 1; index < matches.length; index += 1) {
      const previous = matches[index - 1];
      const current = matches[index];
      if (previous === undefined || current === undefined) throw new Error("Index in range");
      expect(previous.settingRank).toBeGreaterThanOrEqual(current.settingRank);
    }
    const expectedCount = records.filter(record => (
      record.agent === agent && snapshotModelMatches(record.model, configuration.model)
    )).length;
    expect(matches).toHaveLength(expectedCount);
  }));
});

test("property: overlaps are independent of record order and preserve configuration order", () => {
  assertProperty(fc.property(
    fc.array(configurationArb, { maxLength: 8 }),
    recordsArb,
    (configurations, records) => {
      const forward = realSweSnapshotOverlaps(configurations, records);
      const reversed = realSweSnapshotOverlaps(configurations, [...records].reverse());
      expect(forward.map(overlap => overlap.configuration)).toEqual(configurations);
      expect(forward.map(overlap => overlap.record?.id))
        .toEqual(reversed.map(overlap => overlap.record?.id));
      for (const overlap of forward) {
        if (overlap.record === undefined) {
          expect(matchingSnapshotRecords(overlap.configuration, records)).toHaveLength(0);
        } else {
          expect(overlap.record.agent)
            .toBe(snapshotAgentForHarness(overlap.configuration.harness));
        }
      }
    },
  ));
});

test("regression: Real-SWE harness names translate to the snapshot agent names", () => {
  expect(snapshotAgentForHarness("Codex CLI")).toBe("Codex");
  expect(snapshotAgentForHarness("Kimi Code")).toBe("Kimi Code CLI");
  expect(snapshotAgentForHarness("Claude Code")).toBe("Claude Code");
  expect(snapshotModelMatches("Fable 5.1 (with fallback)", "Fable 5.1")).toBeTrue();
  expect(snapshotModelMatches("GLM-5.2", "GLM 5.3")).toBeFalse();
  expect(snapshotModelMatches("GLM-5.3", "GLM 5.3")).toBeTrue();
  expect(snapshotModelMatches("Kimi K3.5", "Kimi K3")).toBeFalse();
  expect(snapshotModelMatches("Muse Spark 1.3", "Muse Spark 1")).toBeFalse();
  expect(snapshotModelMatches("anything", "")).toBeFalse();
});
