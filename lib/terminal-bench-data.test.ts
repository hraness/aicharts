import { describe, expect, test } from "bun:test";

import terminalBenchData from "@/data/terminal-bench.json";

import {
  parseTerminalBenchSnapshot,
  TERMINAL_BENCH_TRIALS_PER_CONFIGURATION,
  TERMINAL_BENCH_VERSION,
  terminalBenchRecordSchema,
  terminalBenchRecordKey,
  validateTerminalBenchReplacement,
  type TerminalBenchSnapshot,
} from "./terminal-bench-data";

const unsafeRetainedUrls = [
  "javascript:alert(1)",
  "data:text/html,unsafe",
  "http://example.com/unsafe",
  "https://user:pass@example.com/unsafe",
] as const;

describe("checked Terminal-Bench data", () => {
  test("is an exact, version-pinned 4.0 snapshot", () => {
    const parsed = parseTerminalBenchSnapshot(terminalBenchData);

    expect(parsed.ok).toBeTrue();
    if (!parsed.ok) return;
    expect(parsed.value.benchmark).toMatchObject({
      datasetRef: "4",
      name: "Terminal-Bench",
      taskCount: 66,
      trialsPerConfiguration: 330,
      trialsPerTask: 5,
      version: TERMINAL_BENCH_VERSION,
    });
    expect(parsed.value.source.repositoryCommit).toHaveLength(40);
    expect(parsed.value.source.leaderboardDefinitionUrl).toContain(
      parsed.value.source.repositoryCommit,
    );
    expect(parsed.value.records.length).toBeGreaterThanOrEqual(10);
  });

  test("retains trial, confidence, economics, usage, and harness identity for every configuration", () => {
    const parsed = parseTerminalBenchSnapshot(terminalBenchData);
    if (!parsed.ok) throw parsed.error;

    const keys = new Set(parsed.value.records.map(terminalBenchRecordKey));
    expect(keys.size).toBe(parsed.value.records.length);
    for (const record of parsed.value.records) {
      expect(record.metrics.nTrials).toBe(TERMINAL_BENCH_TRIALS_PER_CONFIGURATION);
      expect(record.metrics.accuracyCi95HalfWidthPercent).toBeGreaterThan(0);
      expect(record.metrics.totalCostUsd).toBeGreaterThan(0);
      expect(record.metrics.totalTokens).toBeGreaterThan(0);
      expect(record.harness.version.length).toBeGreaterThan(0);
      expect(record.model.id).toContain("/");
      expect(record.sourceUrl).toContain(parsed.value.source.repositoryCommit);
    }
  });

  test("keeps source null-effort semantics separate from displayed none", () => {
    const parsed = parseTerminalBenchSnapshot(terminalBenchData);
    if (!parsed.ok) throw parsed.error;

    const noEffortRecords = parsed.value.records.filter(record => (
      record.reasoningEffort === "none"
    ));
    expect(noEffortRecords.length).toBeGreaterThan(0);
    expect(noEffortRecords.every(record => record.sourceFilterReasoningEffort === null)).toBeTrue();
  });

  test("rejects unsafe URLs at every retained record URL boundary", () => {
    const parsed = parseTerminalBenchSnapshot(terminalBenchData);
    if (!parsed.ok) throw parsed.error;
    const record = parsed.value.records[0]!;

    for (const url of unsafeRetainedUrls) {
      expect(terminalBenchRecordSchema.safeParse({
        ...record,
        harness: { ...record.harness, display: { ...record.harness.display, url } },
      }).success).toBeFalse();
      expect(terminalBenchRecordSchema.safeParse({
        ...record,
        harness: { ...record.harness, organization: { ...record.harness.organization, url } },
      }).success).toBeFalse();
      expect(terminalBenchRecordSchema.safeParse({
        ...record,
        model: { ...record.model, display: { ...record.model.display, url } },
      }).success).toBeFalse();
      expect(terminalBenchRecordSchema.safeParse({
        ...record,
        model: { ...record.model, organization: { ...record.model.organization, url } },
      }).success).toBeFalse();
      expect(terminalBenchRecordSchema.safeParse({ ...record, sourceJobUrls: [url] }).success)
        .toBeFalse();
      expect(terminalBenchRecordSchema.safeParse({ ...record, sourceUrl: url }).success)
        .toBeFalse();
    }
  });

  test("rejects a same-shape owner snapshot whose commit timestamp regresses", () => {
    const parsed = parseTerminalBenchSnapshot(terminalBenchData);
    if (!parsed.ok) throw parsed.error;
    const candidate: TerminalBenchSnapshot = {
      ...parsed.value,
      source: {
        ...parsed.value.source,
        repositoryCommittedAt: "2026-08-28T23:27:45Z",
      },
    };

    const replacement = validateTerminalBenchReplacement(parsed.value, candidate);
    expect(replacement.ok).toBeFalse();
    if (!replacement.ok) expect(replacement.error.message).toContain("timestamp regressed");
  });
});
