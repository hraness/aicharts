import { createHash } from "node:crypto";
import { parseUsageStatsRow, statsInteger, statsOwnRecord, type UsageStatsRow } from "./stats-contract";
import { isStatsClient } from "./stats-registry";
import { contributionAccount, contributionHex, contributionIdentity, CONTRIBUTION_MAX_OPERATIONS, isContributionError,
  type ContributionError, type ContributionResult } from "./contribution-contract";
export { contributionAccount, contributionHex, contributionIdentity, CONTRIBUTION_MAX_OPERATIONS, CONTRIBUTION_ERRORS,
  isContributionError, type ContributionError, type ContributionResult } from "./contribution-contract";

export const CONTRIBUTION_PROFILE = "canonical-contributions-v3" as const;
export const CONTRIBUTION_IDENTITY = "aicharts-occurrence-v1" as const;
export const CONTRIBUTION_MAX_MUTATIONS = 256;
export const CONTRIBUTION_MAX_MEMBERS = 8_192;
export const CONTRIBUTION_MAX_BYTES = 1_048_576;
export const CONTRIBUTION_MAX_HEADS = 262_144;
export const CONTRIBUTION_MAX_ASSOCIATIONS = 1_048_576;
export const CONTRIBUTION_MAX_POPULATIONS = 1_024;
export const CONTRIBUTION_MAX_IMMUTABLE_BYTES = 8_589_934_592;
export const CONTRIBUTION_MAX_TIME = 8_640_000_000_000_000;
export const CONTRIBUTION_ZERO_HASH = "0".repeat(64);
export const contributionHash = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export class ContributionFault extends Error {
  constructor(readonly code: ContributionError) { super(code); }
}
export type ContributionMutation = Readonly<{ kind: "put"; id: string; expectedHeadHash: string | null; row: UsageStatsRow }>
  | Readonly<{ kind: "remove"; id: string; expectedHeadHash: string }>
  | Readonly<{ kind: "tombstone"; id: string; expectedHeadHash: string }>;
export type ContributionBatch = Readonly<{
  schemaVersion: 3; profile: typeof CONTRIBUTION_PROFILE; identityScheme: typeof CONTRIBUTION_IDENTITY; grain: "observation";
  accountId: string; generation: string; deviceId: string; operationId: string; sequence: number;
  expectedRevision: number; populationId: string; writerRevision: number; expectedPopulationRevision: number;
  expectedPopulationHead: string;
  replacement: Readonly<{ members: readonly string[] }> | null;
  mutations: readonly ContributionMutation[];
}>;
/** This authority is created by the account owner after authentication and a
 * fresh restore-fence check. It is not a client-supplied wire object. A retained
 * execution registration must cover every awaited body/projection continuation. */
export type ContributionAuthority = Readonly<{
  accountId: string; generation: string; deviceId: string; active: boolean; observedAtMs: number;
  allowAccountTombstone: boolean;
}>;
export type ContributionReference = Readonly<{ kind: "batch-v3"; bodyHash: string; index: number; payloadHash: string }>
  | Readonly<{ kind: "admission-v1"; generation: string; bodyHash: string; index: number; payloadHash: string; operationHash: string }>;
export type ContributionHead = Readonly<{
  id: string; headHash: string; payloadHash: string | null; reference: ContributionReference | null;
  members: number; deleted: boolean; legacySupport: boolean; suppressedLegacy: boolean;
}>;
export type ContributionPopulation = Readonly<{
  id: string; generation: string; deviceId: string; writerRevision: number; revision: number; headHash: string; memberCount: number;
}>;
export type ContributionMembership = Readonly<{ id: string; headHash: string }>;
export type ContributionDelta = Readonly<{ id: string; before: ContributionReference | null; after: ContributionReference | null }>;
export function parseContributionReference(value: unknown): ContributionReference | null {
  try {
    const v3 = statsOwnRecord(value, ["kind", "bodyHash", "index", "payloadHash"]);
    if (v3?.kind === "batch-v3" && contributionIdentity(v3.bodyHash) && statsInteger(v3.index, 0, 255) && contributionIdentity(v3.payloadHash))
      return Object.freeze({ kind: "batch-v3", bodyHash: v3.bodyHash, index: v3.index, payloadHash: v3.payloadHash });
    const v1 = statsOwnRecord(value, ["kind", "generation", "bodyHash", "index", "payloadHash", "operationHash"]);
    return v1?.kind === "admission-v1" && contributionIdentity(v1.generation) && contributionIdentity(v1.bodyHash)
      && statsInteger(v1.index, 0, 255) && contributionIdentity(v1.payloadHash) && contributionIdentity(v1.operationHash)
      ? Object.freeze({ kind: "admission-v1", generation: v1.generation, bodyHash: v1.bodyHash, index: v1.index,
        payloadHash: v1.payloadHash, operationHash: v1.operationHash }) : null;
  } catch { return null; }
}
export function parseContributionDelta(value: unknown): ContributionDelta | null {
  try {
    const raw = statsOwnRecord(value, ["id", "before", "after"]);
    if (!raw || !contributionIdentity(raw.id, 32)) return null;
    const before = raw.before === null ? null : parseContributionReference(raw.before), after = raw.after === null ? null : parseContributionReference(raw.after);
    return (raw.before === null || before) && (raw.after === null || after) && (before !== null || after !== null)
      && JSON.stringify(before) !== JSON.stringify(after) ? Object.freeze({ id: raw.id, before, after }) : null;
  } catch { return null; }
}
export type ContributionControl = Readonly<{
  accountId: string; generation: string; revision: number; updatedAtMs: number;
  headCount: number; membershipCount: number; populationCount: number; operationCount: number; immutableBytes: number;
  phase: "prepared" | "active"; activationOperationId: string | null; activationHash: string | null; migrationManifestHash: string | null;
  legacySeal: ContributionLegacySeal | null;
}>;
/** Compact binding to immutable migration evidence. Detailed source metadata,
 * numeric conservation vectors and page inventories live in the manifest. */
export type ContributionLegacySeal = Readonly<{
  schemaVersion: 3; accountSchemaVersion: 9; accountId: string; generation: string;
  v1Revision: number; v1HeadCount: number; v1LiveCount: number; suppressedV1Heads: number;
  v1HeadDigest: string; v1JournalDigest: string; v1SourceDigest: string;
  v2Revision: number; v2DayCount: number; v2BodyCount: number; v2SourceDigest: string;
  conservationDigest: string; immutableBytes: number; metadataBytes: number;
}>;
export function parseContributionLegacySeal(value: unknown): ContributionLegacySeal | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountSchemaVersion", "accountId", "generation", "v1Revision", "v1HeadCount", "v1LiveCount",
      "suppressedV1Heads", "v1HeadDigest", "v1JournalDigest", "v1SourceDigest", "v2Revision", "v2DayCount", "v2BodyCount", "v2SourceDigest",
      "conservationDigest", "immutableBytes", "metadataBytes"]);
    if (raw?.schemaVersion !== 3 || raw.accountSchemaVersion !== 9 || !contributionAccount(raw.accountId) || !contributionIdentity(raw.generation)
      || !statsInteger(raw.v1Revision, 0, 4_096) || !statsInteger(raw.v1HeadCount, 0, CONTRIBUTION_MAX_HEADS)
      || !statsInteger(raw.v1LiveCount, 0, raw.v1HeadCount) || !statsInteger(raw.suppressedV1Heads, 0, raw.v1LiveCount)
      || !statsInteger(raw.v2Revision, 0, CONTRIBUTION_MAX_OPERATIONS) || !statsInteger(raw.v2DayCount, 0, 65_536)
      || !statsInteger(raw.v2BodyCount, 0, 65_536) || !statsInteger(raw.immutableBytes, 0, CONTRIBUTION_MAX_IMMUTABLE_BYTES)
      || !statsInteger(raw.metadataBytes, 0, 536_870_912)
      || [raw.v1HeadDigest, raw.v1JournalDigest, raw.v1SourceDigest, raw.v2SourceDigest, raw.conservationDigest].some(value => !contributionIdentity(value))) return null;
    return Object.freeze({ ...raw }) as ContributionLegacySeal;
  } catch { return null; }
}
export type ContributionReceipt = Readonly<{
  schemaVersion: 3; operationId: string; bodyHash: string; accountId: string; generation: string; deviceId: string;
  sequence: number; revision: number; populationId: string; populationRevision: number; populationHead: string;
  committedAtMs: number;
}>;
export type ContributionTerminal = Readonly<{ outcome: "committed"; receipt: ContributionReceipt }>
  | Readonly<{ outcome: "abandoned"; operationId: string; bodyHash: string; revision: number }>;
export type ContributionGrant = Readonly<{
  schemaVersion: 3; operationId: string; accountId: string; generation: string; deviceId: string; populationId: string;
  expectedRevision: number; expectedWriterRevision: number; previousDeviceId: string | null; abandonOperationId: string | null;
}>;
export type ContributionActivationRequest = Readonly<{
  schemaVersion: 3; operationId: string; accountId: string; generation: string; deviceId: string; expectedRevision: number; mode: "fresh-empty";
}>;
export type ContributionActivationReceipt = ContributionActivationRequest & Readonly<{ bodyHash: string; revision: number }>;
export type ContributionMigrationRequest = Readonly<{
  schemaVersion: 3; operationId: string; accountId: string; generation: string; deviceId: string; expectedRevision: number;
  expectedV1Revision: number; expectedV2Revision: number;
}>;
export type ContributionMigrationReceipt = ContributionMigrationRequest & Readonly<{
  bodyHash: string; revision: number; manifestHash: string; deltaManifestHash: string; deltaCount: number;
  headCount: number; suppressedV1Heads: number; unresolvedV2Bodies: number;
}>;
export function parseContributionMigrationRequest(value: unknown): ContributionMigrationRequest | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "operationId", "accountId", "generation", "deviceId", "expectedRevision", "expectedV1Revision", "expectedV2Revision"]);
    return raw?.schemaVersion === 3 && contributionIdentity(raw.operationId) && contributionAccount(raw.accountId)
      && contributionIdentity(raw.generation) && contributionIdentity(raw.deviceId) && statsInteger(raw.expectedRevision, 0, CONTRIBUTION_MAX_OPERATIONS - 1)
      && statsInteger(raw.expectedV1Revision, 0, 4_096) && statsInteger(raw.expectedV2Revision, 0, CONTRIBUTION_MAX_OPERATIONS)
      ? Object.freeze({ schemaVersion: 3, operationId: raw.operationId, accountId: raw.accountId, generation: raw.generation,
        deviceId: raw.deviceId, expectedRevision: raw.expectedRevision, expectedV1Revision: raw.expectedV1Revision, expectedV2Revision: raw.expectedV2Revision }) : null;
  } catch { return null; }
}
export function parseContributionMigrationReceipt(value: unknown): ContributionMigrationReceipt | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "operationId", "accountId", "generation", "deviceId", "expectedRevision", "expectedV1Revision", "expectedV2Revision",
      "bodyHash", "revision", "manifestHash", "deltaManifestHash", "deltaCount", "headCount", "suppressedV1Heads", "unresolvedV2Bodies"]);
    if (!raw) return null;
    const request = parseContributionMigrationRequest({ schemaVersion: raw.schemaVersion, operationId: raw.operationId, accountId: raw.accountId,
      generation: raw.generation, deviceId: raw.deviceId, expectedRevision: raw.expectedRevision, expectedV1Revision: raw.expectedV1Revision, expectedV2Revision: raw.expectedV2Revision });
    return request && contributionIdentity(raw.bodyHash) && raw.revision === request.expectedRevision + 1 && contributionIdentity(raw.manifestHash)
      && contributionIdentity(raw.deltaManifestHash) && statsInteger(raw.deltaCount, 0, CONTRIBUTION_MAX_HEADS)
      && statsInteger(raw.headCount, raw.deltaCount, CONTRIBUTION_MAX_HEADS) && statsInteger(raw.suppressedV1Heads, 0, raw.headCount)
      && statsInteger(raw.unresolvedV2Bodies, 0, 65_536) ? Object.freeze({ ...request, bodyHash: raw.bodyHash, revision: raw.revision,
        manifestHash: raw.manifestHash, deltaManifestHash: raw.deltaManifestHash, deltaCount: raw.deltaCount,
        headCount: raw.headCount, suppressedV1Heads: raw.suppressedV1Heads, unresolvedV2Bodies: raw.unresolvedV2Bodies }) : null;
  } catch { return null; }
}
export function parseContributionActivationRequest(value: unknown): ContributionActivationRequest | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "operationId", "accountId", "generation", "deviceId", "expectedRevision", "mode"]);
    return raw?.schemaVersion === 3 && contributionIdentity(raw.operationId) && contributionAccount(raw.accountId)
      && contributionIdentity(raw.generation) && contributionIdentity(raw.deviceId)
      && statsInteger(raw.expectedRevision, 0, CONTRIBUTION_MAX_OPERATIONS - 1) && raw.mode === "fresh-empty"
      ? Object.freeze({ schemaVersion: 3, operationId: raw.operationId, accountId: raw.accountId, generation: raw.generation,
        deviceId: raw.deviceId, expectedRevision: raw.expectedRevision, mode: "fresh-empty" }) : null;
  } catch { return null; }
}
export type ContributionStatusRequest = Readonly<{
  schemaVersion: 3; accountId: string; generation: string; deviceId: string; populationId: string; operationId: string | null;
}>;
export type ContributionAbandonRequest = Readonly<{
  schemaVersion: 3; accountId: string; generation: string; deviceId: string; operationId: string; bodyHash: string;
}>;
export type ContributionStatus = Readonly<{
  schemaVersion: 3; accountId: string; generation: string; revision: number; nextSequence: number;
  phase: "prepared" | "active"; activationHash: string | null; migrationManifestHash: string | null;
  population: ContributionPopulation | null;
  operation: Readonly<{ operationId: string; bodyHash: string; outcome: "pending" | "committed" | "abandoned"; terminal: ContributionTerminal | null }> | null;
  legacyResolution: "not_evaluated";
}>;
export type ContributionGrantReceipt = Readonly<{
  schemaVersion: 3; operationId: string; bodyHash: string; revision: number; population: ContributionPopulation;
}>;
export function parseContributionPopulation(value: unknown): ContributionPopulation | null {
  try {
    const raw = statsOwnRecord(value, ["id", "generation", "deviceId", "writerRevision", "revision", "headHash", "memberCount"]);
    return raw && contributionIdentity(raw.id) && contributionIdentity(raw.generation) && contributionIdentity(raw.deviceId)
      && statsInteger(raw.writerRevision, 1, CONTRIBUTION_MAX_OPERATIONS) && statsInteger(raw.revision, 0, CONTRIBUTION_MAX_OPERATIONS)
      && contributionHex(raw.headHash) && statsInteger(raw.memberCount, 0, CONTRIBUTION_MAX_MEMBERS)
      && ((raw.revision === 0) === (raw.headHash === CONTRIBUTION_ZERO_HASH))
      ? Object.freeze({ id: raw.id, generation: raw.generation, deviceId: raw.deviceId, writerRevision: raw.writerRevision,
        revision: raw.revision, headHash: raw.headHash, memberCount: raw.memberCount }) : null;
  } catch { return null; }
}
export function parseContributionTerminal(value: unknown): ContributionTerminal | null {
  try {
    const committed = statsOwnRecord(value, ["outcome", "receipt"]);
    if (committed?.outcome === "committed") {
      const receipt = parseContributionReceipt(committed.receipt);
      return receipt ? Object.freeze({ outcome: "committed", receipt }) : null;
    }
    const abandoned = statsOwnRecord(value, ["outcome", "operationId", "bodyHash", "revision"]);
    return abandoned?.outcome === "abandoned" && contributionIdentity(abandoned.operationId) && contributionIdentity(abandoned.bodyHash)
      && statsInteger(abandoned.revision, 1, CONTRIBUTION_MAX_OPERATIONS)
      ? Object.freeze({ outcome: "abandoned", operationId: abandoned.operationId, bodyHash: abandoned.bodyHash, revision: abandoned.revision }) : null;
  } catch { return null; }
}
export function parseContributionGrantReceipt(value: unknown): ContributionGrantReceipt | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "operationId", "bodyHash", "revision", "population"]), population = raw ? parseContributionPopulation(raw.population) : null;
    return raw?.schemaVersion === 3 && contributionIdentity(raw.operationId) && contributionIdentity(raw.bodyHash)
      && statsInteger(raw.revision, 1, CONTRIBUTION_MAX_OPERATIONS) && population
      ? Object.freeze({ schemaVersion: 3, operationId: raw.operationId, bodyHash: raw.bodyHash, revision: raw.revision, population }) : null;
  } catch { return null; }
}
export function parseContributionActivationReceipt(value: unknown): ContributionActivationReceipt | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "operationId", "accountId", "generation", "deviceId", "expectedRevision", "mode", "bodyHash", "revision"]);
    if (!raw) return null;
    const input = parseContributionActivationRequest({ schemaVersion: raw.schemaVersion, operationId: raw.operationId, accountId: raw.accountId,
      generation: raw.generation, deviceId: raw.deviceId, expectedRevision: raw.expectedRevision, mode: raw.mode });
    return input && contributionIdentity(raw.bodyHash) && raw.revision === input.expectedRevision + 1
      ? Object.freeze({ ...input, bodyHash: raw.bodyHash, revision: raw.revision }) : null;
  } catch { return null; }
}
export function parseContributionStatus(value: unknown): ContributionStatus | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "revision", "nextSequence", "phase", "activationHash",
      "migrationManifestHash", "population", "operation", "legacyResolution"]);
    if (raw?.schemaVersion !== 3 || !contributionAccount(raw.accountId) || !contributionIdentity(raw.generation)
      || !statsInteger(raw.revision, 0, CONTRIBUTION_MAX_OPERATIONS) || !statsInteger(raw.nextSequence, 1, Number.MAX_SAFE_INTEGER)
      || !((raw.phase === "prepared" && raw.activationHash === null && raw.migrationManifestHash === null)
        || (raw.phase === "active" && contributionIdentity(raw.activationHash) && (raw.migrationManifestHash === null || contributionIdentity(raw.migrationManifestHash))))
      || raw.legacyResolution !== "not_evaluated") return null;
    const population = raw.population === null ? null : parseContributionPopulation(raw.population);
    if (raw.population !== null && population === null) return null;
    if (population && population.generation !== raw.generation) return null;
    let operation: ContributionStatus["operation"] = null;
    if (raw.operation !== null) {
      const op = statsOwnRecord(raw.operation, ["operationId", "bodyHash", "outcome", "terminal"]);
      if (!op || !contributionIdentity(op.operationId) || !contributionIdentity(op.bodyHash)) return null;
      const terminal = op.terminal === null ? null : parseContributionTerminal(op.terminal);
      if (op.outcome === "pending" ? terminal !== null || op.terminal !== null : !terminal || terminal.outcome !== op.outcome) return null;
      if (terminal) {
        const record = terminal.outcome === "committed" ? terminal.receipt : terminal;
        if (record.operationId !== op.operationId || record.bodyHash !== op.bodyHash || record.revision > raw.revision) return null;
        if (terminal.outcome === "committed" && (terminal.receipt.accountId !== raw.accountId || terminal.receipt.generation !== raw.generation
          || population === null || terminal.receipt.populationId !== population.id
          || population.revision < terminal.receipt.populationRevision
          || (population.revision === terminal.receipt.populationRevision && population.headHash !== terminal.receipt.populationHead))) return null;
      }
      operation = Object.freeze({ operationId: op.operationId, bodyHash: op.bodyHash,
        outcome: op.outcome as "pending" | "committed" | "abandoned", terminal });
    }
    return Object.freeze({ schemaVersion: 3, accountId: raw.accountId, generation: raw.generation, revision: raw.revision,
      nextSequence: raw.nextSequence, phase: raw.phase as "prepared" | "active", activationHash: raw.activationHash as string | null,
      migrationManifestHash: raw.migrationManifestHash as string | null, population, operation, legacyResolution: "not_evaluated" });
  } catch { return null; }
}
export function parseContributionResult<T>(value: unknown, parse: (value: unknown) => T | null): ContributionResult<T> | null {
  try {
    const failure = statsOwnRecord(value, ["ok", "error"]);
    if (failure?.ok === false && isContributionError(failure.error)) return Object.freeze({ ok: false, error: failure.error });
    const success = statsOwnRecord(value, ["ok", "value"]), result = success?.ok === true ? parse(success.value) : null;
    return result === null ? null : Object.freeze({ ok: true, value: result });
  } catch { return null; }
}
export function parseContributionStatusRequest(value: unknown): ContributionStatusRequest | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "deviceId", "populationId", "operationId"]);
    return raw?.schemaVersion === 3 && contributionAccount(raw.accountId) && contributionIdentity(raw.generation)
      && contributionIdentity(raw.deviceId) && contributionIdentity(raw.populationId)
      && (raw.operationId === null || contributionIdentity(raw.operationId))
      ? Object.freeze({ schemaVersion: 3, accountId: raw.accountId, generation: raw.generation, deviceId: raw.deviceId,
        populationId: raw.populationId, operationId: raw.operationId }) : null;
  } catch { return null; }
}
export function parseContributionAbandonRequest(value: unknown): ContributionAbandonRequest | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "accountId", "generation", "deviceId", "operationId", "bodyHash"]);
    return raw?.schemaVersion === 3 && contributionAccount(raw.accountId) && contributionIdentity(raw.generation)
      && contributionIdentity(raw.deviceId) && contributionIdentity(raw.operationId) && contributionIdentity(raw.bodyHash)
      ? Object.freeze({ schemaVersion: 3, accountId: raw.accountId, generation: raw.generation, deviceId: raw.deviceId,
        operationId: raw.operationId, bodyHash: raw.bodyHash }) : null;
  } catch { return null; }
}
export function parseContributionGrant(value: unknown): ContributionGrant | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "operationId", "accountId", "generation", "deviceId", "populationId",
      "expectedRevision", "expectedWriterRevision", "previousDeviceId", "abandonOperationId"]);
    return raw?.schemaVersion === 3 && contributionIdentity(raw.operationId) && contributionAccount(raw.accountId)
      && contributionIdentity(raw.generation) && contributionIdentity(raw.deviceId) && contributionIdentity(raw.populationId)
      && statsInteger(raw.expectedRevision, 0, CONTRIBUTION_MAX_OPERATIONS) && statsInteger(raw.expectedWriterRevision, 0, CONTRIBUTION_MAX_OPERATIONS)
      && (raw.previousDeviceId === null || contributionIdentity(raw.previousDeviceId))
      && (raw.abandonOperationId === null || contributionIdentity(raw.abandonOperationId))
      && ((raw.previousDeviceId === null) === (raw.expectedWriterRevision === 0))
      ? Object.freeze({ schemaVersion: 3, operationId: raw.operationId, accountId: raw.accountId, generation: raw.generation,
        deviceId: raw.deviceId, populationId: raw.populationId, expectedRevision: raw.expectedRevision,
        expectedWriterRevision: raw.expectedWriterRevision, previousDeviceId: raw.previousDeviceId, abandonOperationId: raw.abandonOperationId }) : null;
  } catch { return null; }
}
export function parseContributionReceipt(value: unknown): ContributionReceipt | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "operationId", "bodyHash", "accountId", "generation", "deviceId", "sequence",
      "revision", "populationId", "populationRevision", "populationHead", "committedAtMs"]);
    return raw?.schemaVersion === 3 && contributionIdentity(raw.operationId) && contributionIdentity(raw.bodyHash)
      && contributionAccount(raw.accountId) && contributionIdentity(raw.generation) && contributionIdentity(raw.deviceId)
      && statsInteger(raw.sequence, 1, Number.MAX_SAFE_INTEGER) && statsInteger(raw.revision, 1, CONTRIBUTION_MAX_OPERATIONS)
      && contributionIdentity(raw.populationId) && statsInteger(raw.populationRevision, 1, CONTRIBUTION_MAX_OPERATIONS)
      && contributionIdentity(raw.populationHead) && statsInteger(raw.committedAtMs, 0, CONTRIBUTION_MAX_TIME)
      ? Object.freeze({ schemaVersion: 3, operationId: raw.operationId, bodyHash: raw.bodyHash, accountId: raw.accountId,
        generation: raw.generation, deviceId: raw.deviceId, sequence: raw.sequence, revision: raw.revision,
        populationId: raw.populationId, populationRevision: raw.populationRevision, populationHead: raw.populationHead,
        committedAtMs: raw.committedAtMs }) : null;
  } catch { return null; }
}

function ownedArray(value: unknown, maximum: number): readonly unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !("value" in length) || !statsInteger(length.value, 0, maximum)
    || Reflect.ownKeys(descriptors).length !== length.value + 1) return null;
  const result: unknown[] = [];
  for (let index = 0; index < length.value; index++) {
    const entry = descriptors[String(index)];
    if (!entry || !("value" in entry) || !entry.enumerable) return null;
    result.push(entry.value as unknown);
  }
  return result;
}
const revision = (value: unknown): value is number => statsInteger(value, 0, CONTRIBUTION_MAX_OPERATIONS);
const optionalHash = (value: unknown): value is string | null => value === null || contributionIdentity(value);
export function parseContributionBatch(value: unknown): ContributionBatch | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "profile", "identityScheme", "grain", "accountId", "generation", "deviceId",
      "operationId", "sequence", "expectedRevision", "populationId", "writerRevision", "expectedPopulationRevision", "expectedPopulationHead", "replacement", "mutations"]);
    if (!raw || raw.schemaVersion !== 3 || raw.profile !== CONTRIBUTION_PROFILE || raw.identityScheme !== CONTRIBUTION_IDENTITY
      || raw.grain !== "observation" || !contributionAccount(raw.accountId) || !contributionIdentity(raw.generation)
      || !contributionIdentity(raw.deviceId) || !contributionIdentity(raw.operationId) || !contributionIdentity(raw.populationId)
      || !statsInteger(raw.sequence, 1, Number.MAX_SAFE_INTEGER) || !revision(raw.expectedRevision)
      || !statsInteger(raw.writerRevision, 1, CONTRIBUTION_MAX_OPERATIONS) || !revision(raw.expectedPopulationRevision)
      || !contributionHex(raw.expectedPopulationHead)) return null;
    let replacement: ContributionBatch["replacement"] = null;
    if (raw.replacement !== null) {
      const fields = statsOwnRecord(raw.replacement, ["members"]), items = fields ? ownedArray(fields.members, CONTRIBUTION_MAX_MEMBERS) : null;
      if (!items || items.some((id, index) => !contributionIdentity(id, 32) || (index > 0 && String(items[index - 1]) >= id))) return null;
      replacement = Object.freeze({ members: Object.freeze(items as string[]) });
    }
    const items = ownedArray(raw.mutations, CONTRIBUTION_MAX_MUTATIONS);
    if (!items || (items.length === 0 && replacement === null)) return null;
    const mutations: ContributionMutation[] = [];
    let previous = "";
    for (const item of items) {
      const put = statsOwnRecord(item, ["kind", "id", "expectedHeadHash", "row"]);
      if (put) {
        const row = parseUsageStatsRow(put.row);
        // One means a canonical observation, never a prompt/request count.
        if (put.kind !== "put" || !contributionIdentity(put.id, 32) || put.id <= previous || !optionalHash(put.expectedHeadHash)
          || !row || row.records !== 1 || (replacement && !replacement.members.includes(put.id))) return null;
        mutations.push(Object.freeze({ kind: "put", id: put.id, expectedHeadHash: put.expectedHeadHash, row })); previous = put.id;
        continue;
      }
      const remove = statsOwnRecord(item, ["kind", "id", "expectedHeadHash"]);
      if (!remove || replacement !== null || (remove.kind !== "remove" && remove.kind !== "tombstone")
        || !contributionIdentity(remove.id, 32) || remove.id <= previous || !contributionIdentity(remove.expectedHeadHash)) return null;
      mutations.push(Object.freeze({ kind: remove.kind, id: remove.id, expectedHeadHash: remove.expectedHeadHash })); previous = remove.id;
    }
    const batch: ContributionBatch = Object.freeze({ schemaVersion: 3, profile: CONTRIBUTION_PROFILE, identityScheme: CONTRIBUTION_IDENTITY,
      grain: "observation", accountId: raw.accountId, generation: raw.generation, deviceId: raw.deviceId, operationId: raw.operationId,
      sequence: raw.sequence, expectedRevision: raw.expectedRevision, populationId: raw.populationId, writerRevision: raw.writerRevision,
      expectedPopulationRevision: raw.expectedPopulationRevision, expectedPopulationHead: raw.expectedPopulationHead,
      replacement, mutations: Object.freeze(mutations) });
    return new TextEncoder().encode(JSON.stringify(batch)).byteLength <= CONTRIBUTION_MAX_BYTES ? batch : null;
  } catch { return null; }
}
export function parseContributionJson(text: string): ContributionBatch | null {
  if (text.length > CONTRIBUTION_MAX_BYTES || new TextEncoder().encode(text).byteLength > CONTRIBUTION_MAX_BYTES) return null;
  try { return parseContributionBatch(JSON.parse(text) as unknown); } catch { return null; }
}
/** Callers cannot change field order to create a second immutable identity. */
export function contributionBatchText(value: ContributionBatch): string {
  const batch = parseContributionBatch(value);
  if (!batch) throw new ContributionFault("invalid_input");
  return JSON.stringify(batch);
}
export const contributionBodyHash = (batch: ContributionBatch): string => contributionHash(contributionBatchText(batch));
export const contributionPayloadHash = (row: UsageStatsRow): string => contributionHash(`aicharts:contribution-payload:v3\0${JSON.stringify(row)}`);
const nextHead = (batch: ContributionBatch, id: string, payloadHash: string | null): string => contributionHash(
  `aicharts:contribution-head:v3\0${JSON.stringify([batch.accountId, batch.generation, batch.operationId, id, payloadHash])}`);

/** Aggregate-only V2 evidence has no exact occurrence set. Retain its immutable
 * reference but never use equal totals/body bytes as a deduplication proof. */
export type UnresolvedContributionLegacy = Readonly<{
  schemaVersion: 3; kind: "aggregate-v2"; bodyHash: string; generation: string; client: string; firstUtcDay: number; dayCount: number;
}>;
export function parseUnresolvedContributionLegacy(value: unknown): UnresolvedContributionLegacy | null {
  try {
    const raw = statsOwnRecord(value, ["schemaVersion", "kind", "bodyHash", "generation", "client", "firstUtcDay", "dayCount"]);
    return raw?.schemaVersion === 3 && raw.kind === "aggregate-v2" && contributionIdentity(raw.bodyHash)
      && contributionIdentity(raw.generation) && isStatsClient(raw.client) && statsInteger(raw.firstUtcDay, 0, 99_999_999)
      && statsInteger(raw.dayCount, 1, 366) && raw.firstUtcDay + raw.dayCount <= 100_000_000
      ? Object.freeze({ schemaVersion: 3, kind: "aggregate-v2", bodyHash: raw.bodyHash, generation: raw.generation,
        client: raw.client, firstUtcDay: raw.firstUtcDay, dayCount: raw.dayCount }) : null;
  } catch { return null; }
}
export type ContributionView = Readonly<{
  control: ContributionControl; population: ContributionPopulation;
  head(id: string): ContributionHead | null;
  membership(id: string): ContributionMembership | null;
  members(): readonly ContributionMembership[];
}>;
export type ContributionPlan = Readonly<{
  heads: readonly ContributionHead[]; memberships: readonly ContributionMembership[]; removals: readonly string[];
  deltas: readonly ContributionDelta[]; population: ContributionPopulation; headCount: number; membershipCount: number;
  receipt: ContributionReceipt;
}>;
export function checkContributionAuthority(control: ContributionControl, authority: ContributionAuthority, deviceId = authority.deviceId): void {
  if (!contributionAccount(authority.accountId) || !contributionIdentity(authority.generation) || !contributionIdentity(authority.deviceId)
    || !statsInteger(authority.observedAtMs, 0, CONTRIBUTION_MAX_TIME) || typeof authority.active !== "boolean"
    || typeof authority.allowAccountTombstone !== "boolean" || control.accountId !== authority.accountId || deviceId !== authority.deviceId)
    throw new ContributionFault("unauthorized");
  if (!authority.active) throw new ContributionFault("revoked");
  if (control.generation !== authority.generation) throw new ContributionFault("generation_conflict");
  if (authority.observedAtMs < control.updatedAtMs) throw new ContributionFault("clock_regressed");
}
const visible = (head: ContributionHead | null): ContributionReference | null => head && !head.deleted && !head.suppressedLegacy
  && (head.legacySupport || head.members > 0) ? head.reference : null;

/** A bounded, side-effect-free transition shared by the SQL owner and reference
 * fold. Delta scans touch named facts only; complete replacement enumerates at
 * most one explicitly owned, capped population. */
export function planContribution(view: ContributionView, value: ContributionBatch, authority: ContributionAuthority): ContributionPlan {
  const batch = parseContributionBatch(value);
  if (!batch) throw new ContributionFault("invalid_input");
  const control = view.control, population = view.population;
  checkContributionAuthority(control, authority, batch.deviceId);
  if (control.phase !== "active") throw new ContributionFault("recovery_required");
  if (batch.accountId !== control.accountId || batch.generation !== control.generation) throw new ContributionFault("generation_conflict");
  if (population.id !== batch.populationId || population.generation !== batch.generation
    || population.deviceId !== batch.deviceId || population.writerRevision !== batch.writerRevision)
    throw new ContributionFault("writer_conflict");
  if (control.revision !== batch.expectedRevision) throw new ContributionFault("conflict");
  if (population.revision !== batch.expectedPopulationRevision || population.headHash !== batch.expectedPopulationHead)
    throw new ContributionFault("population_conflict");
  if (control.revision >= CONTRIBUTION_MAX_OPERATIONS) throw new ContributionFault("limit");
  const bodyHash = contributionBodyHash(batch), heads = new Map<string, ContributionHead>(), before = new Map<string, ContributionHead | null>();
  const memberships = new Map<string, ContributionMembership>(), removals = new Set<string>();
  let headCount = control.headCount, membershipCount = control.membershipCount, populationCount = population.memberCount;
  const readHead = (id: string): ContributionHead | null => {
    if (!before.has(id)) before.set(id, view.head(id));
    return heads.get(id) ?? before.get(id) ?? null;
  };
  const remove = (id: string): void => {
    const member = view.membership(id), head = readHead(id);
    if (!member || !head || head.members < 1) throw new ContributionFault("storage_invalid");
    heads.set(id, { ...head, members: head.members - 1 }); removals.add(id); populationCount--; membershipCount--;
  };
  for (const [index, mutation] of batch.mutations.entries()) {
    const head = readHead(mutation.id), member = view.membership(mutation.id);
    if (member && (!head || head.members < 1)) throw new ContributionFault("storage_invalid");
    if ((head?.headHash ?? null) !== mutation.expectedHeadHash) throw new ContributionFault("predecessor_conflict");
    if (mutation.kind === "remove") {
      if (!member) throw new ContributionFault("population_conflict");
      remove(mutation.id); continue;
    }
    if (head?.deleted) throw new ContributionFault("subject_deleted");
    if (mutation.kind === "tombstone") {
      if (!authority.allowAccountTombstone) throw new ContributionFault("unauthorized");
      if (!head) throw new ContributionFault("predecessor_conflict");
      heads.set(mutation.id, { ...head, headHash: nextHead(batch, mutation.id, null), payloadHash: null, reference: null, deleted: true });
      continue;
    }
    if (head?.suppressedLegacy) throw new ContributionFault("legacy_unresolved");
    const payloadHash = contributionPayloadHash(mutation.row);
    // A newly discovered or stale copy may join the current exact bytes, but
    // cannot overwrite a correction it has never observed in its population.
    if (head && head.payloadHash !== payloadHash && member?.headHash !== head.headHash) throw new ContributionFault("population_conflict");
    const next: ContributionHead = head?.payloadHash === payloadHash ? head : {
      id: mutation.id, headHash: nextHead(batch, mutation.id, payloadHash), payloadHash,
      reference: { kind: "batch-v3", bodyHash, index, payloadHash }, members: head?.members ?? 0, deleted: false,
      legacySupport: head?.legacySupport ?? false, suppressedLegacy: false,
    };
    if (!head) headCount++;
    if (!member) { populationCount++; membershipCount++; }
    heads.set(mutation.id, { ...next, members: next.members + (member ? 0 : 1) });
    memberships.set(mutation.id, { id: mutation.id, headHash: next.headHash });
  }
  if (batch.replacement) {
    const desired = new Set(batch.replacement.members), current = view.members();
    if (current.length !== population.memberCount || current.length > CONTRIBUTION_MAX_MEMBERS
      || new Set(current.map(member => member.id)).size !== current.length) throw new ContributionFault("storage_invalid");
    for (const member of current) if (!desired.has(member.id)) remove(member.id);
    for (const id of desired) if (!memberships.has(id) && !view.membership(id)) throw new ContributionFault("population_conflict");
  }
  if (headCount < 0 || membershipCount < 0 || populationCount < 0) throw new ContributionFault("storage_invalid");
  if (headCount > CONTRIBUTION_MAX_HEADS || membershipCount > CONTRIBUTION_MAX_ASSOCIATIONS
    || populationCount > CONTRIBUTION_MAX_MEMBERS || [...heads.values()].some(head => head.members > CONTRIBUTION_MAX_POPULATIONS))
    throw new ContributionFault("limit");
  const populationHead = contributionHash(`aicharts:population-history:v3\0${JSON.stringify([population.headHash, bodyHash])}`);
  const updatedPopulation = { ...population, revision: population.revision + 1, headHash: populationHead, memberCount: populationCount };
  const deltas: ContributionDelta[] = [];
  for (const [id, next] of heads) {
    const prior = visible(before.get(id) ?? null), after = visible(next);
    if (JSON.stringify(prior) !== JSON.stringify(after)) deltas.push({ id, before: prior, after });
  }
  return { heads: [...heads.values()], memberships: [...memberships.values()], removals: [...removals], deltas,
    population: updatedPopulation, headCount, membershipCount,
    receipt: { schemaVersion: 3, operationId: batch.operationId, bodyHash, accountId: batch.accountId, generation: batch.generation,
      deviceId: batch.deviceId, sequence: batch.sequence, revision: control.revision + 1, populationId: batch.populationId,
      populationRevision: updatedPopulation.revision, populationHead, committedAtMs: authority.observedAtMs } };
}

export type ContributionReferenceState = Readonly<{
  control: ContributionControl; populations: ReadonlyMap<string, ContributionPopulation>; heads: ReadonlyMap<string, ContributionHead>;
  memberships: ReadonlyMap<string, ReadonlyMap<string, ContributionMembership>>;
  unresolvedLegacy: readonly UnresolvedContributionLegacy[];
}>;
/** Executable reference state. Production uses the same transition against
 * bounded indexed SQL reads, without loading all account history. */
export function referenceFold(state: ContributionReferenceState, batch: ContributionBatch, authority: ContributionAuthority): Readonly<{
  state: ContributionReferenceState; plan: ContributionPlan;
}> {
  const population = state.populations.get(batch.populationId);
  if (!population) throw new ContributionFault("writer_conflict");
  const members = state.memberships.get(batch.populationId) ?? new Map<string, ContributionMembership>();
  const plan = planContribution({ control: state.control, population, head: id => state.heads.get(id) ?? null,
    membership: id => members.get(id) ?? null, members: () => [...members.values()] }, batch, authority);
  const heads = new Map(state.heads), nextMembers = new Map(members), memberships = new Map(state.memberships), populations = new Map(state.populations);
  for (const head of plan.heads) heads.set(head.id, head);
  for (const id of plan.removals) nextMembers.delete(id);
  for (const member of plan.memberships) nextMembers.set(member.id, member);
  memberships.set(batch.populationId, nextMembers); populations.set(batch.populationId, plan.population);
  return { plan, state: { ...state, heads, memberships, populations, control: { ...state.control,
    revision: plan.receipt.revision, updatedAtMs: plan.receipt.committedAtMs, headCount: plan.headCount, membershipCount: plan.membershipCount } } };
}
export function contributionCoverage(state: ContributionReferenceState): Readonly<{
  exactAccountTotal: boolean; canonicalObservations: number; unresolvedLegacyBodies: number;
}> {
  return { exactAccountTotal: state.unresolvedLegacy.length === 0,
    canonicalObservations: [...state.heads.values()].filter(head => !head.deleted && !head.suppressedLegacy && (head.legacySupport || head.members > 0)).length,
    unresolvedLegacyBodies: state.unresolvedLegacy.length };
}
