import { describe, expect, test } from "bun:test";
import { extractSourceRows, normalizeSourceRows, validateSnapshotUpdate } from "./refresh-coding-agents";

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
      { datasetIndexName: "terminal-bench-v2", mean: { reward: 0.81 } },
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

  test("rejects duplicate stable rows and substantial row-count regressions", () => {
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

    const truncatedResult = validateSnapshotUpdate(previous, {
      ...normalizedSnapshot(7),
      source: previous.source,
    });
    expect(truncatedResult.ok).toBe(false);
    if (!truncatedResult.ok) expect(truncatedResult.error.message).toContain("dropped from 10 to 7 rows");

    const replaced = normalizedSnapshot(10);
    replaced.records = replaced.records.map((record, index) => ({ ...record, seriesId: `replacement-${index}` }));
    const replacedResult = validateSnapshotUpdate(previous, replaced);
    expect(replacedResult.ok).toBe(false);
    if (!replacedResult.ok) expect(replacedResult.error.message).toContain("stable series/setting keys");
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
});
