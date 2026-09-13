import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  QUALIFICATION_ERROR_STATUS, QUALIFICATION_REPLY_BYTES, QUALIFICATION_REQUEST_BYTES,
  QUALIFICATION_RUN_MS, QUALIFICATION_URL, encodeQualificationJson, parseQualificationReply,
  parseQualificationRequest, parseQualificationRun, qualificationByteHex, qualificationBytes,
  qualificationDigest, qualificationExpectedDays, qualificationFields, qualificationFixture, qualificationHex,
  type QualificationAttempt, type QualificationEnrollment, type QualificationObject, type QualificationReply,
  type QualificationRequest, type QualificationRun, type QualificationSlot, type QualificationStage,
} from "../fixtures/usage/cloudflare-qualification";
import { decodeAdmissionJournal } from "../lib/usage/admission";
import { DAY_MS } from "../lib/usage/wire";
import { ADMISSION_POLICY_V1 } from "../services/usage-worker/src/admission-policy";

/** These targets are reviewed independently by the integration owner before deployment. */
export const QUALIFICATION_TARGET = Object.freeze({
  workerName: "aicharts-usage-synthetic-qualification",
  recordsBucket: "aicharts-usage-records", controlBucket: "aicharts-usage-control",
});
export const QUALIFICATION_ATTEMPT_MS = 20_000;
const MAX_MANIFEST_BYTES = 1_048_576;
const root = fileURLToPath(new URL("../", import.meta.url));
const templateDirectory = join(root, "services/usage-worker/qualification");
const phases = ["initial", "redeploy", "generation-two"] as const;
type Phase = typeof phases[number];
type SequenceStep = Readonly<{ id: string; stage: QualificationStage; slot?: QualificationSlot; phase: Phase }>;
const step = (id: string, stage: QualificationStage, phase: Phase, slot?: QualificationSlot): SequenceStep => ({ id, stage, phase, ...(slot ? { slot } : {}) });
const pairingSteps = (slot: QualificationSlot, phase: Phase): SequenceStep[] =>
  (["initialize", "begin", "authenticate", "approve", "confirm", "reserve"] as const).map(stage => step(`${slot}-${stage}`, stage, phase, slot));

/** Every invocation dispatches at most one entry. Deployments are separate, explicit checkpoints. */
export const QUALIFICATION_SEQUENCE: readonly SequenceStep[] = Object.freeze([
  step("initial-empty", "inspect", "initial"), ...pairingSteps("original", "initial"),
  step("enrollment-reply-loss", "enroll-drop", "initial"), step("enroll", "enroll", "initial"),
  step("enroll-replay", "enroll", "initial"), step("namespace", "namespace", "initial"),
  step("enrolled-objects", "inspect", "initial"), step("insert-reply-loss", "insert-drop", "initial"),
  step("insert", "insert", "initial"), step("insert-replay", "insert", "initial"),
  step("insert-days", "read", "initial"), step("insert-objects", "inspect", "initial"),
  step("redeployed-enroll", "enroll", "redeploy"),
  step("redeployed-insert", "insert", "redeploy"), step("redeployed-days", "read", "redeploy"),
  step("redeployed-objects", "inspect", "redeploy"), step("correction", "correct", "redeploy"),
  step("correction-days", "read", "redeploy"), step("correction-objects", "inspect", "redeploy"),
  step("tombstone", "tombstone", "redeploy"), step("tombstone-days", "read", "redeploy"),
  step("tombstone-objects", "inspect", "redeploy"), step("revoke", "revoke", "redeploy"),
  step("revoke-replay", "revoke", "redeploy"), step("revoked-latest-retry", "tombstone", "redeploy"),
  step("revoked-new-operation", "revoked-probe", "redeploy"), step("revoked-days", "read", "redeploy"),
  step("revoked-objects", "inspect", "redeploy"), ...pairingSteps("closure", "generation-two"),
  step("generation-closure", "generation-probe", "generation-two"), step("final-objects", "inspect", "generation-two"),
]);

export type DeploymentReceipt = Readonly<{
  schemaVersion: 1; phase: Phase; accountId: string; workerName: string; sourceSha: string; sourceDigest: string;
  runDigest: string; configSha256: string; versionId: string; deploymentId: string;
  pairingsNamespaceId: string; enrollmentsNamespaceId: string; recordsBucket: string; controlBucket: string;
  workersDev: false; previewUrls: false; routeCount: 0; observabilityEnabled: false; trafficPercent: 100; verifiedAtMs: number;
}>;
type StepState = "prepared" | "dispatched" | "complete" | "ambiguous";
export type QualificationStepRecord = {
  id: string; requestHex: string; state: StepState; attemptCount: number; dispatchedAtMs: number | null;
  replyHex: string | null;
};
export type QualificationManifest = {
  schemaVersion: 1; accountId: string; sourceSha: string; sourceDigest: string; run: QualificationRun;
  deployments: DeploymentReceipt[]; steps: QualificationStepRecord[];
};
type Reservation = { reservationId: string; reservedAtMs: number; expiresAtMs: number; generation: string; deviceId: string };
type Namespace = { namespaceSha256: string; anchorSha256: string; deviceId: string };
type BatchEvidence = { batchHex: string; journalHex: string; committedAtMs: number };
type Evidence = {
  initialized: Partial<Record<QualificationSlot, number>>; attempts: Partial<Record<QualificationSlot, QualificationAttempt>>;
  reservations: Partial<Record<QualificationSlot, Reservation>>; enrollment?: QualificationEnrollment; namespace?: Namespace;
  batches: Partial<Record<"insert" | "correct" | "tombstone", BatchEvidence>>; revision: 0 | 1 | 2 | 3;
  objects: readonly QualificationObject[]; revoked: boolean;
};
const freshEvidence = (): Evidence => ({ initialized: {}, attempts: {}, reservations: {}, batches: {}, revision: 0, objects: [], revoked: false });
const fail = (code = "invalid_qualification_state"): never => { throw new Error(code); };
const requireThat: (value: unknown, code?: string) => asserts value = (value, code) => { if (!value) fail(code); };
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0;
const isSha = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{40}$/u.test(value) && value !== "0".repeat(40);
const isProviderId = (value: unknown): value is string => typeof value === "string" && /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.test(value) && !/^0+$/u.test(value.replaceAll("-", ""));
function jsonBytes(value: unknown, max = QUALIFICATION_REPLY_BYTES): Uint8Array<ArrayBuffer> {
  const bytes = encodeQualificationJson(value, max); requireThat(bytes); return bytes;
}
function readJsonHex(value: unknown, max: number): unknown {
  requireThat(typeof value === "string" && value.length >= 2 && value.length <= max * 2 && /^(?:[0-9a-f]{2})+$/u.test(value));
  const bytes = qualificationBytes(value), text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(text); requireThat(qualificationByteHex(jsonBytes(parsed, max)) === value); return parsed;
}

function requestFor(run: QualificationRun, entry: SequenceStep, evidence: Evidence): QualificationRequest {
  const request = parseQualificationRequest(run, { schemaVersion: 1, runId: run.runId, stage: entry.stage,
    ...(entry.slot ? { slot: entry.slot } : {}),
    ...(entry.stage === "authenticate" || entry.stage === "approve" ? { attempt: evidence.attempts[entry.slot!] } : {}) });
  requireThat(request); return request;
}

function acceptEvidence(run: QualificationRun, request: QualificationRequest, reply: QualificationReply, evidence: Evidence): void {
  if (!reply.ok) {
    requireThat((request.stage === "enroll-drop" || request.stage === "insert-drop") && reply.error === "synthetic_reply_withheld");
    return;
  }
  const value = reply.value;
  switch (request.stage) {
    case "initialize": {
      requireThat("expiresAtMs" in value); evidence.initialized[request.slot] = value.expiresAtMs; break;
    }
    case "begin": {
      requireThat("attemptId" in value && value.expiresAtMs === evidence.initialized[request.slot]);
      evidence.attempts[request.slot] = value; break;
    }
    case "authenticate": case "approve": break; // Frozen parser binds server authentication times to the exact retained attempt.
    case "confirm": {
      requireThat("expiresAtMs" in value && value.expiresAtMs === evidence.attempts[request.slot]?.expiresAtMs); break;
    }
    case "reserve": {
      const attempt = evidence.attempts[request.slot];
      requireThat("reservedAtMs" in value && attempt && value.reservedAtMs >= attempt.startedAtMs && value.expiresAtMs === attempt.expiresAtMs);
      evidence.reservations[request.slot] = value; break;
    }
    case "enroll": case "revoke": {
      const reservation = evidence.reservations.original;
      requireThat("enrolledAtMs" in value && reservation && value.deviceId === reservation.deviceId && value.reservationId === reservation.reservationId
        && value.enrolledAtMs >= reservation.reservedAtMs && value.enrolledAtMs < reservation.expiresAtMs);
      if (request.stage === "enroll") {
        requireThat(value.deviceState === "active" && (!evidence.enrollment || same(value, evidence.enrollment)));
        evidence.enrollment = value;
      } else {
        requireThat(evidence.enrollment && same(value, { ...evidence.enrollment, deviceState: "revoked" })); evidence.revoked = true;
      }
      break;
    }
    case "namespace": {
      requireThat("namespaceSha256" in value && value.deviceId === evidence.enrollment?.deviceId
        && (!evidence.namespace || same(value, evidence.namespace))); evidence.namespace = value; break;
    }
    case "insert": case "correct": case "tombstone": {
      requireThat("batchHex" in value && evidence.enrollment && evidence.namespace);
      const fixture = qualificationFixture(run, evidence.enrollment.deviceId);
      const batch = request.stage === "insert" ? fixture.insert : request.stage === "correct" ? fixture.correction : fixture.tombstone;
      requireThat(value.batchHex === qualificationByteHex(batch.bytes));
      const journal = decodeAdmissionJournal(qualificationBytes(value.journalHex), batch.bytes, ADMISSION_POLICY_V1);
      requireThat(journal.ok && journal.value.committedAtMs >= evidence.enrollment.enrolledAtMs
        && journal.value.receipts.every((receipt, index) => qualificationByteHex(receipt.headOperationHash) === qualificationByteHex(batch.operations[index].operationHash)));
      const previous = evidence.batches[request.stage];
      if (previous) requireThat(value.batchHex === previous.batchHex && value.journalHex === previous.journalHex);
      else {
        const revision = request.stage === "insert" ? 1 : request.stage === "correct" ? 2 : 3;
        requireThat(revision === evidence.revision + 1 && !evidence.revoked);
        const older = evidence.revision === 1 ? evidence.batches.insert : evidence.revision === 2 ? evidence.batches.correct : undefined;
        requireThat(!older || journal.value.committedAtMs >= older.committedAtMs);
        evidence.batches[request.stage] = { ...value, committedAtMs: journal.value.committedAtMs }; evidence.revision = revision;
      }
      break;
    }
    case "read": {
      const accepted = evidence.revision === 1 ? evidence.batches.insert : evidence.revision === 2 ? evidence.batches.correct : evidence.batches.tombstone;
      requireThat(accepted && evidence.revision > 0 && same(value, qualificationExpectedDays(run, evidence.revision as 1 | 2 | 3, accepted.committedAtMs))); break;
    }
    case "inspect": {
      requireThat("objects" in value);
      const expectedCount = evidence.namespace ? 1 + 2 * evidence.revision : 0;
      requireThat(value.objects.length === expectedCount);
      for (const [index, object] of value.objects.entries()) {
        if (index === 0) requireThat(object.sha256 === evidence.namespace?.anchorSha256 && object.byteLength === 160 && object.bodyHex === null);
        else {
          const batch = index <= 2 ? evidence.batches.insert : index <= 4 ? evidence.batches.correct : evidence.batches.tombstone;
          requireThat(batch);
          const bytes = index % 2 === 1 ? batch.batchHex : batch.journalHex;
          requireThat(object.bodyHex === bytes && object.byteLength === bytes.length / 2 && object.sha256 === qualificationDigest(qualificationBytes(bytes)));
        }
        requireThat(!evidence.objects[index] || same(object, evidence.objects[index]));
      }
      evidence.objects = value.objects; break;
    }
    case "revoked-probe": requireThat(evidence.revoked); break;
    case "generation-probe": requireThat(evidence.revoked && evidence.reservations.closure && evidence.objects.length === 7); break;
    case "enroll-drop": case "insert-drop": fail();
  }
}

const closedDriver = {
  $schema: "../../../node_modules/wrangler/config-schema.json", name: "aicharts-usage-qualification-driver-closed",
  compatibility_date: "2026-09-10", compatibility_flags: ["nodejs_compat"], workers_dev: false, preview_urls: false,
  send_metrics: false, observability: { enabled: false },
  services: [{ binding: "QUALIFICATION", service: "aicharts-usage-synthetic-qualification-unconfigured", entrypoint: "SyntheticQualification", remote: false }],
};
const closedService = {
  $schema: "../../../node_modules/wrangler/config-schema.json", name: "aicharts-usage-synthetic-qualification-closed", main: "../src/synthetic-qualification.ts",
  compatibility_date: "2026-09-10", compatibility_flags: ["nodejs_compat"], workers_dev: false, preview_urls: false,
  send_metrics: false, observability: { enabled: false }, vars: { USAGE_ENROLLMENT_GENERATION: "" },
  durable_objects: { bindings: [{ name: "PAIRINGS", class_name: "PairingIntent" }, { name: "ACCOUNT_ENROLLMENTS", class_name: "AccountEnrollment" }] },
  exports: { SyntheticQualification: { type: "worker" }, PairingIntent: { type: "durable-object", storage: "sqlite" },
    AccountEnrollment: { type: "durable-object", storage: "sqlite" } }, r2_buckets: [],
};

export function qualificationConfigs(run: QualificationRun, accountId: string): Readonly<Record<"driver" | "generationOne" | "generationTwo", string>> {
  requireThat(typeof accountId === "string" && /^[0-9a-f]{32}$/u.test(accountId) && !/^0+$/u.test(accountId));
  const service = (generation: string) => JSON.stringify({ ...closedService,
    $schema: join(root, "node_modules/wrangler/config-schema.json"), account_id: accountId,
    name: QUALIFICATION_TARGET.workerName, main: join(root, "services/usage-worker/src/synthetic-qualification.ts"),
    vars: { USAGE_ENROLLMENT_GENERATION: generation, AICHARTS_USAGE_SYNTHETIC_RUN: JSON.stringify(run) },
    r2_buckets: [{ binding: "STAGING", bucket_name: QUALIFICATION_TARGET.recordsBucket }, { binding: "CONTROL", bucket_name: QUALIFICATION_TARGET.controlBucket }],
  });
  return { driver: JSON.stringify({ ...closedDriver, $schema: join(root, "node_modules/wrangler/config-schema.json"),
    account_id: accountId,
    services: [{ binding: "QUALIFICATION", service: QUALIFICATION_TARGET.workerName, entrypoint: "SyntheticQualification", remote: true }],
  }), generationOne: service(run.generationOne), generationTwo: service(run.generationTwo) };
}
const configNames = { driver: "wrangler.driver.json", generationOne: "wrangler.generation-one.json", generationTwo: "wrangler.generation-two.json" } as const;
const receiptKeys = ["schemaVersion", "phase", "accountId", "workerName", "sourceSha", "sourceDigest", "runDigest", "configSha256", "versionId", "deploymentId", "pairingsNamespaceId", "enrollmentsNamespaceId", "recordsBucket", "controlBucket", "workersDev", "previewUrls", "routeCount", "observabilityEnabled", "trafficPercent", "verifiedAtMs"] as const;
function checkedDeployment(manifest: QualificationManifest, value: unknown, index: number): DeploymentReceipt {
  const item = qualificationFields(value, receiptKeys), first = manifest.deployments[0];
  requireThat(item && item.schemaVersion === 1 && item.phase === phases[index] && item.accountId === manifest.accountId
    && item.workerName === QUALIFICATION_TARGET.workerName && item.recordsBucket === QUALIFICATION_TARGET.recordsBucket && item.controlBucket === QUALIFICATION_TARGET.controlBucket
    && item.sourceSha === manifest.sourceSha && item.sourceDigest === manifest.sourceDigest && item.runDigest === qualificationDigest(JSON.stringify(manifest.run))
    && item.configSha256 === qualificationDigest(qualificationConfigs(manifest.run, manifest.accountId)[index === 2 ? "generationTwo" : "generationOne"])
    && isProviderId(item.versionId) && isProviderId(item.deploymentId)
    && isProviderId(item.pairingsNamespaceId) && /^[0-9a-f]{32}$/u.test(item.pairingsNamespaceId)
    && isProviderId(item.enrollmentsNamespaceId) && /^[0-9a-f]{32}$/u.test(item.enrollmentsNamespaceId)
    && item.pairingsNamespaceId !== item.enrollmentsNamespaceId && item.workersDev === false && item.previewUrls === false
    && item.routeCount === 0 && item.observabilityEnabled === false && item.trafficPercent === 100 && isTime(item.verifiedAtMs)
    && item.verifiedAtMs >= manifest.run.createdAtMs && item.verifiedAtMs < manifest.run.expiresAtMs);
  if (index > 0) requireThat(first && item.pairingsNamespaceId === first.pairingsNamespaceId && item.enrollmentsNamespaceId === first.enrollmentsNamespaceId
    && manifest.deployments.slice(0, index).every(old => item.versionId !== old.versionId && item.deploymentId !== old.deploymentId && (item.verifiedAtMs as number) >= old.verifiedAtMs));
  return Object.fromEntries(receiptKeys.map(key => [key, item[key]])) as DeploymentReceipt;
}

/** Replay the retained evidence, not a saved boolean claiming success. */
export function checkQualificationManifest(value: unknown): QualificationManifest {
  const item = qualificationFields(value, ["schemaVersion", "accountId", "sourceSha", "sourceDigest", "run", "deployments", "steps"]);
  requireThat(item?.schemaVersion === 1 && typeof item.accountId === "string" && /^[0-9a-f]{32}$/u.test(item.accountId) && !/^0+$/u.test(item.accountId) && isSha(item.sourceSha) && qualificationHex(item.sourceDigest)
    && Array.isArray(item.deployments) && item.deployments.length <= phases.length && Array.isArray(item.steps) && item.steps.length <= QUALIFICATION_SEQUENCE.length);
  const run = parseQualificationRun(item.run); requireThat(run);
  const manifest: QualificationManifest = { schemaVersion: 1, accountId: item.accountId, sourceSha: item.sourceSha, sourceDigest: item.sourceDigest, run, deployments: [], steps: [] };
  for (const receipt of item.deployments) manifest.deployments.push(checkedDeployment(manifest, receipt, manifest.deployments.length));
  const evidence = freshEvidence();
  for (const [index, raw] of item.steps.entries()) {
    const record = qualificationFields(raw, ["id", "requestHex", "state", "attemptCount", "dispatchedAtMs", "replyHex"]), entry = QUALIFICATION_SEQUENCE[index];
    requireThat(record && record.id === entry.id && ["prepared", "dispatched", "complete", "ambiguous"].includes(String(record.state))
      && isTime(record.attemptCount) && record.attemptCount <= 3 && (record.state === "complete" || index === item.steps.length - 1)
      && manifest.deployments.some(receipt => receipt.phase === entry.phase));
    const request = requestFor(run, entry, evidence), requestHex = qualificationByteHex(jsonBytes(request, QUALIFICATION_REQUEST_BYTES));
    requireThat(record.requestHex === requestHex && (entry.stage !== "begin" || record.attemptCount <= 1));
    if (record.state === "prepared") requireThat(record.attemptCount === 0 && record.dispatchedAtMs === null && record.replyHex === null);
    else requireThat(record.attemptCount >= 1 && isTime(record.dispatchedAtMs) && record.dispatchedAtMs >= run.createdAtMs && record.dispatchedAtMs < run.expiresAtMs);
    if (record.state === "complete") {
      const reply = parseQualificationReply(run, request, readJsonHex(record.replyHex, QUALIFICATION_REPLY_BYTES)); requireThat(reply);
      acceptEvidence(run, request, reply, evidence);
    } else requireThat(record.replyHex === null);
    manifest.steps.push({ id: entry.id, requestHex, state: record.state as StepState, attemptCount: record.attemptCount,
      dispatchedAtMs: record.dispatchedAtMs as number | null, replyHex: record.replyHex as string | null });
  }
  for (let index = 1; index < manifest.deployments.length; index++) {
    const boundary = QUALIFICATION_SEQUENCE.findIndex(entry => entry.phase === phases[index]);
    requireThat(manifest.steps.length >= boundary && manifest.steps.slice(0, boundary).every(record => record.state === "complete"));
    const previous = manifest.steps[boundary - 1];
    requireThat(previous.dispatchedAtMs !== null && manifest.deployments[index].verifiedAtMs >= previous.dispatchedAtMs);
  }
  return manifest;
}

function evidenceFor(manifest: QualificationManifest): Evidence {
  const evidence = freshEvidence();
  for (const [index, record] of manifest.steps.entries()) {
    if (record.state !== "complete") break;
    const request = requestFor(manifest.run, QUALIFICATION_SEQUENCE[index], evidence);
    const reply = parseQualificationReply(manifest.run, request, readJsonHex(record.replyHex, QUALIFICATION_REPLY_BYTES)); requireThat(reply);
    acceptEvidence(manifest.run, request, reply, evidence);
  }
  return evidence;
}
function nextIndex(manifest: QualificationManifest): number { return manifest.steps.filter(record => record.state === "complete").length; }
export function qualificationSummary(manifestInput: QualificationManifest) {
  const manifest = checkQualificationManifest(manifestInput), index = nextIndex(manifest), next = QUALIFICATION_SEQUENCE.at(index), record = manifest.steps[index];
  const complete = index === QUALIFICATION_SEQUENCE.length;
  const checkpoint = next && !manifest.deployments.some(receipt => receipt.phase === next.phase) ? next.phase : null;
  return { schemaVersion: 1, syntheticOnly: true, state: complete ? "complete" : checkpoint ? "deployment_required"
    : record?.state === "dispatched" || record?.state === "ambiguous" ? "ambiguous" : "ready",
  completedSteps: index, totalSteps: QUALIFICATION_SEQUENCE.length, nextStep: next?.id ?? null, deploymentCheckpoint: checkpoint,
  retryAllowed: (record?.state === "dispatched" || record?.state === "ambiguous") && next?.stage !== "begin" && record.attemptCount < 3,
  objectCount: evidenceFor(manifest).objects.length, deploymentReceipts: manifest.deployments.length,
  providerReceipts: "caller-verified", productionActivation: false } as const;
}

async function readRegular(path: string, max: number, privateFile = false): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat(); requireThat(before.isFile() && before.size <= max
      && (!privateFile || (before.nlink === 1 && (before.mode & 0o777) === 0o600 && before.uid === process.getuid?.())));
    const bytes = Buffer.alloc(before.size + 1); let size = 0;
    while (size < bytes.length) { const read = await handle.read(bytes, size, bytes.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
    const after = await handle.stat(); requireThat(size === before.size && before.ino === after.ino && before.mtimeMs === after.mtimeMs && before.size === after.size);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
  } finally { await handle.close(); }
}
async function directory(path: string): Promise<void> {
  requireThat(isAbsolute(path) && resolve(path) === path && await realpath(path) === path);
  const stat = await lstat(path); requireThat(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o700 && stat.uid === process.getuid?.());
}
async function syncDirectory(path: string): Promise<void> { const handle = await open(path, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }
async function writeNew(path: string, text: string): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
}
async function saveManifest(path: string, manifest: QualificationManifest): Promise<void> {
  const checked = checkQualificationManifest(manifest), text = JSON.stringify(checked); requireThat(Buffer.byteLength(text) <= MAX_MANIFEST_BYTES);
  const temporary = join(path, `.manifest-${randomBytes(12).toString("hex")}.tmp`);
  await writeNew(temporary, text); await rename(temporary, join(path, "manifest.json")); await syncDirectory(path);
}

/** Hash the bounded local source set; no Git, credentials or provider command runs here. */
async function sourceDigest(): Promise<string> {
  const files = ["Cargo.lock", "bun.lock", "package.json", "scripts/usage-cloudflare-qualification.ts", "fixtures/usage/cloudflare-qualification.ts",
    "services/usage-worker/qualification/wrangler.driver.jsonc", "services/usage-worker/qualification/wrangler.service.jsonc"];
  async function collect(subdirectory: string, depth = 0): Promise<void> {
    requireThat(depth <= 4 && files.length <= 256);
    for (const entry of await readdir(join(root, subdirectory), { withFileTypes: true })) {
      requireThat(entry.isFile() || entry.isDirectory());
      if (entry.isDirectory()) await collect(`${subdirectory}/${entry.name}`, depth + 1);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(`${subdirectory}/${entry.name}`);
    }
  }
  for (const subdirectory of ["lib/usage", "services/usage-worker/src"]) await collect(subdirectory);
  let total = 0; const entries: string[] = [];
  for (const file of files.sort()) { const text = await readRegular(join(root, file), 2_097_152); total += Buffer.byteLength(text); requireThat(total <= 16_777_216); entries.push(`${file}\0${qualificationDigest(text)}`); }
  for (const [name, expected] of [["driver", closedDriver], ["service", closedService]] as const) {
    const text = await readRegular(join(templateDirectory, `wrangler.${name}.jsonc`), 16_384);
    const parsed: unknown = JSON.parse(text.replace(/^\s*\/\/[^\n]*$/gmu, "")); requireThat(same(parsed, expected), "closed_template_changed");
  }
  const installed: unknown = JSON.parse(await readRegular(join(root, "node_modules/wrangler/package.json"), 65_536));
  requireThat(installed !== null && typeof installed === "object" && "version" in installed && installed.version === "4.131.0", "wrangler_version_changed");
  return qualificationDigest(entries.join("\n"));
}

export async function prepareQualification(path: string, sourceSha: string, target: unknown, now = Date.now()): Promise<QualificationManifest> {
  requireThat(isAbsolute(path) && resolve(path) === path && await realpath(dirname(path)) === dirname(path) && isSha(sourceSha));
  const ownedTarget = qualificationFields(target, ["accountId", "workerName", "recordsBucket", "controlBucket"]);
  requireThat(ownedTarget && typeof ownedTarget.accountId === "string" && /^[0-9a-f]{32}$/u.test(ownedTarget.accountId) && !/^0+$/u.test(ownedTarget.accountId)
    && ownedTarget.workerName === QUALIFICATION_TARGET.workerName && ownedTarget.recordsBucket === QUALIFICATION_TARGET.recordsBucket && ownedTarget.controlBucket === QUALIFICATION_TARGET.controlBucket);
  const digest = await sourceDigest();
  const run = parseQualificationRun({ schemaVersion: 1, runId: randomBytes(12).toString("hex"), createdAtMs: now,
    expiresAtMs: now + QUALIFICATION_RUN_MS, firstUtcDay: Math.floor(now / DAY_MS) - 3,
    generationOne: randomBytes(32).toString("hex"), generationTwo: randomBytes(32).toString("hex") }); requireThat(run);
  const manifest: QualificationManifest = { schemaVersion: 1, accountId: ownedTarget.accountId, sourceSha, sourceDigest: digest, run, deployments: [], steps: [] };
  await mkdir(path, { mode: 0o700 }); // Never adopt or overwrite an existing run directory.
  await directory(path);
  for (const [name, text] of Object.entries(qualificationConfigs(run, manifest.accountId))) await writeNew(join(path, configNames[name as keyof typeof configNames]), text);
  await writeNew(join(path, "manifest.json"), JSON.stringify(manifest)); await syncDirectory(path); return manifest;
}
export async function loadQualification(path: string, verifySource = true): Promise<QualificationManifest> {
  await directory(path);
  const text = await readRegular(join(path, "manifest.json"), MAX_MANIFEST_BYTES, true), parsed: unknown = JSON.parse(text);
  const manifest = checkQualificationManifest(parsed); requireThat(JSON.stringify(manifest) === text);
  for (const [name, expected] of Object.entries(qualificationConfigs(manifest.run, manifest.accountId)))
    requireThat(await readRegular(join(path, configNames[name as keyof typeof configNames]), 16_384, true) === expected, "private_config_changed");
  requireThat(!(await readdir(path)).some(name => name === ".env" || name.startsWith(".env.") || name === ".dev.vars" || name.startsWith(".dev.vars.")), "environment_file_refused");
  if (verifySource) requireThat(await sourceDigest() === manifest.sourceDigest, "qualification_source_changed");
  return manifest;
}

async function withRunLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  await directory(path); const lockPath = join(path, "dispatch.lock");
  // A crashed process leaves this lock as evidence. Never guess that it is safe
  // to remove it: summary remains available and dispatched state is ambiguous.
  let handle;
  try { handle = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { return fail("qualification_run_locked"); }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.sync(); await syncDirectory(path); return await action(); }
  finally { await handle.close(); await unlink(lockPath); await syncDirectory(path); }
}

export async function recordQualificationDeployment(path: string, value: unknown, verifySource = true): Promise<QualificationManifest> {
  return await withRunLock(path, async () => {
    const manifest = await loadQualification(path, verifySource), summary = qualificationSummary(manifest);
    requireThat(summary.state === "deployment_required", "deployment_checkpoint_not_ready");
    const receipt = checkedDeployment(manifest, value, manifest.deployments.length);
    requireThat(receipt.phase === summary.deploymentCheckpoint);
    manifest.deployments.push(receipt); await saveManifest(path, manifest); return manifest;
  });
}

export type QualificationPlatform = { env: { QUALIFICATION: { fetch(request: Request): Promise<Response> } }; dispose(): Promise<void> };
export type QualificationPlatformFactory = (configPath: string) => Promise<QualificationPlatform>;
async function installedPlatform(configPath: string): Promise<QualificationPlatform> {
  // No .env, .dev.vars, inherited application vars, public listener or deployed
  // driver Worker. Wrangler alone owns its existing account authentication.
  process.env.WRANGLER_SEND_METRICS = "false";
  process.env.WRANGLER_LOG = "none";
  process.env.WRANGLER_WRITE_LOGS = "false";
  process.env.WRANGLER_LOG_PATH = join(dirname(configPath), "wrangler.log");
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
  process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "false";
  const { getPlatformProxy } = await import("wrangler");
  return await getPlatformProxy({ configPath, envFiles: [], remoteBindings: true, persist: false }) as unknown as QualificationPlatform;
}

export async function readQualificationResponse(response: Response, run: QualificationRun, request: QualificationRequest, signal: AbortSignal): Promise<{ reply: QualificationReply; replyHex: string }> {
  const headers = response.headers;
  const length = headers.get("content-length");
  try {
    requireThat(headers.get("content-type") === "application/json; charset=utf-8" && headers.get("cache-control") === "private, no-store"
      && headers.get("x-content-type-options") === "nosniff" && headers.get("referrer-policy") === "no-referrer"
      && headers.get("x-robots-tag") === "noindex, nofollow" && !response.redirected
      && ["set-cookie", "location", "content-encoding", "access-control-allow-origin", "access-control-allow-credentials", "refresh"].every(name => !headers.has(name)));
    requireThat(length === null || (/^(?:0|[1-9][0-9]{0,4})$/u.test(length) && Number(length) <= QUALIFICATION_REPLY_BYTES));
    requireThat(response.body);
  } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
  const reader = response.body.getReader(), bytes = new Uint8Array(QUALIFICATION_REPLY_BYTES); let size = 0, chunks = 0, complete = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      requireThat(!signal.aborted); const next = await reader.read(); requireThat(!signal.aborted);
      if (next.done) { complete = true; break; }
      requireThat(next.value instanceof Uint8Array && next.value.byteLength > 0 && ++chunks <= 256 && next.value.byteLength <= bytes.length - size);
      bytes.set(next.value, size); size += next.value.byteLength;
    }
    requireThat(length === null || Number(length) === size);
    const replyHex = qualificationByteHex(bytes.subarray(0, size)), value = readJsonHex(replyHex, QUALIFICATION_REPLY_BYTES);
    const reply = parseQualificationReply(run, request, value); requireThat(reply && response.status === (reply.ok ? 200 : QUALIFICATION_ERROR_STATUS[reply.error]));
    return { reply, replyHex };
  } finally { signal.removeEventListener("abort", cancel); if (!complete) cancel(); reader.releaseLock(); }
}

type AttemptOptions = { retry?: boolean; factory?: QualificationPlatformFactory; now?: () => number;
  monotonicNow?: () => number; deadlineMs?: number; verifySource?: boolean };
/** Injection is for local tests. The CLI never accepts a factory, timeout or source-check override. */
export async function dispatchQualificationStep(path: string, options: AttemptOptions = {}): Promise<QualificationManifest> {
  return await withRunLock(path, async () => {
    const manifest = await loadQualification(path, options.verifySource ?? true), now = options.now ?? Date.now;
    const index = nextIndex(manifest), entry = QUALIFICATION_SEQUENCE[index];
    requireThat(entry && manifest.deployments.some(receipt => receipt.phase === entry.phase), "deployment_checkpoint_required");
    const invocationCivil = now();
    const lastObservation = Math.max(manifest.run.createdAtMs, ...manifest.deployments.map(receipt => receipt.verifiedAtMs),
      ...manifest.steps.map(record => record.dispatchedAtMs ?? manifest.run.createdAtMs));
    requireThat(isTime(invocationCivil) && invocationCivil >= lastObservation && invocationCivil < manifest.run.expiresAtMs, "qualification_run_expired");
    let record = manifest.steps[index];
    if (record?.state === "dispatched") { record.state = "ambiguous"; await saveManifest(path, manifest); }
    if (options.retry) requireThat(record?.state === "ambiguous" && entry.stage !== "begin" && record.attemptCount < 3, "exact_retry_refused");
    else requireThat(!record || record.state === "prepared", "ambiguous_dispatch_requires_review");
    const evidence = evidenceFor(manifest), request = requestFor(manifest.run, entry, evidence);
    const requestHex = qualificationByteHex(jsonBytes(request, QUALIFICATION_REQUEST_BYTES));
    if (!record) {
      record = { id: entry.id, requestHex, state: "prepared", attemptCount: 0, dispatchedAtMs: null, replyHex: null };
      manifest.steps.push(record); await saveManifest(path, manifest);
    }
    requireThat(record.requestHex === requestHex);
    const dispatchCivil = now();
    requireThat(isTime(dispatchCivil) && dispatchCivil >= invocationCivil && dispatchCivil < manifest.run.expiresAtMs, "qualification_run_expired");
    record.state = "dispatched"; record.attemptCount++; record.dispatchedAtMs = dispatchCivil; record.replyHex = null;
    await saveManifest(path, manifest); // Durable intent precedes any possible service effect.
    const controller = new AbortController(); let platform: QualificationPlatform | undefined, timedOut = false;
    let disposal: Promise<void> | undefined;
    const disposePlatform = (): Promise<void> => {
      if (!platform) return Promise.resolve();
      const owned = platform;
      return disposal ??= Promise.resolve().then(() => owned.dispose());
    };
    const monotonicNow = options.monotonicNow ?? (() => performance.now()), monotonicStart = monotonicNow();
    const deadlineMs = options.deadlineMs ?? QUALIFICATION_ATTEMPT_MS;
    const acceptanceOpen = () => {
      const elapsed = monotonicNow() - monotonicStart, civilNow = now();
      requireThat(!timedOut && !controller.signal.aborted && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < deadlineMs
        && isTime(civilNow) && civilNow >= record.dispatchedAtMs! && civilNow < manifest.run.expiresAtMs, "qualification_attempt_deadline");
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error("qualification_attempt_deadline")); }, deadlineMs);
    });
    const operation = (async () => {
      acceptanceOpen();
      platform = await (options.factory ?? installedPlatform)(join(path, configNames.driver));
      if (controller.signal.aborted) { void disposePlatform().catch(() => {}); fail(); }
      acceptanceOpen();
      const response = await platform.env.QUALIFICATION.fetch(new Request(QUALIFICATION_URL, { method: "POST", redirect: "error", signal: controller.signal,
        headers: { accept: "application/json", "content-type": "application/json" }, body: qualificationBytes(record.requestHex) }));
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); fail(); }
      try { acceptanceOpen(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      const result = await readQualificationResponse(response, manifest.run, request, controller.signal);
      acceptanceOpen(); acceptEvidence(manifest.run, request, result.reply, evidence); acceptanceOpen(); return result;
    })();
    try {
      const result = await Promise.race([operation, timeout]); acceptanceOpen();
      record.replyHex = result.replyHex; record.state = "complete";
    } catch { record.replyHex = null; record.state = "ambiguous"; }
    finally {
      clearTimeout(timer); controller.abort();
      // Persist before cleanup, which can itself be interrupted. A late response
      // never changes the retained result or causes another request.
      await saveManifest(path, manifest);
      await disposePlatform();
    }
    return manifest;
  });
}

async function main(args: readonly string[]): Promise<number> {
  const [command, path, extra] = args; requireThat(path && isAbsolute(path));
  let manifest: QualificationManifest;
  if (command === "prepare" && args.length === 4) {
    requireThat(isAbsolute(args[3]));
    const target: unknown = JSON.parse(await readRegular(args[3], 1_024, true)); manifest = await prepareQualification(path, extra, target);
  }
  else if (command === "summary" && args.length === 2) manifest = await loadQualification(path);
  else if (command === "record-deployment" && args.length === 3) {
    requireThat(isAbsolute(extra) && dirname(extra) === path);
    const receipt: unknown = JSON.parse(await readRegular(extra, 4_096, true)); manifest = await recordQualificationDeployment(path, receipt);
  } else if ((command === "step" || command === "retry") && args.length === 2) manifest = await dispatchQualificationStep(path, { retry: command === "retry" });
  else return fail("invalid_qualification_command");
  const summary = qualificationSummary(manifest); console.log(JSON.stringify(summary)); return summary.state === "ambiguous" ? 1 : 0;
}
if (import.meta.main) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch { console.error("usage-cloudflare-qualification: stopped; inspect the private manifest and recorded deployment evidence"); process.exitCode = 1; }
}
