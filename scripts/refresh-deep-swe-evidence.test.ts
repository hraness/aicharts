import { describe, expect, test } from "bun:test";

import type { CodingAgentRecord, CodingAgentSnapshot } from "../lib/coding-agent-data";
import {
  DEEP_SWE_EVIDENCE_SOURCE_URL,
  deriveDeepSweEvidenceSnapshot,
  parseDeepSweSourceSnapshot,
  type DeepSweEvidenceSnapshot,
} from "../lib/deep-swe-evidence";
import {
  MODEL_RELEASE_SOURCE_URL,
  type OpenRouterModel,
} from "../lib/model-release-data";
import { err, ok, type Result } from "../lib/result";
import { refreshDeepSweEvidence } from "./refresh-deep-swe-evidence";

const refreshedAt = "2026-08-28T19:00:00.000Z";

function benchmarkRecord(model: string): CodingAgentRecord {
  return {
    agent: "Example Agent",
    benchmarks: { aaIndex: 60, deepSwe: 55, sweAtlas: 50, terminalBench: 65 },
    completeIndex: true,
    economics: { costUsd: 1, durationSeconds: 60 },
    id: `openai-${model}`,
    model,
    modelLabel: model,
    providerId: "openai",
    providerName: "OpenAI",
    seriesId: `openai/${model}`,
    seriesLabel: model,
    setting: "max",
    settingRank: 0,
    usage: { totalTokens: 1_000 },
  };
}

function benchmarkSnapshot(): CodingAgentSnapshot {
  return {
    records: [benchmarkRecord("Known Model"), benchmarkRecord("New AAI Model")],
    schemaVersion: 3,
    source: {
      benchmarkDatasets: {
        deepSwe: "deep-swe",
        sweAtlas: "swe-atlas-qna",
        terminalBench: "terminal-bench-v2.1",
      },
      method: "next-flight",
      name: "Artificial Analysis",
      retrievedAt: "2026-08-28T17:00:00.000Z",
      url: "https://artificialanalysis.ai/agents/coding-agents/",
    },
    updates: [],
  };
}

function rawRow(model: string, config: string): Record<string, unknown> {
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
  };
}

function openRouterModel(): OpenRouterModel {
  return {
    architecture: { inputModalities: ["text"], outputModalities: ["text"] },
    canonicalSlug: "openai/known-model-20260828",
    created: Date.parse("2026-08-28T00:00:00.000Z") / 1_000,
    id: "openai/known-model",
    name: "OpenAI: Known Model",
    supportedParameters: ["tools"],
  };
}

function previousEvidence(benchmark: CodingAgentSnapshot): DeepSweEvidenceSnapshot {
  const source = parseDeepSweSourceSnapshot(rawSource([
    rawRow("known-model", "known-max"),
  ]));
  if (!source.ok) throw source.error;
  return deriveDeepSweEvidenceSnapshot(
    source.value,
    [openRouterModel()],
    benchmark,
    "2026-08-28T18:30:00.000Z",
    "2026-08-28T18:29:00.000Z",
    "2026-08-28T18:28:00.000Z",
  );
}

describe("direct DeepSWE refresh fallbacks", () => {
  for (const failure of ["transport", "shape"] as const) {
    test(`publishes DataCurve evidence through checked-identity and AAI fallback after OpenRouter ${failure} failure`, async () => {
      const benchmark = benchmarkSnapshot();
      const previous = previousEvidence(benchmark);
      const warnings: string[] = [];
      const writes: DeepSweEvidenceSnapshot[] = [];
      const dataCurveSource = rawSource([
        rawRow("known-model", "known-max"),
        rawRow("new-aai-model", "new-aai-max"),
      ]);

      const fetchJson = async (
        url: string,
      ): Promise<Result<unknown, Error>> => {
        if (url === MODEL_RELEASE_SOURCE_URL) {
          return failure === "transport"
            ? err(new Error("OpenRouter unavailable"))
            : ok({ data: [] });
        }
        if (url === DEEP_SWE_EVIDENCE_SOURCE_URL) return ok(dataCurveSource);
        return err(new Error(`Unexpected source ${url}`));
      };

      const result = await refreshDeepSweEvidence({
        fetchJson,
        now: () => refreshedAt,
        readBenchmarkSnapshot: async () => ok(benchmark),
        readCommittedEvidence: async () => ok(previous),
        warn: message => warnings.push(message),
        writeCommittedEvidence: async snapshot => { writes.push(snapshot); },
      });

      expect(result.ok).toBeTrue();
      if (!result.ok) return;
      expect(writes).toEqual([result.value]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("using AAI for new models");
      expect(result.value.identitySource).toMatchObject({
        attemptedAt: refreshedAt,
        retrievedAt: null,
        status: "unavailable",
      });

      const known = result.value.records.find(record => record.sourceModel === "known-model");
      expect(known?.identity).toMatchObject({
        modelId: "openai/known-model",
        resolver: {
          name: "OpenRouter",
          retrievedAt: "2026-08-28T18:29:00.000Z",
        },
        source: "openrouter",
      });
      const newlyResolved = result.value.records.find(
        record => record.sourceModel === "new-aai-model",
      );
      expect(newlyResolved?.identity).toMatchObject({
        resolver: {
          name: "Artificial Analysis",
          retrievedAt: benchmark.source.retrievedAt,
          url: benchmark.source.url,
        },
        source: "artificial-analysis",
      });
      expect(result.value.unmatchedModels).toEqual([]);
    });
  }

  test("preserves an exact checked id when a valid partial OpenRouter catalog omits it", async () => {
    const benchmark = benchmarkSnapshot();
    const previous = previousEvidence(benchmark);
    const warnings: string[] = [];
    const dataCurveSource = rawSource([
      rawRow("known-model", "known-max"),
      rawRow("new-aai-model", "new-aai-max"),
    ]);
    const partialOpenRouterCatalog = {
      data: [{
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["text"],
        },
        canonical_slug: "google/unrelated-model-20260828",
        created: Date.parse("2026-08-28T00:00:00.000Z") / 1_000,
        id: "google/unrelated-model",
        name: "Google: Unrelated Model",
        supported_parameters: ["tools"],
      }],
    };

    const result = await refreshDeepSweEvidence({
      fetchJson: async url => (
        url === MODEL_RELEASE_SOURCE_URL
          ? ok(partialOpenRouterCatalog)
          : url === DEEP_SWE_EVIDENCE_SOURCE_URL
            ? ok(dataCurveSource)
            : err(new Error(`Unexpected source ${url}`))
      ),
      now: () => refreshedAt,
      readBenchmarkSnapshot: async () => ok(benchmark),
      readCommittedEvidence: async () => ok(previous),
      warn: message => warnings.push(message),
      writeCommittedEvidence: async () => {},
    });

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(warnings).toEqual([]);
    expect(result.value.identitySource).toMatchObject({
      retrievedAt: refreshedAt,
      status: "available",
    });
    expect(result.value.records.find(record => record.sourceModel === "known-model")?.identity)
      .toMatchObject({ modelId: "openai/known-model", source: "openrouter" });
    expect(result.value.records.find(record => record.sourceModel === "new-aai-model")?.identity)
      .toMatchObject({ source: "artificial-analysis" });
  });
});
