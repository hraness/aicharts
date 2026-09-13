import { WorkerEntrypoint } from "cloudflare:workers";
import {
  encodeQualificationJson, parseQualificationAttempt, parseQualificationReply, parseQualificationRequest, parseQualificationRun,
  QUALIFICATION_CLOSURE_KEYS, QUALIFICATION_ERROR_STATUS, QUALIFICATION_OBJECT_KINDS, QUALIFICATION_REQUEST_BYTES, QUALIFICATION_URL,
  qualificationByteHex, qualificationBytes, qualificationDeviceId, qualificationDigest, qualificationFields, qualificationFixture, qualificationHex, qualificationIdentity,
  type QualificationEnrollment, type QualificationError, type QualificationObject, type QualificationRequest, type QualificationRun, type QualificationValue,
} from "../../../fixtures/usage/cloudflare-qualification";
import { decodeAdmissionJournal } from "../../../lib/usage/admission";
import { ADMISSION_POLICY_V1 } from "./admission-policy";
import { enrollmentAccountName, parseEnrollmentReservation } from "./enrollment-contract";
import { encodeNamespaceAnchor, enrollmentStorageCall, namespaceAnchorKey, readNamespaceAnchor, type NamespaceAnchor } from "./namespace-anchor";
import { uploadSecretCommitment } from "./pairing";
import dormant from "./index";

// Separate private configuration only. The normal index never imports this file.
export { PairingIntent } from "./pairing";
export { AccountEnrollment } from "./enrollment";
export default dormant;
export type SyntheticQualificationEnvironment = Pick<Env, "PAIRINGS" | "ACCOUNT_ENROLLMENTS" | "STAGING" | "CONTROL"> & {
  USAGE_ENROLLMENT_GENERATION?: unknown; AICHARTS_USAGE_SYNTHETIC_RUN?: unknown;
};
class QualificationFault extends Error {
  constructor(readonly code: QualificationError = "qualification_failed") { super(code); }
}
const fail = (code?: QualificationError): never => { throw new QualificationFault(code); };
const own = (value: unknown, keys: readonly string[]) => qualificationFields(value, keys) ?? fail();

function dispose(value: unknown): void {
  try {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
    const descriptor = Object.getOwnPropertyDescriptor(value, Symbol.dispose);
    if (descriptor && "value" in descriptor && typeof descriptor.value === "function") Reflect.apply(descriptor.value, value, []);
  } catch { /* No private exception text leaves this boundary. */ }
}

async function rpc(promise: Promise<unknown>, guard: () => void): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const raw = await enrollmentStorageCall(promise, dispose);
  try {
    guard();
    if (raw === null || typeof raw !== "object") return fail();
    const descriptors = Object.getOwnPropertyDescriptors(raw), result: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === Symbol.dispose) continue;
      if (typeof key !== "string" || !("value" in descriptors[key]) || !descriptors[key].enumerable) return fail();
      Object.defineProperty(result, key, { value: descriptors[key].value, enumerable: true });
    }
    const success = qualificationFields(result, ["ok", "value"]);
    if (success?.ok === true) return { ok: true, value: success.value };
    const failure = qualificationFields(result, ["ok", "error"]);
    if (failure?.ok === false && typeof failure.error === "string") return { ok: false, error: failure.error };
    return fail();
  } finally { dispose(raw); }
}
function succeeded(result: Awaited<ReturnType<typeof rpc>>): unknown { return result.ok ? result.value : fail(); }

async function readBytes(body: ReadableStream<Uint8Array>, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let length = 0, ended = false;
  const operation = (async () => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) { ended = true; break; }
      if (!(chunk.value instanceof Uint8Array) || chunk.value.length === 0 || chunk.value.length > maximum - length) return fail("invalid_request");
      length += chunk.value.length; chunks.push(Uint8Array.from(chunk.value));
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  })();
  try { return await enrollmentStorageCall(operation); }
  finally { if (!ended) void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

const headers = {
  "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
};
function failure(code: QualificationError, head = false): Response {
  return new Response(head ? null : encodeQualificationJson({ schemaVersion: 1, ok: false, error: code }), { status: QUALIFICATION_ERROR_STATUS[code], headers });
}

function enrolled(value: unknown, run: QualificationRun): QualificationEnrollment {
  const item = own(value, ["receipt", "deviceState"]), receipt = own(item.receipt, ["schemaVersion", "accountId", "intentId", "reservationId", "deviceId", "enrolledAtMs", "namespaceVersion"]);
  const identity = qualificationIdentity(run);
  if (receipt.schemaVersion !== 1 || receipt.namespaceVersion !== 1 || receipt.accountId !== identity.accountId || receipt.intentId !== identity.original.intentId
    || !qualificationHex(receipt.reservationId) || receipt.deviceId !== qualificationDeviceId(run, receipt.reservationId)
    || typeof receipt.enrolledAtMs !== "number" || !Number.isSafeInteger(receipt.enrolledAtMs) || receipt.enrolledAtMs < run.createdAtMs || receipt.enrolledAtMs >= run.expiresAtMs
    || (item.deviceState !== "active" && item.deviceState !== "revoked")) return fail();
  return { deviceId: receipt.deviceId, reservationId: receipt.reservationId, enrolledAtMs: receipt.enrolledAtMs, deviceState: item.deviceState };
}

async function anchorForRun(env: SyntheticQualificationEnvironment, run: QualificationRun, guard: () => void): Promise<NamespaceAnchor | null> {
  guard();
  const identity = qualificationIdentity(run), anchor = await readNamespaceAnchor(env.CONTROL, identity.accountId);
  guard();
  if (anchor !== null && (anchor.accountId !== identity.accountId || anchor.intentId !== identity.original.intentId || anchor.generation !== run.generationOne
    || anchor.createdAtMs < run.createdAtMs || anchor.createdAtMs >= run.expiresAtMs)) return fail();
  return anchor;
}

async function inspectObjects(env: SyntheticQualificationEnvironment, run: QualificationRun, guard: () => void): Promise<readonly QualificationObject[]> {
  const identity = qualificationIdentity(run), anchor = await anchorForRun(env, run, guard);
  const prefix = `usage-admission/v1/${identity.accountId.slice(5)}/${run.generationOne}`;
  const listed: string[] = [];
  for (const [bucket, suffix] of [[env.STAGING, "batches"], [env.CONTROL, "journal"]] as const) {
    guard();
    const result = await enrollmentStorageCall(bucket.list({ prefix: `${prefix}/${suffix}/`, limit: 4 })); guard();
    if (result.truncated || result.objects.length > 3) return fail();
    for (const object of result.objects) listed.push(object.key);
  }
  if (anchor === null) return listed.length === 0 ? [] : fail();
  const fixture = qualificationFixture(run, qualificationDeviceId(run, anchor.reservationId));
  const objects: QualificationObject[] = [];
  const found: string[] = [];
  for (const [index, kind] of QUALIFICATION_OBJECT_KINDS.entries()) {
    const isAnchor = index === 0, batchNumber = Math.ceil(index / 2), isBatch = index % 2 === 1;
    const batch = batchNumber === 1 ? fixture.insert : batchNumber === 2 ? fixture.correction : fixture.tombstone;
    const key = isAnchor ? namespaceAnchorKey(identity.accountId) : isBatch ? `${prefix}/batches/${qualificationByteHex(batch.batchHash)}.aicb`
      : `${prefix}/journal/${String(batchNumber).padStart(16, "0")}.aicj`;
    const bucket = isBatch ? env.STAGING : env.CONTROL;
    guard();
    const object = await enrollmentStorageCall(bucket.get(key), value => { if (value) void value.body.cancel().catch(() => undefined); });
    if (object === null) { guard(); continue; }
    let consumed = false;
    try {
      guard();
      const contentType = isAnchor ? "application/vnd.aicharts.namespace-v1" : isBatch ? "application/vnd.aicharts.usage-batch-v1" : "application/vnd.aicharts.usage-journal-v1";
      const custom = qualificationFields(object.customMetadata, ["schemaVersion"]), http = object.httpMetadata;
      const absent = ["contentLanguage", "contentDisposition", "contentEncoding", "cacheControl", "cacheExpiry"];
      if (custom?.schemaVersion !== "1" || !http || http.contentType !== contentType
        || Object.keys(http).some(key => key !== "contentType" && !absent.includes(key)) || absent.some(key => (http as Record<string, unknown>)[key] !== undefined)
        || !Number.isSafeInteger(object.size) || object.size < 1 || object.size > 744 || !object.checksums.sha256
        || typeof object.version !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(object.version)) return fail();
      const bytes = await readBytes(object.body, object.size); consumed = true; guard();
      if (bytes.length !== object.size || qualificationDigest(bytes) !== qualificationByteHex(new Uint8Array(object.checksums.sha256))) return fail();
      if (isAnchor ? qualificationByteHex(bytes) !== qualificationByteHex(encodeNamespaceAnchor(anchor))
        : isBatch ? qualificationByteHex(bytes) !== qualificationByteHex(batch.bytes)
          : !decodeAdmissionJournal(bytes, batch.bytes, ADMISSION_POLICY_V1).ok) return fail();
      if (!isAnchor) found.push(key);
      objects.push({ kind, byteLength: bytes.length, sha256: qualificationDigest(bytes), version: object.version, bodyHex: isAnchor ? null : qualificationByteHex(bytes) });
    } finally { if (!consumed) void object.body.cancel().catch(() => undefined); }
  }
  if (listed.length !== found.length || listed.some(key => !found.includes(key))) return fail();
  return objects;
}

async function stageValue(request: QualificationRequest, env: SyntheticQualificationEnvironment, run: QualificationRun, guard: () => void): Promise<QualificationValue> {
  const identity = qualificationIdentity(run), account = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(identity.accountId));
  if ("slot" in request) {
    const proof = identity[request.slot], pairing = env.PAIRINGS.getByName(proof.intentId), browserNonce = request.slot === "original" ? identity.originalNonce : identity.closureNonce;
    switch (request.stage) {
      case "initialize": {
        if (Date.now() + 600_000 > run.expiresAtMs) return fail("run_expired");
        const commitment = await uploadSecretCommitment(proof.intentId, proof.uploadSecret); guard();
        if (!commitment.ok) return fail();
        const result = own(succeeded(await rpc(pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment: commitment.value }), guard)), ["expiresAtMs"]);
        return { expiresAtMs: result.expiresAtMs as number };
      }
      case "begin": {
        // This is one dispatch, never a retryable bootstrap. Only the driver can
        // retain this random context; an ambiguous reply must stop the run.
        const attempt = parseQualificationAttempt(run, succeeded(await rpc(pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce }), guard)));
        return attempt ?? fail();
      }
      case "authenticate": case "approve": {
        const browser = { intentId: proof.intentId, attemptId: request.attempt.attemptId, contextToken: request.attempt.contextToken, browserNonce };
        const status = own(succeeded(await rpc(pairing.browserStatus(browser), guard)), ["state", "expiresAtMs", "accountId", "authenticationExpiresAtMs"]);
        if (status.expiresAtMs !== request.attempt.expiresAtMs) return fail();
        const authTimeMs = Math.floor(request.attempt.startedAtMs / 1000) * 1000, sessionExpiresAtMs = request.attempt.expiresAtMs;
        if (request.stage === "authenticate") {
          if (own(succeeded(await rpc(pairing.recordVerifiedAuthentication({ ...browser, accountId: identity.accountId, authTimeMs, sessionExpiresAtMs }), guard)), ["recorded"]).recorded !== true) return fail();
          return { recorded: true, authTimeMs, sessionExpiresAtMs };
        }
        const result = own(succeeded(await rpc(pairing.decideBrowser({ ...browser, accountId: identity.accountId, liveSessionExpiresAtMs: sessionExpiresAtMs, decision: "approve" }), guard)), ["state", "expiresAtMs", "accountId", "authenticationExpiresAtMs"]);
        if (result.accountId !== identity.accountId) return fail();
        return { state: result.state as "browser-approved", expiresAtMs: result.expiresAtMs as number, authenticationExpiresAtMs: result.authenticationExpiresAtMs as number };
      }
      case "confirm": {
        const result = own(succeeded(await rpc(pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: identity.accountId }), guard)), ["state", "expiresAtMs", "pollAfterMs", "approvedAccountId"]);
        if (result.approvedAccountId !== identity.accountId) return fail();
        return { state: result.state as "terminal-confirmed", expiresAtMs: result.expiresAtMs as number };
      }
      case "reserve": {
        const reservation = parseEnrollmentReservation(succeeded(await rpc(pairing.reserveEnrollment(proof), guard)));
        if (!reservation || reservation.accountId !== identity.accountId || reservation.intentId !== proof.intentId) return fail();
        return { reservationId: reservation.reservationId, reservedAtMs: reservation.reservedAtMs, expiresAtMs: reservation.expiresAtMs,
          generation: reservation.recoveryGeneration, deviceId: qualificationDeviceId(run, reservation.reservationId, request.slot) };
      }
    }
  }
  const query = { schemaVersion: 1, accountId: identity.accountId, sessionExpiresAtMs: run.expiresAtMs, firstUtcDay: run.firstUtcDay, dayCount: 3 };
  switch (request.stage) {
    case "enroll": case "enroll-drop": {
      const result = enrolled(succeeded(await rpc(account.enroll(identity.original), guard)), run);
      if (request.stage === "enroll-drop") return fail("synthetic_reply_withheld");
      return result;
    }
    case "namespace": {
      const result = own(succeeded(await rpc(account.namespaceForEnrollment(identity.original), guard)), ["schemaVersion", "namespaceVersion", "namespaceKey", "receipt"]);
      if (result.schemaVersion !== 1 || result.namespaceVersion !== 1 || !qualificationHex(result.namespaceKey)) return fail();
      const receipt = enrolled({ receipt: result.receipt, deviceState: "active" }, run), anchor = await anchorForRun(env, run, guard);
      if (!anchor || anchor.namespaceKey !== result.namespaceKey || anchor.reservationId !== receipt.reservationId) return fail();
      return { namespaceSha256: qualificationDigest(qualificationBytes(result.namespaceKey)), anchorSha256: qualificationDigest(encodeNamespaceAnchor(anchor)), deviceId: receipt.deviceId };
    }
    case "insert": case "insert-drop": case "correct": case "tombstone": case "revoked-probe": {
      const anchor = await anchorForRun(env, run, guard);
      if (!anchor) return fail();
      if (request.stage === "revoked-probe") {
        // Inspect the retained receipt; this does not revoke or extend authority.
        // An out-of-order probe must not publish a fourth batch before refusing.
        const receipt = enrolled(succeeded(await rpc(account.enroll(identity.original), guard)), run);
        if (receipt.deviceState !== "revoked" || receipt.reservationId !== anchor.reservationId) return fail();
      }
      const fixture = qualificationFixture(run, qualificationDeviceId(run, anchor.reservationId));
      const batch = request.stage === "insert" || request.stage === "insert-drop" ? fixture.insert : request.stage === "correct" ? fixture.correction : request.stage === "tombstone" ? fixture.tombstone : fixture.revokedProbe;
      const result = await rpc(account.admitBatch({ uploadSecret: identity.original.uploadSecret, batch: batch.bytes }), guard);
      if (request.stage === "revoked-probe") return !result.ok && result.error === "revoked" ? { result: "revoked" } : fail();
      const journal = succeeded(result);
      if (!(journal instanceof Uint8Array) || !decodeAdmissionJournal(journal, batch.bytes, ADMISSION_POLICY_V1).ok) return fail();
      if (request.stage === "insert-drop") return fail("synthetic_reply_withheld");
      return { batchHex: qualificationByteHex(batch.bytes), journalHex: qualificationByteHex(journal) };
    }
    case "read": return succeeded(await rpc(account.readImportedDays(query), guard)) as QualificationValue;
    case "revoke": return enrolled(succeeded(await rpc(account.revokeEnrollment(identity.original), guard)), run);
    case "generation-probe": {
      const anchor = await anchorForRun(env, run, guard);
      if (!anchor || (await inspectObjects(env, run, guard)).length !== 7) return fail();
      const fixture = qualificationFixture(run, qualificationDeviceId(run, anchor.reservationId));
      // Each call exercises the source fence; no environment error is fabricated
      // by the harness. The fresh G2 reservation was a separate completed step.
      const calls = [
        () => env.PAIRINGS.getByName(identity.original.intentId).readEnrollmentReservation(identity.original),
        () => account.enroll(identity.original), () => account.namespaceForEnrollment(identity.original),
        () => account.admitBatch({ uploadSecret: identity.original.uploadSecret, batch: fixture.tombstone.bytes }),
        () => account.readImportedDays(query), () => account.enroll(identity.closure), () => account.recoverPendingEnrollment(identity.closure),
      ];
      const result: Record<string, "recovery_required"> = Object.create(null);
      for (const [index, call] of calls.entries()) {
        guard();
        const response = await rpc(call(), guard);
        if (response.ok || response.error !== "recovery_required") return fail();
        result[QUALIFICATION_CLOSURE_KEYS[index]] = "recovery_required";
      }
      return result as QualificationValue;
    }
    case "inspect": return { objects: await inspectObjects(env, run, guard) };
  }
  return fail();
}

/** Finite synthetic stages only; this contains no generic RPC/key/account proxy. */
export function createSyntheticQualificationHandler() {
  return async (request: Request, env: SyntheticQualificationEnvironment): Promise<Response> => {
    if (request.method !== "POST") return failure("method_not_allowed", request.method === "HEAD");
    try {
      const captured = env.AICHARTS_USAGE_SYNTHETIC_RUN;
      if (typeof captured !== "string" || captured.length > QUALIFICATION_REQUEST_BYTES) return failure("qualification_unavailable");
      let run: QualificationRun | null = null;
      try { run = parseQualificationRun(JSON.parse(captured) as unknown); } catch { /* Closed unconfigured template. */ }
      const generation = env.USAGE_ENROLLMENT_GENERATION;
      if (!run || (generation !== run.generationOne && generation !== run.generationTwo)) return failure("qualification_unavailable");
      let observed = Date.now();
      const started = observed;
      const guard = () => {
        const now = Date.now();
        if (!Number.isSafeInteger(now) || now < observed || now < run.createdAtMs || now - started >= 15_000 || request.signal.aborted
          || env.AICHARTS_USAGE_SYNTHETIC_RUN !== captured || env.USAGE_ENROLLMENT_GENERATION !== generation) return fail("qualification_unavailable");
        observed = now;
        if (now >= run.expiresAtMs) return fail("run_expired");
      };
      guard();
      const length = request.headers.get("content-length");
      if (request.url !== QUALIFICATION_URL || request.headers.get("content-type") !== "application/json"
        || (request.headers.has("accept") && request.headers.get("accept") !== "application/json")
        || ["authorization", "cookie", "origin", "content-encoding", "transfer-encoding"].some(key => request.headers.has(key))
        || (length !== null && (!/^[1-9][0-9]{0,3}$/u.test(length) || Number(length) > QUALIFICATION_REQUEST_BYTES)) || !request.body) return failure("invalid_request");
      const bytes = await readBytes(request.body, QUALIFICATION_REQUEST_BYTES); guard();
      if (length !== null && bytes.length !== Number(length)) return failure("invalid_request");
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown; } catch { return failure("invalid_request"); }
      const input = parseQualificationRequest(run, parsed);
      if (!input) return failure("invalid_request");
      const canonical = encodeQualificationJson(input, QUALIFICATION_REQUEST_BYTES);
      if (!canonical || canonical.length !== bytes.length || canonical.some((value, index) => value !== bytes[index])) return failure("invalid_request");
      const needsG2 = "slot" in input ? input.slot === "closure" : input.stage === "generation-probe";
      if (input.stage !== "inspect" && generation !== (needsG2 ? run.generationTwo : run.generationOne)) return failure("qualification_unavailable");
      const value = await stageValue(input, env, run, guard); guard();
      const reply = parseQualificationReply(run, input, { schemaVersion: 1, runId: run.runId, stage: input.stage, ok: true, value });
      if (!reply) return failure("qualification_failed");
      const body = encodeQualificationJson(reply);
      if (!body) return failure("qualification_failed");
      guard();
      return new Response(body, { status: 200, headers });
    } catch (error) { return failure(error instanceof QualificationFault ? error.code : "qualification_unavailable"); }
  };
}

const handler = createSyntheticQualificationHandler();
export class SyntheticQualification extends WorkerEntrypoint<SyntheticQualificationEnvironment> {
  async fetch(request: Request): Promise<Response> { return await handler(request, this.env); }
}
