import { createHash } from "node:crypto";
import { decodeAdmissionBatch, decodeAdmissionJournal, encodeAdmissionBatch, encodeAdmissionOperation, type AdmissionBatch } from "../../lib/usage/admission";
import { parsePrivateDaysValue, type PrivateDaysV1 } from "../../lib/usage/private-days-contract";
import { DAY_MS, encodeUsageBatch } from "../../lib/usage/wire";
import { ADMISSION_POLICY_V1 } from "../../services/usage-worker/src/admission-policy";

/** Synthetic authority only. This fixture must never be a production enrollment path. */
export const QUALIFICATION_URL = "https://aicharts-usage-qualification.invalid/v1/run";
export const QUALIFICATION_REQUEST_BYTES = 2_048;
export const QUALIFICATION_REPLY_BYTES = 16_384;
export const QUALIFICATION_RUN_MS = DAY_MS;
export const QUALIFICATION_STAGES = ["initialize", "begin", "authenticate", "approve", "confirm", "reserve", "enroll-drop", "enroll", "namespace", "insert-drop", "insert", "correct", "tombstone", "read", "revoke", "revoked-probe", "generation-probe", "inspect"] as const;
export type QualificationStage = typeof QUALIFICATION_STAGES[number];
export type QualificationSlot = "original" | "closure";
export type QualificationRun = Readonly<{
  schemaVersion: 1; runId: string; createdAtMs: number; expiresAtMs: number; firstUtcDay: number;
  generationOne: string; generationTwo: string;
}>;
export type QualificationAttempt = Readonly<{ attemptId: string; contextToken: string; startedAtMs: number; expiresAtMs: number }>;
type RequestBase = Readonly<{ schemaVersion: 1; runId: string }>;
export type QualificationRequest = RequestBase & (
  | Readonly<{ stage: "initialize" | "begin" | "confirm" | "reserve"; slot: QualificationSlot }>
  | Readonly<{ stage: "authenticate" | "approve"; slot: QualificationSlot; attempt: QualificationAttempt }>
  | Readonly<{ stage: Exclude<QualificationStage, "initialize" | "begin" | "confirm" | "reserve" | "authenticate" | "approve"> }>
);
export type QualificationEnrollment = Readonly<{ deviceId: string; reservationId: string; enrolledAtMs: number; deviceState: "active" | "revoked" }>;
export const QUALIFICATION_OBJECT_KINDS = ["anchor", "batch-1", "journal-1", "batch-2", "journal-2", "batch-3", "journal-3"] as const;
export type QualificationObject = Readonly<{
  kind: typeof QUALIFICATION_OBJECT_KINDS[number]; byteLength: number; sha256: string; version: string; bodyHex: string | null;
}>;
export const QUALIFICATION_CLOSURE_KEYS = ["oldReservation", "enroll", "namespace", "latestRetry", "read", "freshEnroll", "recover"] as const;
export type QualificationClosure = Readonly<Record<typeof QUALIFICATION_CLOSURE_KEYS[number], "recovery_required">>;
export type QualificationValue = Readonly<{ expiresAtMs: number }> | QualificationAttempt
  | Readonly<{ recorded: true; authTimeMs: number; sessionExpiresAtMs: number }>
  | Readonly<{ state: "browser-approved"; expiresAtMs: number; authenticationExpiresAtMs: number }>
  | Readonly<{ state: "terminal-confirmed"; expiresAtMs: number }>
  | Readonly<{ reservationId: string; reservedAtMs: number; expiresAtMs: number; generation: string; deviceId: string }>
  | QualificationEnrollment | Readonly<{ namespaceSha256: string; anchorSha256: string; deviceId: string }>
  | Readonly<{ batchHex: string; journalHex: string }> | PrivateDaysV1
  | Readonly<{ result: "revoked" }> | QualificationClosure | Readonly<{ objects: readonly QualificationObject[] }>;
export const QUALIFICATION_ERRORS = ["invalid_request", "method_not_allowed", "run_expired", "qualification_failed", "qualification_unavailable", "synthetic_reply_withheld"] as const;
export type QualificationError = typeof QUALIFICATION_ERRORS[number];
export type QualificationReply = Readonly<{ schemaVersion: 1; runId: string; stage: QualificationStage; ok: true; value: QualificationValue }>
  | Readonly<{ schemaVersion: 1; ok: false; error: QualificationError }>;
export const QUALIFICATION_ERROR_STATUS: Readonly<Record<QualificationError, number>> = Object.freeze({
  invalid_request: 400, method_not_allowed: 405, run_expired: 410, qualification_failed: 409,
  qualification_unavailable: 503, synthetic_reply_withheld: 503,
});

const maxTime = 8_640_000_000_000_000;
const integer = (value: unknown, max = maxTime): value is number => typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= max;
export const qualificationHex = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) && value !== "0".repeat(64);
export const qualificationDigest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export const qualificationBytes = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(Buffer.from(value, "hex"));
export const qualificationByteHex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

/** Exact owned JSON fields; inherited serializers and getters are never invoked. */
export function qualificationFields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const fields = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(fields);
    if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const field = fields[key];
      if (field === undefined || !("value" in field) || !field.enumerable) return null;
      result[key] = field.value as unknown;
    }
    return result;
  } catch { return null; }
}

export function parseQualificationRun(value: unknown): QualificationRun | null {
  const input = qualificationFields(value, ["schemaVersion", "runId", "createdAtMs", "expiresAtMs", "firstUtcDay", "generationOne", "generationTwo"]);
  if (!input || input.schemaVersion !== 1 || typeof input.runId !== "string" || !/^[0-9a-f]{24}$/u.test(input.runId)
    || input.runId === "0".repeat(24) || !integer(input.createdAtMs, maxTime - QUALIFICATION_RUN_MS)
    || input.expiresAtMs !== input.createdAtMs + QUALIFICATION_RUN_MS || !integer(input.firstUtcDay, 99_999_998)
    || input.firstUtcDay + 3 !== Math.floor(input.createdAtMs / DAY_MS)
    || !qualificationHex(input.generationOne) || !qualificationHex(input.generationTwo) || input.generationOne === input.generationTwo) return null;
  return Object.freeze({ schemaVersion: 1, runId: input.runId, createdAtMs: input.createdAtMs, expiresAtMs: input.expiresAtMs,
    firstUtcDay: input.firstUtcDay, generationOne: input.generationOne, generationTwo: input.generationTwo });
}

export function parseQualificationAttempt(run: QualificationRun, value: unknown): QualificationAttempt | null {
  const input = qualificationFields(value, ["attemptId", "contextToken", "startedAtMs", "expiresAtMs"]);
  return input && qualificationHex(input.attemptId) && qualificationHex(input.contextToken)
    && integer(input.startedAtMs) && input.startedAtMs >= run.createdAtMs && integer(input.expiresAtMs)
    && input.expiresAtMs > input.startedAtMs && input.expiresAtMs <= run.expiresAtMs && input.expiresAtMs - input.startedAtMs <= 600_000
    ? Object.freeze({ attemptId: input.attemptId, contextToken: input.contextToken, startedAtMs: input.startedAtMs, expiresAtMs: input.expiresAtMs }) : null;
}

export function parseQualificationRequest(run: QualificationRun, value: unknown): QualificationRequest | null {
  try {
    const stage = value !== null && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "stage") : undefined;
    if (!stage || !("value" in stage) || typeof stage.value !== "string" || !(QUALIFICATION_STAGES as readonly string[]).includes(stage.value)) return null;
    const name = stage.value as QualificationStage, pairing = ["initialize", "begin", "authenticate", "approve", "confirm", "reserve"].includes(name);
    const attemptRequired = name === "authenticate" || name === "approve";
    const input = qualificationFields(value, ["schemaVersion", "runId", "stage", ...(pairing ? ["slot"] : []), ...(attemptRequired ? ["attempt"] : [])]);
    if (!input || input.schemaVersion !== 1 || input.runId !== run.runId) return null;
    if (pairing) {
      if (input.slot !== "original" && input.slot !== "closure") return null;
      if (attemptRequired) {
        const attempt = parseQualificationAttempt(run, input.attempt);
        return attempt ? Object.freeze({ schemaVersion: 1, runId: run.runId, stage: name as "authenticate" | "approve", slot: input.slot, attempt }) : null;
      }
      return Object.freeze({ schemaVersion: 1, runId: run.runId, stage: name as "initialize" | "begin" | "confirm" | "reserve", slot: input.slot });
    }
    return Object.freeze({ schemaVersion: 1, runId: run.runId, stage: name as Exclude<QualificationStage, "initialize" | "begin" | "authenticate" | "approve" | "confirm" | "reserve"> });
  } catch { return null; }
}

export function qualificationIdentity(run: QualificationRun) {
  const derive = (label: string) => qualificationDigest(`aicharts:synthetic-qualification:v1\0${run.runId}\0${label}`);
  const proof = (slot: QualificationSlot) => Object.freeze({ intentId: derive(`${slot}:intent`), pollSecret: derive(`${slot}:poll`), uploadSecret: derive(`${slot}:upload`) });
  return Object.freeze({ accountId: `acct_7175616c${run.runId}`, original: proof("original"), closure: proof("closure"),
    originalNonce: derive("original:nonce"), closureNonce: derive("closure:nonce"),
    codexOccurrence: derive("codex:occurrence").slice(0, 32), claudeOccurrence: derive("claude:occurrence").slice(0, 32), probeOccurrence: derive("probe:occurrence").slice(0, 32) });
}

export function qualificationDeviceId(run: QualificationRun, reservationId: string, slot: QualificationSlot = "original"): string {
  if (!qualificationHex(reservationId)) throw new Error("invalid_qualification_fixture");
  const identity = qualificationIdentity(run);
  return qualificationDigest(["aicharts:enrollment:v1", "device", identity.accountId, identity[slot].intentId, reservationId].join("\0"));
}

function checked<T>(value: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!value.ok) throw new Error("invalid_qualification_fixture");
  return value.value;
}

/** Three immutable batches: two puts, a decreasing day correction, one tombstone. */
export function qualificationFixture(run: QualificationRun, deviceId: string): Readonly<{ insert: AdmissionBatch; correction: AdmissionBatch; tombstone: AdmissionBatch; revokedProbe: AdmissionBatch }> {
  if (!qualificationHex(deviceId)) throw new Error("invalid_qualification_fixture");
  const identity = qualificationIdentity(run), accountId = qualificationBytes(identity.accountId.slice(5)), device = qualificationBytes(deviceId), generation = qualificationBytes(run.generationOne);
  const frame = (occurrenceId: Uint8Array, provider: 1 | 2 | 3, day: number, output: bigint) => checked(encodeUsageBatch({ utcDay: day, registryRevision: 1,
    usage: [{ id: occurrenceId, executionId: new Uint8Array(16), accountId: new Uint8Array(16), offsetMs: 1, provider, authMode: 0, evidence: 1, modelId: 0, contextTier: 0,
      tokens: { inputUncached: provider === 2 ? 20n : 10n, cacheRead: provider === 2 ? 3n : 0n, cacheWrite5m: provider === 2 ? 4n : 0n, cacheWrite1h: 0n, output, reasoningOutput: 0n } }], prompts: [], intervals: [] }, ADMISSION_POLICY_V1));
  const operation = (occurrence: string, sequence: number, provider: 1 | 2 | 3, day: number, output: bigint, expectedHeadHash: Uint8Array = new Uint8Array(32), tombstone = false) => {
    const occurrenceId = qualificationBytes(occurrence);
    return checked(encodeAdmissionOperation({ accountId, deviceId: device, generation, sequence, occurrenceId, expectedHeadHash,
      action: tombstone ? 2 : 1, frame: tombstone ? new Uint8Array() : frame(occurrenceId, provider, day, output) }, ADMISSION_POLICY_V1));
  };
  const batch = (operations: readonly Uint8Array[]) => checked(decodeAdmissionBatch(checked(encodeAdmissionBatch(operations, ADMISSION_POLICY_V1)), ADMISSION_POLICY_V1));
  const insert = batch([operation(identity.codexOccurrence, 1, 1, run.firstUtcDay + 1, 5n), operation(identity.claudeOccurrence, 2, 2, run.firstUtcDay + 2, 7n)]);
  const correction = batch([operation(identity.codexOccurrence, 3, 1, run.firstUtcDay, 1n, insert.operations[0].operationHash)]);
  const tombstone = batch([operation(identity.claudeOccurrence, 4, 2, run.firstUtcDay + 2, 0n, insert.operations[1].operationHash, true)]);
  const revokedProbe = batch([operation(identity.probeOccurrence, 5, 1, run.firstUtcDay, 1n)]);
  return Object.freeze({ insert, correction, tombstone, revokedProbe });
}

export function qualificationExpectedDays(run: QualificationRun, revision: 1 | 2 | 3, committedAtMs: number): PrivateDaysV1 {
  const zero = () => ({ usageOccurrences: 0, observedAccountedTokens: "0", observedOutputTokens: "0" });
  const days = Array.from({ length: 3 }, (_, index) => ({ utcDay: run.firstUtcDay + index, codex: zero(), claudeCode: zero(), devin: zero() }));
  days[revision === 1 ? 1 : 0].codex = { usageOccurrences: 1, observedAccountedTokens: revision === 1 ? "15" : "11", observedOutputTokens: revision === 1 ? "5" : "1" };
  if (revision < 3) days[2].claudeCode = { usageOccurrences: 1, observedAccountedTokens: "34", observedOutputTokens: "7" };
  return { schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial", journalRevision: revision, journalCommittedAtMs: committedAtMs, firstUtcDay: run.firstUtcDay, days };
}

/** Serialize only owned, bounded JSON trees, including null-prototype arrays. */
export function encodeQualificationJson(value: unknown, limit = QUALIFICATION_REPLY_BYTES): Uint8Array<ArrayBuffer> | null {
  try {
    let nodes = 0;
    const copy = (input: unknown, depth: number): unknown => {
      if (++nodes > 256 || depth > 8) throw new Error("invalid_qualification_json");
      if (input === null || typeof input === "boolean" || (typeof input === "number" && integer(input)) || (typeof input === "string" && input.length <= limit)) return input;
      if (input === null || typeof input !== "object") throw new Error("invalid_qualification_json");
      const fields = Object.getOwnPropertyDescriptors(input), array = Array.isArray(input);
      const prototype: unknown = Object.getPrototypeOf(input);
      if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)) throw new Error("invalid_qualification_json");
      const output: Record<string, unknown> | unknown[] = array ? Object.setPrototypeOf([], null) as unknown[] : Object.create(null) as Record<string, unknown>;
      if (array && (!("value" in fields.length) || !integer(fields.length.value, 32))) throw new Error("invalid_qualification_json");
      if (array && (Reflect.ownKeys(fields).length !== fields.length.value + 1 || Array.from({ length: fields.length.value }, (_, index) => String(index)).some(key => !Object.hasOwn(fields, key)))) throw new Error("invalid_qualification_json");
      for (const key of Reflect.ownKeys(fields)) {
        if (array && key === "length") continue;
        if (typeof key !== "string" || key === "toJSON" || !("value" in fields[key]) || !fields[key].enumerable) throw new Error("invalid_qualification_json");
        Object.defineProperty(output, key, { value: copy(fields[key].value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return output;
    };
    const bytes = Uint8Array.from(new TextEncoder().encode(JSON.stringify(copy(value, 0))));
    return bytes.length <= limit ? bytes : null;
  } catch { return null; }
}

function enrollment(value: unknown, run: QualificationRun): QualificationEnrollment | null {
  const item = qualificationFields(value, ["deviceId", "reservationId", "enrolledAtMs", "deviceState"]);
  return item && qualificationHex(item.deviceId) && qualificationHex(item.reservationId)
    && item.deviceId === qualificationDeviceId(run, item.reservationId) && integer(item.enrolledAtMs) && item.enrolledAtMs >= run.createdAtMs && item.enrolledAtMs < run.expiresAtMs
    && (item.deviceState === "active" || item.deviceState === "revoked")
    ? { deviceId: item.deviceId, reservationId: item.reservationId, enrolledAtMs: item.enrolledAtMs, deviceState: item.deviceState } : null;
}

function replyValue(run: QualificationRun, request: QualificationRequest, value: unknown): QualificationValue | null {
  switch (request.stage) {
    case "initialize": {
      const item = qualificationFields(value, ["expiresAtMs"]);
      return item && integer(item.expiresAtMs) && item.expiresAtMs > run.createdAtMs && item.expiresAtMs <= run.expiresAtMs ? { expiresAtMs: item.expiresAtMs } : null;
    }
    case "begin": return parseQualificationAttempt(run, value);
    case "authenticate": {
      const item = qualificationFields(value, ["recorded", "authTimeMs", "sessionExpiresAtMs"]);
      return item?.recorded === true && item.authTimeMs === Math.floor(request.attempt.startedAtMs / 1000) * 1000 && item.sessionExpiresAtMs === request.attempt.expiresAtMs
        ? { recorded: true, authTimeMs: item.authTimeMs, sessionExpiresAtMs: item.sessionExpiresAtMs } : null;
    }
    case "approve": {
      const item = qualificationFields(value, ["state", "expiresAtMs", "authenticationExpiresAtMs"]);
      return item?.state === "browser-approved" && item.expiresAtMs === request.attempt.expiresAtMs && item.authenticationExpiresAtMs === request.attempt.expiresAtMs
        ? { state: "browser-approved", expiresAtMs: request.attempt.expiresAtMs, authenticationExpiresAtMs: request.attempt.expiresAtMs } : null;
    }
    case "confirm": {
      const item = qualificationFields(value, ["state", "expiresAtMs"]);
      return item?.state === "terminal-confirmed" && integer(item.expiresAtMs) && item.expiresAtMs > run.createdAtMs && item.expiresAtMs <= run.expiresAtMs ? { state: "terminal-confirmed", expiresAtMs: item.expiresAtMs } : null;
    }
    case "reserve": {
      const item = qualificationFields(value, ["reservationId", "reservedAtMs", "expiresAtMs", "generation", "deviceId"]);
      return item && qualificationHex(item.reservationId) && qualificationHex(item.deviceId) && item.deviceId === qualificationDeviceId(run, item.reservationId, request.slot)
        && integer(item.reservedAtMs) && item.reservedAtMs >= run.createdAtMs && integer(item.expiresAtMs) && item.expiresAtMs > item.reservedAtMs
        && item.expiresAtMs - item.reservedAtMs <= 600_000 && item.expiresAtMs <= run.expiresAtMs && item.generation === (request.slot === "original" ? run.generationOne : run.generationTwo)
        ? { reservationId: item.reservationId, reservedAtMs: item.reservedAtMs, expiresAtMs: item.expiresAtMs, generation: item.generation as string, deviceId: item.deviceId } : null;
    }
    case "enroll": return enrollment(value, run);
    case "revoke": {
      const item = enrollment(value, run);
      return item?.deviceState === "revoked" ? item : null;
    }
    case "namespace": {
      const item = qualificationFields(value, ["namespaceSha256", "anchorSha256", "deviceId"]);
      return item && qualificationHex(item.namespaceSha256) && qualificationHex(item.anchorSha256) && qualificationHex(item.deviceId)
        ? { namespaceSha256: item.namespaceSha256, anchorSha256: item.anchorSha256, deviceId: item.deviceId } : null;
    }
    case "insert": case "correct": case "tombstone": {
      const item = qualificationFields(value, ["batchHex", "journalHex"]);
      if (!item || typeof item.batchHex !== "string" || !/^[0-9a-f]{576,1488}$/u.test(item.batchHex)
        || typeof item.journalHex !== "string" || !/^[0-9a-f]{848,1376}$/u.test(item.journalHex)) return null;
      const batch = decodeAdmissionBatch(qualificationBytes(item.batchHex), ADMISSION_POLICY_V1);
      if (!batch.ok) return null;
      const expected = qualificationFixture(run, qualificationByteHex(batch.value.deviceId));
      const selected = request.stage === "insert" ? expected.insert : request.stage === "correct" ? expected.correction : expected.tombstone;
      if (item.batchHex !== qualificationByteHex(selected.bytes)) return null;
      const journal = decodeAdmissionJournal(qualificationBytes(item.journalHex), selected.bytes, ADMISSION_POLICY_V1);
      const revision = request.stage === "insert" ? 1 : request.stage === "correct" ? 2 : 3;
      if (!journal.ok || journal.value.status !== 1 || journal.value.accountJournalRevision !== revision
        || journal.value.committedAtMs < run.createdAtMs || journal.value.committedAtMs >= run.expiresAtMs
        || journal.value.receipts.some(receipt => receipt.outcome !== (revision === 1 ? 1 : revision === 2 ? 2 : 3))) return null;
      return { batchHex: item.batchHex, journalHex: item.journalHex };
    }
    case "read": {
      const requestDto = { schemaVersion: 1, accountId: qualificationIdentity(run).accountId, sessionExpiresAtMs: run.expiresAtMs, firstUtcDay: run.firstUtcDay, dayCount: 3 };
      const item = parsePrivateDaysValue(requestDto, value);
      if (!item || item.journalRevision < 1 || item.journalRevision > 3 || item.journalCommittedAtMs === null
        || item.journalCommittedAtMs < run.createdAtMs || item.journalCommittedAtMs >= run.expiresAtMs) return null;
      const expected = qualificationExpectedDays(run, item.journalRevision as 1 | 2 | 3, item.journalCommittedAtMs);
      return qualificationByteHex(encodeQualificationJson(item)!) === qualificationByteHex(encodeQualificationJson(expected)!) ? item : null;
    }
    case "revoked-probe": return qualificationFields(value, ["result"])?.result === "revoked" ? { result: "revoked" } : null;
    case "generation-probe": {
      const item = qualificationFields(value, QUALIFICATION_CLOSURE_KEYS);
      return item && QUALIFICATION_CLOSURE_KEYS.every(key => item[key] === "recovery_required") ? Object.fromEntries(QUALIFICATION_CLOSURE_KEYS.map(key => [key, "recovery_required"])) as QualificationClosure : null;
    }
    case "inspect": {
      const item = qualificationFields(value, ["objects"]);
      if (!item || !Array.isArray(item.objects) || Object.getPrototypeOf(item.objects) !== Array.prototype || item.objects.length > 7) return null;
      const entries = Object.getOwnPropertyDescriptors(item.objects);
      if (Reflect.ownKeys(entries).length !== item.objects.length + 1) return null;
      const objects: QualificationObject[] = [];
      for (let index = 0; index < item.objects.length; index++) {
        const entry = entries[String(index)];
        if (!entry || !("value" in entry) || !entry.enumerable) return null;
        const object = qualificationFields(entry.value, ["kind", "byteLength", "sha256", "version", "bodyHex"]);
        const kindIndex = object ? (QUALIFICATION_OBJECT_KINDS as readonly unknown[]).indexOf(object.kind) : -1;
        const previousIndex = objects.length ? QUALIFICATION_OBJECT_KINDS.indexOf(objects[objects.length - 1].kind) : -1;
        if (!object || kindIndex < 0 || kindIndex <= previousIndex || !integer(object.byteLength, 744)
          || object.byteLength !== [160, 744, 688, 424, 424, 288, 424][kindIndex] || !qualificationHex(object.sha256)
          || typeof object.version !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(object.version)) return null;
        if (kindIndex === 0 ? object.byteLength !== 160 || object.bodyHex !== null
          : typeof object.bodyHex !== "string" || object.bodyHex.length !== 2 * object.byteLength || !/^[0-9a-f]+$/u.test(object.bodyHex)
            || qualificationDigest(qualificationBytes(object.bodyHex)) !== object.sha256) return null;
        objects.push({ kind: object.kind as QualificationObject["kind"], byteLength: object.byteLength, sha256: object.sha256, version: object.version, bodyHex: object.bodyHex as string | null });
      }
      return objects.length === 0 || objects[0].kind === "anchor" ? { objects } : null;
    }
    case "enroll-drop": case "insert-drop": return null;
  }
}

export function parseQualificationReply(run: QualificationRun, request: QualificationRequest, value: unknown): QualificationReply | null {
  try {
    const failure = qualificationFields(value, ["schemaVersion", "ok", "error"]);
    if (failure?.schemaVersion === 1 && failure.ok === false && typeof failure.error === "string" && (QUALIFICATION_ERRORS as readonly string[]).includes(failure.error))
      return Object.freeze({ schemaVersion: 1, ok: false, error: failure.error as QualificationError });
    const input = qualificationFields(value, ["schemaVersion", "runId", "stage", "ok", "value"]);
    if (!input || input.schemaVersion !== 1 || input.runId !== run.runId || input.stage !== request.stage || input.ok !== true) return null;
    const owned = replyValue(run, request, input.value);
    if (!owned) return null;
    const result = { schemaVersion: 1 as const, runId: run.runId, stage: request.stage, ok: true as const, value: owned };
    return encodeQualificationJson(result) ? Object.freeze(result) : null;
  } catch { return null; }
}
