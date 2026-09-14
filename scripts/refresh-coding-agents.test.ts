import { describe, expect, test } from "bun:test";
import { assertProperty, fc } from "../lib/property-test";
import {
  deriveSnapshotUpdates,
  extractSourceRows,
  mergeSnapshotUpdates,
  normalizeSourceRows,
  reconcileSnapshotSeriesIds,
  validateSnapshotUpdate,
} from "./refresh-coding-agents";

function sourceRow(index: number, model = `Model ${index}`) {
  return {
    id: `row-${index}`,
    agentName: "codex",
    provider: "provider",
    hostModelSlug: "model-prime",
    display: {
      agent: "Codex CLI",
      model,
      creator: {
        agent: "OpenAI",
        model: "OpenAI",
      },
    },
    displayLabel: `Row ${index} ]`,
    indexComponentCount: 3,
    evalCount: 3,
    indexScore: 0.75,
    evals: [
      { datasetIndexName: "deep-swe", mean: { reward: 0.62 } },
      { datasetIndexName: "terminal-bench-v2.1", mean: { reward: 0.81 } },
      { datasetIndexName: "swe-atlas-qna", mean: { reward: 0.7 } },
    ],
    mean: {
      costUsd: 4 + index,
      agentWallTimeSec: 600 + index,
      totalTokens: 1_000_000 + index,
    },
  };
}

function flightScript(payload: string): string {
  return `<script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`;
}

function normalizedSnapshot(count: number) {
  const snapshot = normalizeSourceRows(
    Array.from({ length: count }, (_, index) => sourceRow(index)),
    "2026-07-17T16:29:07.106Z",
  );
  return {
    ...snapshot,
    records: snapshot.records.map((record, index) => ({ ...record, seriesId: `series-${index}` })),
  };
}

describe("Artificial Analysis Flight extraction", () => {
  test("extracts inline benchmark rows without mistaking brackets inside strings for array endings", () => {
    const rows = Array.from({ length: 10 }, (_, index) => sourceRow(index));
    const html = flightScript(`0:{"benchmarkRows":${JSON.stringify(rows)}}`);
    const result = extractSourceRows(html);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(10);
      expect(result.value[0]?.displayLabel).toBe("Row 0 ]");
    }
  });

  test("resolves benchmark rows stored as separate Flight records", () => {
    const rows = Array.from({ length: 10 }, (_, index) => sourceRow(index));
    const references = rows.map((_, index) => `$${index + 1}`);
    const html = [
      flightScript(`0:{"benchmarkRows":${JSON.stringify(references)}}`),
      ...rows.map((row, index) => flightScript(`${index + 1}:${JSON.stringify(row)}`)),
    ].join("");
    const result = extractSourceRows(html);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map(({ id }) => id)).toEqual(rows.map(({ id }) => id));
  });

  test("fails explicitly when the page no longer exposes benchmark rows", () => {
    const result = extractSourceRows(flightScript("0:{\"otherRows\":[]}"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("benchmarkRows");
  });

  test("normalizes benchmark percentages, total tokens, effort settings, completeness, and source metadata", () => {
    const rows = Array.from({ length: 10 }, (_, index) => (
      sourceRow(index, index === 0 ? "Model Prime (Extra High)" : `Model ${index}`)
    ));
    const extracted = extractSourceRows(flightScript(`0:{"benchmarkRows":${JSON.stringify(rows)}}`));
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const snapshot = normalizeSourceRows(extracted.value, "2026-07-17T16:29:07.106Z");
    const prime = snapshot.records.find(({ id }) => id === "row-0");

    expect(snapshot.source).toEqual({
      benchmarkDatasets: {
        deepSwe: "deep-swe",
        terminalBench: "terminal-bench-v2.1",
        sweAtlas: "swe-atlas-qna",
      },
      name: "Artificial Analysis",
      url: "https://artificialanalysis.ai/agents/coding-agents/",
      retrievedAt: "2026-07-17T16:29:07.106Z",
      method: "next-flight",
    });
    expect(prime?.model).toBe("Model Prime");
    expect(prime?.setting).toBe("extra high");
    expect(prime?.settingRank).toBe(5);
    expect(prime?.completeIndex).toBe(true);
    expect(prime?.benchmarks).toEqual({
      aaIndex: 75,
      deepSwe: 62,
      terminalBench: 81,
      sweAtlas: 70,
    });
    expect(prime?.usage.totalTokens).toBe(1_000_000);
  });

  test("rejects duplicate stable rows, duplicate semantic observations, and substantial row-count regressions", () => {
    const previous = normalizedSnapshot(10);
    const duplicate = normalizedSnapshot(10);
    const first = duplicate.records[0];
    const second = duplicate.records[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    duplicate.records[1] = { ...second, seriesId: first.seriesId, setting: first.setting };

    const duplicateResult = validateSnapshotUpdate(previous, duplicate);
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) expect(duplicateResult.error.message).toContain("duplicate series/setting");

    const semanticDuplicate = normalizedSnapshot(10);
    const semanticFirst = semanticDuplicate.records[0];
    const semanticSecond = semanticDuplicate.records[1];
    expect(semanticFirst).toBeDefined();
    expect(semanticSecond).toBeDefined();
    if (semanticFirst === undefined || semanticSecond === undefined) return;
    semanticDuplicate.records[1] = {
      ...semanticSecond,
      agent: semanticFirst.agent,
      model: semanticFirst.model,
      providerId: semanticFirst.providerId,
      setting: semanticFirst.setting,
    };

    const semanticDuplicateResult = validateSnapshotUpdate(previous, semanticDuplicate);
    expect(semanticDuplicateResult.ok).toBe(false);
    if (!semanticDuplicateResult.ok) {
      expect(semanticDuplicateResult.error.message).toContain("duplicate semantic observation");
    }

    const truncatedResult = validateSnapshotUpdate(previous, {
      ...normalizedSnapshot(7),
      source: previous.source,
    });
    expect(truncatedResult.ok).toBe(false);
    if (!truncatedResult.ok) expect(truncatedResult.error.message).toContain("dropped from 10 to 7 rows");

    const replaced = normalizedSnapshot(10);
    replaced.records = replaced.records.map((record, index) => ({
      ...record,
      model: `Replacement ${index}`,
      seriesId: `replacement-${index}`,
    }));
    const replacedResult = validateSnapshotUpdate(previous, replaced);
    expect(replacedResult.ok).toBe(false);
    if (!replacedResult.ok) expect(replacedResult.error.message).toContain("stable series/setting keys");
  });

  test("reconciles upstream series slug churn without fabricating model-added events", () => {
    const previous = normalizedSnapshot(10);
    const candidate = normalizedSnapshot(10);
    candidate.source = { ...candidate.source, retrievedAt: "2026-07-18T16:29:07.106Z" };
    candidate.records = candidate.records.map((record, index) => ({
      ...record,
      seriesId: `public-slug-${index}`,
    }));

    expect(validateSnapshotUpdate(previous, candidate)).toEqual({ ok: true, value: undefined });
    expect(deriveSnapshotUpdates(previous, candidate)).toEqual([]);
    expect(reconcileSnapshotSeriesIds(previous, candidate).records.map(record => record.seriesId))
      .toEqual(previous.records.map(record => record.seriesId));
  });

  test("rejects substantial chart-metric coverage regressions", () => {
    const previous = normalizedSnapshot(10);
    for (const metric of ["deepSwe", "terminalBench", "sweAtlas", "totalTokens"] as const) {
      const candidate = normalizedSnapshot(10);
      candidate.records = candidate.records.map((record, index) => {
        if (index >= 3) return record;
        if (metric === "totalTokens") return { ...record, usage: { totalTokens: null } };
        return { ...record, benchmarks: { ...record.benchmarks, [metric]: null } };
      });

      const result = validateSnapshotUpdate(previous, candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain(`${metric} coverage from 10 to 7`);
    }
  });

  test("groups newly added settings into one model event with the best benchmark summary", () => {
    const previous = normalizedSnapshot(10);
    const candidate = normalizedSnapshot(10);
    const low = sourceRow(10, "Model Next (low)");
    low.hostModelSlug = "model-next";
    low.indexScore = 0.68;
    const high = sourceRow(11, "Model Next (high)");
    high.hostModelSlug = "model-next";
    high.indexScore = 0.76;
    const additions = normalizeSourceRows([low, high, ...Array.from({ length: 8 }, (_, index) => sourceRow(index))], "2026-07-18T16:29:07.106Z");
    candidate.source = additions.source;
    candidate.records.push(...additions.records.filter(({ model }) => model === "Model Next"));

    const updates = deriveSnapshotUpdates(previous, candidate);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      benchmarks: { aaIndex: 76 },
      kind: "model-added",
      model: "Model Next",
      setting: "high",
      variantCount: 2,
    });
  });

  test("distinguishes a new setting from a genuinely new model", () => {
    const previous = normalizedSnapshot(10);
    const candidate = normalizedSnapshot(10);
    candidate.source = { ...candidate.source, retrievedAt: "2026-07-18T16:29:07.106Z" };
    const existing = candidate.records[0];
    expect(existing).toBeDefined();
    if (existing === undefined) return;
    candidate.records.push({
      ...existing,
      id: "new-setting-row",
      modelLabel: `${existing.model} (high)`,
      setting: "high",
      settingRank: 4,
    });

    expect(deriveSnapshotUpdates(previous, candidate)).toMatchObject([{
      kind: "variant-added",
      model: existing.model,
      setting: "high",
      variantCount: 1,
    }]);
  });

  test("records material benchmark changes and suppresses sub-half-point noise", () => {
    const previous = normalizedSnapshot(10);
    const candidate = normalizedSnapshot(10);
    candidate.source = { ...candidate.source, retrievedAt: "2026-07-18T16:29:07.106Z" };
    const first = candidate.records[0];
    const second = candidate.records[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    candidate.records[0] = {
      ...first,
      benchmarks: { ...first.benchmarks, aaIndex: 75.49, terminalBench: 82 },
    };
    candidate.records[1] = {
      ...second,
      benchmarks: { ...second.benchmarks, aaIndex: 75.3 },
    };

    const updates = deriveSnapshotUpdates(previous, candidate);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      changes: [{ current: 82, metric: "terminalBench", previous: 81 }],
      kind: "benchmark-changed",
      model: "Model 0",
    });
  });

  test("does not report scores from a benchmark-version migration as ordinary changes", () => {
    const previous = normalizedSnapshot(10);
    previous.source = {
      ...previous.source,
      benchmarkDatasets: {
        ...previous.source.benchmarkDatasets,
        terminalBench: "terminal-bench-v2",
      },
    };
    const candidate = normalizedSnapshot(10);
    candidate.source = { ...candidate.source, retrievedAt: "2026-07-18T16:29:07.106Z" };
    const first = candidate.records[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    candidate.records[0] = {
      ...first,
      benchmarks: {
        ...first.benchmarks,
        aaIndex: 88,
        deepSwe: 70,
        terminalBench: 92,
      },
    };
    previous.updates = [{
      id: "legacy-terminal-benchmark-event",
      agent: "Codex CLI",
      benchmarks: previous.records[0]?.benchmarks ?? {
        aaIndex: null,
        deepSwe: null,
        sweAtlas: null,
        terminalBench: null,
      },
      detectedAt: "2026-07-17T16:29:07.106Z",
      kind: "model-added",
      model: "Model 0",
      providerId: "openai",
      providerName: "OpenAI",
      setting: "default",
      variantCount: 1,
    }];

    expect(deriveSnapshotUpdates(previous, candidate)).toMatchObject([{
      changes: [{ current: 70, metric: "deepSwe", previous: 62 }],
      kind: "benchmark-changed",
    }]);
    const merged = mergeSnapshotUpdates(previous, candidate);
    expect(merged.updates).toHaveLength(1);
    expect(merged.updates[0]).toMatchObject({
      detectedAt: candidate.source.retrievedAt,
      kind: "benchmark-changed",
    });
    expect(merged.updates.some(({ id }) => id === "legacy-terminal-benchmark-event"))
      .toBeFalse();
  });

  test("keeps prior history when a refresh has no notable changes", () => {
    const previous = normalizedSnapshot(10);
    previous.updates = [{
      id: "existing-update",
      agent: "Codex CLI",
      benchmarks: previous.records[0]?.benchmarks ?? {
        aaIndex: null,
        deepSwe: null,
        sweAtlas: null,
        terminalBench: null,
      },
      detectedAt: "2026-07-17T16:29:07.106Z",
      kind: "model-added",
      model: "Model 0",
      providerId: "openai",
      providerName: "OpenAI",
      setting: "default",
      variantCount: 1,
    }];
    const candidate = normalizedSnapshot(10);
    candidate.source = { ...candidate.source, retrievedAt: "2026-07-18T16:29:07.106Z" };

    expect(mergeSnapshotUpdates(previous, candidate).updates).toEqual(previous.updates);
  });

  test("property: upstream row-id churn and ordering never fabricate model updates", () => {
    assertProperty(fc.property(
      fc.array(fc.integer(), { minLength: 10, maxLength: 10 }),
      (weights) => {
        const previous = normalizedSnapshot(10);
        const candidate = normalizedSnapshot(10);
        candidate.source = { ...candidate.source, retrievedAt: "2026-07-18T16:29:07.106Z" };
        candidate.records = candidate.records
          .map((record) => ({ ...record, id: `churned-${record.id}` }))
          .sort((left, right) => (
            (weights[Number(left.seriesId.slice("series-".length))] ?? 0)
            - (weights[Number(right.seriesId.slice("series-".length))] ?? 0)
            || left.seriesId.localeCompare(right.seriesId)
          ));

        expect(deriveSnapshotUpdates(previous, candidate)).toEqual([]);
      },
    ));
  });
});
