import { describe, expect, test } from "bun:test";

import {
  MODEL_RELEASE_LIMIT,
  MODEL_RELEASE_SOURCE_URL,
  MODEL_RELEASE_WINDOW_DAYS,
  modelReleaseProviderIds,
  modelReleaseProviderForOpenRouterId,
  modelReleaseSemanticKey,
  openRouterModelIdTail,
  parseModelReleaseRadar,
  type ModelReleaseListing,
} from "./model-release-data";

const retrievedAt = "2026-08-28T00:00:00.000Z";

function listing(id: string, sourceAddedAt: string): ModelReleaseListing {
  return {
    id,
    model: id.split("/").at(-1) ?? id,
    providerId: "openai",
    sourceAddedAt,
  };
}

function radar(
  observedListings: readonly ModelReleaseListing[],
  releases: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    source: {
      method: "models-api",
      name: "OpenRouter",
      retrievedAt,
      timestampMeaning: "source-added-at",
      url: MODEL_RELEASE_SOURCE_URL,
    },
    policy: {
      limit: MODEL_RELEASE_LIMIT,
      providers: [...modelReleaseProviderIds],
      publication: "discovery-only",
      requires: ["text-output", "tools"],
      windowDays: MODEL_RELEASE_WINDOW_DAYS,
    },
    observedListings,
    releases,
  };
}

describe("model-release semantic identity", () => {
  test("resolves only canonical established-provider OpenRouter ids", () => {
    expect(modelReleaseProviderForOpenRouterId("z-ai/glm-5.3")).toEqual({
      providerId: "z_ai",
      providerName: "Z.ai",
    });
    expect(openRouterModelIdTail("openai/gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(modelReleaseProviderForOpenRouterId("~openai/private")).toBeNull();
    expect(modelReleaseProviderForOpenRouterId("openai/gpt-5.6-sol:batch")).toBeNull();
    expect(modelReleaseProviderForOpenRouterId("unknown/example")).toBeNull();
  });

  test("retains deliberate punctuation, configuration, and Anthropic brand matches", () => {
    expect(modelReleaseSemanticKey("z_ai", "GLM 5.3 Flash"))
      .toBe(modelReleaseSemanticKey("z_ai", "GLM-5.3-Flash"));
    expect(modelReleaseSemanticKey("alibaba_cloud", "Qwen3.7 Plus"))
      .toBe(modelReleaseSemanticKey("alibaba_cloud", "Qwen 3.7 Plus (thinking)"));
    expect(modelReleaseSemanticKey("anthropic", "Anthropic Claude Opus 5"))
      .toBe(modelReleaseSemanticKey("anthropic", "Opus 5 (with fallback)"));
  });

  test("preserves token boundaries instead of concatenating unrelated labels", () => {
    expect(modelReleaseSemanticKey("openai", "AB C"))
      .not.toBe(modelReleaseSemanticKey("openai", "A BC"));
    expect(modelReleaseSemanticKey("openai", "Model 1 23"))
      .not.toBe(modelReleaseSemanticKey("openai", "Model 12 3"));
    expect(modelReleaseSemanticKey("openai", "C++"))
      .not.toBe(modelReleaseSemanticKey("openai", "C"));
  });

  test("normalizes compatible Unicode forms without erasing non-Latin identity", () => {
    expect(modelReleaseSemanticKey("z_ai", "ＧＬＭ－５．３"))
      .toBe(modelReleaseSemanticKey("z_ai", "glm-5.3"));
    expect(modelReleaseSemanticKey("google", "模型 甲"))
      .not.toBe(modelReleaseSemanticKey("google", "模 型甲"));
    expect(modelReleaseSemanticKey("google", "Módel 5"))
      .not.toBe(modelReleaseSemanticKey("google", "Model 5"));
  });

  test("keeps provider ownership as part of identity", () => {
    expect(modelReleaseSemanticKey("openai", "Model 5"))
      .not.toBe(modelReleaseSemanticKey("google", "Model 5"));
  });

  test("rejects labels that normalize to no semantic name tokens", () => {
    expect(() => modelReleaseSemanticKey("openai", "..."))
      .toThrow("requires at least one name token");
    expect(() => modelReleaseSemanticKey("anthropic", "Anthropic Claude"))
      .toThrow("requires at least one name token");
  });
});

describe("durable OpenRouter listing observations", () => {
  test("accepts more than the current-radar limit and observations older than its window", () => {
    const observedListings = Array.from({ length: MODEL_RELEASE_LIMIT + 4 }, (_, index) => (
      listing(
        `openai/archive-${String(index).padStart(2, "0")}`,
        new Date(Date.parse(retrievedAt) - (100 + index) * 86_400_000).toISOString(),
      )
    ));

    expect(parseModelReleaseRadar(radar(observedListings)).ok).toBeTrue();
  });

  test("rejects duplicate, future, and non-deterministically ordered observations", () => {
    const newest = listing("openai/newest", "2026-08-20T00:00:00.000Z");
    const older = listing("openai/older", "2026-08-19T00:00:00.000Z");

    expect(parseModelReleaseRadar(radar([newest, newest])).ok).toBeFalse();
    expect(parseModelReleaseRadar(radar([
      listing("openai/future", "2026-08-29T00:00:00.000Z"),
    ])).ok).toBeFalse();
    expect(parseModelReleaseRadar(radar([older, newest])).ok).toBeFalse();
  });

  test("requires every bounded radar row to have an exact durable projection", () => {
    const observed = listing("openai/example", "2026-08-20T00:00:00.000Z");
    const release = {
      capabilities: {
        inputModalities: ["text"],
        outputModalities: ["text"],
        supportsTools: true,
      },
      canonicalSlug: "openai/example-20260820",
      id: observed.id,
      model: observed.model,
      modelUrl: `https://openrouter.ai/${observed.id}`,
      providerId: observed.providerId,
      providerName: "OpenAI",
      sourceAddedAt: observed.sourceAddedAt,
      status: "awaiting-benchmark",
    };

    expect(parseModelReleaseRadar(radar([observed], [release])).ok).toBeTrue();
    expect(parseModelReleaseRadar(radar([], [release])).ok).toBeFalse();
    expect(parseModelReleaseRadar(radar([
      { ...observed, model: "Different label" },
    ], [release])).ok).toBeFalse();
  });
});
