import { describe, expect, test } from "bun:test";

import codingAgentData from "@/data/coding-agents.json";
import modelCardCatalogData from "@/data/model-card-catalog.json";

import { parseCodingAgentSnapshot, type CodingAgentRecord } from "./coding-agent-data";
import {
  MODEL_CARD_CATALOG,
  buildModelCardVariants,
  findModelCardVariant,
  findModelCardVariantByPath,
  getModelCardCatalogEntry,
  modelCardCatalogCoverage,
  modelCardPath,
  modelCardRouteStatus,
  modelCardStaticParams,
  parseModelCardCatalog,
  parseModelCardPath,
  parseModelCardPathSegments,
  resolveModelCardCatalogEntry,
  type ModelCardCatalog,
} from "./model-card-data";

const parsedSnapshot = parseCodingAgentSnapshot(codingAgentData);
if (!parsedSnapshot.ok) throw parsedSnapshot.error;
const snapshot = parsedSnapshot.value;
const variants = buildModelCardVariants(snapshot.records);

const expectedGatewayByCanonicalId = {
  "alibaba/qwen3.7-plus": "alibaba/qwen3.7-plus",
  "alibaba/qwen3.8-max": "alibaba/qwen3.8-max",
  "anthropic/claude-fable-5": "anthropic/claude-fable-5",
  "anthropic/claude-fable-5.1": null,
  "anthropic/claude-opus-4.6": "anthropic/claude-opus-4.6",
  "anthropic/claude-opus-4.7": "anthropic/claude-opus-4.7",
  "anthropic/claude-opus-4.8": "anthropic/claude-opus-4.8",
  "anthropic/claude-opus-5": "anthropic/claude-opus-5",
  "anthropic/claude-sonnet-4.6": "anthropic/claude-sonnet-4.6",
  "cognition/swe-1.7": null,
  "cursor/composer-2": null,
  "cursor/composer-2.5": null,
  "cursor/composer-2.5-fast": null,
  "deepseek/deepseek-v4-flash-0731": "deepseek/deepseek-v4-flash-0731",
  "deepseek/deepseek-v4-pro": "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-pro-0813": null,
  "google/gemini-3.1-pro": null,
  "google/gemini-3.6-flash": "google/gemini-3.6-flash",
  "google/gemini-3.7-flash": "google/gemini-3.7-flash",
  "google/gemini-3.8-flash": null,
  "meta/muse-spark-1.1": "meta/muse-spark-1.1",
  "meta/muse-spark-1.2": "meta/muse-spark-1.2",
  "meta/muse-spark-1.3": null,
  "moonshotai/kimi-k2.6": "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k3": "moonshotai/kimi-k3",
  "openai/gpt-5.4": "openai/gpt-5.4",
  "openai/gpt-5.5": "openai/gpt-5.5",
  "openai/gpt-5.6-luna": "openai/gpt-5.6-luna",
  "openai/gpt-5.6-sol": "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra": "openai/gpt-5.6-terra",
  "openai/gpt-6-astra": null,
  "spacexai/grok-4.5": "spacexai/grok-4.5",
  "zai/glm-5.1": "zai/glm-5.1",
  "zai/glm-5.2": "zai/glm-5.2",
} as const;

function fixtureRecord(
  overrides: Partial<CodingAgentRecord> = {},
): CodingAgentRecord {
  return {
    agent: "Fixture Agent",
    benchmarks: {
      aaIndex: 50,
      deepSwe: 40,
      sweAtlas: 30,
      terminalBench: 60,
    },
    completeIndex: true,
    economics: { costUsd: 2, durationSeconds: 600 },
    id: "fixture-record",
    model: "Fixture Model",
    modelLabel: "Fixture Model",
    providerId: "fixture_provider",
    providerName: "Fixture Provider",
    seriesId: "Fixture Agent:fixture-model",
    seriesLabel: "Fixture Agent · Fixture Model",
    setting: "default",
    settingRank: 0,
    usage: { totalTokens: 100_000 },
    ...overrides,
  };
}

function recordForCatalog(
  canonicalModelId: string,
  setting: string,
  id: string,
): CodingAgentRecord {
  const entry = MODEL_CARD_CATALOG.find(candidate => (
    candidate.canonicalModelId === canonicalModelId
  ));
  if (entry === undefined) {
    throw new Error(`Expected checked catalog entry ${canonicalModelId}.`);
  }
  return fixtureRecord({
    id,
    model: entry.model,
    modelLabel: `${entry.model} (${setting})`,
    providerId: entry.providerId,
    providerName: entry.providerId,
    seriesId: `${id}:${entry.aliases[0] ?? entry.canonicalModelId}`,
    seriesLabel: `${id} · ${entry.model}`,
    setting,
    settingRank: ["default", "low", "medium", "high", "xhigh", "max"].indexOf(setting),
  });
}

describe("model-card catalog boundary", () => {
  test("strictly parses the checked catalog", () => {
    const input: unknown = modelCardCatalogData;
    const parsed = parseModelCardCatalog(input);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(MODEL_CARD_CATALOG);
  });

  test("pins every canonical ID to an exact Gateway ID or an honest null", () => {
    const gatewayByCanonicalId = new Map(MODEL_CARD_CATALOG.map(entry => [
      entry.canonicalModelId,
      entry.gatewayModelId,
    ]));
    for (const [canonicalModelId, gatewayModelId] of Object.entries(
      expectedGatewayByCanonicalId,
    )) {
      expect(gatewayByCanonicalId.get(canonicalModelId)).toBe(gatewayModelId);
    }
    expect(getModelCardCatalogEntry("xai", "Grok 4.5")?.canonicalModelId).toBe(
      "spacexai/grok-4.5",
    );
    expect(getModelCardCatalogEntry(
      "cognition",
      "SWE-1.7 Lightning Max",
    )?.lobeIconKey).toBeNull();
  });

  test("owns a distinct hierarchical emblem identity for every catalog model", () => {
    const emblemKeys = MODEL_CARD_CATALOG.map(entry => JSON.stringify([
      entry.providerId,
      entry.emblemIdentity.familyId,
      entry.emblemIdentity.generation,
      entry.emblemIdentity.revision,
      entry.emblemIdentity.editionId,
      entry.emblemIdentity.role,
    ]));
    expect(new Set(emblemKeys).size).toBe(MODEL_CARD_CATALOG.length);

    const opus48 = resolveModelCardCatalogEntry("anthropic/claude-opus-4.8");
    const opus5 = resolveModelCardCatalogEntry("anthropic/claude-opus-5");
    expect(opus48?.emblemIdentity).toEqual({
      editionId: "base",
      familyId: "opus",
      generation: ["4", "8"],
      revision: null,
      role: "flagship",
    });
    expect(opus5?.emblemIdentity).toMatchObject({
      editionId: "base",
      familyId: "opus",
      generation: ["5"],
      role: "flagship",
    });

    const gpt56 = MODEL_CARD_CATALOG.filter(entry => (
      entry.providerId === "openai"
      && entry.emblemIdentity.generation.join(".") === "5.6"
    ));
    expect(gpt56.map(entry => entry.emblemIdentity.editionId).sort()).toEqual([
      "luna",
      "sol",
      "terra",
    ]);
    expect(new Set(gpt56.map(entry => entry.emblemIdentity.familyId))).toEqual(
      new Set(["gpt"]),
    );
  });

  test("rejects unknown fields, malformed IDs, and duplicate identities", () => {
    const first = modelCardCatalogData[0];
    const second = modelCardCatalogData[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected checked catalog fixtures.");
    }
    expect(parseModelCardCatalog([{ ...first, undocumented: true }]).ok).toBe(false);
    expect(parseModelCardCatalog([{
      ...first,
      canonicalModelId: "Not Route Safe",
    }]).ok).toBe(false);
    expect(parseModelCardCatalog([first, {
      ...second,
      model: first.model,
    }]).ok).toBe(false);
  });

  test("rejects missing, malformed, and duplicate emblem identities", () => {
    const first = modelCardCatalogData[0];
    const second = modelCardCatalogData[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected checked catalog fixtures.");
    }
    const missingIdentity = Object.fromEntries(
      Object.entries(first).filter(([field]) => field !== "emblemIdentity"),
    );

    expect(parseModelCardCatalog([missingIdentity]).ok).toBe(false);
    expect(parseModelCardCatalog([{
      ...first,
      emblemIdentity: { ...first.emblemIdentity, familyId: "Not route safe" },
    }]).ok).toBe(false);
    expect(parseModelCardCatalog([{
      ...first,
      emblemIdentity: { ...first.emblemIdentity, generation: [] },
    }]).ok).toBe(false);
    expect(parseModelCardCatalog([{
      ...first,
      emblemIdentity: { ...first.emblemIdentity, role: "royal" },
    }]).ok).toBe(false);
    expect(parseModelCardCatalog([first, {
      ...second,
      emblemIdentity: first.emblemIdentity,
    }]).ok).toBe(false);
  });

  test("rejects duplicate aliases and aliases that repeat route IDs", () => {
    const first = modelCardCatalogData[0];
    const second = modelCardCatalogData[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected checked catalog fixtures.");
    }
    const duplicateAlias = parseModelCardCatalog([
      first,
      { ...second, aliases: [...first.aliases] },
    ]);
    const reservedAlias = parseModelCardCatalog([{
      ...first,
      aliases: [first.canonicalModelId],
    }]);

    expect(duplicateAlias.ok).toBe(false);
    expect(reservedAlias.ok).toBe(false);
  });

  test("rejects canonical and Gateway collisions across entries", () => {
    const first = modelCardCatalogData[0];
    const second = modelCardCatalogData[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected checked catalog fixtures.");
    }
    expect(parseModelCardCatalog([
      first,
      { ...second, gatewayModelId: first.canonicalModelId },
    ]).ok).toBe(false);
    expect(parseModelCardCatalog([
      { ...first, gatewayModelId: "gateway/model-prime" },
      {
        ...second,
        canonicalModelId: "gateway/model-prime",
        gatewayModelId: null,
      },
    ]).ok).toBe(false);
    expect(parseModelCardCatalog([first]).ok).toBe(true);
  });

  test("resolves curated raw source identifiers without making new aliases mandatory", () => {
    for (const entry of MODEL_CARD_CATALOG) {
      for (const alias of entry.aliases) {
        expect(resolveModelCardCatalogEntry(alias)).toBe(entry);
      }
    }
    expect(resolveModelCardCatalogEntry("OPENAI_OPAL-ALPHA")).toBeUndefined();
  });

  test("binds the September upstream aliases to stable family identities and routes", () => {
    const expected = [
      ["anthropic_claude-fable-5-1", "anthropic/claude-fable-5.1", "fable"],
      ["google_skimaki_ai-studio", "google/gemini-3.8-flash", "gemini"],
      ["openai_vega-alpha", "openai/gpt-6-astra", "gpt"],
      ["meta_goofy-glacier135", "meta/muse-spark-1.3", "muse-spark"],
      ["meta_joyful-jello138", "meta/muse-spark-1.3", "muse-spark"],
    ] as const;

    for (const [alias, canonicalModelId, familyId] of expected) {
      expect(resolveModelCardCatalogEntry(alias)).toMatchObject({
        canonicalModelId,
        emblemIdentity: { familyId },
      });
    }
    expect(variants.filter(variant => (
      expected.some(([, canonicalModelId]) => canonicalModelId === variant.canonicalModelId)
    )).map(variant => variant.path)).toEqual([
      "/models/anthropic/claude-fable-5.1/max",
      "/models/google/gemini-3.8-flash/high",
      "/models/meta/muse-spark-1.3/xhigh",
      "/models/meta/muse-spark-1.3/max",
      "/models/openai/gpt-6-astra/max",
    ]);
  });
});

describe("model-card variants", () => {
  test("retains every current observation behind one unique route", () => {
    expect(variants.reduce(
      (sum, variant) => sum + variant.observationCount,
      0,
    )).toBe(snapshot.records.length);
    expect(new Set(variants.map(variant => variant.path)).size).toBe(variants.length);
    expect(variants.every(variant => variant.observationCount > 0)).toBe(true);
  });

  test("reports catalog drift without blocking missing or orphaned identities", () => {
    const first = MODEL_CARD_CATALOG[0];
    if (first === undefined) throw new Error("Expected a checked catalog fixture.");
    const known = recordForCatalog(first.canonicalModelId, "default", "known");
    const unknown = fixtureRecord({
      id: "unknown",
      model: "Unlisted Model",
      modelLabel: "Unlisted Model",
      providerId: "unlisted_provider",
      providerName: "Unlisted Provider",
      seriesId: "Unknown Agent:new-source-id",
    });
    const oneEntryCatalog = [first] as ModelCardCatalog;
    const coverage = modelCardCatalogCoverage([known, unknown], oneEntryCatalog);
    expect(coverage.missingCatalogEntries).toEqual([
      "unlisted_provider/Unlisted Model",
    ]);
    expect(coverage.orphanedCatalogEntries).toEqual([]);
    const built = buildModelCardVariants([known, unknown], oneEntryCatalog);
    expect(built).toHaveLength(2);
    expect(built.find(variant => variant.observations[0]?.id === "unknown")).toMatchObject({
      gatewayModelId: null,
      lobeIconKey: null,
    });
    expect(modelCardCatalogCoverage([], oneEntryCatalog).orphanedCatalogEntries).toEqual([
      `${first.providerId}/${first.model}`,
    ]);
    expect(buildModelCardVariants([], oneEntryCatalog)).toEqual([]);
  });

  test("retains all observations and reports source min/max bounds", () => {
    const source = [
      recordForCatalog("anthropic/claude-opus-4.7", "medium", "range-a"),
      recordForCatalog("anthropic/claude-opus-4.7", "medium", "range-b"),
    ].map((record, index) => ({
      ...record,
      benchmarks: { ...record.benchmarks, aaIndex: index === 0 ? 45 : 75 },
    }));
    const variant = buildModelCardVariants(source).find(candidate => (
      candidate.canonicalModelId === "anthropic/claude-opus-4.7"
    ));
    if (variant === undefined) throw new Error("Expected Opus 4.7 medium card.");
    const aaIndexValues = source.flatMap(record => (
      record.benchmarks.aaIndex === null ? [] : [record.benchmarks.aaIndex]
    ));

    expect(variant.observations.map(record => record.id).sort()).toEqual(
      source.map(record => record.id).sort(),
    );
    expect(variant.metricRanges.aaIndex).toEqual({
      min: Math.min(...aaIndexValues),
      max: Math.max(...aaIndexValues),
      observationCount: aaIndexValues.length,
    });
    expect(variant.metricRanges.aaIndex.min).not.toBe(
      aaIndexValues.reduce((sum, value) => sum + value, 0) / aaIndexValues.length,
    );
  });

  test("prioritizes intrinsic classes and only then the max chart profile", () => {
    const classVariants = buildModelCardVariants([
      recordForCatalog("anthropic/claude-fable-5", "max", "fable"),
      recordForCatalog("deepseek/deepseek-v4-flash-0731", "max", "flash"),
      recordForCatalog("alibaba/qwen3.8-max", "default", "qwen"),
      recordForCatalog("openai/gpt-5.6-sol", "max", "sol-max"),
      recordForCatalog("openai/gpt-5.6-sol", "xhigh", "sol-xhigh"),
    ]);
    const byPath = new Map(classVariants.map(variant => [variant.path, variant]));
    expect(byPath.get("/models/anthropic/claude-fable-5/max")?.cardClass).toBe("fallback");
    expect(byPath.get("/models/deepseek/deepseek-v4-flash-0731/max")?.cardClass).toBe("fast");
    expect(byPath.get("/models/alibaba/qwen3.8-max/default")?.cardClass).toBe("max");
    expect(byPath.get("/models/openai/gpt-5.6-sol/max")?.cardClass).toBe("max");
    expect(byPath.get("/models/openai/gpt-5.6-sol/xhigh")?.cardClass).toBe("standard");
  });

  test("never derives a Gateway suffix from an execution profile", () => {
    for (const variant of variants) {
      const entry = resolveModelCardCatalogEntry(variant.canonicalModelId);
      expect(variant.gatewayModelId).toBe(entry?.gatewayModelId ?? null);
    }
    const terraVariants = buildModelCardVariants([
      recordForCatalog("openai/gpt-5.6-terra", "max", "terra"),
    ]);
    expect(findModelCardVariantByPath(
      terraVariants,
      "/models/openai/gpt-5.6-terra/max",
    )?.gatewayModelId).toBe("openai/gpt-5.6-terra");
  });

  test("uses stable source aliases before mutable display names", () => {
    const original = recordForCatalog("openai/gpt-5.6-sol", "max", "corrected");
    const corrected = {
      ...original,
      model: "GPT 5.6 Sol",
      modelLabel: "GPT 5.6 Sol (max)",
    };
    const [variant] = buildModelCardVariants([corrected]);
    expect(variant).toMatchObject({
      canonicalModelId: "openai/gpt-5.6-sol",
      emblemIdentity: {
        editionId: "sol",
        familyId: "gpt",
        generation: ["5", "6"],
        revision: null,
        role: "flagship",
      },
      gatewayModelId: "openai/gpt-5.6-sol",
      model: "GPT 5.6 Sol",
      path: "/models/openai/gpt-5.6-sol/max",
    });

    const rerun = { ...original, seriesId: "New Harness:not-yet-curated" };
    expect(buildModelCardVariants([rerun])[0]?.canonicalModelId).toBe(
      "openai/gpt-5.6-sol",
    );
    const mismatchedProvider = {
      ...corrected,
      providerId: "not_openai",
      providerName: "Not OpenAI",
    };
    expect(buildModelCardVariants([mismatchedProvider])[0]).toMatchObject({
      gatewayModelId: null,
      lobeIconKey: null,
    });

    const opusEntry = MODEL_CARD_CATALOG.find(entry => (
      entry.canonicalModelId === "anthropic/claude-opus-4.8"
    ));
    if (opusEntry === undefined || opusEntry.aliases.length < 2) {
      throw new Error("Expected Opus 4.8 aliases for the display-drift fixture.");
    }
    const firstDisplay = {
      ...recordForCatalog(
        "anthropic/claude-opus-4.8",
        "default",
        "display-a",
      ),
      providerName: "Anthropic",
    };
    const secondDisplay = {
      ...firstDisplay,
      id: "display-b",
      model: "Claude Opus 4.8",
      modelLabel: "Claude Opus 4.8",
      providerName: "Anthropic, PBC",
      seriesId: `Harness:Preview:${opusEntry.aliases[1]}`,
    };
    const displayVariants = buildModelCardVariants([firstDisplay, secondDisplay]);
    expect(displayVariants).toEqual(buildModelCardVariants([
      secondDisplay,
      firstDisplay,
    ]));
    expect(displayVariants[0]).toMatchObject({
      canonicalModelId: "anthropic/claude-opus-4.8",
      model: "Claude Opus 4.8",
      providerName: "Anthropic",
    });
  });

  test("derives deterministic collision-safe routes for unknown identities and settings", () => {
    const unknownRecords = [
      fixtureRecord({
        id: "unknown-a",
        model: "Model A",
        modelLabel: "Model A",
        providerId: "openai",
        providerName: "OpenAI",
        seriesId: "Agent:new-model-a",
        setting: "Speed / preview",
      }),
      fixtureRecord({
        id: "unknown-b",
        model: "Model-A",
        modelLabel: "Model-A",
        providerId: "openai",
        providerName: "OpenAI",
        seriesId: "Agent:new-model-b",
        setting: "Speed / preview",
      }),
    ];
    const unknownVariants = buildModelCardVariants(unknownRecords);
    expect(new Set(unknownVariants.map(variant => variant.path)).size).toBe(2);
    expect(unknownVariants.every(variant => variant.path.startsWith(
      "/models/unlisted/model-a.",
    ))).toBe(true);
    expect(unknownVariants.every(variant => variant.profileSlug.startsWith(
      "upstream.speed-preview.",
    ))).toBe(true);
    expect(unknownVariants.every(variant => variant.gatewayModelId === null)).toBe(true);
    expect(unknownVariants.every(variant => variant.lobeIconKey === "openai")).toBe(true);
    expect(unknownVariants.every(variant => (
      variant.emblemIdentity.familyId === "model-a"
      && variant.emblemIdentity.generation[0] === "unlisted"
      && variant.emblemIdentity.revision !== null
    ))).toBe(true);
    expect(buildModelCardVariants([...unknownRecords].reverse())).toEqual(unknownVariants);
  });

  test("heuristically relates unlisted versions while keeping their emblems distinct", () => {
    const unlisted = [
      fixtureRecord({
        id: "unlisted-fast-a",
        model: "Aurora 7.2 Fast",
        modelLabel: "Aurora 7.2 Fast",
        providerId: "new_lab",
        providerName: "New Lab",
        seriesId: "Agent:aurora-fast-a",
      }),
      fixtureRecord({
        id: "unlisted-fast-b",
        model: "Aurora 7.3 Fast",
        modelLabel: "Aurora 7.3 Fast",
        providerId: "new_lab",
        providerName: "New Lab",
        seriesId: "Agent:aurora-fast-b",
      }),
    ];
    const built = buildModelCardVariants(unlisted);

    expect(built.map(variant => variant.emblemIdentity.familyId)).toEqual([
      "aurora",
      "aurora",
    ]);
    expect(built.map(variant => variant.emblemIdentity.generation)).toEqual([
      ["7", "2"],
      ["7", "3"],
    ]);
    expect(built.every(variant => (
      variant.emblemIdentity.editionId === "fast"
      && variant.emblemIdentity.role === "speed"
    ))).toBe(true);
    expect(new Set(built.map(variant => variant.emblemIdentity.revision)).size).toBe(2);
  });

  test("keeps a complete range object even when a metric has no observation", () => {
    const source = recordForCatalog("openai/gpt-5.6-sol", "max", "missing-range");
    const [variant] = buildModelCardVariants([{
      ...source,
      benchmarks: { ...source.benchmarks, deepSwe: null },
    }]);
    expect(variant?.metricRanges.deepSwe).toEqual({
      min: null,
      max: null,
      observationCount: 0,
    });
  });
});

describe("model-card route identity", () => {
  test("centralizes canonical and provisional route classification", () => {
    expect(modelCardRouteStatus({
      canonicalModelId: "openai/gpt-5.6-sol",
      profileSlug: "max",
    })).toEqual({
      isProvisional: false,
      primaryReason: null,
      provisionalIdentity: false,
      provisionalProfile: false,
    });
    expect(modelCardRouteStatus({
      canonicalModelId: "unlisted/new-model.1234567890abcdef12345678",
      profileSlug: "max",
    })).toEqual({
      isProvisional: true,
      primaryReason: "model identity",
      provisionalIdentity: true,
      provisionalProfile: false,
    });
    expect(modelCardRouteStatus({
      canonicalModelId: "openai/gpt-5.6-sol",
      profileSlug: "upstream.preview.1234567890abcdef12345678",
    })).toEqual({
      isProvisional: true,
      primaryReason: "profile setting",
      provisionalIdentity: false,
      provisionalProfile: true,
    });
    expect(modelCardRouteStatus({
      canonicalModelId: "unlisted/new-model.1234567890abcdef12345678",
      profileSlug: "upstream.preview.1234567890abcdef12345678",
    })).toMatchObject({
      isProvisional: true,
      primaryReason: "model identity",
      provisionalIdentity: true,
      provisionalProfile: true,
    });
  });

  test("freezes the creator/model/profile path and parses it strictly", () => {
    const path = modelCardPath({
      canonicalModelId: "spacexai/grok-4.5",
      profileSlug: "high",
    });
    expect(path).toBe("/models/spacexai/grok-4.5/high");
    expect(parseModelCardPath(path)).toEqual({
      ok: true,
      value: {
        creatorSlug: "spacexai",
        modelSlug: "grok-4.5",
        profileSlug: "high",
      },
    });
    expect(parseModelCardPath(`${path}/extra`).ok).toBe(false);
    expect(parseModelCardPathSegments({
      creatorSlug: "spacexai",
      modelSlug: "grok-4.5",
      profileSlug: "high",
      extra: true,
    }).ok).toBe(false);
  });

  test("looks up cards from path segments and emits unique static params", () => {
    const routeVariants = buildModelCardVariants([
      recordForCatalog("google/gemini-3.1-pro", "high", "gemini"),
    ]);
    const target = routeVariants[0];
    if (target === undefined) throw new Error("Expected Gemini 3.1 Pro card.");
    const params = {
      creatorSlug: target.creatorSlug,
      modelSlug: target.modelSlug,
      profileSlug: target.profileSlug,
    };

    expect(findModelCardVariant(routeVariants, params)).toBe(target);
    expect(findModelCardVariant(routeVariants, { ...params, extra: true })).toBeUndefined();
    expect(findModelCardVariantByPath(routeVariants, target.path)).toBe(target);

    const staticParams = modelCardStaticParams([...variants].reverse());
    expect(staticParams).toHaveLength(variants.length);
    expect(new Set(staticParams.map(item => JSON.stringify(item))).size).toBe(variants.length);
    expect(staticParams).toEqual(modelCardStaticParams(variants));
  });
});
