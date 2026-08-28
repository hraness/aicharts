import { describe, expect, test } from "bun:test";
import type { CodingAgentRecord, CodingAgentSnapshot } from "../lib/coding-agent-data";
import {
  MODEL_RELEASE_LIMIT,
  modelReleaseSemanticKey,
  parseModelReleaseRadar,
  parseOpenRouterModelsResponse,
  type ModelReleaseListing,
  type ModelReleaseProviderId,
  type OpenRouterModel,
} from "../lib/model-release-data";
import {
  deriveModelReleaseRadar,
  reconcileModelReleaseRadarStatuses,
  validateModelReleaseRadarStatuses,
} from "./refresh-model-releases";

const retrievedAt = "2026-08-27T18:00:00.000Z";

function rawModel(
  id: string,
  name: string,
  sourceAddedAt: string,
  overrides: Readonly<{
    canonicalSlug?: string | null;
    inputModalities?: string[];
    outputModalities?: string[];
    supportedParameters?: string[];
  }> = {},
) {
  return {
    architecture: {
      input_modalities: overrides.inputModalities ?? ["text"],
      output_modalities: overrides.outputModalities ?? ["text"],
      tokenizer: "ignored additive source field",
    },
    canonical_slug: overrides.canonicalSlug === undefined ? `${id}-20260827` : overrides.canonicalSlug,
    created: Date.parse(sourceAddedAt) / 1_000,
    description: "Ignored additive source field",
    id,
    name,
    supported_parameters: overrides.supportedParameters ?? ["temperature", "tools"],
  };
}

function parseSourceModels(values: readonly ReturnType<typeof rawModel>[]): OpenRouterModel[] {
  const parsed = parseOpenRouterModelsResponse({
    data: values,
    links: { next: null },
    total_count: values.length,
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
}

function benchmarkRecord(
  providerId: ModelReleaseProviderId,
  providerName: string,
  model: string,
  index: number,
): CodingAgentRecord {
  return {
    agent: "Example Agent",
    benchmarks: {
      aaIndex: 60,
      deepSwe: 55,
      sweAtlas: 50,
      terminalBench: 65,
    },
    completeIndex: true,
    economics: { costUsd: 1, durationSeconds: 60 },
    id: `row-${index}`,
    model,
    modelLabel: model,
    providerId,
    providerName,
    seriesId: `series-${index}`,
    seriesLabel: `Example Agent · ${model}`,
    setting: "default",
    settingRank: 0,
    usage: { totalTokens: 1_000 },
  };
}

function benchmarkSnapshot(
  models: readonly [ModelReleaseProviderId, string, string][] = [],
): CodingAgentSnapshot {
  return {
    records: models.map(([providerId, providerName, model], index) => (
      benchmarkRecord(providerId, providerName, model, index)
    )),
    schemaVersion: 3,
    source: {
      benchmarkDatasets: {
        deepSwe: "deep-swe",
        sweAtlas: "swe-atlas-qna",
        terminalBench: "terminal-bench-v2.1",
      },
      method: "next-flight",
      name: "Artificial Analysis",
      retrievedAt,
      url: "https://artificialanalysis.ai/agents/coding-agents/",
    },
    updates: [],
  };
}

describe("OpenRouter release-radar parsing", () => {
  test("narrows additive API payloads to a strict owned model shape", () => {
    const parsed = parseOpenRouterModelsResponse({
      data: [rawModel("z-ai/glm-5.3", "Z.ai: GLM 5.3", "2026-08-18T20:57:35.000Z")],
      total_count: 1,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual([{
      architecture: {
        inputModalities: ["text"],
        outputModalities: ["text"],
      },
      canonicalSlug: "z-ai/glm-5.3-20260827",
      created: Date.parse("2026-08-18T20:57:35.000Z") / 1_000,
      id: "z-ai/glm-5.3",
      name: "Z.ai: GLM 5.3",
      supportedParameters: ["temperature", "tools"],
    }]);
  });

  test("fails closed when a required upstream field changes type", () => {
    const malformed = rawModel("z-ai/glm-5.3", "Z.ai: GLM 5.3", "2026-08-18T20:57:35.000Z");
    const parsed = parseOpenRouterModelsResponse({
      data: [{ ...malformed, created: "2026-08-18" }],
    });

    expect(parsed.ok).toBe(false);
  });

  test("rejects duplicate upstream model ids before derivation", () => {
    const model = rawModel("z-ai/glm-5.3", "Z.ai: GLM 5.3", "2026-08-18T20:57:35.000Z");
    const parsed = parseOpenRouterModelsResponse({ data: [model, model] });

    expect(parsed.ok).toBe(false);
  });
});

describe("OpenRouter release-radar derivation", () => {
  test("keeps GLM-5.3 and GLM-5.3-Flash distinct while they await comparable AA observations", () => {
    const sources = parseSourceModels([
      rawModel(
        "z-ai/glm-5.3-flash",
        "Z.ai: GLM 5.3 Flash",
        "2026-08-26T13:59:01.000Z",
        { canonicalSlug: "z-ai/glm-5.3-flash-20260826", inputModalities: ["video", "text", "image"] },
      ),
      rawModel(
        "z-ai/glm-5.3",
        "Z.ai: GLM 5.3",
        "2026-08-18T20:57:35.000Z",
        { canonicalSlug: "z-ai/glm-5.3-20260816" },
      ),
    ]);
    const radar = deriveModelReleaseRadar(
      sources,
      benchmarkSnapshot([["z_ai", "Z.ai", "GLM-5.2"]]),
      retrievedAt,
    );

    expect(radar.releases.map(({ id }) => id)).toEqual([
      "z-ai/glm-5.3-flash",
      "z-ai/glm-5.3",
    ]);
    expect(radar.observedListings.map(({ id }) => id)).toEqual([
      "z-ai/glm-5.3-flash",
      "z-ai/glm-5.3",
    ]);
    expect(radar.releases.map(({ status }) => status)).toEqual([
      "awaiting-benchmark",
      "awaiting-benchmark",
    ]);
    expect(radar.releases[0]?.capabilities.inputModalities).toEqual(["image", "text", "video"]);
    expect(radar.releases[0]?.sourceAddedAt).toBe("2026-08-26T13:59:01.000Z");
    expect(radar.releases[1]?.canonicalSlug).toBe("z-ai/glm-5.3-20260816");
    expect(parseModelReleaseRadar(radar).ok).toBe(true);
  });

  test("filters aliases, variants, unsupported providers, old entries, non-text output, and models without tools", () => {
    const sources = parseSourceModels([
      rawModel("z-ai/glm-5.3", "Z.ai: GLM 5.3", "2026-08-18T20:57:35.000Z"),
      rawModel("~z-ai/glm-private", "Z.ai: private alias", "2026-08-20T00:00:00.000Z"),
      rawModel("z-ai/glm-5.3:free", "Z.ai: free variant", "2026-08-20T00:00:00.000Z"),
      rawModel("untracked/example", "Untracked: Example", "2026-08-20T00:00:00.000Z"),
      rawModel("z-ai/image-only", "Z.ai: Image Only", "2026-08-20T00:00:00.000Z", {
        outputModalities: ["image"],
      }),
      rawModel("z-ai/no-tools", "Z.ai: No Tools", "2026-08-20T00:00:00.000Z", {
        supportedParameters: ["temperature"],
      }),
      rawModel("z-ai/old", "Z.ai: Old", "2026-05-20T00:00:00.000Z"),
    ]);

    const radar = deriveModelReleaseRadar(sources, benchmarkSnapshot(), retrievedAt);

    expect(radar.releases.map(({ id }) => id)).toEqual(["z-ai/glm-5.3"]);
    expect(radar.observedListings.map(({ id }) => id)).toEqual(["z-ai/glm-5.3"]);
  });

  test("uses conservative provider-plus-model semantics for benchmark status", () => {
    const sources = parseSourceModels([
      rawModel("anthropic/claude-opus-5", "Claude Opus 5", "2026-07-24T17:02:24.000Z"),
      rawModel("anthropic/claude-opus-5-fast", "Claude Opus 5 (Fast)", "2026-07-24T17:02:26.000Z"),
      rawModel("z-ai/glm-5.3-flash", "Z.ai: GLM 5.3 Flash", "2026-08-26T13:59:01.000Z"),
    ]);
    const snapshot = benchmarkSnapshot([
      ["anthropic", "Anthropic", "Opus 5 (with fallback)"],
      ["z_ai", "Z.ai", "GLM-5.3-Flash"],
    ]);
    const radar = deriveModelReleaseRadar(sources, snapshot, retrievedAt);

    expect(radar.releases.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "z-ai/glm-5.3-flash", status: "benchmarked" },
      { id: "anthropic/claude-opus-5-fast", status: "awaiting-benchmark" },
      { id: "anthropic/claude-opus-5", status: "benchmarked" },
    ]);
    expect(modelReleaseSemanticKey("z_ai", "GLM 5.3 Flash"))
      .toBe(modelReleaseSemanticKey("z_ai", "GLM-5.3-Flash"));
    expect(validateModelReleaseRadarStatuses(radar, snapshot).ok).toBe(true);
  });

  test("is newest-first, deterministic, unique by id, and bounded", () => {
    const sources = parseSourceModels(Array.from({ length: MODEL_RELEASE_LIMIT + 8 }, (_, index) => (
      rawModel(
        `openai/example-${String(index).padStart(2, "0")}`,
        `OpenAI: Example ${index}`,
        new Date(Date.parse(retrievedAt) - index * 60 * 60 * 1_000).toISOString(),
        { canonicalSlug: `openai/example-${index}-20260827` },
      )
    )));
    sources.push(sources[0] as OpenRouterModel);

    const radar = deriveModelReleaseRadar(sources, benchmarkSnapshot(), retrievedAt);

    expect(radar.releases).toHaveLength(MODEL_RELEASE_LIMIT);
    expect(radar.observedListings).toHaveLength(MODEL_RELEASE_LIMIT + 8);
    expect(new Set(radar.releases.map(({ id }) => id)).size).toBe(MODEL_RELEASE_LIMIT);
    expect(new Set(radar.observedListings.map(({ id }) => id)).size)
      .toBe(MODEL_RELEASE_LIMIT + 8);
    expect(radar.releases[0]?.id).toBe("openai/example-00");
    expect(radar.releases.at(-1)?.id).toBe("openai/example-47");
    expect(radar.observedListings.at(-1)?.id).toBe("openai/example-55");
    expect(parseModelReleaseRadar(radar).ok).toBe(true);
  });

  test("retains aged listings after they leave the bounded current radar", () => {
    const priorListings: readonly ModelReleaseListing[] = [{
      id: "z-ai/glm-5.2",
      model: "GLM 5.2",
      providerId: "z_ai",
      sourceAddedAt: "2026-05-20T00:00:00.000Z",
    }];
    const sources = parseSourceModels([
      rawModel("z-ai/glm-5.3", "Z.ai: GLM 5.3", "2026-08-18T20:57:35.000Z"),
    ]);

    const radar = deriveModelReleaseRadar(
      sources,
      benchmarkSnapshot(),
      retrievedAt,
      priorListings,
    );

    expect(radar.releases.map(({ id }) => id)).toEqual(["z-ai/glm-5.3"]);
    expect(radar.observedListings).toEqual([
      {
        id: "z-ai/glm-5.3",
        model: "GLM 5.3",
        providerId: "z_ai",
        sourceAddedAt: "2026-08-18T20:57:35.000Z",
      },
      priorListings[0],
    ]);
    expect(parseModelReleaseRadar(radar).ok).toBe(true);
  });

  test("lets a current source row correct a retained id without duplicating it", () => {
    const priorListings: readonly ModelReleaseListing[] = [{
      id: "openai/example",
      model: "Old Example Label",
      providerId: "openai",
      sourceAddedAt: "2026-08-01T00:00:00.000Z",
    }];
    const sources = parseSourceModels([
      rawModel(
        "openai/example",
        "OpenAI: Corrected Example Label",
        "2026-08-20T00:00:00.000Z",
      ),
    ]);

    const first = deriveModelReleaseRadar(
      sources,
      benchmarkSnapshot(),
      retrievedAt,
      priorListings,
    );
    const repeated = deriveModelReleaseRadar(
      sources,
      benchmarkSnapshot(),
      retrievedAt,
      first.observedListings,
    );

    expect(first.observedListings).toEqual([{
      id: "openai/example",
      model: "Corrected Example Label",
      providerId: "openai",
      sourceAddedAt: "2026-08-20T00:00:00.000Z",
    }]);
    expect(repeated.observedListings).toEqual(first.observedListings);
  });

  test("checked-radar validation rejects stale benchmark status and additive fields", () => {
    const sources = parseSourceModels([
      rawModel("z-ai/glm-5.3", "Z.ai: GLM 5.3", "2026-08-18T20:57:35.000Z"),
    ]);
    const snapshot = benchmarkSnapshot([["z_ai", "Z.ai", "GLM-5.3"]]);
    const radar = deriveModelReleaseRadar(sources, snapshot, retrievedAt);
    const stale = {
      ...radar,
      releases: radar.releases.map(release => ({ ...release, status: "awaiting-benchmark" as const })),
    };

    expect(validateModelReleaseRadarStatuses(stale, snapshot).ok).toBe(false);
    const reconciled = reconcileModelReleaseRadarStatuses(stale, snapshot);
    expect(reconciled.releases[0]?.status).toBe("benchmarked");
    expect(reconciled.observedListings).toBe(stale.observedListings);
    expect(parseModelReleaseRadar({ ...radar, unexpected: true }).ok).toBe(false);
  });
});
