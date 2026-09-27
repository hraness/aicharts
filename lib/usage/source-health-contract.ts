import { privateDaysSnapshot as snapshot } from "./private-days-http-contract";
import { isStatsClient } from "./stats-registry";

/** Hosted `source-health-v1` summary: one selector's latest local collection
 * evidence carried with a publication. Exact integers only; `null` is explicit
 * missingness, never zero. The CLI emitter is
 * `crates/aicharts-cli/src/stats/health.rs` (`SourceHealthSummary`). */
export const SOURCE_HEALTH_PROFILE = "source-health-v1";
export const SOURCE_HEALTH_BYTES = 8_192;
export const SOURCE_HEALTH_MAX_TIME = 8_640_000_000_000_000;
export const SOURCE_HEALTH_MAX_CODES = 16;
const SOURCE_HEALTH_TEXT_BYTES = 128;
export const SOURCE_HEALTH_OUTCOMES = ["complete", "partial", "failed"] as const;
export const SOURCE_HEALTH_CODES = ["source_failed", "projection_refused", "deferred_tail", "checkpoint_replay", "checkpoint_unsupported",
  "checkpoint_capacity", "clamped", "fallback", "estimated", "schema_coverage_limited"] as const;
export const SOURCE_PUBLICATION_OUTCOMES = ["pending", "uncertain", "succeeded", "failed", "abandoned"] as const;
export type SourceHealthOutcome = (typeof SOURCE_HEALTH_OUTCOMES)[number];
export type SourceHealthCode = (typeof SOURCE_HEALTH_CODES)[number];
export type SourcePublicationOutcome = (typeof SOURCE_PUBLICATION_OUTCOMES)[number];
type MetricKind = "count" | "timestamp" | "ratio" | "status" | "work";
/** Every Phase 4 catalog metric, sorted; the wire object carries exactly these keys. */
export const SOURCE_HEALTH_METRIC_KINDS = Object.freeze({
  "acquisition-lag": "count", "collector-qualification-status": "status", "collector-queue-depth": "count",
  "collector-rejection-reason-count": "count", "collector-retry-reason-count": "count", "collector-version-status": "status",
  "data-through-watermark": "timestamp", "deferred-observation-count": "count", "detected-source-count": "count",
  "excluded-observation-count": "count", "incremental-catch-up-lag": "count", "last-collection-attempt": "timestamp",
  "last-collection-success": "timestamp", "local-database-bytes": "count", "local-wal-bytes": "count",
  "measured-denominator-ratio": "ratio", "missing-source-count": "count", "model-attribution-coverage": "ratio",
  "no-change-work": "work", "oldest-sync-backlog-age": "count", "parser-schema-refusal-count": "count",
  "pricing-record-coverage": "ratio", "publication-lag": "count", "scan-bytes": "count", "scan-duration": "count",
  "scan-files": "count", "selected-source-count": "count", "stale-partition-count": "count", "sync-backlog-count": "count",
  "warning-observation-count": "count",
} as const satisfies Readonly<Record<string, MetricKind>>);
export type SourceHealthMetric = keyof typeof SOURCE_HEALTH_METRIC_KINDS;
export const SOURCE_HEALTH_METRICS = Object.freeze(Object.keys(SOURCE_HEALTH_METRIC_KINDS) as SourceHealthMetric[]);
export type SourceHealthWork = Readonly<{ files: number | null; parsedBytes: number | null; reusedFiles: number; verifiedBytes: number }>;
export type SourceHealthRatio = Readonly<{ denominator: number; numerator: number }>;
export type SourceHealthMetricValue = number | string | SourceHealthWork | SourceHealthRatio | null;
export type ImportHealth = Readonly<{
  schemaVersion: 1; outcome: SourceHealthOutcome; parserGeneration: string; qualificationId: "aicharts-adapters-v1";
  files: number | null; logicalBytes: number | null; parsedBytes: number | null; verifiedBytes: number; reusedFiles: number;
  records: number | null; deferredTailFiles: number | null; schemaMismatchRecords: number | null; clampedRecords: number | null;
  fallbackRecords: number | null; estimatedRecords: number | null; eventMinMs: number | null; eventMaxMs: number | null;
  codes: readonly SourceHealthCode[];
}>;
export type SourceObservation = Readonly<{ startedAtMs: number; completedAtMs: number; health: ImportHealth }>;
export type SourcePublication = Readonly<{ observedCompletedAtMs: number; atMs: number; outcome: SourcePublicationOutcome }>;
export type SourceHealthSummary = Readonly<{
  schemaVersion: 1; profile: typeof SOURCE_HEALTH_PROFILE; client: string;
  lastAttempt: SourceObservation | null; lastGood: SourceObservation | null; lastPublication: SourcePublication | null;
  metrics: Readonly<Record<SourceHealthMetric, SourceHealthMetricValue>>;
}>;

const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max && !Object.is(value, -0);
const optional = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number | null => value === null || integer(value, 0, max);
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= SOURCE_HEALTH_TEXT_BYTES
  && /^[\x20-\x7e]+$/u.test(value);

/** Mirrors `ImportHealth::validate` in `crates/aicharts-import/src/observed.rs`. */
export function parseImportHealth(value: unknown): ImportHealth | null {
  const dto = snapshot(value, ["schemaVersion", "outcome", "parserGeneration", "qualificationId", "files", "logicalBytes", "parsedBytes",
    "verifiedBytes", "reusedFiles", "records", "deferredTailFiles", "schemaMismatchRecords", "clampedRecords", "fallbackRecords",
    "estimatedRecords", "eventMinMs", "eventMaxMs", "codes"]);
  if (!dto || dto.schemaVersion !== 1 || !oneOf(SOURCE_HEALTH_OUTCOMES, dto.outcome) || dto.qualificationId !== "aicharts-adapters-v1"
    || typeof dto.parserGeneration !== "string" || !/^aicharts-[1-9][0-9]{0,9}-(?:0|[1-9][0-9]{0,19})$/u.test(dto.parserGeneration)
    || !optional(dto.files) || !optional(dto.logicalBytes) || !optional(dto.parsedBytes) || !integer(dto.verifiedBytes)
    || !integer(dto.reusedFiles) || !optional(dto.records) || !optional(dto.deferredTailFiles) || !optional(dto.schemaMismatchRecords)
    || !optional(dto.clampedRecords) || !optional(dto.fallbackRecords) || !optional(dto.estimatedRecords)
    || !(dto.eventMinMs === null || integer(dto.eventMinMs, -SOURCE_HEALTH_MAX_TIME, SOURCE_HEALTH_MAX_TIME))
    || !(dto.eventMaxMs === null || integer(dto.eventMaxMs, -SOURCE_HEALTH_MAX_TIME, SOURCE_HEALTH_MAX_TIME))
    || !Array.isArray(dto.codes) || dto.codes.length > SOURCE_HEALTH_MAX_CODES || new Set(dto.codes).size !== dto.codes.length
    || !dto.codes.every((code): code is SourceHealthCode => oneOf(SOURCE_HEALTH_CODES, code))) return null;
  const codes = dto.codes, has = (code: SourceHealthCode) => codes.includes(code);
  const positive = (count: number | null) => count !== null && count > 0;
  const complete = dto.outcome === "complete", failed = dto.outcome === "failed";
  if ((dto.files !== null && (dto.reusedFiles > dto.files || (dto.deferredTailFiles !== null && dto.deferredTailFiles > dto.files)))
    || (dto.records !== null && dto.estimatedRecords !== null && dto.estimatedRecords > dto.records)
    || (!failed && (dto.files === null || dto.records === null || dto.logicalBytes === null || dto.deferredTailFiles === null))
    || (complete && dto.deferredTailFiles !== 0) || (dto.outcome === "partial" && !positive(dto.deferredTailFiles))
    || has("deferred_tail") !== positive(dto.deferredTailFiles) || has("clamped") !== positive(dto.clampedRecords)
    || has("fallback") !== positive(dto.fallbackRecords) || has("estimated") !== positive(dto.estimatedRecords)
    || has("schema_coverage_limited") !== (dto.schemaMismatchRecords === null)
    || (has("source_failed") || has("projection_refused")) !== failed) return null;
  if (dto.eventMinMs === null || dto.eventMaxMs === null) {
    if (dto.eventMinMs !== dto.eventMaxMs || !(failed || dto.records === null || dto.records === 0)) return null;
  } else if (dto.eventMinMs > dto.eventMaxMs || dto.records === null || dto.records === 0) return null;
  return Object.freeze({ schemaVersion: 1, outcome: dto.outcome, parserGeneration: dto.parserGeneration, qualificationId: "aicharts-adapters-v1",
    files: dto.files, logicalBytes: dto.logicalBytes, parsedBytes: dto.parsedBytes, verifiedBytes: dto.verifiedBytes, reusedFiles: dto.reusedFiles,
    records: dto.records, deferredTailFiles: dto.deferredTailFiles, schemaMismatchRecords: dto.schemaMismatchRecords,
    clampedRecords: dto.clampedRecords, fallbackRecords: dto.fallbackRecords, estimatedRecords: dto.estimatedRecords,
    eventMinMs: dto.eventMinMs, eventMaxMs: dto.eventMaxMs, codes: Object.freeze([...codes]) });
}
export function parseSourceObservation(value: unknown): SourceObservation | null {
  const dto = snapshot(value, ["startedAtMs", "completedAtMs", "health"]);
  if (!dto || !integer(dto.startedAtMs, 0, SOURCE_HEALTH_MAX_TIME) || !integer(dto.completedAtMs, dto.startedAtMs, SOURCE_HEALTH_MAX_TIME)) return null;
  const health = parseImportHealth(dto.health);
  return health ? Object.freeze({ startedAtMs: dto.startedAtMs, completedAtMs: dto.completedAtMs, health }) : null;
}
export function parseSourcePublication(value: unknown): SourcePublication | null {
  const dto = snapshot(value, ["observedCompletedAtMs", "atMs", "outcome"]);
  return dto && integer(dto.observedCompletedAtMs, 0, SOURCE_HEALTH_MAX_TIME) && integer(dto.atMs, dto.observedCompletedAtMs, SOURCE_HEALTH_MAX_TIME)
    && oneOf(SOURCE_PUBLICATION_OUTCOMES, dto.outcome)
    ? Object.freeze({ observedCompletedAtMs: dto.observedCompletedAtMs, atMs: dto.atMs, outcome: dto.outcome }) : null;
}
function parseMetric(kind: MetricKind, value: unknown): SourceHealthMetricValue | undefined {
  if (value === null) return null;
  switch (kind) {
    case "count": return integer(value) ? value : undefined;
    case "timestamp": return integer(value, -SOURCE_HEALTH_MAX_TIME, SOURCE_HEALTH_MAX_TIME) ? value : undefined;
    case "status": return text(value) ? value : undefined;
    case "ratio": {
      const dto = snapshot(value, ["denominator", "numerator"]);
      return dto && integer(dto.denominator, 1) && integer(dto.numerator) ? Object.freeze({ denominator: dto.denominator, numerator: dto.numerator }) : undefined;
    }
    case "work": {
      const dto = snapshot(value, ["files", "parsedBytes", "reusedFiles", "verifiedBytes"]);
      return dto && optional(dto.files) && optional(dto.parsedBytes) && integer(dto.reusedFiles) && integer(dto.verifiedBytes)
        ? Object.freeze({ files: dto.files, parsedBytes: dto.parsedBytes, reusedFiles: dto.reusedFiles, verifiedBytes: dto.verifiedBytes }) : undefined;
    }
  }
}
/** `client`, when given, must match the summary; a good observation is never a failed one. */
export function parseSourceHealthSummary(value: unknown, client?: string): SourceHealthSummary | null {
  try {
    const dto = snapshot(value, ["schemaVersion", "profile", "client", "lastAttempt", "lastGood", "lastPublication", "metrics"]);
    if (!dto || dto.schemaVersion !== 1 || dto.profile !== SOURCE_HEALTH_PROFILE || !isStatsClient(dto.client)
      || (client !== undefined && dto.client !== client)) return null;
    const lastAttempt = dto.lastAttempt === null ? null : parseSourceObservation(dto.lastAttempt);
    const lastGood = dto.lastGood === null ? null : parseSourceObservation(dto.lastGood);
    const lastPublication = dto.lastPublication === null ? null : parseSourcePublication(dto.lastPublication);
    if (lastAttempt === undefined || lastGood === undefined || lastPublication === undefined || lastGood?.health.outcome === "failed"
      || (dto.lastAttempt !== null && !lastAttempt) || (dto.lastGood !== null && !lastGood) || (dto.lastPublication !== null && !lastPublication)) return null;
    const raw = snapshot(dto.metrics, SOURCE_HEALTH_METRICS);
    if (!raw) return null;
    const metrics: Partial<Record<SourceHealthMetric, SourceHealthMetricValue>> = {};
    for (const id of SOURCE_HEALTH_METRICS) {
      const parsed = parseMetric(SOURCE_HEALTH_METRIC_KINDS[id], raw[id]);
      if (parsed === undefined) return null;
      metrics[id] = parsed;
    }
    const result: SourceHealthSummary = Object.freeze({ schemaVersion: 1, profile: SOURCE_HEALTH_PROFILE, client: dto.client, lastAttempt, lastGood,
      lastPublication, metrics: Object.freeze(metrics as Record<SourceHealthMetric, SourceHealthMetricValue>) });
    return new TextEncoder().encode(JSON.stringify(result)).byteLength <= SOURCE_HEALTH_BYTES ? result : null;
  } catch { return null; }
}
