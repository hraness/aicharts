import type { Result } from "./result";
import { credentialFreeHttpsUrlSchema } from "./credential-free-https-url";
import { err, ok } from "./result";
import { parseResult, z } from "./schema";

export const TERMINAL_BENCH_NAME = "Terminal-Bench" as const;
export const TERMINAL_BENCH_VERSION = "4.0.0" as const;
export const TERMINAL_BENCH_DATASET_REF = "4" as const;
export const TERMINAL_BENCH_TASK_COUNT = 66 as const;
export const TERMINAL_BENCH_TRIALS_PER_TASK = 5 as const;
export const TERMINAL_BENCH_AGENT_TIMEOUT_SECONDS = 28_800 as const;
export const TERMINAL_BENCH_TRIALS_PER_CONFIGURATION = (
  TERMINAL_BENCH_TASK_COUNT * TERMINAL_BENCH_TRIALS_PER_TASK
) as 330;
export const TERMINAL_BENCH_REPOSITORY_URL =
  "https://github.com/harbor-framework/terminal-bench" as const;
export const TERMINAL_BENCH_RELEASE_URL =
  "https://github.com/harbor-framework/terminal-bench/releases/tag/v4.0.0" as const;
export const TERMINAL_BENCH_LEADERBOARD_URL =
  "https://hub.harborframework.com/datasets/terminal-bench/terminal-bench/latest?leaderboard=4-0-0&tab=leaderboard" as const;

const fullCommitSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const percentSchema = z.number().finite().min(0).max(100);
const probabilitySchema = z.number().finite().min(0).max(1);
const nonnegativeFiniteSchema = z.number().finite().nonnegative();
const nonnegativeIntegerSchema = z.number().int().nonnegative();
const sourcePathSchema = z.string().regex(
  /^leaderboard\/submissions\/[a-z0-9][a-z0-9-]*\.json$/u,
);

const labeledLinkSchema = z.object({
  label: z.string().min(1),
  url: credentialFreeHttpsUrlSchema,
}).strict();

const terminalBenchMetricsSchema = z.object({
  accuracyPercent: percentSchema,
  accuracyCi95HalfWidthPercent: percentSchema,
  averageTrialDurationSeconds: nonnegativeFiniteSchema,
  cachedInputTokens: nonnegativeIntegerSchema,
  nTrials: z.literal(TERMINAL_BENCH_TRIALS_PER_CONFIGURATION),
  outputTokens: nonnegativeIntegerSchema,
  passAt2: probabilitySchema,
  passAt3: probabilitySchema,
  passAt4: probabilitySchema,
  passAt5: probabilitySchema,
  successes: z.number().int().min(0).max(TERMINAL_BENCH_TRIALS_PER_CONFIGURATION),
  totalCostUsd: nonnegativeFiniteSchema,
  totalTokens: nonnegativeIntegerSchema,
  uncachedInputTokens: nonnegativeIntegerSchema,
}).strict().superRefine((metrics, context) => {
  const observedAccuracy = metrics.successes / metrics.nTrials * 100;
  if (Math.abs(observedAccuracy - metrics.accuracyPercent) > 0.011) {
    context.addIssue({
      code: "custom",
      message: "Terminal-Bench accuracy must equal successes divided by trials, rounded to two decimals.",
      path: ["accuracyPercent"],
    });
  }
  if (
    metrics.passAt2 > metrics.passAt3
    || metrics.passAt3 > metrics.passAt4
    || metrics.passAt4 > metrics.passAt5
  ) {
    context.addIssue({
      code: "custom",
      message: "Terminal-Bench pass@k values must be nondecreasing as k increases.",
      path: ["passAt2"],
    });
  }
});

export const terminalBenchRecordSchema = z.object({
  id: z.string().min(1),
  releaseDate: isoDateSchema,
  reasoningEffort: z.string().min(1),
  harness: z.object({
    display: labeledLinkSchema,
    id: z.string().min(1),
    organization: labeledLinkSchema,
    version: z.string().min(1),
  }).strict(),
  model: z.object({
    display: labeledLinkSchema,
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u),
    organization: labeledLinkSchema,
  }).strict(),
  metrics: terminalBenchMetricsSchema,
  sourceFilterReasoningEffort: z.string().min(1).nullable(),
  sourceJobUrls: z.array(credentialFreeHttpsUrlSchema).min(1),
  sourcePath: sourcePathSchema,
  sourceUrl: credentialFreeHttpsUrlSchema,
}).strict();

export const terminalBenchSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  benchmark: z.object({
    datasetRef: z.literal(TERMINAL_BENCH_DATASET_REF),
    name: z.literal(TERMINAL_BENCH_NAME),
    score: z.literal("accuracy"),
    scoreUnit: z.literal("percent"),
    taskCount: z.literal(TERMINAL_BENCH_TASK_COUNT),
    trialsPerConfiguration: z.literal(TERMINAL_BENCH_TRIALS_PER_CONFIGURATION),
    trialsPerTask: z.literal(TERMINAL_BENCH_TRIALS_PER_TASK),
    version: z.literal(TERMINAL_BENCH_VERSION),
    runPolicy: z.object({
      actionLimit: z.null(),
      agentCount: z.null(),
      agentTimeoutSeconds: z.literal(TERMINAL_BENCH_AGENT_TIMEOUT_SECONDS),
      costBasis: z.literal("source-reported-total-usd; pricing basis unspecified"),
      disqualifiedTrialPolicy: z.literal("reject-submission"),
      retryPolicy: z.null(),
      seedPolicy: z.null(),
      tokenLimit: z.null(),
      toolsMode: z.null(),
      uncertaintyMethod: z.literal("source-reported-95%-confidence-interval; method unspecified"),
    }).strict(),
  }).strict(),
  source: z.object({
    leaderboardDefinitionUrl: credentialFreeHttpsUrlSchema,
    leaderboardUrl: z.literal(TERMINAL_BENCH_LEADERBOARD_URL),
    method: z.literal("version-pinned-github-submissions"),
    name: z.literal("Harbor Framework"),
    releaseUrl: z.literal(TERMINAL_BENCH_RELEASE_URL),
    repositoryCommit: fullCommitSchema,
    repositoryCommittedAt: z.string().datetime({ offset: true }),
    repositoryCommitUrl: credentialFreeHttpsUrlSchema,
    repositoryUrl: z.literal(TERMINAL_BENCH_REPOSITORY_URL),
    retrievedAt: z.string().datetime({ offset: true }),
    sourceClass: z.literal("benchmark-owner"),
    submissionsDirectoryUrl: credentialFreeHttpsUrlSchema,
  }).strict(),
  records: z.array(terminalBenchRecordSchema).min(1),
}).strict().superRefine((snapshot, context) => {
  const commit = snapshot.source.repositoryCommit;
  const expectedCommitUrl = `${TERMINAL_BENCH_REPOSITORY_URL}/commit/${commit}`;
  const expectedDefinitionUrl = `${TERMINAL_BENCH_REPOSITORY_URL}/blob/${commit}/leaderboard/leaderboard.yaml`;
  const expectedSubmissionsUrl = `${TERMINAL_BENCH_REPOSITORY_URL}/tree/${commit}/leaderboard/submissions`;
  if (snapshot.source.repositoryCommitUrl !== expectedCommitUrl) {
    context.addIssue({
      code: "custom",
      message: "Terminal-Bench commit URL must pin the recorded repository commit.",
      path: ["source", "repositoryCommitUrl"],
    });
  }
  if (snapshot.source.leaderboardDefinitionUrl !== expectedDefinitionUrl) {
    context.addIssue({
      code: "custom",
      message: "Terminal-Bench leaderboard definition URL must pin the recorded repository commit.",
      path: ["source", "leaderboardDefinitionUrl"],
    });
  }
  if (snapshot.source.submissionsDirectoryUrl !== expectedSubmissionsUrl) {
    context.addIssue({
      code: "custom",
      message: "Terminal-Bench submissions URL must pin the recorded repository commit.",
      path: ["source", "submissionsDirectoryUrl"],
    });
  }
  if (Date.parse(snapshot.source.repositoryCommittedAt) > Date.parse(snapshot.source.retrievedAt)) {
    context.addIssue({
      code: "custom",
      message: "Terminal-Bench source commit cannot be newer than its retrieval.",
      path: ["source", "repositoryCommittedAt"],
    });
  }

  const ids = new Set<string>();
  const semanticKeys = new Set<string>();
  const paths = new Set<string>();
  snapshot.records.forEach((record, index) => {
    const semanticKey = terminalBenchRecordKey(record);
    if (ids.has(record.id)) {
      context.addIssue({
        code: "custom",
        message: `Terminal-Bench snapshot contains duplicate record id ${record.id}.`,
        path: ["records", index, "id"],
      });
    }
    if (semanticKeys.has(semanticKey)) {
      context.addIssue({
        code: "custom",
        message: "Terminal-Bench snapshot contains a duplicate harness/model/effort configuration.",
        path: ["records", index],
      });
    }
    if (paths.has(record.sourcePath)) {
      context.addIssue({
        code: "custom",
        message: `Terminal-Bench snapshot contains duplicate source path ${record.sourcePath}.`,
        path: ["records", index, "sourcePath"],
      });
    }
    const expectedSourceUrl = `https://raw.githubusercontent.com/harbor-framework/terminal-bench/${commit}/${record.sourcePath}`;
    if (record.sourceUrl !== expectedSourceUrl) {
      context.addIssue({
        code: "custom",
        message: "Terminal-Bench record source URL must pin its source file to the recorded repository commit.",
        path: ["records", index, "sourceUrl"],
      });
    }
    ids.add(record.id);
    semanticKeys.add(semanticKey);
    paths.add(record.sourcePath);
  });

  const sortedRecords = [...snapshot.records].sort(compareTerminalBenchRecords);
  snapshot.records.forEach((record, index) => {
    if (record.id !== sortedRecords[index]?.id) {
      context.addIssue({
        code: "custom",
        message: "Terminal-Bench records must be sorted by accuracy, then stable configuration identity.",
        path: ["records", index],
      });
    }
  });
});

export type TerminalBenchRecord = z.infer<typeof terminalBenchRecordSchema>;
export type TerminalBenchSnapshot = z.infer<typeof terminalBenchSnapshotSchema>;

export function terminalBenchRecordKey(
  record: Pick<TerminalBenchRecord, "harness" | "model" | "reasoningEffort">,
): string {
  return JSON.stringify([
    record.harness.id,
    record.harness.version,
    record.model.id,
    record.reasoningEffort,
  ]);
}

export function compareTerminalBenchRecords(
  left: TerminalBenchRecord,
  right: TerminalBenchRecord,
): number {
  return right.metrics.accuracyPercent - left.metrics.accuracyPercent
    || terminalBenchRecordKey(left).localeCompare(terminalBenchRecordKey(right))
    || left.id.localeCompare(right.id);
}

export function parseTerminalBenchSnapshot(
  value: unknown,
): Result<TerminalBenchSnapshot, z.ZodError> {
  return parseResult(terminalBenchSnapshotSchema, value);
}

const minimumRetentionRatio = 0.8;

export function validateTerminalBenchReplacement(
  previous: TerminalBenchSnapshot,
  candidate: TerminalBenchSnapshot,
): Result<void, Error> {
  if (
    Date.parse(candidate.source.repositoryCommittedAt)
    < Date.parse(previous.source.repositoryCommittedAt)
  ) {
    return err(new Error(
      `Terminal-Bench source commit timestamp regressed from ${previous.source.repositoryCommittedAt} to ${candidate.source.repositoryCommittedAt}.`,
    ));
  }

  const minimumRows = Math.ceil(previous.records.length * minimumRetentionRatio);
  if (candidate.records.length < minimumRows) {
    return err(new Error(
      `Terminal-Bench refresh dropped from ${previous.records.length} to ${candidate.records.length} records; minimum safe count is ${minimumRows}.`,
    ));
  }

  const previousKeys = new Set(previous.records.map(terminalBenchRecordKey));
  const retainedKeys = candidate.records.filter(record => (
    previousKeys.has(terminalBenchRecordKey(record))
  )).length;
  const minimumRetained = Math.ceil(previousKeys.size * minimumRetentionRatio);
  if (retainedKeys < minimumRetained) {
    return err(new Error(
      `Terminal-Bench refresh retained ${retainedKeys} of ${previousKeys.size} configurations; minimum safe overlap is ${minimumRetained}.`,
    ));
  }

  return ok(undefined);
}
