import type { Result } from "./result";
import { credentialFreeHttpsUrlSchema } from "./credential-free-https-url";
import { err, ok } from "./result";
import { parseResult, z } from "./schema";

export const TERMINAL_BENCH_SCIENCE_NAME = "Terminal-Bench-Science" as const;
export const TERMINAL_BENCH_SCIENCE_VERSION = "0.1.0" as const;
export const TERMINAL_BENCH_SCIENCE_RELEASE_TAG = "v0.1.0" as const;
export const TERMINAL_BENCH_SCIENCE_TASK_COUNT = 70 as const;
export const TERMINAL_BENCH_SCIENCE_TRIALS_PER_TASK = 3 as const;
export const TERMINAL_BENCH_SCIENCE_TRIALS_PER_CONFIGURATION = (
  TERMINAL_BENCH_SCIENCE_TASK_COUNT * TERMINAL_BENCH_SCIENCE_TRIALS_PER_TASK
) as 210;
export const TERMINAL_BENCH_SCIENCE_PACKAGE =
  "terminal-bench-science/terminal-bench-science" as const;
export const TERMINAL_BENCH_SCIENCE_DATASET_VERSION_ID =
  "2b817f26-dc4f-4477-8032-2218dcc553b5" as const;
export const TERMINAL_BENCH_SCIENCE_LEADERBOARD_NAME = "v0-1-eval" as const;
export const TERMINAL_BENCH_SCIENCE_LEADERBOARD_ID =
  "9a545a14-78d0-44b4-9003-afe062522a47" as const;
export const TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT =
  "f81afac4f11048e77a15dfc8fb1dbfb897fea0ce" as const;
export const TERMINAL_BENCH_SCIENCE_REPOSITORY_URL =
  "https://github.com/harbor-framework/terminal-bench-science" as const;
export const TERMINAL_BENCH_SCIENCE_RELEASE_URL =
  `${TERMINAL_BENCH_SCIENCE_REPOSITORY_URL}/releases/tag/${TERMINAL_BENCH_SCIENCE_RELEASE_TAG}` as const;
export const TERMINAL_BENCH_SCIENCE_ANNOUNCEMENT_URL =
  "https://www.terminal-bench-science.ai/announcement" as const;
export const TERMINAL_BENCH_SCIENCE_LEADERBOARD_URL =
  "https://hub.harborframework.com/datasets/terminal-bench-science/terminal-bench-science/0.1.0?leaderboard=v0-1-eval&tab=leaderboard" as const;
export const TERMINAL_BENCH_SCIENCE_LEADERBOARD_API_URL =
  "https://www.terminal-bench-science.ai/api/leaderboard?package=terminal-bench-science%2Fterminal-bench-science&name=v0-1-eval" as const;
export const TERMINAL_BENCH_SCIENCE_RELEASE_DOI_URL =
  "https://doi.org/10.5281/zenodo.22110254" as const;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const percentSchema = z.number().finite().min(0).max(100);
const nonnegativeFiniteSchema = z.number().finite().nonnegative();
const nonnegativeIntegerSchema = z.number().int().nonnegative();

const labeledLinkSchema = z.object({
  label: z.string().min(1),
  url: credentialFreeHttpsUrlSchema,
}).strict();

const terminalBenchScienceDomainMetricsSchema = z.object({
  nTrials: z.number().int().positive(),
  passes: nonnegativeIntegerSchema,
  resolutionRatePercent: percentSchema,
  standardErrorPercent: percentSchema,
  totalCostUsd: nonnegativeFiniteSchema,
  totalTokens: nonnegativeIntegerSchema,
}).strict().superRefine((metrics, context) => {
  if (metrics.passes > metrics.nTrials) {
    context.addIssue({
      code: "custom",
      message: "Domain passes cannot exceed domain trials.",
      path: ["passes"],
    });
  }
  const observedRate = metrics.passes / metrics.nTrials * 100;
  if (Math.abs(observedRate - metrics.resolutionRatePercent) > 1e-9) {
    context.addIssue({
      code: "custom",
      message: "Domain resolution rate must equal passes divided by trials.",
      path: ["resolutionRatePercent"],
    });
  }
  const probability = metrics.resolutionRatePercent / 100;
  const observedStandardError = Math.sqrt(
    probability * (1 - probability) / metrics.nTrials,
  ) * 100;
  if (Math.abs(observedStandardError - metrics.standardErrorPercent) > 1e-9) {
    context.addIssue({
      code: "custom",
      message: "Domain standard error must match the binomial standard error.",
      path: ["standardErrorPercent"],
    });
  }
});

const terminalBenchScienceDomainsSchema = z.object({
  earth: terminalBenchScienceDomainMetricsSchema,
  engineering: terminalBenchScienceDomainMetricsSchema,
  life: terminalBenchScienceDomainMetricsSchema,
  mathematical: terminalBenchScienceDomainMetricsSchema,
  physical: terminalBenchScienceDomainMetricsSchema,
}).strict();

const terminalBenchScienceMetricsSchema = z.object({
  domains: terminalBenchScienceDomainsSchema,
  nTrials: z.literal(TERMINAL_BENCH_SCIENCE_TRIALS_PER_CONFIGURATION),
  passes: z.number().int().min(0).max(TERMINAL_BENCH_SCIENCE_TRIALS_PER_CONFIGURATION),
  resolutionRatePercent: percentSchema,
  standardErrorPercent: percentSchema,
  totalCostUsd: nonnegativeFiniteSchema,
  totalTokens: nonnegativeIntegerSchema,
}).strict().superRefine((metrics, context) => {
  const observedRate = metrics.passes / metrics.nTrials * 100;
  if (Math.abs(observedRate - metrics.resolutionRatePercent) > 1e-9) {
    context.addIssue({
      code: "custom",
      message: "Terminal-Bench-Science resolution rate must equal passes divided by trials.",
      path: ["resolutionRatePercent"],
    });
  }
  const probability = metrics.resolutionRatePercent / 100;
  const observedStandardError = Math.sqrt(
    probability * (1 - probability) / metrics.nTrials,
  ) * 100;
  if (Math.abs(observedStandardError - metrics.standardErrorPercent) > 1e-9) {
    context.addIssue({
      code: "custom",
      message: "Terminal-Bench-Science standard error must match the binomial standard error.",
      path: ["standardErrorPercent"],
    });
  }
  const domains = Object.values(metrics.domains);
  const totals = domains.reduce((sum, domain) => ({
    passes: sum.passes + domain.passes,
    tokens: sum.tokens + domain.totalTokens,
    trials: sum.trials + domain.nTrials,
  }), { passes: 0, tokens: 0, trials: 0 });
  if (totals.trials !== metrics.nTrials) {
    context.addIssue({
      code: "custom",
      message: "Domain trials must sum to total trials.",
      path: ["domains"],
    });
  }
  if (totals.passes !== metrics.passes) {
    context.addIssue({
      code: "custom",
      message: "Domain passes must sum to total passes.",
      path: ["domains"],
    });
  }
  if (totals.tokens !== metrics.totalTokens) {
    context.addIssue({
      code: "custom",
      message: "Domain tokens must sum to total tokens.",
      path: ["domains"],
    });
  }
});

export const terminalBenchScienceRecordSchema = z.object({
  harness: z.object({
    display: labeledLinkSchema,
    organization: labeledLinkSchema,
    version: z.null(),
  }).strict(),
  id: z.string().min(1),
  metrics: terminalBenchScienceMetricsSchema,
  model: z.object({
    display: labeledLinkSchema,
    organization: labeledLinkSchema,
    version: z.null(),
  }).strict(),
  rank: z.number().int().positive(),
  reasoningEffort: z.string().min(1),
  releaseDate: isoDateSchema,
  safeguardMode: z.null(),
  sourceUpdatedAt: z.string().datetime({ offset: true }),
  sourceUrl: credentialFreeHttpsUrlSchema,
}).strict();

export const terminalBenchScienceSnapshotSchema = z.object({
  benchmark: z.object({
    name: z.literal(TERMINAL_BENCH_SCIENCE_NAME),
    score: z.literal("resolution-rate"),
    scoreUnit: z.literal("percent"),
    taskCount: z.literal(TERMINAL_BENCH_SCIENCE_TASK_COUNT),
    trialsPerConfiguration: z.literal(TERMINAL_BENCH_SCIENCE_TRIALS_PER_CONFIGURATION),
    trialsPerTask: z.literal(TERMINAL_BENCH_SCIENCE_TRIALS_PER_TASK),
    version: z.literal(TERMINAL_BENCH_SCIENCE_VERSION),
    runPolicy: z.object({
      actionLimit: z.null(),
      agentCount: z.null(),
      agentTimeoutSeconds: z.null(),
      costAggregationPolicy: z.literal(
        "preserve-owner-aggregate-and-domain-costs-without-reconciliation",
      ),
      costBasis: z.literal("source-reported-total-evaluation-usd; pricing basis unspecified"),
      errorTreatment: z.null(),
      retryPolicy: z.null(),
      seedPolicy: z.null(),
      tokenLimit: z.null(),
      toolsMode: z.null(),
      uncertaintyMethod: z.literal("source-reported-binomial-standard-error"),
    }).strict(),
  }).strict(),
  records: z.array(terminalBenchScienceRecordSchema).min(1),
  schemaVersion: z.literal(1),
  source: z.object({
    announcementUrl: z.literal(TERMINAL_BENCH_SCIENCE_ANNOUNCEMENT_URL),
    datasetVersionId: z.literal(TERMINAL_BENCH_SCIENCE_DATASET_VERSION_ID),
    leaderboardApiUrl: z.literal(TERMINAL_BENCH_SCIENCE_LEADERBOARD_API_URL),
    leaderboardId: z.literal(TERMINAL_BENCH_SCIENCE_LEADERBOARD_ID),
    leaderboardName: z.literal(TERMINAL_BENCH_SCIENCE_LEADERBOARD_NAME),
    leaderboardPackage: z.literal(TERMINAL_BENCH_SCIENCE_PACKAGE),
    leaderboardUpdatedAt: z.string().datetime({ offset: true }),
    leaderboardUrl: z.literal(TERMINAL_BENCH_SCIENCE_LEADERBOARD_URL),
    method: z.literal("version-pinned-release-owner-leaderboard-api"),
    name: z.literal("Terminal-Bench-Science and Harbor Framework"),
    releaseCommit: z.literal(TERMINAL_BENCH_SCIENCE_REPOSITORY_COMMIT),
    releaseCommittedAt: z.string().datetime({ offset: true }),
    releaseCommitUrl: credentialFreeHttpsUrlSchema,
    releaseDoiUrl: z.literal(TERMINAL_BENCH_SCIENCE_RELEASE_DOI_URL),
    releaseNotesUrl: credentialFreeHttpsUrlSchema,
    releasePublishedAt: z.string().datetime({ offset: true }),
    releaseTag: z.literal(TERMINAL_BENCH_SCIENCE_RELEASE_TAG),
    releaseUrl: z.literal(TERMINAL_BENCH_SCIENCE_RELEASE_URL),
    repositoryUrl: z.literal(TERMINAL_BENCH_SCIENCE_REPOSITORY_URL),
    retrievedAt: z.string().datetime({ offset: true }),
    sourceClass: z.literal("benchmark-owner"),
  }).strict(),
}).strict().superRefine((snapshot, context) => {
  const commit = snapshot.source.releaseCommit;
  const expectedCommitUrl = `${TERMINAL_BENCH_SCIENCE_REPOSITORY_URL}/commit/${commit}`;
  const expectedNotesUrl = `${TERMINAL_BENCH_SCIENCE_REPOSITORY_URL}/blob/${commit}/release-notes-v0.1.0.md`;
  if (snapshot.source.releaseCommitUrl !== expectedCommitUrl) {
    context.addIssue({
      code: "custom",
      message: "Terminal-Bench-Science commit URL must pin the v0.1.0 release commit.",
      path: ["source", "releaseCommitUrl"],
    });
  }
  if (snapshot.source.releaseNotesUrl !== expectedNotesUrl) {
    context.addIssue({
      code: "custom",
      message: "Terminal-Bench-Science release notes must pin the v0.1.0 release commit.",
      path: ["source", "releaseNotesUrl"],
    });
  }

  const committedAt = Date.parse(snapshot.source.releaseCommittedAt);
  const publishedAt = Date.parse(snapshot.source.releasePublishedAt);
  const leaderboardUpdatedAt = Date.parse(snapshot.source.leaderboardUpdatedAt);
  const retrievedAt = Date.parse(snapshot.source.retrievedAt);
  if (committedAt > publishedAt || publishedAt > retrievedAt || leaderboardUpdatedAt > retrievedAt) {
    context.addIssue({
      code: "custom",
      message: "Terminal-Bench-Science source timestamps must not postdate their retrieval.",
      path: ["source", "retrievedAt"],
    });
  }

  const ids = new Set<string>();
  const configurations = new Set<string>();
  snapshot.records.forEach((record, index) => {
    if (ids.has(record.id)) {
      context.addIssue({
        code: "custom",
        message: `Terminal-Bench-Science snapshot contains duplicate row id ${record.id}.`,
        path: ["records", index, "id"],
      });
    }
    const configuration = terminalBenchScienceRecordKey(record);
    if (configurations.has(configuration)) {
      context.addIssue({
        code: "custom",
        message: "Terminal-Bench-Science snapshot contains a duplicate model/harness/effort configuration.",
        path: ["records", index],
      });
    }
    const expectedSourceUrl = terminalBenchScienceRowUrl(record.id);
    if (record.sourceUrl !== expectedSourceUrl) {
      context.addIssue({
        code: "custom",
        message: "Terminal-Bench-Science row URL must identify its owner-published leaderboard row.",
        path: ["records", index, "sourceUrl"],
      });
    }
    if (record.rank !== index + 1) {
      context.addIssue({
        code: "custom",
        message: "Terminal-Bench-Science records must preserve contiguous owner-published ranks.",
        path: ["records", index, "rank"],
      });
    }
    if (Date.parse(record.sourceUpdatedAt) > retrievedAt) {
      context.addIssue({
        code: "custom",
        message: "Terminal-Bench-Science row update cannot postdate retrieval.",
        path: ["records", index, "sourceUpdatedAt"],
      });
    }
    ids.add(record.id);
    configurations.add(configuration);
  });

  const sortedRecords = [...snapshot.records].sort(compareTerminalBenchScienceRecords);
  snapshot.records.forEach((record, index) => {
    if (record.id !== sortedRecords[index]?.id) {
      context.addIssue({
        code: "custom",
        message: "Terminal-Bench-Science records must be sorted by owner rank.",
        path: ["records", index],
      });
    }
  });
});

export type TerminalBenchScienceRecord = z.infer<typeof terminalBenchScienceRecordSchema>;
export type TerminalBenchScienceSnapshot = z.infer<typeof terminalBenchScienceSnapshotSchema>;

export function terminalBenchScienceRowUrl(rowId: string): string {
  return `https://hub.harborframework.com/datasets/terminal-bench-science/terminal-bench-science/${TERMINAL_BENCH_SCIENCE_VERSION}/leaderboards/${TERMINAL_BENCH_SCIENCE_LEADERBOARD_NAME}/rows/${encodeURIComponent(rowId)}`;
}

export function terminalBenchScienceRecordKey(
  record: Pick<TerminalBenchScienceRecord, "harness" | "model" | "reasoningEffort">,
): string {
  return JSON.stringify([
    record.harness.display.label,
    record.harness.display.url,
    record.model.display.label,
    record.model.display.url,
    record.reasoningEffort,
  ]);
}

export function compareTerminalBenchScienceRecords(
  left: TerminalBenchScienceRecord,
  right: TerminalBenchScienceRecord,
): number {
  return left.rank - right.rank || left.id.localeCompare(right.id);
}

export function parseTerminalBenchScienceSnapshot(
  value: unknown,
): Result<TerminalBenchScienceSnapshot, z.ZodError> {
  return parseResult(terminalBenchScienceSnapshotSchema, value);
}

const minimumRetentionRatio = 0.8;

export function validateTerminalBenchScienceReplacement(
  previous: TerminalBenchScienceSnapshot,
  candidate: TerminalBenchScienceSnapshot,
): Result<void, Error> {
  if (
    Date.parse(candidate.source.leaderboardUpdatedAt)
    < Date.parse(previous.source.leaderboardUpdatedAt)
  ) {
    return err(new Error(
      `Terminal-Bench-Science owner timestamp regressed from ${previous.source.leaderboardUpdatedAt} to ${candidate.source.leaderboardUpdatedAt}.`,
    ));
  }
  const minimumRows = Math.ceil(previous.records.length * minimumRetentionRatio);
  if (candidate.records.length < minimumRows) {
    return err(new Error(
      `Terminal-Bench-Science refresh dropped from ${previous.records.length} to ${candidate.records.length} records; minimum safe count is ${minimumRows}.`,
    ));
  }

  const previousKeys = new Set(previous.records.map(terminalBenchScienceRecordKey));
  const retainedKeys = candidate.records.filter(record => (
    previousKeys.has(terminalBenchScienceRecordKey(record))
  )).length;
  const minimumRetained = Math.ceil(previousKeys.size * minimumRetentionRatio);
  if (retainedKeys < minimumRetained) {
    return err(new Error(
      `Terminal-Bench-Science refresh retained ${retainedKeys} of ${previousKeys.size} configurations; minimum safe overlap is ${minimumRetained}.`,
    ));
  }

  return ok(undefined);
}
