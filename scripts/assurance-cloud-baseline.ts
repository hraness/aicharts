import { Database, type SQLQueryBindings } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { z } from "zod";
import type { StatsTotals } from "../components/usage/stats-view";
import type { AdmissionBatch } from "../lib/usage/admission";
import type { PrivateDaysRequestV1, PrivateDaysV1 } from "../lib/usage/private-days-contract";
import type { UsageStatsReport } from "../lib/usage/stats-contract";
import type { StatsRange, StatsReceipt, StatsStatus, StatsUpload } from "../lib/usage/stats-http-contract";

export const CLOUD_BASELINE_COMMIT = "a5bec6415ce640a61495db57bc9c2ce83fb83021";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpusUrl = new URL("../fixtures/usage/assurance/cloud/baseline.json", import.meta.url);
const findingIds = ["F02", "F09", "F10", "F11", "F12", "F15", "F16"] as const;
const sourceFiles = [
  "components/usage/stats-report-view.tsx", "components/usage/stats-view.ts", "data/usage-registry.json", "lib/result.ts",
  "lib/usage/admission.ts", "lib/usage/leaderboard-contract.ts", "lib/usage/private-days-contract.ts",
  "lib/usage/private-days-http-contract.ts", "lib/usage/stats-contract.ts", "lib/usage/stats-http-contract.ts",
  "lib/usage/stats-registry.ts", "lib/usage/wire.ts", "services/usage-worker/src/admission-policy.ts",
  "services/usage-worker/src/admission-schema.ts", "services/usage-worker/src/admission-state.ts",
  "services/usage-worker/src/stats-state.ts", "tsconfig.json",
] as const;
type FindingId = typeof findingIds[number];
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Observation = { observed: Json; reference: Json; invariantHolds: boolean };
const identity = z.string().regex(/^[0-9a-f]{64}$/u);
const boundedTime = z.number().int().min(0).max(8_640_000_000_000_000);
const authoritySchema = z.object({
  accountId: z.string().regex(/^acct_[0-9a-f]{32}$/u), generation: identity,
  observedAtMs: boundedTime, phase: z.literal("active"),
  devices: z.array(z.object({
    deviceId: identity, enrolledAtMs: boundedTime, revokedAtMs: boundedTime.nullable(),
    reservation: z.object({ intentId: identity, uploadCommitment: identity }).strict(),
  }).strict()).length(2),
}).strict();
type Authority = z.infer<typeof authoritySchema>;
const corpusSchema = z.object({
  schemaVersion: z.literal(1), baselineCommit: z.literal(CLOUD_BASELINE_COMMIT),
  evidenceDate: z.literal("2026-09-23"), claim: z.string().min(1),
  sourceSha256: z.record(z.enum(sourceFiles), identity),
  inputs: z.object({
    nowMs: boundedTime, authority: authoritySchema,
    legacy: z.object({ deviceIndex: z.literal(1), occurrenceId: z.string().regex(/^[0-9a-f]{32}$/u),
      inputTokens: z.string().regex(/^[0-9]{1,12}$/u), outputTokens: z.string().regex(/^[0-9]{1,12}$/u) }).strict(),
    upload: z.unknown(), metricRow: z.unknown(), capacityCounts: z.tuple([z.literal(99_999), z.literal(100_000), z.literal(100_001)]),
    groundTruth: z.object({
      legacyAndDetailedPopulations: z.literal("disjoint"), legacyOccurrence: z.string().min(1), detailedOccurrence: z.string().min(1),
      reportedCostObservation: z.string().min(1), estimatedCostObservation: z.string().min(1), matchedCostObservations: z.literal(0),
    }).strict(),
  }).strict(),
  findings: z.record(z.enum(findingIds), z.object({
    name: z.string().min(1), evidence: z.string().min(1), failureMeaning: z.string().min(1),
    expected: z.object({ observed: z.json(), reference: z.json(), invariantHolds: z.literal(false) }).strict(),
  }).strict()),
}).strict();
export type CloudBaselineCorpus = z.infer<typeof corpusSchema>;

export async function readCloudBaselineCorpus(): Promise<CloudBaselineCorpus> {
  const bytes = await readFile(corpusUrl);
  if (bytes.length > 64 * 1024) throw new Error("cloud_baseline_corpus_too_large");
  return corpusSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
}

/** A narrow test port keeps Cloudflare ambient runtime types out of the Next
 * typecheck. Runtime constructors below are the fingerprinted production code,
 * not copies of its state-machine implementation. */
type AdmissionPort = {
  initialize(authority: Authority): void;
  reserve(batch: AdmissionBatch, authority: Authority, now: number): unknown;
  freeze(pending: unknown, authority: Authority, now: number): unknown;
  publish(pending: unknown, authority: Authority): Uint8Array;
  readImportedDays(authority: Authority, request: PrivateDaysRequestV1): PrivateDaysV1;
};
type StatsPort = {
  initialize(): void;
  status(authority: Authority, device: string, client: string, range: StatsRange): StatsStatus;
  reserve(request: StatsUpload, authority: Authority, now: number): void;
  freeze(request: StatsUpload, authority: Authority, now: number): StatsReceipt;
  publish(request: StatsUpload, authority: Authority): StatsReceipt;
  read(authority: Authority, range: StatsRange, now: number): UsageStatsReport;
  leaderboard(authority: Authority, range: StatsRange, now: number): { observedTokens: string; usageRecords: number };
  revokeDevice(device: string): void;
  writer(client: string): string | null;
  check(request: StatsUpload, authority: Authority): void;
  control(): { revision: number; immutableBytes: number };
  progress(device: string): { sequence: number };
  pending(): { bodyHash: string } | null;
  supersedePending(device: string): void;
};
class SyntheticSql {
  readonly db = new Database(":memory:", { strict: true });
  readonly statements: string[] = [];
  exec(query: string, ...bindings: SQLQueryBindings[]) {
    this.statements.push(query);
    const rows = this.db.query<Record<string, unknown>, SQLQueryBindings[]>(query).all(...bindings.map(value =>
      value instanceof ArrayBuffer ? new Uint8Array(value) : value)).map(row => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? value.slice().buffer : value])));
    // Workerd returns ArrayBuffer blobs. Bun SQLite returns Uint8Array blobs.
    return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
  }
  writes(): string[] {
    return this.statements.filter(query => !/^\s*(SELECT|EXPLAIN|PRAGMA)\b/iu.test(query)).map(query => {
      const match = /^(INSERT INTO|DELETE FROM|UPDATE) (\w+)/u.exec(query);
      if (!match) throw new Error("unexpected_synthetic_mutation_shape");
      return `${match[1].split(" ")[0]} ${match[2]}`;
    });
  }
}
type Modules = {
  admission: { AdmissionState: new (sql: SyntheticSql) => AdmissionPort; admissionIdBytes(hex: string): Uint8Array };
  stats: { StatsState: new (sql: SyntheticSql) => StatsPort; statsHash(value: string): string; statsUploadText(value: StatsUpload): string };
  policy: typeof import("../services/usage-worker/src/admission-policy");
  wire: typeof import("../lib/usage/wire");
  codec: typeof import("../lib/usage/admission");
  statsHttp: typeof import("../lib/usage/stats-http-contract");
  privateDays: typeof import("../lib/usage/private-days-contract");
  statsContract: typeof import("../lib/usage/stats-contract");
  view: typeof import("../components/usage/stats-view");
};
async function loadModules(root: string): Promise<Modules> {
  // Import URL resolution is relative to the selected checkout, never cwd or
  // an audit workstation path. Source fingerprints are checked before import.
  const load = <T>(path: string): Promise<T> => import(pathToFileURL(resolve(root, path)).href) as Promise<T>;
  const [admission, stats, policy, wire, codec, statsHttp, privateDays, statsContract, view] = await Promise.all([
    load<Modules["admission"]>("services/usage-worker/src/admission-state.ts"),
    load<Modules["stats"]>("services/usage-worker/src/stats-state.ts"),
    load<Modules["policy"]>("services/usage-worker/src/admission-policy.ts"),
    load<Modules["wire"]>("lib/usage/wire.ts"), load<Modules["codec"]>("lib/usage/admission.ts"),
    load<Modules["statsHttp"]>("lib/usage/stats-http-contract.ts"),
    load<Modules["privateDays"]>("lib/usage/private-days-contract.ts"),
    load<Modules["statsContract"]>("lib/usage/stats-contract.ts"), load<Modules["view"]>("components/usage/stats-view.ts"),
  ]);
  return { admission, stats, policy, wire, codec, statsHttp, privateDays, statsContract, view };
}
function requireValue<T>(value: T | null): T {
  if (value === null) throw new Error("synthetic_fixture_rejected_by_production_parser");
  return value;
}
function requireResult<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`synthetic_fixture_codec_rejected:${String(result.error)}`);
  return result.value;
}
const hex = (value: number) => value.toString(16).padStart(64, "0");
const totalReport = (report: UsageStatsReport) => ({
  records: report.rows.reduce((sum, row) => sum + row.records, 0),
  tokens: report.rows.reduce((sum, row) => sum + Object.values(row.tokens).reduce((n, value) => n + BigInt(value), 0n), 0n),
});
type Context = { sql: SyntheticSql; authority: Authority; admission: AdmissionPort; stats: StatsPort; request: StatsUpload };
function inDatabase<T>(modules: Modules, corpus: CloudBaselineCorpus, run: (context: Context) => T): T {
  const sql = new SyntheticSql();
  try {
    const authority = structuredClone(corpus.inputs.authority), admission = new modules.admission.AdmissionState(sql), stats = new modules.stats.StatsState(sql);
    admission.initialize(authority); stats.initialize();
    return run({ sql, authority, admission, stats, request: requireValue(modules.statsHttp.parseStatsUpload(corpus.inputs.upload)) });
  } finally { sql.db.close(); }
}
function publish(context: Context, now: number): void {
  context.stats.reserve(context.request, context.authority, now);
  context.stats.freeze(context.request, context.authority, now);
  context.stats.publish(context.request, context.authority);
}
function seedLegacy(modules: Modules, corpus: CloudBaselineCorpus, context: Context): void {
  const { authority, admission, request } = context, fixture = corpus.inputs.legacy, policy = modules.policy.ADMISSION_POLICY_V1;
  const occurrence = modules.admission.admissionIdBytes(fixture.occurrenceId);
  const frame = requireResult(modules.wire.encodeUsageBatch({
    utcDay: request.report.firstUtcDay, registryRevision: 1,
    usage: [{ id: occurrence, executionId: new Uint8Array(16), accountId: new Uint8Array(16), offsetMs: 1,
      provider: 2, authMode: 0, evidence: 1, modelId: 0, contextTier: 0,
      tokens: { inputUncached: BigInt(fixture.inputTokens), cacheRead: 0n, cacheWrite5m: 0n, cacheWrite1h: 0n,
        output: BigInt(fixture.outputTokens), reasoningOutput: 0n } }], prompts: [], intervals: [],
  }, policy));
  const operation = requireResult(modules.codec.encodeAdmissionOperation({
    accountId: modules.admission.admissionIdBytes(authority.accountId.slice(5)),
    deviceId: modules.admission.admissionIdBytes(authority.devices[fixture.deviceIndex].deviceId),
    generation: modules.admission.admissionIdBytes(authority.generation), action: 1, sequence: 1,
    occurrenceId: occurrence, expectedHeadHash: new Uint8Array(32), frame,
  }, policy));
  const batch = requireResult(modules.codec.decodeAdmissionBatch(requireResult(modules.codec.encodeAdmissionBatch([operation], policy)), policy));
  admission.publish(admission.freeze(admission.reserve(batch, authority, corpus.inputs.nowMs), authority, corpus.inputs.nowMs), authority);
}
function probeOwnership(modules: Modules, corpus: CloudBaselineCorpus): Observation {
  return inDatabase(modules, corpus, context => {
    seedLegacy(modules, corpus, context);
    const { authority, stats, request, admission } = context, now = corpus.inputs.nowMs;
    const query: PrivateDaysRequestV1 = { schemaVersion: 1, accountId: authority.accountId,
      sessionExpiresAtMs: now + 10_000, firstUtcDay: request.report.firstUtcDay, dayCount: 1 };
    const legacy = admission.readImportedDays(authority, query).days[0].claudeCode;
    const status = stats.status(authority, request.deviceId, "claude", request.report);
    const detailed = totalReport(request.report);
    publish(context, now);
    const hosted = totalReport(stats.read(authority, request.report, now));
    const retained = admission.readImportedDays(authority, query).days[0].claudeCode;
    const disjointRecords = detailed.records + legacy.usageOccurrences;
    const disjointTokens = detailed.tokens + BigInt(legacy.observedAccountedTokens);
    return { observed: { legacyRecordsConsideredByTakeover: status.legacyRecords, takeoverEligible: status.takeoverEligible,
      hostedRecords: hosted.records, hostedTokens: hosted.tokens.toString(), retainedLegacyRecords: retained.usageOccurrences,
      retainedLegacyTokens: retained.observedAccountedTokens },
    reference: { disjointRecords, disjointTokens: disjointTokens.toString() },
    invariantHolds: hosted.records === disjointRecords && hosted.tokens === disjointTokens };
  });
}
function probeRevocation(modules: Modules, corpus: CloudBaselineCorpus): Observation {
  return inDatabase(modules, corpus, context => {
    publish(context, corpus.inputs.nowMs);
    const { authority, stats, request } = context;
    authority.devices[0].revokedAtMs = corpus.inputs.nowMs;
    stats.revokeDevice(request.deviceId);
    const replacement = requireValue(modules.statsHttp.parseStatsUpload({ ...request, operationId: hex(31),
      deviceId: authority.devices[1].deviceId, expectedRevision: 1 }));
    let replacementError: string | null = null;
    try { stats.check(replacement, authority); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "string") throw error;
      replacementError = error.code;
    }
    const retained = totalReport(stats.read(authority, request.report, corpus.inputs.nowMs));
    const writerStillRevokedDevice = stats.writer("claude") === request.deviceId;
    return { observed: { writerStillRevokedDevice, replacementError, retainedRecords: retained.records, retainedTokens: retained.tokens.toString() },
      reference: { requiredCapability: "account-authorized ownership transfer preserving history and fencing old work" },
      invariantHolds: !(writerStillRevokedDevice && replacementError === "writer_conflict") };
  });
}
function probeCapacity(modules: Modules, corpus: CloudBaselineCorpus): Observation {
  const now = corpus.inputs.nowMs, day = Math.floor(now / 86_400_000), journalRevision = 400;
  const query = { schemaVersion: 1, accountId: corpus.inputs.authority.accountId, sessionExpiresAtMs: now + 10_000,
    firstUtcDay: day - 1, dayCount: 2 };
  const totals = (count: number) => ({ usageOccurrences: count, observedAccountedTokens: String(count), observedOutputTokens: "0" });
  const values = corpus.inputs.capacityCounts.map(count => ({ schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial",
    journalRevision, journalCommittedAtMs: now, firstUtcDay: day - 1, days: [
      { utcDay: day - 1, codex: totals(50_000), claudeCode: totals(0), devin: totals(0) },
      { utcDay: day, codex: totals(count - 50_000), claudeCode: totals(0), devin: totals(0) },
    ] }));
  const samples = corpus.inputs.capacityCounts.map((records, index) => ({ records,
    privateDaysAccepted: modules.privateDays.parsePrivateDaysValue(query, values[index]) !== null,
    statsStatusAccepted: modules.statsHttp.parseStatsStatus({ schemaVersion: 2, revision: 0, nextSequence: 1, writerDeviceId: null,
      v1Revision: journalRevision, headDigest: hex(0), legacyRecords: records, takeoverEligible: true }) !== null,
  }));
  const largestPrivateDaysBytes = Math.max(...values.map(value => new TextEncoder().encode(JSON.stringify(value)).length));
  const withinBounds = corpus.inputs.capacityCounts.every(count => count <= modules.policy.MAX_ADMISSION_HEADS
    && count <= journalRevision * 256 && 50_000 <= modules.privateDays.PRIVATE_DAYS_MAX_DAY_HEADS
    && count - 50_000 <= modules.privateDays.PRIVATE_DAYS_MAX_DAY_HEADS)
    && largestPrivateDaysBytes <= modules.privateDays.PRIVATE_DAYS_MAX_RESPONSE_BYTES;
  if (!withinBounds) throw new Error("capacity_probe_exceeded_independent_bound");
  return { observed: { storageHeadCap: modules.policy.MAX_ADMISSION_HEADS, privateDayPerDayCap: modules.privateDays.PRIVATE_DAYS_MAX_DAY_HEADS,
    samples, largestPrivateDaysBytes }, reference: { allSamplesWithinStorageDayJournalAndByteLimits: withinBounds,
    compatibleRepresentationsAcceptAllSamples: true }, invariantHolds: samples.every(sample => sample.privateDaysAccepted && sample.statsStatusAccepted) };
}
function probeSupersession(modules: Modules, corpus: CloudBaselineCorpus): Observation {
  return inDatabase(modules, corpus, context => {
    publish(context, corpus.inputs.nowMs);
    const { authority, stats, request } = context, now = corpus.inputs.nowMs;
    const pendingA = requireValue(modules.statsHttp.parseStatsUpload({ ...request, operationId: hex(40), sequence: 2, expectedRevision: 1 }));
    const pendingB = requireValue(modules.statsHttp.parseStatsUpload({ ...request, operationId: hex(41), sequence: 2, expectedRevision: 1 }));
    const before = stats.control().immutableBytes;
    stats.reserve(pendingA, authority, now);
    const singleReservationCharge = stats.control().immutableBytes - before;
    stats.supersedePending(request.deviceId); stats.reserve(pendingB, authority, now);
    stats.supersedePending(request.deviceId); stats.reserve(pendingA, authority, now);
    const earlierAReinstalled = stats.pending()?.bodyHash === modules.stats.statsHash(modules.stats.statsUploadText(pendingA));
    const chargeAfterABA = stats.control().immutableBytes - before;
    return { observed: { earlierAReinstalled, singleReservationCharge, chargeAfterABA,
      revision: stats.control().revision, publishedSequence: stats.progress(request.deviceId).sequence },
    reference: { terminallySupersededACannotReturn: true, maximumChargeForTwoDistinctIntents: singleReservationCharge * 2 },
    invariantHolds: !earlierAReinstalled && chargeAfterABA <= singleReservationCharge * 2 };
  });
}
function probeReadWrites(modules: Modules, corpus: CloudBaselineCorpus): Observation {
  return inDatabase(modules, corpus, context => {
    publish(context, corpus.inputs.nowMs);
    const { sql, authority, stats, request } = context;
    const removeDerived = () => { sql.exec("DELETE FROM usage_stats_day_rows"); sql.exec("DELETE FROM usage_stats_day_meta"); sql.statements.length = 0; };
    removeDerived();
    const privateResult = totalReport(stats.read(authority, request.report, corpus.inputs.nowMs)), privateReadWrites = sql.writes();
    sql.statements.length = 0;
    stats.read(authority, request.report, corpus.inputs.nowMs);
    const warmPrivateReadWrites = sql.writes();
    removeDerived();
    const leaderboardResult = stats.leaderboard(authority, request.report, corpus.inputs.nowMs), leaderboardReadWrites = sql.writes();
    return { observed: { privateReadWrites, leaderboardReadWrites, warmPrivateReadWrites,
      privateResultTokens: privateResult.tokens.toString(), leaderboardResultTokens: leaderboardResult.observedTokens },
    reference: { persistentWritesAllowedDuringRead: 0 },
    invariantHolds: privateReadWrites.length + leaderboardReadWrites.length + warmPrivateReadWrites.length === 0 };
  });
}
function dashboardFormulas(source: string, ratio: Modules["view"]["statsRatio"]) {
  const parsed = ts.createSourceFile("stats-report-view.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const components = parsed.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "StatsReportView");
  if (components.length !== 1 || !components[0].body) throw new Error("baseline_formula_component_not_unique");
  const initializer = (name: string) => {
    const declarations = components[0].body!.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
      .filter(node => ts.isIdentifier(node.name) && node.name.text === name);
    if (declarations.length !== 1 || !declarations[0].initializer) throw new Error(`baseline_formula_missing:${name}`);
    return declarations[0].initializer.getText(parsed);
  };
  // Execute only the exact three initializers in the fingerprinted repository
  // source. This is formula-source evidence, not a rendered UI or browser test.
  const evaluate = new Function("totals", "statsRatio", `const inputSide = ${initializer("inputSide")};
    return { cacheShare: (${initializer("cacheShare")}), costDelta: (${initializer("costDelta")}) };`) as
    (totals: StatsTotals, ratio: Modules["view"]["statsRatio"]) => unknown;
  return (totals: StatsTotals) => z.object({ cacheShare: z.number().finite().nullable(), costDelta: z.bigint().nullable() }).strict().parse(evaluate(totals, ratio));
}
function probeMetrics(modules: Modules, corpus: CloudBaselineCorpus, source: string): Record<"F15" | "F16", Observation> {
  const row = requireValue(modules.statsContract.parseUsageStatsRow(corpus.inputs.metricRow)), totals = modules.view.sumStatsRows([row]);
  const formulas = dashboardFormulas(source, modules.view.statsRatio), observed = formulas(totals);
  const wholeInput = totals.input + totals.cacheRead + totals.cacheWrite;
  const referenceShare = wholeInput === 0n ? null : Number(totals.cacheRead * 10_000n / wholeInput) / 100;
  const zero = formulas(modules.view.sumStatsRows([]));
  const withoutWrites = requireValue(modules.statsContract.parseUsageStatsRow({ ...row, tokens: { ...row.tokens, input: "900", cacheWrite: "0" } }));
  const noEstimate = formulas(modules.view.sumStatsRows([requireValue(modules.statsContract.parseUsageStatsRow({ ...row,
    estimatedCostMicrousd: null, estimatedCostRecords: 0 }))]));
  return {
    F15: { observed: { rowAccepted: true, displayedCacheSharePercent: observed.cacheShare, zeroInputControl: zero.cacheShare,
      withoutCacheWritesControl: formulas(modules.view.sumStatsRows([withoutWrites])).cacheShare },
    reference: { wholeInputTokens: wholeInput.toString(), cacheSharePercent: referenceShare }, invariantHolds: observed.cacheShare === referenceShare },
    F16: { observed: { rowAccepted: true, reportedCostRecords: totals.reportedCostRecords, estimatedCostRecords: totals.estimatedCostRecords,
      displayedDifferenceMicrousd: observed.costDelta?.toString() ?? null, missingEstimateControl: noEstimate.costDelta?.toString() ?? null },
    reference: { matchedCostObservations: corpus.inputs.groundTruth.matchedCostObservations, comparableDifferenceMicrousd: null },
    invariantHolds: observed.costDelta === null },
  };
}
export type CloudBaselineResult = {
  baselineCommit: string; pinnedSourceFiles: number; sourceSetSha256: string; bunVersion: string; sqliteVersion: string; typescriptVersion: string;
  expectedCounterexamplesMatched: boolean; productionInvariantStatus: "known-failures" | "no-failure-observed-not-qualified";
  findings: { id: FindingId; name: string; evidence: string; failureMeaning: string; baselineMatched: boolean; actual: Observation; expected: Observation }[];
};
export async function runCloudBaseline(options: { sourceRoot?: string; sourceBundle?: string; corpus?: unknown } = {}): Promise<CloudBaselineResult> {
  const corpus = options.corpus === undefined ? await readCloudBaselineCorpus() : corpusSchema.parse(options.corpus);
  if (options.sourceRoot !== undefined && options.sourceBundle !== undefined) throw new Error("select_one_baseline_source");
  const selected = resolve(options.sourceBundle ?? options.sourceRoot ?? repoRoot);
  const sources = await Promise.all(sourceFiles.map(async path => {
    const input = resolve(selected, `${path}${options.sourceBundle === undefined ? "" : ".source"}`);
    const info = await stat(input);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error(`baseline_source_size_invalid:${path}`);
    const bytes = await readFile(input);
    if (createHash("sha256").update(bytes).digest("hex") !== corpus.sourceSha256[path]) throw new Error(`baseline_source_fingerprint_mismatch:${path}`);
    return [path, bytes] as const;
  }));
  if (options.sourceBundle === undefined) return runQualifiedBaseline(selected, corpus, sources);
  // Keep historical .ts files outside ordinary application source discovery.
  // Only these already-verified owned paths are materialized; no archive or
  // caller-provided pathname can escape this newly created scratch directory.
  const scratch = await mkdtemp(join(tmpdir(), "aicharts-cloud-baseline-"));
  try {
    for (const [path, bytes] of sources) {
      const output = resolve(scratch, path);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, bytes, { flag: "wx" });
    }
    return await runQualifiedBaseline(scratch, corpus, sources);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
async function runQualifiedBaseline(root: string, corpus: CloudBaselineCorpus, sources: readonly (readonly [string, Buffer])[]): Promise<CloudBaselineResult> {
  if (corpus.inputs.groundTruth.legacyOccurrence === corpus.inputs.groundTruth.detailedOccurrence
    || corpus.inputs.groundTruth.reportedCostObservation === corpus.inputs.groundTruth.estimatedCostObservation) throw new Error("synthetic_populations_not_disjoint");
  const modules = await loadModules(root), uiSource = new Map(sources).get("components/usage/stats-report-view.tsx")!.toString("utf8");
  const observations: Record<FindingId, Observation> = {
    F02: probeOwnership(modules, corpus), F09: probeRevocation(modules, corpus), F10: probeCapacity(modules, corpus),
    F11: probeSupersession(modules, corpus), F12: probeReadWrites(modules, corpus), ...probeMetrics(modules, corpus, uiSource),
  };
  const findings = findingIds.map(id => ({ id, name: corpus.findings[id].name, evidence: corpus.findings[id].evidence,
    failureMeaning: corpus.findings[id].failureMeaning, baselineMatched: isDeepStrictEqual(observations[id], corpus.findings[id].expected),
    actual: observations[id], expected: corpus.findings[id].expected }));
  const db = new Database(":memory:");
  let sqliteVersion: string;
  try { sqliteVersion = z.object({ version: z.string() }).parse(db.query("SELECT sqlite_version() AS version").get()).version; }
  finally { db.close(); }
  const sourceSetSha256 = createHash("sha256").update(sourceFiles.map(path => `${path}\t${corpus.sourceSha256[path]}\n`).join("")).digest("hex");
  return { baselineCommit: corpus.baselineCommit, pinnedSourceFiles: sourceFiles.length, sourceSetSha256, bunVersion: Bun.version, sqliteVersion,
    typescriptVersion: ts.version, expectedCounterexamplesMatched: findings.every(finding => finding.baselineMatched),
    productionInvariantStatus: findings.some(finding => !finding.actual.invariantHolds) ? "known-failures" : "no-failure-observed-not-qualified", findings };
}
async function main(): Promise<void> {
  let sourceRoot: string | undefined, sourceBundle: string | undefined, requireInvariants = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--require-invariants" && !requireInvariants) requireInvariants = true;
    else if (arg === "--source-root" && sourceRoot === undefined && args[index + 1] && !args[index + 1].startsWith("--")) sourceRoot = args[++index];
    else if (arg === "--source-bundle" && sourceBundle === undefined && args[index + 1] && !args[index + 1].startsWith("--")) sourceBundle = args[++index];
    else throw new Error("usage: bun scripts/assurance-cloud-baseline.ts [--source-root <governed-checkout> | --source-bundle <suffixed-source-directory>] [--require-invariants]");
  }
  const result = await runCloudBaseline({ sourceRoot, sourceBundle });
  console.log(JSON.stringify({ type: "baseline-attribution", baselineCommit: result.baselineCommit, pinnedSourceFiles: result.pinnedSourceFiles,
    sourceSetSha256: result.sourceSetSha256,
    sourceScope: "fingerprinted execution dependencies and formula source; not whole-checkout identity", bunVersion: result.bunVersion,
    sqliteVersion: result.sqliteVersion, typescriptVersion: result.typescriptVersion }));
  for (const finding of result.findings) console.log(JSON.stringify({ type: "expected-counterexample", ...finding }));
  console.log(JSON.stringify({ type: "baseline-summary", expectedCounterexamplesMatched: result.expectedCounterexamplesMatched,
    matched: result.findings.filter(finding => finding.baselineMatched).length, total: result.findings.length,
    productionInvariantStatus: result.productionInvariantStatus,
    claim: "Exit 0 in baseline mode means known failures reproduced. No production, workerd, auth, network or browser qualification.",
    mode: requireInvariants ? "require-invariants" : "expect-historical-counterexamples" }));
  process.exitCode = !result.expectedCounterexamplesMatched || (requireInvariants && result.productionInvariantStatus === "known-failures") ? 1 : 0;
}
if (import.meta.main) await main().catch(error => {
  console.error(JSON.stringify({ type: "baseline-error", message: error instanceof Error ? error.message : "unknown_error" }));
  process.exitCode = 1;
});
