import { rename } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import {
  credentialFreeHttpsUrlSchema,
  isCredentialFreeHttpsUrl,
} from "../lib/credential-free-https-url";
import { err, ok, type Result } from "../lib/result";
import { parseResult, z } from "../lib/schema";
import {
  compareTerminalBenchRecords,
  parseTerminalBenchSnapshot,
  TERMINAL_BENCH_DATASET_REF,
  TERMINAL_BENCH_AGENT_TIMEOUT_SECONDS,
  TERMINAL_BENCH_LEADERBOARD_URL,
  TERMINAL_BENCH_NAME,
  TERMINAL_BENCH_RELEASE_URL,
  TERMINAL_BENCH_REPOSITORY_URL,
  TERMINAL_BENCH_TASK_COUNT,
  TERMINAL_BENCH_TRIALS_PER_CONFIGURATION,
  TERMINAL_BENCH_TRIALS_PER_TASK,
  TERMINAL_BENCH_VERSION,
  validateTerminalBenchReplacement,
  type TerminalBenchRecord,
  type TerminalBenchSnapshot,
} from "../lib/terminal-bench-data";

const OUTPUT_PATH = path.join(import.meta.dir, "..", "data", "terminal-bench.json");
const REPOSITORY_API_URL = "https://api.github.com/repos/harbor-framework/terminal-bench";
const LEADERBOARD_PATH = "leaderboard";
const LEADERBOARD_DEFINITION_PATH = `${LEADERBOARD_PATH}/leaderboard.yaml`;
const SUBMISSIONS_PATH = `${LEADERBOARD_PATH}/submissions`;
const SOURCE_COMMIT_URL = `${REPOSITORY_API_URL}/commits?sha=main&path=${LEADERBOARD_PATH}&per_page=1`;
const GITHUB_USER_AGENT = "aicharts-terminal-bench-refresh/1.0 (+https://aicharts.io)";
const HARBOR_JOB_URL_PREFIX = "https://hub.harborframework.com/jobs/";

const sourceCommitResponseSchema = z.array(z.object({
  commit: z.object({
    committer: z.object({
      date: z.string().datetime({ offset: true }),
    }),
  }),
  sha: z.string().regex(/^[0-9a-f]{40}$/u),
})).min(1);

const sourceDirectoryItemSchema = z.object({
  path: z.string().min(1),
  sha: z.string().regex(/^[0-9a-f]{40}$/u),
  type: z.literal("file"),
});

const labeledLinkSchema = z.object({
  label: z.string().min(1),
  url: credentialFreeHttpsUrlSchema,
});

const sourceJobSchema = z.union([
  credentialFreeHttpsUrlSchema,
  z.string().uuid().transform(jobId => `${HARBOR_JOB_URL_PREFIX}${jobId}`),
]);

const sourceSubmissionSchema = z.object({
  disqualified_trials: z.array(z.unknown()).length(0),
  metadata: z.object({
    agent_display: labeledLinkSchema,
    agent_org: labeledLinkSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    model_display: labeledLinkSchema,
    model_org: labeledLinkSchema,
    reasoning_effort: z.string().min(1),
  }),
  metrics: z.object({
    accuracy: z.number().finite().min(0).max(100),
    accuracy_ci95_half_width: z.number().finite().min(0).max(100),
    avg_trial_duration_sec: z.number().finite().nonnegative(),
    cached_input_tokens: z.number().int().nonnegative(),
    n_trials: z.literal(TERMINAL_BENCH_TRIALS_PER_CONFIGURATION),
    output_tokens: z.number().int().nonnegative(),
    pass_at_2: z.number().finite().min(0).max(1),
    pass_at_3: z.number().finite().min(0).max(1),
    pass_at_4: z.number().finite().min(0).max(1),
    pass_at_5: z.number().finite().min(0).max(1),
    successes: z.number().int().min(0).max(TERMINAL_BENCH_TRIALS_PER_CONFIGURATION),
    total_cost_usd: z.number().finite().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    uncached_input_tokens: z.number().int().nonnegative(),
  }),
  source_filter: z.object({
    agent: z.string().min(1),
    agent_version: z.string().min(1),
    model_name: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u),
    reasoning_effort: z.string().min(1).nullable(),
  }),
  source_jobs: z.array(sourceJobSchema).min(1),
  trials: z.array(z.string().min(1)).length(TERMINAL_BENCH_TRIALS_PER_CONFIGURATION),
}).superRefine((submission, context) => {
  const expectedAccuracy = submission.metrics.successes / submission.metrics.n_trials * 100;
  if (Math.abs(expectedAccuracy - submission.metrics.accuracy) > 0.011) {
    context.addIssue({
      code: "custom",
      message: "Source accuracy did not equal successes divided by trials, rounded to two decimals.",
      path: ["metrics", "accuracy"],
    });
  }
  if (new Set(submission.trials).size !== submission.trials.length) {
    context.addIssue({
      code: "custom",
      message: "Source submission contained duplicate trial identifiers.",
      path: ["trials"],
    });
  }
  const sourceEffort = submission.source_filter.reasoning_effort;
  if (
    sourceEffort !== submission.metadata.reasoning_effort
    && !(sourceEffort === null && submission.metadata.reasoning_effort === "none")
  ) {
    context.addIssue({
      code: "custom",
      message: "Source-filter effort must match the leaderboard display effort.",
      path: ["source_filter", "reasoning_effort"],
    });
  }
});

const leaderboardDefinitionSchema = z.object({
  dataset_version_refs: z.tuple([z.literal(TERMINAL_BENCH_DATASET_REF)]),
  name: z.literal("4-0-0"),
  package: z.literal("terminal-bench/terminal-bench"),
  rank_by: z.array(z.object({
    accessor: z.string().min(1),
    direction: z.string().min(1),
  })).min(1),
  title: z.literal("Terminal-Bench 4.0"),
});

type SourceSubmission = z.infer<typeof sourceSubmissionSchema>;
type SourceCommit = z.infer<typeof sourceCommitResponseSchema>[number];
type SourceDirectoryItem = z.infer<typeof sourceDirectoryItemSchema>;

export function parseTerminalBenchSubmission(
  value: unknown,
): Result<SourceSubmission, z.ZodError> {
  return parseResult(sourceSubmissionSchema, value);
}

export function validateLeaderboardDefinition(value: unknown): Result<void, Error> {
  const parsed = parseResult(leaderboardDefinitionSchema, value);
  if (!parsed.ok) {
    return err(new Error(
      `Terminal-Bench leaderboard definition changed shape: ${parsed.error.message}`,
      { cause: parsed.error },
    ));
  }
  const primaryRank = parsed.value.rank_by[0];
  if (primaryRank?.accessor !== "metrics.accuracy" || primaryRank.direction !== "desc") {
    return err(new Error("Terminal-Bench 4.0 leaderboard no longer ranks accuracy descending."));
  }
  return ok(undefined);
}

function recordIdForPath(sourcePath: string): string {
  const fileName = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  return fileName.endsWith(".json") ? fileName.slice(0, -5) : fileName;
}

export function normalizeTerminalBenchSubmission(
  submission: SourceSubmission,
  sourcePath: string,
  repositoryCommit: string,
): TerminalBenchRecord {
  return {
    harness: {
      display: submission.metadata.agent_display,
      id: submission.source_filter.agent,
      organization: submission.metadata.agent_org,
      version: submission.source_filter.agent_version,
    },
    id: recordIdForPath(sourcePath),
    metrics: {
      accuracyCi95HalfWidthPercent: submission.metrics.accuracy_ci95_half_width,
      accuracyPercent: submission.metrics.accuracy,
      averageTrialDurationSeconds: submission.metrics.avg_trial_duration_sec,
      cachedInputTokens: submission.metrics.cached_input_tokens,
      nTrials: submission.metrics.n_trials,
      outputTokens: submission.metrics.output_tokens,
      passAt2: submission.metrics.pass_at_2,
      passAt3: submission.metrics.pass_at_3,
      passAt4: submission.metrics.pass_at_4,
      passAt5: submission.metrics.pass_at_5,
      successes: submission.metrics.successes,
      totalCostUsd: submission.metrics.total_cost_usd,
      totalTokens: submission.metrics.total_tokens,
      uncachedInputTokens: submission.metrics.uncached_input_tokens,
    },
    model: {
      display: submission.metadata.model_display,
      id: submission.source_filter.model_name,
      organization: submission.metadata.model_org,
    },
    reasoningEffort: submission.metadata.reasoning_effort,
    releaseDate: submission.metadata.date,
    sourceFilterReasoningEffort: submission.source_filter.reasoning_effort,
    sourceJobUrls: submission.source_jobs,
    sourcePath,
    sourceUrl: `https://raw.githubusercontent.com/harbor-framework/terminal-bench/${repositoryCommit}/${sourcePath}`,
  };
}

export function deriveTerminalBenchSnapshot(
  sourceCommit: SourceCommit,
  submissions: readonly Readonly<{ item: SourceDirectoryItem; submission: SourceSubmission }>[],
  retrievedAt: string,
): TerminalBenchSnapshot {
  const repositoryCommit = sourceCommit.sha;
  const records = submissions
    .map(({ item, submission }) => normalizeTerminalBenchSubmission(
      submission,
      item.path,
      repositoryCommit,
    ))
    .sort(compareTerminalBenchRecords);

  return {
    benchmark: {
      datasetRef: TERMINAL_BENCH_DATASET_REF,
      name: TERMINAL_BENCH_NAME,
      score: "accuracy",
      scoreUnit: "percent",
      taskCount: TERMINAL_BENCH_TASK_COUNT,
      trialsPerConfiguration: TERMINAL_BENCH_TRIALS_PER_CONFIGURATION,
      trialsPerTask: TERMINAL_BENCH_TRIALS_PER_TASK,
      version: TERMINAL_BENCH_VERSION,
      runPolicy: {
        actionLimit: null,
        agentCount: null,
        agentTimeoutSeconds: TERMINAL_BENCH_AGENT_TIMEOUT_SECONDS,
        costBasis: "source-reported-total-usd; pricing basis unspecified",
        disqualifiedTrialPolicy: "reject-submission",
        retryPolicy: null,
        seedPolicy: null,
        tokenLimit: null,
        toolsMode: null,
        uncertaintyMethod: "source-reported-95%-confidence-interval; method unspecified",
      },
    },
    records,
    schemaVersion: 1,
    source: {
      leaderboardDefinitionUrl: `${TERMINAL_BENCH_REPOSITORY_URL}/blob/${repositoryCommit}/${LEADERBOARD_DEFINITION_PATH}`,
      leaderboardUrl: TERMINAL_BENCH_LEADERBOARD_URL,
      method: "version-pinned-github-submissions",
      name: "Harbor Framework",
      releaseUrl: TERMINAL_BENCH_RELEASE_URL,
      repositoryCommit,
      repositoryCommittedAt: sourceCommit.commit.committer.date,
      repositoryCommitUrl: `${TERMINAL_BENCH_REPOSITORY_URL}/commit/${repositoryCommit}`,
      repositoryUrl: TERMINAL_BENCH_REPOSITORY_URL,
      retrievedAt,
      sourceClass: "benchmark-owner",
      submissionsDirectoryUrl: `${TERMINAL_BENCH_REPOSITORY_URL}/tree/${repositoryCommit}/${SUBMISSIONS_PATH}`,
    },
  };
}

async function fetchSource(
  url: string,
  accept: "application/json" | "text/plain",
): Promise<Result<Response, Error>> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: terminalBenchRequestHeaders(
          url,
          accept,
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

export function terminalBenchRequestHeaders(
  url: string,
  accept: "application/json" | "text/plain",
  githubToken?: string,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {
    accept,
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
  const response = await fetchSource(url, "application/json");
  if (!response.ok) return response;
  try {
    const body: unknown = await response.value.json();
    return ok(body);
  } catch (cause) {
    return err(new Error(`Could not parse JSON from ${url}.`, { cause }));
  }
}

async function fetchText(url: string): Promise<Result<string, Error>> {
  const response = await fetchSource(url, "text/plain");
  if (!response.ok) return response;
  return ok(await response.value.text());
}

async function readCommittedSnapshot(): Promise<Result<TerminalBenchSnapshot, Error>> {
  try {
    const input: unknown = await Bun.file(OUTPUT_PATH).json();
    const parsed = parseTerminalBenchSnapshot(input);
    return parsed.ok
      ? ok(parsed.value)
      : err(new Error(`Invalid ${OUTPUT_PATH}: ${parsed.error.message}`, { cause: parsed.error }));
  } catch (cause) {
    return err(new Error(`Could not read ${OUTPUT_PATH}.`, { cause }));
  }
}

async function writeCommittedSnapshot(snapshot: TerminalBenchSnapshot): Promise<void> {
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  await Bun.write(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(temporaryPath, OUTPUT_PATH);
}

type TerminalBenchRefreshDependencies = Readonly<{
  fetchJson: typeof fetchJson;
  fetchText: typeof fetchText;
  now: () => string;
  readCommittedSnapshot: typeof readCommittedSnapshot;
  writeCommittedSnapshot: typeof writeCommittedSnapshot;
}>;

const defaultRefreshDependencies: TerminalBenchRefreshDependencies = {
  fetchJson,
  fetchText,
  now: () => new Date().toISOString(),
  readCommittedSnapshot,
  writeCommittedSnapshot,
};

function preserveRetrievalTimeWhenUnchanged(
  previous: TerminalBenchSnapshot,
  candidate: TerminalBenchSnapshot,
): TerminalBenchSnapshot {
  const candidateAtPreviousTime: TerminalBenchSnapshot = {
    ...candidate,
    source: { ...candidate.source, retrievedAt: previous.source.retrievedAt },
  };
  return JSON.stringify(previous) === JSON.stringify(candidateAtPreviousTime)
    ? previous
    : candidate;
}

export async function validateCommittedTerminalBench(): Promise<Result<TerminalBenchSnapshot, Error>> {
  return readCommittedSnapshot();
}

export async function refreshTerminalBench(
  overrides: Partial<TerminalBenchRefreshDependencies> = {},
): Promise<Result<TerminalBenchSnapshot, Error>> {
  const dependencies = { ...defaultRefreshDependencies, ...overrides };
  const previous = await dependencies.readCommittedSnapshot();
  if (!previous.ok) return previous;

  const commitSource = await dependencies.fetchJson(SOURCE_COMMIT_URL);
  if (!commitSource.ok) return commitSource;
  const parsedCommits = parseResult(sourceCommitResponseSchema, commitSource.value);
  if (!parsedCommits.ok) {
    return err(new Error(
      `Terminal-Bench source commit response changed shape: ${parsedCommits.error.message}`,
      { cause: parsedCommits.error },
    ));
  }
  const sourceCommit = parsedCommits.value[0];
  if (sourceCommit === undefined) return err(new Error("Terminal-Bench returned no leaderboard commit."));

  const repositoryCommit = sourceCommit.sha;
  const directoryUrl = `${REPOSITORY_API_URL}/contents/${SUBMISSIONS_PATH}?ref=${repositoryCommit}`;
  const directorySource = await dependencies.fetchJson(directoryUrl);
  if (!directorySource.ok) return directorySource;
  const parsedDirectory = parseResult(z.array(sourceDirectoryItemSchema).min(1), directorySource.value);
  if (!parsedDirectory.ok) {
    return err(new Error(
      `Terminal-Bench submissions directory changed shape: ${parsedDirectory.error.message}`,
      { cause: parsedDirectory.error },
    ));
  }
  const submissionItems = parsedDirectory.value
    .filter(item => item.path.endsWith(".json"))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (submissionItems.length === 0) {
    return err(new Error("Terminal-Bench submissions directory contained no JSON submissions."));
  }

  const definitionUrl = `https://raw.githubusercontent.com/harbor-framework/terminal-bench/${repositoryCommit}/${LEADERBOARD_DEFINITION_PATH}`;
  const definitionSource = await dependencies.fetchText(definitionUrl);
  if (!definitionSource.ok) return definitionSource;
  let definition: unknown;
  try {
    definition = parseYaml(definitionSource.value);
  } catch (cause) {
    return err(new Error("Could not parse the Terminal-Bench leaderboard definition.", { cause }));
  }
  const validDefinition = validateLeaderboardDefinition(definition);
  if (!validDefinition.ok) return validDefinition;

  const submissions: Array<{ item: SourceDirectoryItem; submission: SourceSubmission }> = [];
  for (const item of submissionItems) {
    const sourceUrl = `https://raw.githubusercontent.com/harbor-framework/terminal-bench/${repositoryCommit}/${item.path}`;
    const source = await dependencies.fetchJson(sourceUrl);
    if (!source.ok) return source;
    const parsed = parseTerminalBenchSubmission(source.value);
    if (!parsed.ok) {
      return err(new Error(
        `Terminal-Bench submission ${item.path} changed shape: ${parsed.error.message}`,
        { cause: parsed.error },
      ));
    }
    submissions.push({ item, submission: parsed.value });
  }

  const derived = deriveTerminalBenchSnapshot(sourceCommit, submissions, dependencies.now());
  const parsedDerived = parseTerminalBenchSnapshot(derived);
  if (!parsedDerived.ok) {
    return err(new Error(
      `Normalized Terminal-Bench snapshot is invalid: ${parsedDerived.error.message}`,
      { cause: parsedDerived.error },
    ));
  }
  const candidate = preserveRetrievalTimeWhenUnchanged(previous.value, parsedDerived.value);
  const safeReplacement = validateTerminalBenchReplacement(previous.value, candidate);
  if (!safeReplacement.ok) return safeReplacement;
  await dependencies.writeCommittedSnapshot(candidate);
  return ok(candidate);
}

if (import.meta.main) {
  const checkOnly = Bun.argv.includes("--check");
  const result = checkOnly
    ? await validateCommittedTerminalBench()
    : await refreshTerminalBench();
  if (!result.ok) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    const verb = checkOnly ? "Validated" : "Refreshed";
    console.log(
      `${verb} ${result.value.records.length} Terminal-Bench ${result.value.benchmark.version} configurations in data/terminal-bench.json.`,
    );
  }
}
