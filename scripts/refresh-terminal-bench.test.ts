import { describe, expect, test } from "bun:test";

import { ok } from "../lib/result";
import {
  parseTerminalBenchSnapshot,
  TERMINAL_BENCH_TRIALS_PER_CONFIGURATION,
  validateTerminalBenchReplacement,
  type TerminalBenchSnapshot,
} from "../lib/terminal-bench-data";
import {
  deriveTerminalBenchSnapshot,
  normalizeTerminalBenchSubmission,
  parseTerminalBenchSubmission,
  refreshTerminalBench,
  terminalBenchRequestHeaders,
  validateLeaderboardDefinition,
} from "./refresh-terminal-bench";

const sourceCommit = {
  commit: { committer: { date: "2026-08-29T23:27:45.000Z" } },
  sha: "624df069c505c5ddd21d2d78467dd5579020db95",
};
const sourcePath = "leaderboard/submissions/2026-08-26-openai-example-max-codex.json";
const retrievedAt = "2026-09-02T12:00:00.000Z";
const unsafeRetainedUrls = [
  "javascript:alert(1)",
  "data:text/html,unsafe",
  "http://example.com/unsafe",
  "https://user:pass@example.com/unsafe",
] as const;

function rawSubmission(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    disqualified_trials: [],
    metadata: {
      agent_display: { label: "Codex", url: "https://openai.com/codex/" },
      agent_org: { label: "OpenAI", url: "https://openai.com" },
      date: "2026-06-26",
      display_date: "Jun 26, 2026",
      model_display: { label: "Example", url: "https://openai.com/example" },
      model_org: { label: "OpenAI", url: "https://openai.com" },
      reasoning_effort: "max",
    },
    metrics: {
      accuracy: 37.27,
      accuracy_ci95_half_width: 3.78,
      avg_trial_duration_sec: 2_388.4,
      cached_input_tokens: 4_316_454_466,
      display_accuracy: "**37.3%** ± 3.8%",
      n_trials: TERMINAL_BENCH_TRIALS_PER_CONFIGURATION,
      output_tokens: 23_451_415,
      pass_at_2: .4955,
      pass_at_3: .55,
      pass_at_4: .5818,
      pass_at_5: .6061,
      successes: 123,
      total_cost_usd: 2_541.7,
      total_tokens: 4_409_948_969,
      uncached_input_tokens: 4_386_497_554,
    },
    source_filter: {
      agent: "codex",
      agent_version: "0.149.1",
      model_name: "openai/example",
      reasoning_effort: "max",
    },
    source_jobs: ["https://hub.harborframework.com/jobs/example"],
    trials: Array.from(
      { length: TERMINAL_BENCH_TRIALS_PER_CONFIGURATION },
      (_, index) => `trial-${index}`,
    ),
    additive_source_field: true,
    ...overrides,
  };
}

function leaderboardDefinition(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    dataset_version_refs: ["4"],
    name: "4-0-0",
    package: "terminal-bench/terminal-bench",
    rank_by: [{ accessor: "metrics.accuracy", direction: "desc" }],
    title: "Terminal-Bench 4.0",
    ...overrides,
  };
}

function parsedSubmission() {
  const parsed = parseTerminalBenchSubmission(rawSubmission());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
}

function snapshot(): TerminalBenchSnapshot {
  const derived = deriveTerminalBenchSnapshot(
    sourceCommit,
    [{ item: { path: sourcePath, sha: sourceCommit.sha, type: "file" }, submission: parsedSubmission() }],
    retrievedAt,
  );
  const parsed = parseTerminalBenchSnapshot(derived);
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
}

describe("Terminal-Bench 4.0 source parsing", () => {
  test("authenticates GitHub API calls without leaking the token to raw files", () => {
    expect(terminalBenchRequestHeaders(
      "https://api.github.com/repos/harbor-framework/terminal-bench/commits",
      "application/json",
      "secret-token",
    )).toMatchObject({ authorization: "Bearer secret-token" });
    expect(terminalBenchRequestHeaders(
      "https://raw.githubusercontent.com/harbor-framework/terminal-bench/main/leaderboard/leaderboard.yaml",
      "text/plain",
      "secret-token",
    )).not.toHaveProperty("authorization");
    expect(terminalBenchRequestHeaders(
      "https://api.github.com.evil.example/terminal-bench",
      "application/json",
      "secret-token",
    )).not.toHaveProperty("authorization");
    expect(terminalBenchRequestHeaders(
      "http://api.github.com/repos/harbor-framework/terminal-bench",
      "application/json",
      "secret-token",
    )).not.toHaveProperty("authorization");
    expect(terminalBenchRequestHeaders(
      "https://user:pass@api.github.com/repos/harbor-framework/terminal-bench",
      "application/json",
      "secret-token",
    )).not.toHaveProperty("authorization");
  });

  test("projects additive fields while retaining the exact harness, model, and metrics", () => {
    const parsed = parseTerminalBenchSubmission(rawSubmission());

    expect(parsed.ok).toBeTrue();
    if (!parsed.ok) return;
    const record = normalizeTerminalBenchSubmission(parsed.value, sourcePath, sourceCommit.sha);
    expect(record).toMatchObject({
      harness: { id: "codex", version: "0.149.1" },
      metrics: {
        accuracyCi95HalfWidthPercent: 3.78,
        accuracyPercent: 37.27,
        nTrials: 330,
        totalCostUsd: 2_541.7,
        totalTokens: 4_409_948_969,
      },
      model: { id: "openai/example" },
      reasoningEffort: "max",
      sourceFilterReasoningEffort: "max",
    });
    expect(record.sourceUrl).toContain(sourceCommit.sha);
  });

  test("rejects non-HTTPS or credential-bearing display, organization, and job URLs", () => {
    const metadataLinkFields = [
      "agent_display",
      "agent_org",
      "model_display",
      "model_org",
    ] as const;

    for (const field of metadataLinkFields) {
      for (const url of unsafeRetainedUrls) {
        const candidate = rawSubmission();
        const metadata = candidate.metadata as Record<string, Record<string, unknown>>;
        metadata[field]!.url = url;
        expect(parseTerminalBenchSubmission(candidate).ok).toBeFalse();
      }
    }

    for (const url of unsafeRetainedUrls) {
      expect(parseTerminalBenchSubmission(rawSubmission({ source_jobs: [url] })).ok).toBeFalse();
    }
    expect(parseTerminalBenchSubmission(rawSubmission({ source_jobs: ["not-a-job-id"] })).ok)
      .toBeFalse();
  });

  test("normalizes an owner-published Harbor job UUID to its HTTPS job page", () => {
    const jobId = "542367e9-c4ae-5255-ab76-4c9045749e8e";
    const parsed = parseTerminalBenchSubmission(rawSubmission({ source_jobs: [jobId] }));

    expect(parsed.ok).toBeTrue();
    if (!parsed.ok) return;
    expect(parsed.value.source_jobs).toEqual([
      `https://hub.harborframework.com/jobs/${jobId}`,
    ]);
  });

  test("accepts a null source-filter effort only when the display effort is none", () => {
    const noneEffort = rawSubmission({
      metadata: {
        agent_display: { label: "Grok Build", url: "https://x.ai/build" },
        agent_org: { label: "xAI", url: "https://x.ai" },
        date: "2026-08-12",
        model_display: { label: "Grok", url: "https://x.ai/grok" },
        model_org: { label: "xAI", url: "https://x.ai" },
        reasoning_effort: "none",
      },
      source_filter: {
        agent: "grok-build",
        agent_version: "1.0.5",
        model_name: "xai/grok",
        reasoning_effort: null,
      },
    });
    expect(parseTerminalBenchSubmission(noneEffort).ok).toBeTrue();

    const conflicting = rawSubmission({
      source_filter: {
        agent: "codex",
        agent_version: "0.149.1",
        model_name: "openai/example",
        reasoning_effort: "high",
      },
    });
    expect(parseTerminalBenchSubmission(conflicting).ok).toBeFalse();
  });

  test("rejects incomplete trials, duplicate trial ids, and inconsistent accuracy", () => {
    expect(parseTerminalBenchSubmission(rawSubmission({
      trials: Array.from({ length: 329 }, (_, index) => `trial-${index}`),
    })).ok).toBeFalse();
    expect(parseTerminalBenchSubmission(rawSubmission({
      trials: Array.from({ length: 330 }, () => "duplicate"),
    })).ok).toBeFalse();
    expect(parseTerminalBenchSubmission(rawSubmission({
      metrics: {
        ...rawSubmission().metrics as Record<string, unknown>,
        accuracy: 99,
      },
    })).ok).toBeFalse();
    expect(parseTerminalBenchSubmission(rawSubmission({
      disqualified_trials: ["trial-0"],
    })).ok).toBeFalse();
  });

  test("requires the 4.0 dataset ref and accuracy-descending rank contract", () => {
    expect(validateLeaderboardDefinition(leaderboardDefinition()).ok).toBeTrue();
    expect(validateLeaderboardDefinition(leaderboardDefinition({
      dataset_version_refs: ["2.1"],
    })).ok).toBeFalse();
    expect(validateLeaderboardDefinition(leaderboardDefinition({
      rank_by: [{ accessor: "metrics.total_cost_usd", direction: "asc" }],
    })).ok).toBeFalse();
  });
});

describe("Terminal-Bench checked snapshot", () => {
  test("binds every source URL and record to an immutable commit", () => {
    const candidate = snapshot();
    expect(parseTerminalBenchSnapshot(candidate).ok).toBeTrue();

    const unpinned: TerminalBenchSnapshot = {
      ...candidate,
      records: candidate.records.map(record => ({
        ...record,
        sourceUrl: record.sourceUrl.replace(sourceCommit.sha, "main"),
      })),
    };
    expect(parseTerminalBenchSnapshot(unpinned).ok).toBeFalse();
  });

  test("rejects a benchmark downgrade and unsafe source retention", () => {
    const candidate = snapshot();
    const downgraded = structuredClone(candidate) as unknown as Record<string, unknown>;
    const benchmark = downgraded.benchmark as Record<string, unknown>;
    benchmark.version = "2.1";
    expect(parseTerminalBenchSnapshot(downgraded).ok).toBeFalse();

    const expanded: TerminalBenchSnapshot = {
      ...candidate,
      records: Array.from({ length: 10 }, (_, index) => ({
        ...candidate.records[0]!,
        harness: {
          ...candidate.records[0]!.harness,
          version: `version-${index}`,
        },
        id: `record-${index}`,
        sourcePath: `leaderboard/submissions/record-${index}.json`,
        sourceUrl: `https://raw.githubusercontent.com/harbor-framework/terminal-bench/${sourceCommit.sha}/leaderboard/submissions/record-${index}.json`,
      })),
    };
    const replacement = validateTerminalBenchReplacement(expanded, candidate);
    expect(replacement.ok).toBeFalse();
    if (!replacement.ok) expect(replacement.error.message).toContain("minimum safe count");
  });

  test("refresh preserves retrieval time when the version-pinned source is unchanged", async () => {
    const previous = snapshot();
    const writes: TerminalBenchSnapshot[] = [];
    const raw = rawSubmission();
    const result = await refreshTerminalBench({
      fetchJson: async url => {
        if (url.includes("/commits?")) return ok([sourceCommit]);
        if (url.includes("/contents/leaderboard/submissions")) {
          return ok([{ path: sourcePath, sha: sourceCommit.sha, type: "file" }]);
        }
        if (url.includes(sourcePath)) return ok(raw);
        throw new Error(`Unexpected source ${url}`);
      },
      fetchText: async () => ok(`
dataset_version_refs: ['4']
name: 4-0-0
package: terminal-bench/terminal-bench
rank_by:
  - accessor: metrics.accuracy
    direction: desc
title: Terminal-Bench 4.0
`),
      now: () => "2026-09-02T13:00:00.000Z",
      readCommittedSnapshot: async () => ok(previous),
      writeCommittedSnapshot: async value => { writes.push(value); },
    });

    expect(result).toEqual(ok(previous));
    expect(writes).toEqual([previous]);
  });
});
