import { rename } from "node:fs/promises";
import path from "node:path";

import {
  credentialFreeHttpsUrlSchema,
  isCredentialFreeHttpsUrl,
} from "../lib/credential-free-https-url";
import { err, ok, type Result } from "../lib/result";
import { parseResult, z } from "../lib/schema";
import {
  compareTerminalBenchScienceRecords,
  parseTerminalBenchScienceSnapshot,
  TERMINAL_BENCH_SCIENCE_ANNOUNCEMENT_URL,
  TERMINAL_BENCH_SCIENCE_DATASET_VERSION_ID,
  TERMINAL_BENCH_SCIENCE_LEADERBOARD_API_URL,
  TERMINAL_BENCH_SCIENCE_LEADERBOARD_ID,
  TERMINAL_BENCH_SCIENCE_LEADERBOARD_NAME,
  TERMINAL_BENCH_SCIENCE_LEADERBOARD_URL,
  TERMINAL_BENCH_SCIENCE_NAME,
  TERMINAL_BENCH_SCIENCE_PACKAGE,
  TERMINAL_BENCH_SCIENCE_RELEASE_DOI_URL,
  TERMINAL_BENCH_SCIENCE_RELEASE_TAG,
  TERMINAL_BENCH_SCIENCE_RELEASE_URL,
  TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT,
  TERMINAL_BENCH_SCIENCE_REPOSITORY_URL,
  TERMINAL_BENCH_SCIENCE_TASK_COUNT,
  TERMINAL_BENCH_SCIENCE_TRIALS_PER_CONFIGURATION,
  TERMINAL_BENCH_SCIENCE_TRIALS_PER_TASK,
  TERMINAL_BENCH_SCIENCE_VERSION,
  terminalBenchScienceRowUrl,
  validateTerminalBenchScienceReplacement,
  type TerminalBenchScienceRecord,
  type TerminalBenchScienceSnapshot,
} from "../lib/terminal-bench-science-data";

const OUTPUT_PATH = path.join(import.meta.dir, "..", "data", "terminal-bench-science.json");
const REPOSITORY_API_URL =
  "https://api.github.com/repos/harbor-framework/terminal-bench-science";
const RELEASE_API_URL = `${REPOSITORY_API_URL}/releases/tags/${TERMINAL_BENCH_SCIENCE_RELEASE_TAG}`;
const RELEASE_COMMIT_API_URL =
  `${REPOSITORY_API_URL}/commits/${TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT}`;
const GITHUB_USER_AGENT = "aicharts-terminal-bench-science-refresh/1.0 (+https://aicharts.io)";

const labeledLinkSchema = z.object({
  label: z.string().min(1),
  url: credentialFreeHttpsUrlSchema,
});

const sourceReleaseSchema = z.object({
  html_url: z.literal(TERMINAL_BENCH_SCIENCE_RELEASE_URL),
  published_at: z.string().datetime({ offset: true }),
  tag_name: z.literal(TERMINAL_BENCH_SCIENCE_RELEASE_TAG),
  target_commitish: z.literal(TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT),
});

const sourceCommitSchema = z.object({
  commit: z.object({
    committer: z.object({
      date: z.string().datetime({ offset: true }),
    }),
  }),
  html_url: z.literal(
    `${TERMINAL_BENCH_SCIENCE_REPOSITORY_URL}/commit/${TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT}`,
  ),
  sha: z.literal(TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT),
});

const sourceDomainMetricsSchema = z.object({
  accuracy: z.number().finite().min(0).max(100),
  accuracy_stderr: z.number().finite().min(0).max(100),
  passes: z.number().int().nonnegative(),
  tasks: z.number().int().positive(),
  total_cost_usd: z.number().finite().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
}).superRefine((metrics, context) => {
  if (metrics.passes > metrics.tasks) {
    context.addIssue({
      code: "custom",
      message: "Source domain passes cannot exceed trials.",
      path: ["passes"],
    });
  }
  const observedRate = metrics.passes / metrics.tasks * 100;
  if (Math.abs(observedRate - metrics.accuracy) > 1e-9) {
    context.addIssue({
      code: "custom",
      message: "Source domain resolution rate did not equal passes divided by trials.",
      path: ["accuracy"],
    });
  }
  const probability = metrics.accuracy / 100;
  const observedStandardError = Math.sqrt(
    probability * (1 - probability) / metrics.tasks,
  ) * 100;
  if (Math.abs(observedStandardError - metrics.accuracy_stderr) > 1e-9) {
    context.addIssue({
      code: "custom",
      message: "Source domain uncertainty did not match the binomial standard error.",
      path: ["accuracy_stderr"],
    });
  }
});

const sourceRowSchema = z.object({
  id: z.string().min(1),
  leaderboard_id: z.literal(TERMINAL_BENCH_SCIENCE_LEADERBOARD_ID),
  metadata: z.object({
    agent_display: labeledLinkSchema,
    agent_org: labeledLinkSchema,
    model_display: labeledLinkSchema,
    model_org: labeledLinkSchema,
    model_release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    reasoning_effort: z.string().min(1),
  }),
  metrics: z.object({
    accuracy: z.number().finite().min(0).max(100),
    accuracy_stderr: z.number().finite().min(0).max(100),
    domain_metrics: z.object({
      earth: sourceDomainMetricsSchema,
      engineering: sourceDomainMetricsSchema,
      life: sourceDomainMetricsSchema,
      mathematical: sourceDomainMetricsSchema,
      physical: sourceDomainMetricsSchema,
    }),
    passes: z.number().int().min(0).max(TERMINAL_BENCH_SCIENCE_TRIALS_PER_CONFIGURATION),
    tasks: z.literal(TERMINAL_BENCH_SCIENCE_TRIALS_PER_CONFIGURATION),
    total_cost_usd: z.number().finite().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }),
  n_trials: z.literal(TERMINAL_BENCH_SCIENCE_TRIALS_PER_CONFIGURATION),
  rank: z.number().int().positive(),
  status: z.literal("display"),
  updated_at: z.string().datetime({ offset: true }),
}).superRefine((row, context) => {
  const observedRate = row.metrics.passes / row.n_trials * 100;
  if (Math.abs(observedRate - row.metrics.accuracy) > 1e-9) {
    context.addIssue({
      code: "custom",
      message: "Source resolution rate did not equal passes divided by trials.",
      path: ["metrics", "accuracy"],
    });
  }
  const probability = row.metrics.accuracy / 100;
  const observedStandardError = Math.sqrt(probability * (1 - probability) / row.n_trials) * 100;
  if (Math.abs(observedStandardError - row.metrics.accuracy_stderr) > 1e-9) {
    context.addIssue({
      code: "custom",
      message: "Source uncertainty did not match the binomial standard error.",
      path: ["metrics", "accuracy_stderr"],
    });
  }
});

const sourceLeaderboardSchema = z.object({
  leaderboard: z.object({
    dataset_version_ids: z.tuple([z.literal(TERMINAL_BENCH_SCIENCE_DATASET_VERSION_ID)]),
    description: z.literal(
      "Evaluation results for Terminal-Bench-Science 0.1 with 3 trials per task.",
    ),
    id: z.literal(TERMINAL_BENCH_SCIENCE_LEADERBOARD_ID),
    name: z.literal(TERMINAL_BENCH_SCIENCE_LEADERBOARD_NAME),
    package: z.literal(TERMINAL_BENCH_SCIENCE_PACKAGE),
    rank_by: z.tuple([
      z.object({
        accessor: z.literal("metrics.accuracy"),
        direction: z.literal("desc"),
        nulls: z.literal("last"),
      }).strict(),
      z.object({
        accessor: z.literal("metrics.total_cost_usd"),
        direction: z.literal("asc"),
        nulls: z.literal("last"),
      }).strict(),
    ]),
    title: z.literal("Terminal-Bench-Science 0.1 Evaluation Results"),
    updated_at: z.string().datetime({ offset: true }),
  }),
  rows: z.array(sourceRowSchema).min(1),
}).superRefine((payload, context) => {
  payload.rows.forEach((row, index) => {
    if (row.rank !== index + 1) {
      context.addIssue({
        code: "custom",
        message: "Source rows must preserve contiguous owner-published ranks.",
        path: ["rows", index, "rank"],
      });
    }
  });
});

type SourceRelease = z.infer<typeof sourceReleaseSchema>;
type SourceCommit = z.infer<typeof sourceCommitSchema>;
type SourceRow = z.infer<typeof sourceRowSchema>;
type SourceLeaderboard = z.infer<typeof sourceLeaderboardSchema>;

export function parseTerminalBenchScienceLeaderboard(
  value: unknown,
): Result<SourceLeaderboard, z.ZodError> {
  return parseResult(sourceLeaderboardSchema, value);
}

export function normalizeTerminalBenchScienceRow(row: SourceRow): TerminalBenchScienceRecord {
  return {
    harness: {
      display: row.metadata.agent_display,
      organization: row.metadata.agent_org,
      version: null,
    },
    id: row.id,
    metrics: {
      domains: Object.fromEntries(Object.entries(row.metrics.domain_metrics).map(
        ([domain, metrics]) => [domain, {
          nTrials: metrics.tasks,
          passes: metrics.passes,
          resolutionRatePercent: metrics.accuracy,
          standardErrorPercent: metrics.accuracy_stderr,
          totalCostUsd: metrics.total_cost_usd,
          totalTokens: metrics.total_tokens,
        }],
      )) as TerminalBenchScienceRecord["metrics"]["domains"],
      nTrials: row.n_trials,
      passes: row.metrics.passes,
      resolutionRatePercent: row.metrics.accuracy,
      standardErrorPercent: row.metrics.accuracy_stderr,
      totalCostUsd: row.metrics.total_cost_usd,
      totalTokens: row.metrics.total_tokens,
    },
    model: {
      display: row.metadata.model_display,
      organization: row.metadata.model_org,
      version: null,
    },
    rank: row.rank,
    reasoningEffort: row.metadata.reasoning_effort,
    releaseDate: row.metadata.model_release_date,
    safeguardMode: null,
    sourceUpdatedAt: row.updated_at,
    sourceUrl: terminalBenchScienceRowUrl(row.id),
  };
}

export function deriveTerminalBenchScienceSnapshot(
  release: SourceRelease,
  releaseCommit: SourceCommit,
  leaderboard: SourceLeaderboard,
  retrievedAt: string,
): TerminalBenchScienceSnapshot {
  const records = leaderboard.rows
    .map(normalizeTerminalBenchScienceRow)
    .sort(compareTerminalBenchScienceRecords);

  return {
    benchmark: {
      name: TERMINAL_BENCH_SCIENCE_NAME,
      score: "resolution-rate",
      scoreUnit: "percent",
      taskCount: TERMINAL_BENCH_SCIENCE_TASK_COUNT,
      trialsPerConfiguration: TERMINAL_BENCH_SCIENCE_TRIALS_PER_CONFIGURATION,
      trialsPerTask: TERMINAL_BENCH_SCIENCE_TRIALS_PER_TASK,
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
    },
    records,
    schemaVersion: 1,
    source: {
      announcementUrl: TERMINAL_BENCH_SCIENCE_ANNOUNCEMENT_URL,
      datasetVersionId: TERMINAL_BENCH_SCIENCE_DATASET_VERSION_ID,
      leaderboardApiUrl: TERMINAL_BENCH_SCIENCE_LEADERBOARD_API_URL,
      leaderboardId: TERMINAL_BENCH_SCIENCE_LEADERBOARD_ID,
      leaderboardName: TERMINAL_BENCH_SCIENCE_LEADERBOARD_NAME,
      leaderboardPackage: TERMINAL_BENCH_SCIENCE_PACKAGE,
      leaderboardUpdatedAt: leaderboard.leaderboard.updated_at,
      leaderboardUrl: TERMINAL_BENCH_SCIENCE_LEADERBOARD_URL,
      method: "version-pinned-release-owner-leaderboard-api",
      name: "Terminal-Bench-Science and Harbor Framework",
      releaseCommit: TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT,
      releaseCommittedAt: releaseCommit.commit.committer.date,
      releaseCommitUrl: releaseCommit.html_url,
      releaseDoiUrl: TERMINAL_BENCH_SCIENCE_RELEASE_DOI_URL,
      releaseNotesUrl: `${TERMINAL_BENCH_SCIENCE_REPOSITORY_URL}/blob/${TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT}/release-notes-v0.1.0.md`,
      releasePublishedAt: release.published_at,
      releaseTag: TERMINAL_BENCH_SCIENCE_RELEASE_TAG,
      releaseUrl: release.html_url,
      repositoryUrl: TERMINAL_BENCH_SCIENCE_REPOSITORY_URL,
      retrievedAt,
      sourceClass: "benchmark-owner",
    },
  };
}

async function fetchSource(url: string): Promise<Result<Response, Error>> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: terminalBenchScienceRequestHeaders(
          url,
          process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
        ),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status} for ${url}.`);
      return ok(response);
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
      if (attempt < 3) await Bun.sleep(250 * 2 ** (attempt - 1));
    }
  }
  return err(new Error(`Could not download ${url} after 3 attempts.`, { cause: lastError }));
}

export function terminalBenchScienceRequestHeaders(
  url: string,
  githubToken?: string,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": GITHUB_USER_AGENT,
  };
  if (
    isCredentialFreeHttpsUrl(url)
    && new URL(url).hostname === "api.github.com"
    && githubToken?.trim()
  ) {
    headers.authorization = `Bearer ${githubToken.trim()}`;
  }
  return headers;
}

async function fetchJson(url: string): Promise<Result<unknown, Error>> {
  const response = await fetchSource(url);
  if (!response.ok) return response;
  try {
    const body: unknown = await response.value.json();
    return ok(body);
  } catch (cause) {
    return err(new Error(`Could not parse JSON from ${url}.`, { cause }));
  }
}

async function readCommittedSnapshot(): Promise<Result<TerminalBenchScienceSnapshot, Error>> {
  try {
    const input: unknown = await Bun.file(OUTPUT_PATH).json();
    const parsed = parseTerminalBenchScienceSnapshot(input);
    return parsed.ok
      ? ok(parsed.value)
      : err(new Error(`Invalid ${OUTPUT_PATH}: ${parsed.error.message}`, { cause: parsed.error }));
  } catch (cause) {
    return err(new Error(`Could not read ${OUTPUT_PATH}.`, { cause }));
  }
}

async function writeCommittedSnapshot(snapshot: TerminalBenchScienceSnapshot): Promise<void> {
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  await Bun.write(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(temporaryPath, OUTPUT_PATH);
}

type TerminalBenchScienceRefreshDependencies = Readonly<{
  fetchJson: typeof fetchJson;
  now: () => string;
  readCommittedSnapshot: typeof readCommittedSnapshot;
  writeCommittedSnapshot: typeof writeCommittedSnapshot;
}>;

const defaultRefreshDependencies: TerminalBenchScienceRefreshDependencies = {
  fetchJson,
  now: () => new Date().toISOString(),
  readCommittedSnapshot,
  writeCommittedSnapshot,
};

function preserveRetrievalTimeWhenUnchanged(
  previous: TerminalBenchScienceSnapshot,
  candidate: TerminalBenchScienceSnapshot,
): TerminalBenchScienceSnapshot {
  const candidateAtPreviousTime: TerminalBenchScienceSnapshot = {
    ...candidate,
    source: { ...candidate.source, retrievedAt: previous.source.retrievedAt },
  };
  return JSON.stringify(previous) === JSON.stringify(candidateAtPreviousTime)
    ? previous
    : candidate;
}

export async function validateCommittedTerminalBenchScience(): Promise<
  Result<TerminalBenchScienceSnapshot, Error>
> {
  return readCommittedSnapshot();
}

export async function refreshTerminalBenchScience(
  overrides: Partial<TerminalBenchScienceRefreshDependencies> = {},
): Promise<Result<TerminalBenchScienceSnapshot, Error>> {
  const dependencies = { ...defaultRefreshDependencies, ...overrides };
  const previous = await dependencies.readCommittedSnapshot();
  if (!previous.ok) return previous;

  const releaseSource = await dependencies.fetchJson(RELEASE_API_URL);
  if (!releaseSource.ok) return releaseSource;
  const parsedRelease = parseResult(sourceReleaseSchema, releaseSource.value);
  if (!parsedRelease.ok) {
    return err(new Error(
      `Terminal-Bench-Science v0.1.0 release changed shape: ${parsedRelease.error.message}`,
      { cause: parsedRelease.error },
    ));
  }

  const commitSource = await dependencies.fetchJson(RELEASE_COMMIT_API_URL);
  if (!commitSource.ok) return commitSource;
  const parsedCommit = parseResult(sourceCommitSchema, commitSource.value);
  if (!parsedCommit.ok) {
    return err(new Error(
      `Terminal-Bench-Science v0.1.0 commit changed shape: ${parsedCommit.error.message}`,
      { cause: parsedCommit.error },
    ));
  }

  const leaderboardSource = await dependencies.fetchJson(TERMINAL_BENCH_SCIENCE_LEADERBOARD_API_URL);
  if (!leaderboardSource.ok) return leaderboardSource;
  const parsedLeaderboard = parseTerminalBenchScienceLeaderboard(leaderboardSource.value);
  if (!parsedLeaderboard.ok) {
    return err(new Error(
      `Terminal-Bench-Science owner leaderboard changed shape: ${parsedLeaderboard.error.message}`,
      { cause: parsedLeaderboard.error },
    ));
  }

  const derived = deriveTerminalBenchScienceSnapshot(
    parsedRelease.value,
    parsedCommit.value,
    parsedLeaderboard.value,
    dependencies.now(),
  );
  const parsedDerived = parseTerminalBenchScienceSnapshot(derived);
  if (!parsedDerived.ok) {
    return err(new Error(
      `Normalized Terminal-Bench-Science snapshot is invalid: ${parsedDerived.error.message}`,
      { cause: parsedDerived.error },
    ));
  }
  const candidate = preserveRetrievalTimeWhenUnchanged(previous.value, parsedDerived.value);
  const safeReplacement = validateTerminalBenchScienceReplacement(previous.value, candidate);
  if (!safeReplacement.ok) return safeReplacement;
  await dependencies.writeCommittedSnapshot(candidate);
  return ok(candidate);
}

if (import.meta.main) {
  const checkOnly = Bun.argv.includes("--check");
  const result = checkOnly
    ? await validateCommittedTerminalBenchScience()
    : await refreshTerminalBenchScience();
  if (!result.ok) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    const verb = checkOnly ? "Validated" : "Refreshed";
    console.log(
      `${verb} ${result.value.records.length} Terminal-Bench-Science ${result.value.benchmark.version} configurations in data/terminal-bench-science.json.`,
    );
  }
}
