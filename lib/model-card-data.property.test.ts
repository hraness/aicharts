import { expect, test } from "bun:test";

import type { CodingAgentRecord } from "./coding-agent-data";
import {
  MODEL_CARD_METRIC_IDS,
  buildModelCardVariants,
  findModelCardVariantByPath,
  modelCardPath,
  parseModelCardPath,
  type ModelCardCatalog,
  type ModelCardMetricId,
} from "./model-card-data";
import { assertProperty, fc } from "./property-test";

const settings = ["none", "low", "medium", "high", "xhigh", "max"] as const;
const settingRank = new Map(settings.map((setting, index) => [setting, index + 1]));

const syntheticCatalog = [{
  aliases: ["provider_model-prime"],
  canonicalModelId: "creator/model-prime",
  gatewayModelId: "creator/model-prime",
  intrinsicClass: "standard",
  lobeIconKey: "openai",
  model: "Model Prime",
  providerId: "provider",
}] as const satisfies ModelCardCatalog;

const nullableMetric = fc.option(
  fc.integer({ min: 0, max: 100_000 }).map(value => value / 100),
  { nil: null },
);

const generatedRecords = fc.array(fc.record({
  aaIndex: nullableMetric,
  agent: fc.constantFrom("Agent A", "Agent B", "Agent C"),
  costUsd: nullableMetric,
  deepSwe: nullableMetric,
  durationSeconds: nullableMetric,
  setting: fc.constantFrom(...settings),
  sweAtlas: nullableMetric,
  terminalBench: nullableMetric,
  totalTokens: nullableMetric,
}), { minLength: 1, maxLength: 36 }).map((items): CodingAgentRecord[] => (
  items.map((item, index) => ({
    agent: item.agent,
    benchmarks: {
      aaIndex: item.aaIndex,
      deepSwe: item.deepSwe,
      sweAtlas: item.sweAtlas,
      terminalBench: item.terminalBench,
    },
    completeIndex: true,
    economics: {
      costUsd: item.costUsd,
      durationSeconds: item.durationSeconds,
    },
    id: `record-${index}`,
    model: "Model Prime",
    modelLabel: `Model Prime (${item.setting})`,
    providerId: "provider",
    providerName: "Provider",
    seriesId: `agent:model-prime:${index}`,
    seriesLabel: `${item.agent} · Model Prime`,
    setting: item.setting,
    settingRank: settingRank.get(item.setting) ?? 0,
    usage: { totalTokens: item.totalTokens },
  }))
));

function metricValue(
  record: CodingAgentRecord,
  metric: ModelCardMetricId,
): number | null {
  if (metric === "aaIndex") return record.benchmarks.aaIndex;
  if (metric === "deepSwe") return record.benchmarks.deepSwe;
  if (metric === "terminalBench") return record.benchmarks.terminalBench;
  if (metric === "sweAtlas") return record.benchmarks.sweAtlas;
  if (metric === "costUsd") return record.economics.costUsd;
  if (metric === "durationSeconds") return record.economics.durationSeconds;
  return record.usage.totalTokens;
}

test("property: model-card grouping is deterministic across input order", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    const forward = buildModelCardVariants(records, syntheticCatalog);
    const reversed = buildModelCardVariants([...records].reverse(), syntheticCatalog);
    expect(reversed).toEqual(forward);
    expect(forward.reduce(
      (count, variant) => count + variant.observationCount,
      0,
    )).toBe(records.length);
  }));
});

const firstCharacter = fc.constantFrom("a", "b", "c", "m", "x", "z");
const remainingCharacters = fc.array(
  fc.constantFrom("a", "b", "c", "0", "1", "2", "-", "."),
  { maxLength: 10 },
).map(characters => characters.join("").replace(/[.-]+$/u, ""));
const routeSegment = fc.tuple(firstCharacter, remainingCharacters)
  .map(([first, remaining]) => first + remaining)
  .filter(value => /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(value));

test("property: model-card paths round trip without changing any slug", () => {
  assertProperty(fc.property(
    routeSegment,
    routeSegment,
    routeSegment,
    (creatorSlug, modelSlug, profileSlug) => {
      const path = modelCardPath({
        canonicalModelId: `${creatorSlug}/${modelSlug}`,
        profileSlug,
      });
      const parsed = parseModelCardPath(path);
      expect(parsed).toEqual({
        ok: true,
        value: { creatorSlug, modelSlug, profileSlug },
      });
    },
  ));
});

test("property: every metric range is the exact bound of retained values", () => {
  assertProperty(fc.property(generatedRecords, (records) => {
    const variants = buildModelCardVariants(records, syntheticCatalog);
    for (const variant of variants) {
      expect(findModelCardVariantByPath(variants, variant.path)).toBe(variant);
      for (const metric of MODEL_CARD_METRIC_IDS) {
        const values = variant.observations
          .map(record => metricValue(record, metric))
          .filter((value): value is number => value !== null);
        const range = variant.metricRanges[metric];
        expect(range.observationCount).toBe(values.length);
        if (values.length === 0) {
          expect(range).toEqual({ min: null, max: null, observationCount: 0 });
          continue;
        }
        expect(range.min).toBe(Math.min(...values));
        expect(range.max).toBe(Math.max(...values));
        for (const value of values) {
          expect(value).toBeGreaterThanOrEqual(range.min ?? Number.POSITIVE_INFINITY);
          expect(value).toBeLessThanOrEqual(range.max ?? Number.NEGATIVE_INFINITY);
        }
      }
    }
  }));
});

const upstreamText = fc.string({ minLength: 1, maxLength: 80 });

test("property: unknown upstream identities get bounded unique deterministic routes", () => {
  const distinctIdentities = fc.uniqueArray(
    fc.tuple(upstreamText, upstreamText),
    {
      maxLength: 24,
      minLength: 1,
      selector: ([providerId, model]) => JSON.stringify([providerId, model]),
    },
  );
  assertProperty(fc.property(distinctIdentities, (identities) => {
    const records = identities.map(([providerPart, model], index): CodingAgentRecord => ({
      agent: "Unknown Agent",
      benchmarks: {
        aaIndex: 50,
        deepSwe: null,
        sweAtlas: null,
        terminalBench: null,
      },
      completeIndex: false,
      economics: { costUsd: null, durationSeconds: null },
      id: `unknown-${index}`,
      model,
      modelLabel: model,
      providerId: `unknown:${providerPart}`,
      providerName: `Unknown ${providerPart}`,
      seriesId: `Unknown Agent:unknown-source-${index}`,
      seriesLabel: `Unknown Agent · ${model}`,
      setting: "default",
      settingRank: 0,
      usage: { totalTokens: null },
    }));
    const forward = buildModelCardVariants(records, syntheticCatalog);
    const reversed = buildModelCardVariants([...records].reverse(), syntheticCatalog);

    expect(forward).toHaveLength(identities.length);
    expect(reversed).toEqual(forward);
    expect(new Set(forward.map(variant => variant.path)).size).toBe(forward.length);
    for (const variant of forward) {
      expect(variant.canonicalModelId.startsWith("unlisted/")).toBe(true);
      expect(variant.modelSlug.length).toBeLessThanOrEqual(65);
      expect(variant.path.length).toBeLessThanOrEqual(100);
      expect(variant.gatewayModelId).toBeNull();
      expect(variant.lobeIconKey).toBeNull();
      expect(parseModelCardPath(variant.path).ok).toBe(true);
    }
  }));
});

test("property: arbitrary upstream settings map injectively to bounded profile slugs", () => {
  const distinctSettings = fc.uniqueArray(upstreamText, {
    maxLength: 24,
    minLength: 1,
  });
  assertProperty(fc.property(distinctSettings, (rawSettings) => {
    const records = rawSettings.map((setting, index): CodingAgentRecord => ({
      agent: "Agent A",
      benchmarks: {
        aaIndex: 50,
        deepSwe: null,
        sweAtlas: null,
        terminalBench: null,
      },
      completeIndex: false,
      economics: { costUsd: null, durationSeconds: null },
      id: `setting-${index}`,
      model: "Model Prime",
      modelLabel: `Model Prime (${setting})`,
      providerId: "provider",
      providerName: "Provider",
      seriesId: `agent:model-prime:${index}`,
      seriesLabel: "Agent A · Model Prime",
      setting,
      settingRank: index,
      usage: { totalTokens: null },
    }));
    const variants = buildModelCardVariants(records, syntheticCatalog);

    expect(variants).toHaveLength(rawSettings.length);
    expect(new Set(variants.map(variant => variant.profileSlug)).size).toBe(
      variants.length,
    );
    expect(variants.every(variant => variant.profileSlug.length <= 59)).toBe(true);
    expect(variants.every(variant => parseModelCardPath(variant.path).ok)).toBe(true);
  }));
});
