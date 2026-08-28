import type { CodingAgentSnapshot } from "./coding-agent-data";
import {
  modelReleaseDisplayName,
  MODEL_RELEASE_SOURCE_URL,
  modelReleaseProviderForOpenRouterId,
  modelReleaseProviderIds,
  modelReleaseSemanticKey,
  openRouterModelIdTail,
  type ModelReleaseProviderId,
  type OpenRouterModel,
} from "./model-release-data";
import type { Result } from "./result";
import { err, isRecord, ok } from "./result";
import { parseResult, z } from "./schema";

export const DEEP_SWE_EVIDENCE_SOURCE_URL =
  "https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json" as const;
export const DEEP_SWE_LEADERBOARD_URL = "https://deepswe.datacurve.ai/" as const;
export const DEEP_SWE_BENCHMARK_VERSION = "1.1" as const;
export const DEEP_SWE_EVIDENCE_HARNESS = "mini-swe-agent" as const;

const sourceRowSchema = z.object({
  ciHigh: z.number().finite().min(0).max(1),
  ciLow: z.number().finite().min(0).max(1),
  config: z.string().min(1),
  harness: z.string().min(1),
  model: z.string().min(1),
  attempted: z.number().int().positive(),
  passed: z.number().int().nonnegative(),
  passAt1: z.number().finite().min(0).max(1),
  passRate: z.number().finite().min(0).max(1),
  reasoningEffort: z.string().min(1).nullable(),
  runs: z.number().int().positive(),
  source: z.literal("deep-swe"),
}).strict().superRefine((row, context) => {
  if (row.passed > row.attempted) {
    context.addIssue({
      code: "custom",
      message: "DeepSWE passed attempts cannot exceed attempted rollouts.",
      path: ["passed"],
    });
  }
  if (Math.abs(row.passAt1 - row.passed / row.attempted) > 1e-12) {
    context.addIssue({
      code: "custom",
      message: "DeepSWE pass@1 must equal passed divided by attempted rollouts.",
      path: ["passAt1"],
    });
  }
  if (Math.abs(row.passRate - row.passAt1) > 1e-12) {
    context.addIssue({
      code: "custom",
      message: "DeepSWE pass_rate and pass_at_1 must retain their current equivalent meaning.",
      path: ["passRate"],
    });
  }
  if (row.ciLow > row.passAt1 || row.ciHigh < row.passAt1 || row.ciLow > row.ciHigh) {
    context.addIssue({
      code: "custom",
      message: "DeepSWE confidence bounds must contain pass@1.",
      path: ["ciLow"],
    });
  }
});

const sourceSnapshotSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  latestJob: z.object({
    finishedAt: z.string().datetime({ offset: true }).nullable(),
    name: z.string().min(1),
  }).strict(),
  rows: z.array(sourceRowSchema).min(1),
  scope: z.string().min(1),
  taskCount: z.number().int().positive(),
  unit: z.string().min(1),
}).strict().superRefine((snapshot, context) => {
  const configs = new Set<string>();
  snapshot.rows.forEach((row, index) => {
    if (configs.has(row.config)) {
      context.addIssue({
        code: "custom",
        message: `DeepSWE returned duplicate configuration ${row.config}.`,
        path: ["rows", index, "config"],
      });
    }
    configs.add(row.config);
  });
});

const openRouterEvidenceIdentitySchema = z.object({
  modelId: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u),
  resolver: z.object({
    name: z.literal("OpenRouter"),
    retrievedAt: z.string().datetime({ offset: true }),
    url: z.literal(MODEL_RELEASE_SOURCE_URL),
  }).strict(),
  source: z.literal("openrouter"),
}).strict();

const artificialAnalysisEvidenceIdentitySchema = z.object({
  resolver: z.object({
    name: z.literal("Artificial Analysis"),
    retrievedAt: z.string().datetime({ offset: true }),
    url: z.string().url(),
  }).strict(),
  source: z.literal("artificial-analysis"),
}).strict();

const evidenceRecordSchema = z.object({
  attempted: z.number().int().positive(),
  ci95: z.object({
    high: z.number().finite().min(0).max(1),
    low: z.number().finite().min(0).max(1),
  }).strict(),
  config: z.string().min(1),
  harness: z.literal(DEEP_SWE_EVIDENCE_HARNESS),
  identity: z.discriminatedUnion("source", [
    openRouterEvidenceIdentitySchema,
    artificialAnalysisEvidenceIdentitySchema,
  ]),
  model: z.string().min(1),
  passAt1: z.number().finite().min(0).max(1),
  passed: z.number().int().nonnegative(),
  providerId: z.enum(modelReleaseProviderIds),
  runs: z.number().int().positive(),
  reasoningEffort: z.string().min(1).nullable(),
  sourceModel: z.string().min(1),
}).strict().superRefine((record, context) => {
  if (record.passed > record.attempted) {
    context.addIssue({
      code: "custom",
      message: "DeepSWE evidence passed attempts cannot exceed attempted rollouts.",
      path: ["passed"],
    });
  }
  if (Math.abs(record.passAt1 - record.passed / record.attempted) > 1e-12) {
    context.addIssue({
      code: "custom",
      message: "DeepSWE evidence pass@1 must equal passed divided by attempted rollouts.",
      path: ["passAt1"],
    });
  }
  if (
    record.ci95.low > record.passAt1
    || record.ci95.high < record.passAt1
    || record.ci95.low > record.ci95.high
  ) {
    context.addIssue({
      code: "custom",
      message: "DeepSWE evidence confidence bounds must contain pass@1.",
      path: ["ci95"],
    });
  }
});

const deepSweEvidenceSnapshotBaseSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    benchmark: z.literal("DeepSWE"),
    benchmarkVersion: z.literal(DEEP_SWE_BENCHMARK_VERSION),
    generatedAt: z.string().datetime({ offset: true }),
    latestJob: z.object({
      finishedAt: z.string().datetime({ offset: true }).nullable(),
      name: z.string().min(1),
    }).strict(),
    method: z.literal("leaderboard-artifact"),
    name: z.literal("DataCurve DeepSWE"),
    retrievedAt: z.string().datetime({ offset: true }),
    scope: z.string().min(1),
    taskCount: z.number().int().positive(),
    unit: z.string().min(1),
    url: z.literal(DEEP_SWE_EVIDENCE_SOURCE_URL),
  }).strict(),
  identitySource: z.object({
    attemptedAt: z.string().datetime({ offset: true }),
    method: z.literal("exact-semantic-model-id"),
    name: z.literal("OpenRouter"),
    retrievedAt: z.string().datetime({ offset: true }).nullable(),
    status: z.enum(["available", "unavailable"]),
    url: z.literal(MODEL_RELEASE_SOURCE_URL),
  }).strict(),
  policy: z.object({
    harness: z.literal(DEEP_SWE_EVIDENCE_HARNESS),
    identityPriority: z.tuple([
      z.literal("openrouter"),
      z.literal("artificial-analysis"),
    ]),
    publication: z.literal("early-evidence-only"),
    score: z.literal("pass@1"),
  }).strict(),
  records: z.array(evidenceRecordSchema).min(1),
  unmatchedModels: z.array(z.string().min(1)),
}).strict();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEvidenceRecords(
  left: DeepSweEvidenceRecord,
  right: DeepSweEvidenceRecord,
): number {
  return compareText(left.providerId, right.providerId)
    || compareText(left.model, right.model)
    || right.passAt1 - left.passAt1
    || compareText(left.config, right.config);
}

export const deepSweEvidenceSnapshotSchema = deepSweEvidenceSnapshotBaseSchema
  .superRefine((snapshot, context) => {
    const retrievedAt = Date.parse(snapshot.source.retrievedAt);
    if (Date.parse(snapshot.source.generatedAt) > retrievedAt) {
      context.addIssue({
        code: "custom",
        message: "DeepSWE source generation cannot be newer than retrieval.",
        path: ["source", "generatedAt"],
      });
    }
    if (
      snapshot.source.latestJob.finishedAt !== null
      && Date.parse(snapshot.source.latestJob.finishedAt) > retrievedAt
    ) {
      context.addIssue({
        code: "custom",
        message: "DeepSWE latest-job completion cannot be newer than retrieval.",
        path: ["source", "latestJob", "finishedAt"],
      });
    }

    const configs = new Set<string>();
    const resolvedModels = new Set<string>();
    const identityBySourceModel = new Map<string, string>();
    const identityAttemptedAt = Date.parse(snapshot.identitySource.attemptedAt);
    if (identityAttemptedAt > retrievedAt) {
      context.addIssue({
        code: "custom",
        message: "OpenRouter identity lookup cannot be attempted after evidence retrieval.",
        path: ["identitySource", "attemptedAt"],
      });
    }
    if (
      (snapshot.identitySource.status === "available")
      !== (snapshot.identitySource.retrievedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "OpenRouter identity availability must agree with its retrieval timestamp.",
        path: ["identitySource", "status"],
      });
    }
    if (
      snapshot.identitySource.retrievedAt !== null
      && Date.parse(snapshot.identitySource.retrievedAt) > retrievedAt
    ) {
      context.addIssue({
        code: "custom",
        message: "OpenRouter identity retrieval cannot be newer than evidence retrieval.",
        path: ["identitySource", "retrievedAt"],
      });
    }
    snapshot.records.forEach((record, index) => {
      if (configs.has(record.config)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate checked DeepSWE configuration ${record.config}.`,
          path: ["records", index, "config"],
        });
      }
      configs.add(record.config);
      resolvedModels.add(record.sourceModel);
      const identityKey = JSON.stringify([
        record.providerId,
        record.model,
        record.identity.source,
        record.identity.source === "openrouter" ? record.identity.modelId : null,
      ]);
      const existingIdentity = identityBySourceModel.get(record.sourceModel);
      if (existingIdentity !== undefined && existingIdentity !== identityKey) {
        context.addIssue({
          code: "custom",
          message: `DeepSWE source model ${record.sourceModel} resolves to inconsistent model identities.`,
          path: ["records", index, "identity"],
        });
      } else {
        identityBySourceModel.set(record.sourceModel, identityKey);
      }
      if (Date.parse(record.identity.resolver.retrievedAt) > retrievedAt) {
        context.addIssue({
          code: "custom",
          message: "A model resolver cannot be newer than evidence retrieval.",
          path: ["records", index, "identity", "resolver", "retrievedAt"],
        });
      }
      const previous = snapshot.records[index - 1];
      if (previous !== undefined && compareEvidenceRecords(previous, record) > 0) {
        context.addIssue({
          code: "custom",
          message: "DeepSWE evidence records must use deterministic provider/model/score order.",
          path: ["records", index],
        });
      }
    });

    snapshot.unmatchedModels.forEach((model, index) => {
      if (resolvedModels.has(model)) {
        context.addIssue({
          code: "custom",
          message: `DeepSWE model ${model} cannot be both resolved and unmatched.`,
          path: ["unmatchedModels", index],
        });
      }
      if (index > 0 && compareText(snapshot.unmatchedModels[index - 1] ?? "", model) >= 0) {
        context.addIssue({
          code: "custom",
          message: "Unmatched DeepSWE model names must be sorted and unique.",
          path: ["unmatchedModels", index],
        });
      }
    });
  });

export type DeepSweSourceRow = z.infer<typeof sourceRowSchema>;
export type DeepSweSourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type DeepSweEvidenceRecord = z.infer<typeof evidenceRecordSchema>;
export type DeepSweEvidenceSnapshot = z.infer<typeof deepSweEvidenceSnapshotBaseSchema>;

function modelIdTokens(value: string): readonly string[] {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{Letter}\p{Mark}]+|\p{Number}+/gu) ?? [];
}

function modelIdKey(value: string): string {
  const tokens = modelIdTokens(value);
  if (tokens.length === 0) throw new RangeError("A DeepSWE model identity requires name tokens.");
  return JSON.stringify(tokens);
}

type ResolvedEvidenceIdentity = Readonly<{
  identity: DeepSweEvidenceRecord["identity"];
  model: string;
  providerId: ModelReleaseProviderId;
}>;

function openRouterIdentityCandidates(
  sourceModel: string,
  openRouterModels: readonly OpenRouterModel[],
  retrievedAt: string,
): readonly ResolvedEvidenceIdentity[] {
  const sourceKey = modelIdKey(sourceModel);
  return openRouterModels.flatMap(model => {
    const tail = openRouterModelIdTail(model.id);
    const provider = modelReleaseProviderForOpenRouterId(model.id);
    if (tail === null || provider === null || modelIdKey(tail) !== sourceKey) return [];
    const displayName = modelReleaseDisplayName(model.name);
    if (displayName === "") return [];
    return [{
      identity: {
        modelId: model.id,
        resolver: {
          name: "OpenRouter" as const,
          retrievedAt,
          url: MODEL_RELEASE_SOURCE_URL,
        },
        source: "openrouter" as const,
      },
      model: displayName,
      providerId: provider.providerId,
    }];
  });
}

function artificialAnalysisIdentityCandidates(
  sourceModel: string,
  benchmarkSnapshot: CodingAgentSnapshot,
): readonly ResolvedEvidenceIdentity[] {
  const allowedProviderIds = new Set<string>(modelReleaseProviderIds);
  const candidates = new Map<string, ResolvedEvidenceIdentity>();
  for (const record of benchmarkSnapshot.records) {
    if (!allowedProviderIds.has(record.providerId)) continue;
    const providerId = record.providerId as ModelReleaseProviderId;
    let sourceKey: string;
    try {
      sourceKey = modelReleaseSemanticKey(providerId, sourceModel);
    } catch {
      continue;
    }
    if (sourceKey !== modelReleaseSemanticKey(providerId, record.model)) continue;
    candidates.set(JSON.stringify([providerId, record.model]), {
      identity: {
        resolver: {
          name: benchmarkSnapshot.source.name,
          retrievedAt: benchmarkSnapshot.source.retrievedAt,
          url: benchmarkSnapshot.source.url,
        },
        source: "artificial-analysis",
      },
      model: record.model,
      providerId,
    });
  }
  return [...candidates.values()];
}

/** OpenRouter owns model identity when it has one exact canonical match; AAI is the fallback. */
export function resolveDeepSweEvidenceIdentity(
  sourceModel: string,
  openRouterModels: readonly OpenRouterModel[],
  benchmarkSnapshot: CodingAgentSnapshot,
  openRouterRetrievedAt: string,
): ResolvedEvidenceIdentity | null {
  const openRouterCandidates = openRouterIdentityCandidates(
    sourceModel,
    openRouterModels,
    openRouterRetrievedAt,
  );
  if (openRouterCandidates.length > 0) {
    return openRouterCandidates.length === 1 ? openRouterCandidates[0] ?? null : null;
  }
  const benchmarkCandidates = artificialAnalysisIdentityCandidates(sourceModel, benchmarkSnapshot);
  return benchmarkCandidates.length === 1 ? benchmarkCandidates[0] ?? null : null;
}

function checkedOpenRouterIdentity(
  sourceModel: string,
  previous: DeepSweEvidenceSnapshot | null,
): ResolvedEvidenceIdentity | null {
  if (previous === null) return null;
  const candidates = new Map<string, ResolvedEvidenceIdentity>();
  for (const record of previous.records) {
    if (record.sourceModel !== sourceModel || record.identity.source !== "openrouter") continue;
    const candidate = {
      identity: record.identity,
      model: record.model,
      providerId: record.providerId,
    } satisfies ResolvedEvidenceIdentity;
    candidates.set(JSON.stringify([
      record.identity.modelId,
      record.providerId,
      record.model,
    ]), candidate);
  }
  return candidates.size === 1 ? [...candidates.values()][0] ?? null : null;
}

export function deriveDeepSweEvidenceSnapshot(
  source: DeepSweSourceSnapshot,
  openRouterModels: readonly OpenRouterModel[],
  benchmarkSnapshot: CodingAgentSnapshot,
  retrievedAt: string,
  identityRetrievedAt: string | null = openRouterModels.length > 0 ? retrievedAt : null,
  identityAttemptedAt: string = identityRetrievedAt ?? retrievedAt,
  previous: DeepSweEvidenceSnapshot | null = null,
): DeepSweEvidenceSnapshot {
  const identities = new Map<string, ResolvedEvidenceIdentity | null>();
  for (const sourceModel of new Set(source.rows.map(row => row.model))) {
    const checkedIdentity = checkedOpenRouterIdentity(sourceModel, previous);
    const openRouterCandidates = openRouterIdentityCandidates(
      sourceModel,
      openRouterModels,
      identityRetrievedAt ?? identityAttemptedAt,
    );
    if (checkedIdentity !== null && checkedIdentity.identity.source === "openrouter") {
      const checkedModelId = checkedIdentity.identity.modelId;
      const refreshedCheckedIdentity = openRouterCandidates.find(candidate => (
        candidate.identity.source === "openrouter"
        && candidate.identity.modelId === checkedModelId
      ));
      identities.set(sourceModel, refreshedCheckedIdentity ?? checkedIdentity);
      continue;
    }
    if (openRouterCandidates.length > 0) {
      identities.set(
        sourceModel,
        openRouterCandidates.length === 1 ? openRouterCandidates[0] ?? null : null,
      );
      continue;
    }
    const benchmarkCandidates = artificialAnalysisIdentityCandidates(
      sourceModel,
      benchmarkSnapshot,
    );
    identities.set(
      sourceModel,
      benchmarkCandidates.length === 1 ? benchmarkCandidates[0] ?? null : null,
    );
  }

  const records = source.rows.flatMap<DeepSweEvidenceRecord>(row => {
    if (row.harness !== DEEP_SWE_EVIDENCE_HARNESS) return [];
    const resolved = identities.get(row.model) ?? null;
    if (resolved === null) return [];
    return [{
      attempted: row.attempted,
      ci95: { high: row.ciHigh, low: row.ciLow },
      config: row.config,
      harness: DEEP_SWE_EVIDENCE_HARNESS,
      identity: resolved.identity,
      model: resolved.model,
      passAt1: row.passAt1,
      passed: row.passed,
      providerId: resolved.providerId,
      reasoningEffort: row.reasoningEffort,
      runs: row.runs,
      sourceModel: row.model,
    }];
  }).sort(compareEvidenceRecords);

  const matchedModels = new Set(records.map(record => record.sourceModel));
  const unmatchedModels = [...identities.entries()]
    .filter(([sourceModel, identity]) => identity === null || !matchedModels.has(sourceModel))
    .map(([sourceModel]) => sourceModel)
    .sort(compareText);

  return {
    schemaVersion: 1,
    identitySource: {
      attemptedAt: identityAttemptedAt,
      method: "exact-semantic-model-id",
      name: "OpenRouter",
      retrievedAt: identityRetrievedAt,
      status: identityRetrievedAt === null ? "unavailable" : "available",
      url: MODEL_RELEASE_SOURCE_URL,
    },
    source: {
      benchmark: "DeepSWE",
      benchmarkVersion: DEEP_SWE_BENCHMARK_VERSION,
      generatedAt: source.generatedAt,
      latestJob: source.latestJob,
      method: "leaderboard-artifact",
      name: "DataCurve DeepSWE",
      retrievedAt,
      scope: source.scope,
      taskCount: source.taskCount,
      unit: source.unit,
      url: DEEP_SWE_EVIDENCE_SOURCE_URL,
    },
    policy: {
      harness: DEEP_SWE_EVIDENCE_HARNESS,
      identityPriority: ["openrouter", "artificial-analysis"],
      publication: "early-evidence-only",
      score: "pass@1",
    },
    records,
    unmatchedModels,
  };
}

function projectSourceRow(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    attempted: value.n_attempted,
    ciHigh: value.ci_hi,
    ciLow: value.ci_lo,
    config: value.config,
    harness: value.harness,
    model: value.model,
    passed: value.n_passed,
    passAt1: value.pass_at_1,
    passRate: value.pass_rate,
    reasoningEffort: value.reasoning_effort,
    runs: value.n_runs,
    source: value.source,
  };
}

function projectLatestJob(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return { finishedAt: value.finished_at, name: value.name };
}

/** Narrows the live artifact to the measured facts AI Charts owns. */
export function parseDeepSweSourceSnapshot(
  value: unknown,
): Result<DeepSweSourceSnapshot, z.ZodError> {
  const projected = isRecord(value) ? {
    generatedAt: value.generated_at,
    latestJob: projectLatestJob(value.latest_job),
    rows: Array.isArray(value.rows) ? value.rows.map(projectSourceRow) : value.rows,
    scope: value.scope,
    taskCount: value.n_tasks_in_set,
    unit: value.unit,
  } : value;
  return parseResult(sourceSnapshotSchema, projected);
}

export function parseDeepSweEvidenceSnapshot(
  value: unknown,
): Result<DeepSweEvidenceSnapshot, z.ZodError> {
  return parseResult(deepSweEvidenceSnapshotSchema, value);
}

function evidenceConfigurationKey(record: DeepSweEvidenceRecord): string {
  return JSON.stringify([
    record.config,
    record.sourceModel,
    record.harness,
    record.reasoningEffort,
  ]);
}

/** Rejects suspicious upstream loss while allowing reviewed identity promotion. */
export function validateDeepSweEvidenceReplacement(
  previous: DeepSweEvidenceSnapshot,
  candidate: DeepSweEvidenceSnapshot,
): Result<void, Error> {
  if (Date.parse(candidate.source.generatedAt) < Date.parse(previous.source.generatedAt)) {
    return err(new Error(
      `DeepSWE source generation regressed from ${previous.source.generatedAt} to ${candidate.source.generatedAt}.`,
    ));
  }

  const minimumRecordCount = Math.ceil(previous.records.length * .8);
  if (candidate.records.length < minimumRecordCount) {
    return err(new Error(
      `DeepSWE evidence dropped from ${previous.records.length} to ${candidate.records.length} configurations; minimum safe count is ${minimumRecordCount}.`,
    ));
  }

  const previousKeys = new Set(previous.records.map(evidenceConfigurationKey));
  const retainedKeys = candidate.records.filter(record => (
    previousKeys.has(evidenceConfigurationKey(record))
  )).length;
  const minimumStableCount = Math.ceil(previousKeys.size * .8);
  if (retainedKeys < minimumStableCount) {
    return err(new Error(
      `DeepSWE evidence retained ${retainedKeys} of ${previousKeys.size} exact source configurations; minimum safe overlap is ${minimumStableCount}.`,
    ));
  }

  const previousModels = new Set([
    ...previous.records.map(record => record.sourceModel),
    ...previous.unmatchedModels,
  ]);
  const candidateModels = new Set([
    ...candidate.records.map(record => record.sourceModel),
    ...candidate.unmatchedModels,
  ]);
  const minimumModelCount = Math.ceil(previousModels.size * .8);
  if (candidateModels.size < minimumModelCount) {
    return err(new Error(
      `DeepSWE evidence dropped from ${previousModels.size} to ${candidateModels.size} source models; minimum safe count is ${minimumModelCount}.`,
    ));
  }
  return ok(undefined);
}

export function formatDeepSweEvidenceScore(passAt1: number): string {
  return `${(passAt1 * 100).toFixed(1)}%`;
}
