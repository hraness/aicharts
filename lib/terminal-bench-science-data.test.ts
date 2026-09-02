import { describe, expect, test } from "bun:test";

import terminalBenchScienceData from "@/data/terminal-bench-science.json";

import {
  parseTerminalBenchScienceSnapshot,
  TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT,
  TERMINAL_BENCH_SCIENCE_TRIALS_PER_CONFIGURATION,
  TERMINAL_BENCH_SCIENCE_VERSION,
  terminalBenchScienceRecordSchema,
  terminalBenchScienceRecordKey,
  terminalBenchScienceRowUrl,
  validateTerminalBenchScienceReplacement,
  type TerminalBenchScienceSnapshot,
} from "./terminal-bench-science-data";

const unsafeRetainedUrls = [
  "javascript:alert(1)",
  "data:text/html,unsafe",
  "http://example.com/unsafe",
  "https://user:pass@example.com/unsafe",
] as const;

describe("checked Terminal-Bench-Science data", () => {
  test("pins the exact 0.1 release, 70 tasks, and three trials per task", () => {
    const parsed = parseTerminalBenchScienceSnapshot(terminalBenchScienceData);

    expect(parsed.ok).toBeTrue();
    if (!parsed.ok) return;
    expect(parsed.value.benchmark).toEqual({
      name: "Terminal-Bench-Science",
      score: "resolution-rate",
      scoreUnit: "percent",
      taskCount: 70,
      trialsPerConfiguration: 210,
      trialsPerTask: 3,
      version: TERMINAL_BENCH_SCIENCE_VERSION,
      runPolicy: {
        actionLimit: null,
        agentCount: null,
        agentTimeoutSeconds: null,
        costAggregationPolicy:
          "preserve-owner-aggregate-and-domain-costs-without-reconciliation",
        costBasis: "source-reported-total-evaluation-usd; pricing basis unspecified",
        errorTreatment: null,
        retryPolicy: null,
        seedPolicy: null,
        tokenLimit: null,
        toolsMode: null,
        uncertaintyMethod: "source-reported-binomial-standard-error",
      },
    });
    expect(parsed.value.source.releaseCommit).toBe(TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT);
    expect(parsed.value.source.releaseNotesUrl).toContain(TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT);
    expect(parsed.value.source.datasetVersionId).toBe("2b817f26-dc4f-4477-8032-2218dcc553b5");
    expect(parsed.value.source.sourceClass).toBe("benchmark-owner");
    expect(parsed.value.source.leaderboardUrl).toContain("/0.1.0?");
    expect(parsed.value.source.leaderboardUrl).not.toContain("/latest");
    expect(parsed.value.records).toHaveLength(9);
  });

  test("retains model, harness, effort, uncertainty, usage, and cost for every system", () => {
    const parsed = parseTerminalBenchScienceSnapshot(terminalBenchScienceData);
    if (!parsed.ok) throw parsed.error;

    const keys = new Set(parsed.value.records.map(terminalBenchScienceRecordKey));
    expect(keys.size).toBe(parsed.value.records.length);
    for (const record of parsed.value.records) {
      expect(record.metrics.nTrials).toBe(TERMINAL_BENCH_SCIENCE_TRIALS_PER_CONFIGURATION);
      expect(record.metrics.standardErrorPercent).toBeGreaterThan(0);
      expect(record.metrics.totalCostUsd).toBeGreaterThan(0);
      expect(record.metrics.totalTokens).toBeGreaterThan(0);
      expect(Object.keys(record.metrics.domains)).toEqual([
        "earth",
        "engineering",
        "life",
        "mathematical",
        "physical",
      ]);
      expect(record.harness.display.label.length).toBeGreaterThan(0);
      expect(record.harness.version).toBeNull();
      expect(record.model.display.label.length).toBeGreaterThan(0);
      expect(record.model.version).toBeNull();
      expect(record.reasoningEffort.length).toBeGreaterThan(0);
      expect(record.safeguardMode).toBeNull();
      expect(record.sourceUrl).toBe(terminalBenchScienceRowUrl(record.id));
      expect(record.sourceUrl).not.toContain("/latest/");
    }
    expect(parsed.value.records[0]).toMatchObject({
      metrics: { resolutionRatePercent: 30 },
      model: { display: { label: "Opus 5" } },
      rank: 1,
    });
    expect(parsed.value.records[1]).toMatchObject({
      harness: { display: { label: "Codex" } },
      metrics: { resolutionRatePercent: 22.380952380952383 },
      model: { display: { label: "GPT-5.6 Sol" } },
      rank: 2,
    });
  });

  test("preserves owner aggregate and domain costs without inventing reconciliation", () => {
    const parsed = parseTerminalBenchScienceSnapshot(terminalBenchScienceData);
    if (!parsed.ok) throw parsed.error;
    const glm = parsed.value.records.find(record => record.model.display.label === "GLM 5.3");
    if (glm === undefined) throw new Error("Expected the GLM 5.3 owner row.");
    const domainCost = Object.values(glm.metrics.domains)
      .reduce((total, domain) => total + domain.totalCostUsd, 0);

    expect(glm.metrics.totalCostUsd).toBe(2_733.16185912);
    expect(domainCost).toBeCloseTo(6_802.566162, 6);
    expect(domainCost).not.toBeCloseTo(glm.metrics.totalCostUsd, 6);
    expect(parsed.value.benchmark.runPolicy.costAggregationPolicy).toBe(
      "preserve-owner-aggregate-and-domain-costs-without-reconciliation",
    );
  });

  test("rejects unsafe URLs at every retained record URL boundary", () => {
    const parsed = parseTerminalBenchScienceSnapshot(terminalBenchScienceData);
    if (!parsed.ok) throw parsed.error;
    const record = parsed.value.records[0]!;

    for (const url of unsafeRetainedUrls) {
      expect(terminalBenchScienceRecordSchema.safeParse({
        ...record,
        harness: { ...record.harness, display: { ...record.harness.display, url } },
      }).success).toBeFalse();
      expect(terminalBenchScienceRecordSchema.safeParse({
        ...record,
        harness: { ...record.harness, organization: { ...record.harness.organization, url } },
      }).success).toBeFalse();
      expect(terminalBenchScienceRecordSchema.safeParse({
        ...record,
        model: { ...record.model, display: { ...record.model.display, url } },
      }).success).toBeFalse();
      expect(terminalBenchScienceRecordSchema.safeParse({
        ...record,
        model: { ...record.model, organization: { ...record.model.organization, url } },
      }).success).toBeFalse();
      expect(terminalBenchScienceRecordSchema.safeParse({ ...record, sourceUrl: url }).success)
        .toBeFalse();
    }
  });

  test("rejects release drift, broken ranks, and inconsistent score statistics", () => {
    const changedRevision = structuredClone(terminalBenchScienceData) as Record<string, unknown>;
    (changedRevision.source as Record<string, unknown>).releaseCommit = "0".repeat(40);
    expect(parseTerminalBenchScienceSnapshot(changedRevision).ok).toBeFalse();

    const brokenRank = structuredClone(terminalBenchScienceData) as Record<string, unknown>;
    const brokenRankRecords = brokenRank.records as Array<Record<string, unknown>>;
    brokenRankRecords[0]!.rank = 2;
    expect(parseTerminalBenchScienceSnapshot(brokenRank).ok).toBeFalse();

    const brokenUncertainty = structuredClone(terminalBenchScienceData) as Record<string, unknown>;
    const brokenMetrics = (
      brokenUncertainty.records as Array<Record<string, unknown>>
    )[0]!.metrics as Record<string, unknown>;
    brokenMetrics.standardErrorPercent = 0;
    expect(parseTerminalBenchScienceSnapshot(brokenUncertainty).ok).toBeFalse();

    const missingEnvelope = structuredClone(terminalBenchScienceData) as Record<string, unknown>;
    delete (missingEnvelope.source as Record<string, unknown>).sourceClass;
    expect(parseTerminalBenchScienceSnapshot(missingEnvelope).ok).toBeFalse();

    const brokenDomain = structuredClone(terminalBenchScienceData) as Record<string, unknown>;
    const brokenDomainMetrics = (
      ((brokenDomain.records as Array<Record<string, unknown>>)[0]!.metrics as Record<string, unknown>)
        .domains as Record<string, Record<string, unknown>>
    ).earth!;
    brokenDomainMetrics.passes = 12;
    expect(parseTerminalBenchScienceSnapshot(brokenDomain).ok).toBeFalse();
  });

  test("blocks a leaderboard replacement that loses most existing configurations", () => {
    const parsed = parseTerminalBenchScienceSnapshot(terminalBenchScienceData);
    if (!parsed.ok) throw parsed.error;
    const candidate: TerminalBenchScienceSnapshot = {
      ...parsed.value,
      records: parsed.value.records.slice(0, 1),
    };

    const replacement = validateTerminalBenchScienceReplacement(parsed.value, candidate);
    expect(replacement.ok).toBeFalse();
    if (!replacement.ok) expect(replacement.error.message).toContain("minimum safe count");
  });

  test("rejects a same-shape owner payload whose leaderboard timestamp regresses", () => {
    const parsed = parseTerminalBenchScienceSnapshot(terminalBenchScienceData);
    if (!parsed.ok) throw parsed.error;
    const candidate: TerminalBenchScienceSnapshot = {
      ...parsed.value,
      source: {
        ...parsed.value.source,
        leaderboardUpdatedAt: "2026-08-29T00:00:00.000Z",
      },
    };

    const replacement = validateTerminalBenchScienceReplacement(parsed.value, candidate);
    expect(replacement.ok).toBeFalse();
    if (!replacement.ok) expect(replacement.error.message).toContain("timestamp regressed");
  });
});
