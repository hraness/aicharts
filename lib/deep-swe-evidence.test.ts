import { describe, expect, test } from "bun:test";

import deepSweEvidenceData from "@/data/deep-swe-evidence.json";

import type { CodingAgentRecord, CodingAgentSnapshot } from "./coding-agent-data";
import { directDeepSweEvidenceForReleaseFrom } from "./deep-swe-evidence-collection";
import {
  deriveDeepSweEvidenceSnapshot,
  parseDeepSweEvidenceSnapshot,
  parseDeepSweSourceSnapshot,
  resolveDeepSweEvidenceIdentity,
  validateDeepSweEvidenceReplacement,
} from "./deep-swe-evidence";
import type { ModelRelease, OpenRouterModel } from "./model-release-data";

const retrievedAt = "2026-08-28T19:00:00.000Z";

function rawRow(
  model: string,
  config: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    ci_hi: .9,
    ci_lo: .5,
    config,
    harness: "mini-swe-agent",
    model,
    n_attempted: 4,
    n_passed: 3,
    n_runs: 4,
    pass_at_1: .75,
    pass_rate: .75,
    reasoning_effort: "max",
    source: "deep-swe",
    ignored_efficiency_field: 123,
    ...overrides,
  };
}

function rawSource(rows: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    generated_at: "2026-08-28T18:00:00.000Z",
    latest_job: { finished_at: null, name: "latest-job" },
    n_tasks_in_set: 113,
    rows,
    scope: "Every rollout grouped by configuration.",
    unit: "pass@1 is attempt pass rate.",
    ignored_top_level_field: true,
  };
}

function openRouterModel(id: string, name: string): OpenRouterModel {
  return {
    architecture: { inputModalities: ["text"], outputModalities: ["text"] },
    canonicalSlug: `${id}-20260828`,
    created: Date.parse("2026-08-28T00:00:00.000Z") / 1_000,
    id,
    name,
    supportedParameters: ["tools"],
  };
}

function release(id: string, model: string): ModelRelease {
  return {
    capabilities: {
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsTools: true,
    },
    canonicalSlug: id,
    id,
    model,
    modelUrl: `https://openrouter.ai/${id}`,
    providerId: "openai",
    providerName: "OpenAI",
    sourceAddedAt: retrievedAt,
    status: "awaiting-benchmark",
  };
}

function benchmarkRecord(providerId: string, model: string): CodingAgentRecord {
  return {
    agent: "Example Agent",
    benchmarks: { aaIndex: 60, deepSwe: 55, sweAtlas: 50, terminalBench: 65 },
    completeIndex: true,
    economics: { costUsd: 1, durationSeconds: 60 },
    id: `${providerId}-${model}`,
    model,
    modelLabel: model,
    providerId,
    providerName: providerId,
    seriesId: `${providerId}/${model}`,
    seriesLabel: model,
    setting: "max",
    settingRank: 0,
    usage: { totalTokens: 1_000 },
  };
}

function benchmarkSnapshot(records: readonly CodingAgentRecord[] = []): CodingAgentSnapshot {
  return {
    records: [...records],
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

describe("DataCurve DeepSWE source parsing", () => {
  test("projects additive source fields and preserves nullable effort", () => {
    const parsed = parseDeepSweSourceSnapshot(rawSource([
      rawRow("kimi-k2-7-code", "kimi-default", { reasoning_effort: null }),
    ]));

    expect(parsed.ok).toBeTrue();
    if (!parsed.ok) return;
    expect(parsed.value.rows).toEqual([{
      attempted: 4,
      ciHigh: .9,
      ciLow: .5,
      config: "kimi-default",
      harness: "mini-swe-agent",
      model: "kimi-k2-7-code",
      passed: 3,
      passAt1: .75,
      passRate: .75,
      reasoningEffort: null,
      runs: 4,
      source: "deep-swe",
    }]);
  });

  test("rejects duplicate configurations, inconsistent rates, and invalid confidence intervals", () => {
    const duplicate = rawRow("glm-5-3", "duplicate");
    expect(parseDeepSweSourceSnapshot(rawSource([duplicate, duplicate])).ok).toBeFalse();
    expect(parseDeepSweSourceSnapshot(rawSource([
      rawRow("glm-5-3", "bad-rate", { pass_at_1: .5 }),
    ])).ok).toBeFalse();
    expect(parseDeepSweSourceSnapshot(rawSource([
      rawRow("glm-5-3", "split-rate", { pass_rate: .5 }),
    ])).ok).toBeFalse();
    expect(parseDeepSweSourceSnapshot(rawSource([
      rawRow("glm-5-3", "bad-ci", { ci_hi: .7 }),
    ])).ok).toBeFalse();
  });
});

describe("DeepSWE model identity", () => {
  test("prefers one exact OpenRouter id-tail match over an AAI match", () => {
    const resolved = resolveDeepSweEvidenceIdentity(
      "gpt-5-6-sol",
      [openRouterModel("openai/gpt-5.6-sol", "OpenAI: GPT-5.6 Sol")],
      benchmarkSnapshot([benchmarkRecord("openai", "GPT-5.6 Sol")]),
      retrievedAt,
    );

    expect(resolved).toEqual({
      identity: {
        modelId: "openai/gpt-5.6-sol",
        resolver: {
          name: "OpenRouter",
          retrievedAt,
          url: "https://openrouter.ai/api/v1/models?sort=newest",
        },
        source: "openrouter",
      },
      model: "GPT-5.6 Sol",
      providerId: "openai",
    });
  });

  test("falls back to a unique AAI identity when OpenRouter has no exact id", () => {
    const resolved = resolveDeepSweEvidenceIdentity(
      "deepseek-v4-pro",
      [],
      benchmarkSnapshot([benchmarkRecord("deepseek", "DeepSeek V4 Pro")]),
      retrievedAt,
    );

    expect(resolved).toEqual({
      identity: {
        resolver: {
          name: "Artificial Analysis",
          retrievedAt,
          url: "https://artificialanalysis.ai/agents/coding-agents/",
        },
        source: "artificial-analysis",
      },
      model: "DeepSeek V4 Pro",
      providerId: "deepseek",
    });
  });

  test("fails closed on ambiguous ids and never fuzzy-matches dated variants", () => {
    expect(resolveDeepSweEvidenceIdentity(
      "example-5",
      [
        openRouterModel("openai/example-5", "OpenAI: Example 5"),
        openRouterModel("google/example-5", "Google: Example 5"),
      ],
      benchmarkSnapshot(),
      retrievedAt,
    )).toBeNull();
    expect(resolveDeepSweEvidenceIdentity(
      "deepseek-v4-pro",
      [openRouterModel("deepseek/deepseek-v4-pro-0813", "DeepSeek: DeepSeek V4 Pro")],
      benchmarkSnapshot(),
      retrievedAt,
    )).toBeNull();
  });
});

describe("checked direct DeepSWE evidence", () => {
  test("retains every configuration with OpenRouter-first provenance", () => {
    const source = parseDeepSweSourceSnapshot(rawSource([
      rawRow("glm-5-3", "glm-max"),
      rawRow("gpt-5-5", "gpt-high", { reasoning_effort: "high" }),
    ]));
    if (!source.ok) throw source.error;
    const snapshot = deriveDeepSweEvidenceSnapshot(
      source.value,
      [openRouterModel("z-ai/glm-5.3", "Z.ai: GLM 5.3")],
      benchmarkSnapshot([benchmarkRecord("openai", "GPT-5.5")]),
      retrievedAt,
    );

    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.records.map(record => record.identity.source).sort()).toEqual([
      "artificial-analysis",
      "openrouter",
    ]);
    expect(snapshot.unmatchedModels).toEqual([]);
    expect(parseDeepSweEvidenceSnapshot(snapshot).ok).toBeTrue();
  });

  test("never reassigns exact OpenRouter evidence to a different model id", () => {
    const source = parseDeepSweSourceSnapshot(rawSource([
      rawRow("example-5", "example-max"),
    ]));
    if (!source.ok) throw source.error;
    const snapshot = deriveDeepSweEvidenceSnapshot(
      source.value,
      [openRouterModel("openai/example-5", "OpenAI: Example 5")],
      benchmarkSnapshot(),
      retrievedAt,
    );

    expect(directDeepSweEvidenceForReleaseFrom(
      snapshot.records,
      release("openai/example-5", "Example 5"),
    )).not.toBeNull();
    expect(directDeepSweEvidenceForReleaseFrom(
      snapshot.records,
      release("openai/example-5-revision", "Example 5"),
    )).toBeNull();

    const aaiSnapshot = deriveDeepSweEvidenceSnapshot(
      source.value,
      [],
      benchmarkSnapshot([benchmarkRecord("openai", "Example 5")]),
      retrievedAt,
      null,
    );
    expect(directDeepSweEvidenceForReleaseFrom(
      aaiSnapshot.records,
      release("openai/example-5-revision", "Example 5"),
    )?.identity.source).toBe("artificial-analysis");
  });

  test("requires every configuration for one source model to share one identity", () => {
    const source = parseDeepSweSourceSnapshot(rawSource([
      rawRow("example-5", "example-a"),
      rawRow("example-5", "example-b"),
    ]));
    if (!source.ok) throw source.error;
    const snapshot = deriveDeepSweEvidenceSnapshot(
      source.value,
      [openRouterModel("openai/example-5", "OpenAI: Example 5")],
      benchmarkSnapshot(),
      retrievedAt,
    );
    const inconsistent = {
      ...snapshot,
      records: snapshot.records.map((record, index) => (
        index !== 1 || record.identity.source !== "openrouter"
          ? record
          : {
              ...record,
              identity: {
                ...record.identity,
                modelId: "openai/example-5-revision",
              },
            }
      )),
    };

    expect(parseDeepSweEvidenceSnapshot(inconsistent).ok).toBeFalse();
  });

  test("keeps unresolved models explicit and validates the committed full feed", () => {
    const source = parseDeepSweSourceSnapshot(rawSource([
      rawRow("glm-5-3", "glm-max"),
      rawRow("unknown-model", "unknown-max"),
    ]));
    if (!source.ok) throw source.error;
    const snapshot = deriveDeepSweEvidenceSnapshot(
      source.value,
      [openRouterModel("z-ai/glm-5.3", "Z.ai: GLM 5.3")],
      benchmarkSnapshot(),
      retrievedAt,
    );

    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.unmatchedModels).toEqual(["unknown-model"]);
    expect(parseDeepSweEvidenceSnapshot(snapshot).ok).toBeTrue();
    expect(validateDeepSweEvidenceReplacement(snapshot, {
      ...snapshot,
      records: snapshot.records.map(record => ({
        ...record,
        config: `${record.config}-renamed`,
      })),
    }).ok).toBeFalse();

    const committed: unknown = deepSweEvidenceData;
    const parsedCommitted = parseDeepSweEvidenceSnapshot(committed);
    expect(parsedCommitted.ok).toBeTrue();
    if (!parsedCommitted.ok) return;
    expect(parsedCommitted.value.records.length).toBeGreaterThan(0);
    expect(new Set(parsedCommitted.value.records.map(record => record.sourceModel)).size)
      .toBeGreaterThan(0);
    expect(parsedCommitted.value.records.every(record => (
      record.identity.resolver.name === "OpenRouter"
      || record.identity.resolver.name === "Artificial Analysis"
    ))).toBeTrue();
    expect(validateDeepSweEvidenceReplacement(
      parsedCommitted.value,
      {
        ...parsedCommitted.value,
        records: parsedCommitted.value.records.slice(20),
      },
    ).ok).toBeFalse();
    expect(validateDeepSweEvidenceReplacement(
      parsedCommitted.value,
      {
        ...parsedCommitted.value,
        source: {
          ...parsedCommitted.value.source,
          generatedAt: "2026-08-25T00:00:00.000Z",
        },
      },
    ).ok).toBeFalse();
  });
});
