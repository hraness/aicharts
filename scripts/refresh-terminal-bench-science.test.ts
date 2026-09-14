import { describe, expect, test } from "bun:test";

import { ok } from "../lib/result";
import {
  parseTerminalBenchScienceSnapshot,
  TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT,
  type TerminalBenchScienceSnapshot,
} from "../lib/terminal-bench-science-data";
import {
  deriveTerminalBenchScienceSnapshot,
  normalizeTerminalBenchScienceRow,
  parseTerminalBenchScienceLeaderboard,
  refreshTerminalBenchScience,
  terminalBenchScienceRequestHeaders,
} from "./refresh-terminal-bench-science";

const rowId = "bcf50bd8-8555-48a6-8cae-9f697af54051";
const unsafeRetainedUrls = [
  "javascript:alert(1)",
  "data:text/html,unsafe",
  "http://example.com/unsafe",
  "https://user:pass@example.com/unsafe",
] as const;

function rawRow(): Record<string, unknown> {
  return {
    id: rowId,
    leaderboard_id: "9a545a14-78d0-44b4-9003-afe062522a47",
    metadata: {
      agent_display: { label: "Claude Code", url: "https://claude.com/product/claude-code" },
      agent_org: { label: "Anthropic", url: "https://www.anthropic.com" },
      model_display: { label: "Opus 5", url: "https://www.anthropic.com/news/claude-opus-5" },
      model_org: { label: "Anthropic", url: "https://www.anthropic.com" },
      model_release_date: "2026-07-24",
      reasoning_effort: "max",
    },
    metrics: {
      accuracy: 30,
      accuracy_stderr: 3.162277660168379,
      domain_metrics: {
        earth: {
          accuracy: 45.83333333333333,
          accuracy_stderr: 10.170707302692229,
          passes: 11,
          tasks: 24,
          total_cost_usd: 1_150.81077375,
          total_tokens: 897_476_528,
        },
        engineering: {
          accuracy: 29.629629629629626,
          accuracy_stderr: 8.787718725951697,
          passes: 8,
          tasks: 27,
          total_cost_usd: 1_035.3482442499999,
          total_tokens: 1_225_811_096,
        },
        life: {
          accuracy: 29.82456140350877,
          accuracy_stderr: 6.059575107331345,
          passes: 17,
          tasks: 57,
          total_cost_usd: 1_324.0133410000003,
          total_tokens: 1_306_678_199,
        },
        mathematical: {
          accuracy: 25.49019607843137,
          accuracy_stderr: 6.102505932917984,
          passes: 13,
          tasks: 51,
          total_cost_usd: 1_634.1868124999999,
          total_tokens: 1_709_641_761,
        },
        physical: {
          accuracy: 27.450980392156865,
          accuracy_stderr: 6.2489869213841,
          passes: 14,
          tasks: 51,
          total_cost_usd: 1_848.3181522499997,
          total_tokens: 2_127_060_729,
        },
      },
      passes: 63,
      tasks: 210,
      total_cost_usd: 6_992.67732375,
      total_tokens: 7_266_668_313,
    },
    n_trials: 210,
    rank: 1,
    status: "display",
    updated_at: "2026-08-30T03:13:14.468783+00:00",
  };
}

function rawLeaderboard(): Record<string, unknown> {
  return {
    leaderboard: {
      dataset_version_ids: ["2b817f26-dc4f-4477-8032-2218dcc553b5"],
      description: "Evaluation results for Terminal-Bench-Science 0.1 with 3 trials per task.",
      id: "9a545a14-78d0-44b4-9003-afe062522a47",
      name: "v0-1-eval",
      package: "terminal-bench-science/terminal-bench-science",
      rank_by: [
        { accessor: "metrics.accuracy", direction: "desc", nulls: "last" },
        { accessor: "metrics.total_cost_usd", direction: "asc", nulls: "last" },
      ],
      title: "Terminal-Bench-Science 0.1 Evaluation Results",
      updated_at: "2026-08-30T05:21:48.859178+00:00",
    },
    rows: [rawRow()],
  };
}

const release = {
  html_url: "https://github.com/harbor-framework/terminal-bench-science/releases/tag/v0.1.0",
  published_at: "2026-08-26T10:24:33Z",
  tag_name: "v0.1.0",
  target_commitish: TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT,
} as const;

const releaseCommit = {
  commit: { committer: { date: "2026-08-26T10:23:00Z" } },
  html_url: `https://github.com/harbor-framework/terminal-bench-science/commit/${TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT}`,
  sha: TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT,
} as const;

function snapshot(retrievedAt = "2026-09-02T14:22:12.000Z"): TerminalBenchScienceSnapshot {
  const parsed = parseTerminalBenchScienceLeaderboard(rawLeaderboard());
  if (!parsed.ok) throw parsed.error;
  const derived = deriveTerminalBenchScienceSnapshot(
    release,
    releaseCommit,
    parsed.value,
    retrievedAt,
  );
  const checked = parseTerminalBenchScienceSnapshot(derived);
  if (!checked.ok) throw checked.error;
  return checked.value;
}

describe("Terminal-Bench-Science refresh", () => {
  test("accepts only the exact 0.1 dataset and owner ranking contract", () => {
    const parsed = parseTerminalBenchScienceLeaderboard(rawLeaderboard());
    expect(parsed.ok).toBeTrue();

    const wrongVersion = rawLeaderboard();
    const wrongVersionLeaderboard = wrongVersion.leaderboard as Record<string, unknown>;
    wrongVersionLeaderboard.dataset_version_ids = ["future-version"];
    expect(parseTerminalBenchScienceLeaderboard(wrongVersion).ok).toBeFalse();

    const wrongRank = rawLeaderboard();
    const wrongRankLeaderboard = wrongRank.leaderboard as Record<string, unknown>;
    wrongRankLeaderboard.rank_by = [
      { accessor: "metrics.total_cost_usd", direction: "asc", nulls: "last" },
      { accessor: "metrics.accuracy", direction: "desc", nulls: "last" },
    ];
    expect(parseTerminalBenchScienceLeaderboard(wrongRank).ok).toBeFalse();

    const extraRank = rawLeaderboard();
    const extraRankLeaderboard = extraRank.leaderboard as Record<string, unknown>;
    extraRankLeaderboard.rank_by = [
      ...extraRankLeaderboard.rank_by as unknown[],
      { accessor: "metrics.total_tokens", direction: "asc", nulls: "last" },
    ];
    expect(parseTerminalBenchScienceLeaderboard(extraRank).ok).toBeFalse();

    const wrongNullOrder = rawLeaderboard();
    const wrongNullOrderLeaderboard = wrongNullOrder.leaderboard as Record<string, unknown>;
    const wrongNullRanks = wrongNullOrderLeaderboard.rank_by as Array<Record<string, unknown>>;
    wrongNullRanks[0]!.nulls = "first";
    expect(parseTerminalBenchScienceLeaderboard(wrongNullOrder).ok).toBeFalse();

    const wrongRowLeaderboard = rawLeaderboard();
    (wrongRowLeaderboard.rows as Array<Record<string, unknown>>)[0]!.leaderboard_id =
      "different-leaderboard";
    expect(parseTerminalBenchScienceLeaderboard(wrongRowLeaderboard).ok).toBeFalse();
  });

  test("projects owner fields without inventing model or harness versions", () => {
    const parsed = parseTerminalBenchScienceLeaderboard(rawLeaderboard());
    if (!parsed.ok) throw parsed.error;
    const record = normalizeTerminalBenchScienceRow(parsed.value.rows[0]!);

    expect(record).toMatchObject({
      harness: { display: { label: "Claude Code" } },
      metrics: {
        domains: {
          earth: { nTrials: 24, passes: 11 },
          engineering: { nTrials: 27, passes: 8 },
          life: { nTrials: 57, passes: 17 },
          mathematical: { nTrials: 51, passes: 13 },
          physical: { nTrials: 51, passes: 14 },
        },
        nTrials: 210,
        passes: 63,
        resolutionRatePercent: 30,
        standardErrorPercent: 3.162277660168379,
        totalCostUsd: 6_992.67732375,
        totalTokens: 7_266_668_313,
      },
      model: { display: { label: "Opus 5" } },
      reasoningEffort: "max",
      safeguardMode: null,
    });
    expect(record.sourceUrl).toContain(rowId);
  });

  test("rejects non-HTTPS or credential-bearing display and organization URLs", () => {
    const metadataLinkFields = [
      "agent_display",
      "agent_org",
      "model_display",
      "model_org",
    ] as const;

    for (const field of metadataLinkFields) {
      for (const url of unsafeRetainedUrls) {
        const candidate = rawLeaderboard();
        const row = (candidate.rows as Array<Record<string, unknown>>)[0]!;
        const metadata = row.metadata as Record<string, Record<string, unknown>>;
        metadata[field]!.url = url;
        expect(parseTerminalBenchScienceLeaderboard(candidate).ok).toBeFalse();
      }
    }
  });

  test("rejects inconsistent trials, scores, and uncertainty", () => {
    const wrongTrials = rawLeaderboard();
    const wrongTrialsRow = (wrongTrials.rows as Array<Record<string, unknown>>)[0]!;
    wrongTrialsRow.n_trials = 70;
    expect(parseTerminalBenchScienceLeaderboard(wrongTrials).ok).toBeFalse();

    const wrongScore = rawLeaderboard();
    const wrongScoreMetrics = (
      (wrongScore.rows as Array<Record<string, unknown>>)[0]!.metrics
    ) as Record<string, unknown>;
    wrongScoreMetrics.accuracy = 99;
    expect(parseTerminalBenchScienceLeaderboard(wrongScore).ok).toBeFalse();

    const wrongUncertainty = rawLeaderboard();
    const wrongUncertaintyMetrics = (
      (wrongUncertainty.rows as Array<Record<string, unknown>>)[0]!.metrics
    ) as Record<string, unknown>;
    wrongUncertaintyMetrics.accuracy_stderr = 0;
    expect(parseTerminalBenchScienceLeaderboard(wrongUncertainty).ok).toBeFalse();

    const wrongDomain = rawLeaderboard();
    const wrongDomainMetrics = (
      ((wrongDomain.rows as Array<Record<string, unknown>>)[0]!.metrics as Record<string, unknown>)
        .domain_metrics as Record<string, Record<string, unknown>>
    ).earth!;
    wrongDomainMetrics.passes = 12;
    expect(parseTerminalBenchScienceLeaderboard(wrongDomain).ok).toBeFalse();
  });

  test("authenticates only GitHub API requests", () => {
    expect(terminalBenchScienceRequestHeaders(
      "https://api.github.com/repos/harbor-framework/terminal-bench-science/releases",
      "secret-token",
    )).toMatchObject({ authorization: "Bearer secret-token" });
    expect(terminalBenchScienceRequestHeaders(
      "https://www.terminal-bench-science.ai/api/leaderboard",
      "secret-token",
    )).not.toHaveProperty("authorization");
    expect(terminalBenchScienceRequestHeaders(
      "https://api.github.com.evil.example/leaderboard",
      "secret-token",
    )).not.toHaveProperty("authorization");
    expect(terminalBenchScienceRequestHeaders(
      "http://api.github.com/repos/harbor-framework/terminal-bench-science",
      "secret-token",
    )).not.toHaveProperty("authorization");
    expect(terminalBenchScienceRequestHeaders(
      "https://user:pass@api.github.com/repos/harbor-framework/terminal-bench-science",
      "secret-token",
    )).not.toHaveProperty("authorization");
  });

  test("preserves retrieval time when the owner source is unchanged", async () => {
    const previous = snapshot();
    const writes: TerminalBenchScienceSnapshot[] = [];
    const result = await refreshTerminalBenchScience({
      fetchJson: async url => {
        if (url.includes("/releases/tags/")) return ok(release);
        if (url.includes("/commits/")) return ok(releaseCommit);
        if (url.includes("/api/leaderboard")) return ok(rawLeaderboard());
        throw new Error(`Unexpected source ${url}`);
      },
      now: () => "2026-09-02T15:00:00.000Z",
      readCommittedSnapshot: async () => ok(previous),
      writeCommittedSnapshot: async value => { writes.push(value); },
    });

    expect(result).toEqual(ok(previous));
    expect(writes).toEqual([previous]);
  });
});
