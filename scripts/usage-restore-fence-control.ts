import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FENCE_CONTROL_ERROR_STATUS, FENCE_CONTROL_ERRORS, FENCE_CONTROL_REPLY_BYTES, FENCE_CONTROL_REQUEST_BYTES, FENCE_CONTROL_URL,
  encodeFenceControlJson, fenceControlAccount, fenceControlEpoch, fenceControlFields, fenceControlHex, fenceControlTime,
  parseFenceControlReply,
  type FenceControlOperation, type FenceControlReply, type FenceControlRequest, type FenceControlView,
} from "../services/usage-worker/src/restore-fence-control-contract";

/** The fenced Worker name is operator intent; the control Worker name is a
 * reviewed constant. The control service owns no storage — its cross-script
 * binding reaches the fenced Worker's existing RESTORE_FENCES namespace. */
export const FENCE_CONTROL_TARGET = Object.freeze({ controlWorker: "aicharts-usage-restore-fence-control" });
export const FENCE_CONTROL_RUN_MS = 43_200_000; // 12 hours bound one operator run.
export const FENCE_CONTROL_ATTEMPT_MS = 20_000;
// Leases expire by TTL after at most 30s; the drain bound covers the worst
// lease plus margin, and every poll remains inside the same attempt budget.
export const FENCE_DRAIN_WAIT_MS = 90_000;
export const FENCE_DRAIN_POLL_MS = 2_000;
export const FENCE_DRAIN_POLLS = 45;
const MAX_MANIFEST_BYTES = 1_048_576;
const root = fileURLToPath(new URL("../", import.meta.url));
const templateDirectory = join(root, "services/usage-worker/operator");
export const FENCE_STEP_SEQUENCE = ["read-initial", "close", "drain", "publish", "read-final"] as const;
export type FenceStepId = typeof FENCE_STEP_SEQUENCE[number];
const FENCE_STEP_STATES = ["prepared", "dispatched", "complete", "ambiguous", "refused"] as const;
type FenceStepState = typeof FENCE_STEP_STATES[number];
const MUTATING_STEPS: readonly FenceStepId[] = ["close", "publish"];
const FENCE_STEP_ERRORS = [...FENCE_CONTROL_ERRORS, "unexpected_state", "drain_incomplete"] as const;

export type FenceControlIntent = Readonly<{
  schemaVersion: 1; accountId: string; generation: string;
  cloudflareAccountId: string; fencedWorker: string;
  fromEpoch: number; toEpoch: number; fromWorkerVersion: string; toWorkerVersion: string;
}>;
export type FenceDeploymentReceipt = Readonly<{
  schemaVersion: 1; accountId: string; controlWorker: string; fencedWorker: string;
  versionId: string; deploymentId: string; workersDev: false; previewUrls: false;
  routeCount: 0; observabilityEnabled: false; trafficPercent: 100; verifiedAtMs: number;
}>;
/** The operator's attestation that the external two-store restore completed.
 * The tool never restores Durable Object or R2 data itself; this receipt is
 * the explicit checkpoint between drain and publish. */
export type FenceRestoreReceipt = Readonly<{
  schemaVersion: 1; accountId: string; generation: string;
  accountStore: "reconciled"; controlStore: "reconciled";
  credentialsInvalidated: true; journalsReconciled: true; restoredAtMs: number;
}>;
export type FenceStepRecord = {
  id: FenceStepId; requestHex: string; state: FenceStepState; attemptCount: number;
  dispatchedAtMs: number | null; replyHex: string | null; reconcileHex: string | null;
  error: string | null; polls: number;
};
export type FenceRunManifest = {
  schemaVersion: 1; runId: string; sourceSha: string; sourceDigest: string;
  intent: FenceControlIntent; createdAtMs: number; expiresAtMs: number;
  deployment: FenceDeploymentReceipt | null; restore: FenceRestoreReceipt | null;
  steps: FenceStepRecord[];
};

const fail = (code = "invalid_fence_control_state"): never => { throw new Error(code); };
const requireThat: (value: unknown, code?: string) => asserts value = (value, code) => { if (!value) fail(code); };
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0;
const isCount = (value: unknown): value is number => isTime(value) && value <= 1_000;
const isSha = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{40}$/u.test(value) && value !== "0".repeat(40);
const isProviderId = (value: unknown): value is string => typeof value === "string" && /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.test(value) && !/^0+$/u.test(value.replaceAll("-", ""));
const isWorkerName = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value);
const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const byteHex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

function jsonBytes(value: unknown, max = FENCE_CONTROL_REPLY_BYTES): Uint8Array<ArrayBuffer> {
  const bytes = encodeFenceControlJson(value, max); requireThat(bytes); return bytes;
}
function readJsonHex(value: unknown, max: number): unknown {
  requireThat(typeof value === "string" && value.length >= 2 && value.length <= max * 2 && /^(?:[0-9a-f]{2})+$/u.test(value));
  const bytes = Uint8Array.from(Buffer.from(value as string, "hex")), text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(text); requireThat(byteHex(jsonBytes(parsed, max)) === value); return parsed;
}

export function parseFenceControlIntent(value: unknown): FenceControlIntent | null {
  const input = fenceControlFields(value, ["schemaVersion", "accountId", "generation", "cloudflareAccountId", "fencedWorker",
    "fromEpoch", "toEpoch", "fromWorkerVersion", "toWorkerVersion"]);
  return input !== null && input.schemaVersion === 1 && fenceControlAccount(input.accountId) && fenceControlHex(input.generation)
    && typeof input.cloudflareAccountId === "string" && /^[0-9a-f]{32}$/u.test(input.cloudflareAccountId) && !/^0+$/u.test(input.cloudflareAccountId)
    && isWorkerName(input.fencedWorker) && input.fencedWorker !== FENCE_CONTROL_TARGET.controlWorker
    && fenceControlEpoch(input.fromEpoch) && fenceControlEpoch(input.toEpoch) && input.toEpoch > input.fromEpoch
    && fenceControlHex(input.fromWorkerVersion) && fenceControlHex(input.toWorkerVersion)
    ? Object.freeze({ schemaVersion: 1, accountId: input.accountId, generation: input.generation,
      cloudflareAccountId: input.cloudflareAccountId, fencedWorker: input.fencedWorker,
      fromEpoch: input.fromEpoch, toEpoch: input.toEpoch, fromWorkerVersion: input.fromWorkerVersion, toWorkerVersion: input.toWorkerVersion })
    : null;
}

/** The canonical request one step dispatches; drain and the publish reconcile
 * reuse the read request. */
export function fenceStepRequest(intent: FenceControlIntent, id: FenceStepId): FenceControlRequest {
  // Keys stay in the contract's canonical order; the service re-encodes the
  // parsed request and requires byte equality with the received body.
  const account = { accountId: intent.accountId, generation: intent.generation };
  switch (id) {
    case "close": return Object.freeze({ schemaVersion: 1, operation: "close" as const, ...account,
      epoch: intent.fromEpoch, workerVersion: intent.fromWorkerVersion });
    case "publish": return Object.freeze({ schemaVersion: 1, operation: "publish" as const, ...account,
      epoch: intent.toEpoch, workerVersion: intent.toWorkerVersion });
    default: return Object.freeze({ schemaVersion: 1, operation: "read" as const, ...account });
  }
}

function recordMatches(intent: FenceControlIntent, view: FenceControlView): boolean {
  const record = view.record;
  return record !== null && record.accountId === intent.accountId && record.generation === intent.generation;
}
function publishedTarget(intent: FenceControlIntent, view: FenceControlView): boolean {
  const record = view.record;
  return recordMatches(intent, view) && record !== null && record.phase === "open"
    && record.epoch === intent.toEpoch && record.workerVersion === intent.toWorkerVersion;
}
/** Deterministic acceptance of a successful reply against the pinned intent. A
 * fence view outside the expected transition is a refusal, not an ambiguity. */
function stepAccepts(intent: FenceControlIntent, id: FenceStepId, view: FenceControlView): boolean {
  const record = view.record;
  if (!recordMatches(intent, view) || record === null) return false;
  switch (id) {
    case "read-initial":
      return record.phase === "open" && record.epoch === intent.fromEpoch && record.workerVersion === intent.fromWorkerVersion;
    case "close":
      return record.phase === "closed" && record.epoch === intent.fromEpoch && record.workerVersion === intent.fromWorkerVersion;
    case "drain":
      return record.phase === "closed" && record.epoch === intent.fromEpoch && view.inFlight === 0;
    case "publish":
      // An idempotent publish reply may already observe new-epoch leases; the
      // closed+drained barrier was enforced by the fence before the transition.
      return publishedTarget(intent, view);
    case "read-final":
      return publishedTarget(intent, view);
  }
}

const closedDriver = {
  $schema: "../../../node_modules/wrangler/config-schema.json", name: "aicharts-usage-fence-driver-closed",
  compatibility_date: "2026-09-10", compatibility_flags: ["nodejs_compat"], workers_dev: false, preview_urls: false,
  send_metrics: false, observability: { enabled: false },
  services: [{ binding: "FENCE_CONTROL", service: "aicharts-usage-restore-fence-control-unconfigured", entrypoint: "RestoreFenceControl", remote: false }],
};
const closedControl = {
  $schema: "../../../node_modules/wrangler/config-schema.json", name: "aicharts-usage-restore-fence-control-closed", main: "../src/restore-fence-control.ts",
  compatibility_date: "2026-09-10", compatibility_flags: ["nodejs_compat"], workers_dev: false, preview_urls: false,
  send_metrics: false, observability: { enabled: false }, vars: { AICHARTS_USAGE_FENCE_CONTROL_ENABLED: "" },
  durable_objects: { bindings: [{ name: "RESTORE_FENCES", class_name: "RestoreFence", script_name: "aicharts-usage-fenced-unconfigured" }] },
  exports: { RestoreFenceControl: { type: "worker" } }, r2_buckets: [],
};

export function fenceControlConfigs(intent: FenceControlIntent): Readonly<Record<"driver" | "control", string>> {
  const schema = join(root, "node_modules/wrangler/config-schema.json");
  return {
    driver: JSON.stringify({ ...closedDriver, $schema: schema, account_id: intent.cloudflareAccountId,
      services: [{ binding: "FENCE_CONTROL", service: FENCE_CONTROL_TARGET.controlWorker, entrypoint: "RestoreFenceControl", remote: true }] }),
    control: JSON.stringify({ ...closedControl, $schema: schema, account_id: intent.cloudflareAccountId,
      name: FENCE_CONTROL_TARGET.controlWorker, main: join(root, "services/usage-worker/src/restore-fence-control.ts"),
      vars: { AICHARTS_USAGE_FENCE_CONTROL_ENABLED: "1" },
      durable_objects: { bindings: [{ name: "RESTORE_FENCES", class_name: "RestoreFence", script_name: intent.fencedWorker }] } }),
  };
}
const configNames = { driver: "wrangler.driver.json", control: "wrangler.control.json" } as const;

const deploymentKeys = ["schemaVersion", "accountId", "controlWorker", "fencedWorker", "versionId", "deploymentId",
  "workersDev", "previewUrls", "routeCount", "observabilityEnabled", "trafficPercent", "verifiedAtMs"] as const;
function checkedDeployment(manifest: FenceRunManifest, value: unknown): FenceDeploymentReceipt {
  const item = fenceControlFields(value, deploymentKeys);
  requireThat(item && item.schemaVersion === 1 && item.accountId === manifest.intent.cloudflareAccountId
    && item.controlWorker === FENCE_CONTROL_TARGET.controlWorker && item.fencedWorker === manifest.intent.fencedWorker
    && isProviderId(item.versionId) && isProviderId(item.deploymentId) && item.versionId !== item.deploymentId
    && item.workersDev === false && item.previewUrls === false && item.routeCount === 0 && item.observabilityEnabled === false
    && item.trafficPercent === 100 && isTime(item.verifiedAtMs)
    && item.verifiedAtMs >= manifest.createdAtMs && item.verifiedAtMs < manifest.expiresAtMs);
  return Object.fromEntries(deploymentKeys.map(key => [key, item[key]])) as unknown as FenceDeploymentReceipt;
}

const restoreKeys = ["schemaVersion", "accountId", "generation", "accountStore", "controlStore",
  "credentialsInvalidated", "journalsReconciled", "restoredAtMs"] as const;
function checkedRestore(manifest: FenceRunManifest, value: unknown): FenceRestoreReceipt {
  const item = fenceControlFields(value, restoreKeys);
  requireThat(item && item.schemaVersion === 1 && item.accountId === manifest.intent.accountId && item.generation === manifest.intent.generation
    && item.accountStore === "reconciled" && item.controlStore === "reconciled"
    && item.credentialsInvalidated === true && item.journalsReconciled === true
    && isTime(item.restoredAtMs) && item.restoredAtMs >= manifest.createdAtMs && item.restoredAtMs < manifest.expiresAtMs);
  return Object.fromEntries(restoreKeys.map(key => [key, item[key]])) as unknown as FenceRestoreReceipt;
}

function replyFor(hex: string, request: FenceControlRequest): FenceControlReply {
  const reply = parseFenceControlReply(request, readJsonHex(hex, FENCE_CONTROL_REPLY_BYTES)); requireThat(reply); return reply;
}
function okView(reply: FenceControlReply): FenceControlView {
  requireThat(reply.ok); return reply.ok ? reply.value : fail();
}

/** Replay the retained evidence, not a saved boolean claiming success. */
export function checkFenceManifest(value: unknown): FenceRunManifest {
  const item = fenceControlFields(value, ["schemaVersion", "runId", "sourceSha", "sourceDigest", "intent",
    "createdAtMs", "expiresAtMs", "deployment", "restore", "steps"]);
  requireThat(item && item.schemaVersion === 1 && typeof item.runId === "string" && /^[0-9a-f]{24}$/u.test(item.runId) && item.runId !== "0".repeat(24)
    && isSha(item.sourceSha) && fenceControlHex(item.sourceDigest) && fenceControlTime(item.createdAtMs)
    && item.expiresAtMs === item.createdAtMs + FENCE_CONTROL_RUN_MS && fenceControlTime(item.expiresAtMs));
  const intent = parseFenceControlIntent(item.intent); requireThat(intent !== null);
  const manifest: FenceRunManifest = { schemaVersion: 1, runId: item.runId, sourceSha: item.sourceSha, sourceDigest: item.sourceDigest,
    intent, createdAtMs: item.createdAtMs, expiresAtMs: item.expiresAtMs, deployment: null, restore: null, steps: [] };
  if (item.deployment !== null) manifest.deployment = checkedDeployment(manifest, item.deployment);
  if (item.restore !== null) manifest.restore = checkedRestore(manifest, item.restore);
  requireThat(Array.isArray(item.steps) && item.steps.length <= FENCE_STEP_SEQUENCE.length);
  let boundary = manifest.createdAtMs;
  const readRequest = fenceStepRequest(intent, "read-initial");
  for (const [index, raw] of item.steps.entries()) {
    const id = FENCE_STEP_SEQUENCE[index];
    const record = fenceControlFields(raw, ["id", "requestHex", "state", "attemptCount", "dispatchedAtMs", "replyHex", "reconcileHex", "error", "polls"]);
    const request = fenceStepRequest(intent, id), requestHex = byteHex(jsonBytes(request, FENCE_CONTROL_REQUEST_BYTES));
    requireThat(record && record.id === id && (FENCE_STEP_STATES as readonly string[]).includes(String(record.state))
      && record.requestHex === requestHex && isCount(record.attemptCount) && record.attemptCount <= 3
      && (record.state === "complete" || index === item.steps.length - 1)
      && ((typeof record.error === "string" && record.state === "refused" && (FENCE_STEP_ERRORS as readonly string[]).includes(record.error))
        || record.error === null)
      && isCount(record.polls) && record.polls <= FENCE_DRAIN_POLLS
      && (record.reconcileHex === null || typeof record.reconcileHex === "string")
      && (record.replyHex === null || typeof record.replyHex === "string"));
    if (id !== "publish") requireThat(record.reconcileHex === null);
    if (id !== "drain") requireThat(record.polls === 0);
    if (record.state === "prepared") {
      requireThat(record.attemptCount === 0 && record.dispatchedAtMs === null && record.replyHex === null && record.reconcileHex === null && record.polls === 0);
    } else {
      // Ordering is evidence: a step cannot precede the deployment it relies on,
      // and publish cannot precede the attested restore completion.
      requireThat(record.attemptCount >= 1 && isTime(record.dispatchedAtMs) && record.dispatchedAtMs >= boundary
        && record.dispatchedAtMs < manifest.expiresAtMs && manifest.deployment !== null
        && record.dispatchedAtMs >= manifest.deployment.verifiedAtMs
        && (id !== "publish" || (manifest.restore !== null && record.dispatchedAtMs >= manifest.restore.restoredAtMs)));
      boundary = record.dispatchedAtMs as number;
    }
    if (record.state === "complete") {
      if (id === "publish") {
        // The reconcile read is mandatory evidence; a replyHex absent means the
        // read itself proved the fence already carried the published target.
        requireThat(typeof record.reconcileHex === "string");
        const reconcile = okView(replyFor(record.reconcileHex, readRequest));
        if (publishedTarget(intent, reconcile)) requireThat(record.replyHex === null);
        else {
          requireThat(record.replyHex !== null && reconcile.record !== null && reconcile.record.phase === "closed"
            && reconcile.record.epoch === intent.fromEpoch && reconcile.inFlight === 0);
          requireThat(stepAccepts(intent, "publish", okView(replyFor(record.replyHex, request))));
        }
      } else {
        requireThat(typeof record.replyHex === "string");
        requireThat(stepAccepts(intent, id, okView(replyFor(record.replyHex, request))));
        if (id === "drain") requireThat(record.polls >= 1);
      }
    } else {
      requireThat(record.replyHex === null);
      if (id === "publish" && typeof record.reconcileHex === "string") replyFor(record.reconcileHex, readRequest);
    }
    manifest.steps.push({ id, requestHex, state: record.state as FenceStepState, attemptCount: record.attemptCount,
      dispatchedAtMs: record.dispatchedAtMs as number | null, replyHex: record.replyHex as string | null,
      reconcileHex: record.reconcileHex as string | null, error: record.error as string | null, polls: record.polls });
  }
  if (manifest.restore !== null) {
    const drain = manifest.steps.find(record => record.id === "drain");
    requireThat(drain?.state === "complete" && drain.dispatchedAtMs !== null && manifest.restore.restoredAtMs >= drain.dispatchedAtMs);
  }
  return manifest;
}

function nextIndex(manifest: FenceRunManifest): number { return manifest.steps.filter(record => record.state === "complete").length; }
function observedView(manifest: FenceRunManifest): FenceControlView | null {
  const last = manifest.steps.at(-1);
  if (!last || last.state !== "complete") return null;
  if (last.id === "publish" && last.reconcileHex !== null) {
    const reconcile = parseFenceControlReply(fenceStepRequest(manifest.intent, "read-initial"), readJsonHex(last.reconcileHex, FENCE_CONTROL_REPLY_BYTES));
    if (reconcile?.ok && publishedTarget(manifest.intent, reconcile.value)) return reconcile.value;
  }
  if (last.replyHex === null) return null;
  const reply = parseFenceControlReply(fenceStepRequest(manifest.intent, last.id), readJsonHex(last.replyHex, FENCE_CONTROL_REPLY_BYTES));
  return reply?.ok ? reply.value : null;
}

export function fenceControlSummary(manifestInput: FenceRunManifest) {
  const manifest = checkFenceManifest(manifestInput), index = nextIndex(manifest), next = FENCE_STEP_SEQUENCE.at(index), record = manifest.steps[index];
  const complete = index === FENCE_STEP_SEQUENCE.length, refusal = record?.state === "refused" ? record.error : null;
  const observed = observedView(manifest);
  const state = complete ? "complete" : refusal !== null ? "refused"
    : record?.state === "dispatched" || record?.state === "ambiguous" ? "ambiguous"
    : manifest.deployment === null ? "deployment_required"
    : next === "publish" && manifest.restore === null ? "restore_required" : "ready";
  return { schemaVersion: 1, operatorFence: true, state, completedSteps: index, totalSteps: FENCE_STEP_SEQUENCE.length,
    nextStep: next ?? null, mutatingNext: next !== undefined && MUTATING_STEPS.includes(next),
    retryAllowed: record?.state === "ambiguous" && record.attemptCount < 3,
    deploymentReceipt: manifest.deployment !== null, restoreReceipt: manifest.restore !== null,
    observed: observed === null || observed.record === null ? null : { epoch: observed.record.epoch, phase: observed.record.phase, inFlight: observed.inFlight },
    refusal, productionActivation: false } as const;
}

/** The planned close→drain→restore→publish transitions for dry-run review. */
export function fenceControlPlan(manifestInput: FenceRunManifest) {
  const manifest = checkFenceManifest(manifestInput), { intent } = manifest;
  return { schemaVersion: 1, tool: "restore-fence-control", state: fenceControlSummary(manifest).state,
    accountId: intent.accountId, generation: intent.generation,
    fencedWorker: intent.fencedWorker, controlWorker: FENCE_CONTROL_TARGET.controlWorker,
    transitions: [
      { step: "read-initial", operation: "read", mutating: false, gate: "service",
        detail: "observe the fence record at the pinned epoch and the in-flight lease count" },
      { step: "close", operation: "close", epoch: intent.fromEpoch, workerVersion: intent.fromWorkerVersion, mutating: true, gate: "--apply",
        detail: "refuse new leases; already-admitted operations keep their TTL to settle" },
      { step: "drain", operation: "read", mutating: false, gate: "service",
        detail: `poll until inFlight reaches zero; bounded ${FENCE_DRAIN_WAIT_MS}ms at ${FENCE_DRAIN_POLL_MS}ms polls (lease TTL is 30000ms)` },
      { step: "restore-checkpoint", operation: null, mutating: true, gate: "record-restore",
        detail: "EXTERNAL operator action: restore the account Durable Object and both R2 stores, invalidate old device credentials, reconcile journal prefixes and namespace anchors, then record the receipt. The tool performs no restore itself." },
      { step: "publish", operation: "publish", epoch: intent.toEpoch, workerVersion: intent.toWorkerVersion, mutating: true, gate: "--apply",
        detail: "reconcile by read first, then publish the strictly greater epoch; never blind-retried" },
      { step: "read-final", operation: "read", mutating: false, gate: "service",
        detail: "verify the fence reopened at the new epoch and Worker version" },
    ] } as const;
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
async function saveManifest(path: string, manifest: FenceRunManifest): Promise<void> {
  const checked = checkFenceManifest(manifest), text = JSON.stringify(checked); requireThat(Buffer.byteLength(text) <= MAX_MANIFEST_BYTES);
  const temporary = join(path, `.manifest-${randomBytes(12).toString("hex")}.tmp`);
  await writeNew(temporary, text); await rename(temporary, join(path, "manifest.json")); await syncDirectory(path);
}

/** Hash the bounded source the run depends on; no Git, credentials or provider
 * command runs here. A mid-run source edit is not silently adopted. */
export async function fenceControlSourceDigest(): Promise<string> {
  const files = ["bun.lock", "package.json", "scripts/usage-cloudflare-node.mjs", "scripts/usage-restore-fence-control.ts",
    "services/usage-worker/src/enrollment-contract.ts", "services/usage-worker/src/index.ts", "services/usage-worker/src/namespace-anchor.ts",
    "services/usage-worker/src/production.ts", "services/usage-worker/src/restore-fence.ts", "services/usage-worker/src/restore-fence-control.ts",
    "services/usage-worker/src/restore-fence-control-contract.ts"];
  let total = 0; const entries: string[] = [];
  for (const file of files.sort()) { const text = await readRegular(join(root, file), 2_097_152); total += Buffer.byteLength(text); requireThat(total <= 16_777_216); entries.push(`${file}\0${digest(text)}`); }
  for (const [name, expected] of [["driver", closedDriver], ["control", closedControl]] as const) {
    const text = await readRegular(join(templateDirectory, `wrangler.${name}.jsonc`), 16_384);
    const parsed: unknown = JSON.parse(text.replace(/^\s*\/\/[^\n]*$/gmu, "")); requireThat(same(parsed, expected), "closed_template_changed");
  }
  const installed: unknown = JSON.parse(await readRegular(join(root, "node_modules/wrangler/package.json"), 65_536));
  requireThat(installed !== null && typeof installed === "object" && "version" in installed && installed.version === "4.131.0", "wrangler_version_changed");
  return digest(entries.join("\n"));
}

export async function prepareFenceRun(path: string, sourceSha: string, target: unknown, now = Date.now()): Promise<FenceRunManifest> {
  requireThat(isAbsolute(path) && resolve(path) === path && await realpath(dirname(path)) === dirname(path) && isSha(sourceSha));
  const intent = parseFenceControlIntent(target); requireThat(intent !== null, "invalid_fence_intent");
  requireThat(fenceControlTime(now) && fenceControlTime(now + FENCE_CONTROL_RUN_MS));
  const digestValue = await fenceControlSourceDigest();
  const manifest: FenceRunManifest = { schemaVersion: 1, runId: randomBytes(12).toString("hex"), sourceSha, sourceDigest: digestValue,
    intent, createdAtMs: now, expiresAtMs: now + FENCE_CONTROL_RUN_MS, deployment: null, restore: null, steps: [] };
  await mkdir(path, { mode: 0o700 }); // Never adopt or overwrite an existing run directory.
  await directory(path);
  for (const [name, text] of Object.entries(fenceControlConfigs(intent))) await writeNew(join(path, configNames[name as keyof typeof configNames]), text);
  await writeNew(join(path, "manifest.json"), JSON.stringify(manifest)); await syncDirectory(path); return manifest;
}
export async function loadFenceRun(path: string, verifySource = true): Promise<FenceRunManifest> {
  await directory(path);
  const text = await readRegular(join(path, "manifest.json"), MAX_MANIFEST_BYTES, true), parsed: unknown = JSON.parse(text);
  const manifest = checkFenceManifest(parsed); requireThat(JSON.stringify(manifest) === text);
  for (const [name, expected] of Object.entries(fenceControlConfigs(manifest.intent)))
    requireThat(await readRegular(join(path, configNames[name as keyof typeof configNames]), 16_384, true) === expected, "private_config_changed");
  requireThat(!(await readdir(path)).some(name => name === ".env" || name.startsWith(".env.") || name === ".dev.vars" || name.startsWith(".dev.vars.")), "environment_file_refused");
  if (verifySource) requireThat(await fenceControlSourceDigest() === manifest.sourceDigest, "fence_source_changed");
  return manifest;
}

async function withRunLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  await directory(path); const lockPath = join(path, "dispatch.lock");
  // A crashed process leaves this lock as evidence. Never guess that it is safe
  // to remove it: summary remains available and dispatched state is ambiguous.
  let handle;
  try { handle = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { return fail("fence_run_locked"); }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.sync(); await syncDirectory(path); return await action(); }
  finally { await handle.close(); await unlink(lockPath); await syncDirectory(path); }
}

export async function recordFenceDeployment(path: string, value: unknown, verifySource = true): Promise<FenceRunManifest> {
  return await withRunLock(path, async () => {
    const manifest = await loadFenceRun(path, verifySource);
    requireThat(manifest.deployment === null && manifest.steps.length === 0, "deployment_checkpoint_not_ready");
    manifest.deployment = checkedDeployment(manifest, value); await saveManifest(path, manifest); return manifest;
  });
}
export async function recordFenceRestore(path: string, value: unknown, verifySource = true, now = Date.now()): Promise<FenceRunManifest> {
  return await withRunLock(path, async () => {
    const manifest = await loadFenceRun(path, verifySource);
    const drain = manifest.steps.find(record => record.id === "drain");
    requireThat(manifest.restore === null && drain?.state === "complete" && nextIndex(manifest) === 3, "restore_checkpoint_not_ready");
    const receipt = checkedRestore(manifest, value);
    requireThat(isTime(now) && receipt.restoredAtMs >= (drain.dispatchedAtMs as number) && receipt.restoredAtMs <= now + 60_000);
    manifest.restore = receipt; await saveManifest(path, manifest); return manifest;
  });
}

export type FencePlatform = { env: { FENCE_CONTROL: { fetch(input: string | URL, init?: RequestInit): Promise<Response> } }; dispose(): Promise<void> };
export type FencePlatformFactory = (configPath: string) => Promise<FencePlatform>;
async function installedPlatform(configPath: string): Promise<FencePlatform> {
  // No .env, .dev.vars, inherited application vars, public listener or deployed
  // driver Worker. Wrangler alone owns its existing account authentication.
  process.env.WRANGLER_SEND_METRICS = "false";
  process.env.WRANGLER_LOG = "none";
  process.env.WRANGLER_WRITE_LOGS = "false";
  process.env.WRANGLER_LOG_PATH = join(dirname(configPath), "wrangler.log");
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
  process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "false";
  const { getPlatformProxy } = await import("wrangler");
  return await getPlatformProxy({ configPath, envFiles: [], remoteBindings: true, persist: false }) as unknown as FencePlatform;
}

export async function readFenceControlResponse(response: Response, request: FenceControlRequest, signal: AbortSignal): Promise<{ reply: FenceControlReply; replyHex: string }> {
  const headers = response.headers;
  const length = headers.get("content-length");
  try {
    requireThat(headers.get("content-type") === "application/json; charset=utf-8" && headers.get("cache-control") === "private, no-store"
      && headers.get("x-content-type-options") === "nosniff" && headers.get("referrer-policy") === "no-referrer"
      && headers.get("x-robots-tag") === "noindex, nofollow" && !response.redirected
      && ["set-cookie", "location", "content-encoding", "access-control-allow-origin", "access-control-allow-credentials", "refresh"].every(name => !headers.has(name)));
    requireThat(length === null || (/^(?:0|[1-9][0-9]{0,4})$/u.test(length) && Number(length) <= FENCE_CONTROL_REPLY_BYTES));
    requireThat(response.body);
  } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
  const reader = response.body.getReader(), bytes = new Uint8Array(FENCE_CONTROL_REPLY_BYTES); let size = 0, chunks = 0, complete = false;
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
    const replyHex = byteHex(bytes.subarray(0, size)), value = readJsonHex(replyHex, FENCE_CONTROL_REPLY_BYTES);
    const reply = parseFenceControlReply(request, value);
    requireThat(reply && response.status === (reply.ok ? 200 : FENCE_CONTROL_ERROR_STATUS[reply.error]));
    return { reply, replyHex };
  } finally { signal.removeEventListener("abort", cancel); if (!complete) cancel(); reader.releaseLock(); }
}

class FenceRefusal extends Error { constructor(readonly code: string) { super(code); } }
const refuse = (code: string): never => { throw new FenceRefusal(code); };

type AttemptOptions = { apply?: boolean; retry?: boolean; factory?: FencePlatformFactory; now?: () => number;
  monotonicNow?: () => number; deadlineMs?: number; drainWaitMs?: number; drainPollMs?: number;
  sleep?: (milliseconds: number) => Promise<void>; verifySource?: boolean;
  afterOutcomePersisted?: () => Promise<void> };
/** Injection is for local tests. The CLI never accepts a factory, timeout,
 * sleep, persistence hook or source-check override. */
export async function dispatchFenceStep(path: string, options: AttemptOptions = {}): Promise<FenceRunManifest> {
  return await withRunLock(path, async () => {
    const manifest = await loadFenceRun(path, options.verifySource ?? true), now = options.now ?? Date.now;
    const index = nextIndex(manifest), id = FENCE_STEP_SEQUENCE[index];
    requireThat(index < FENCE_STEP_SEQUENCE.length, "fence_run_complete");
    requireThat(manifest.deployment !== null, "deployment_checkpoint_required");
    if (id === "publish") requireThat(manifest.restore !== null, "restore_checkpoint_required");
    requireThat(!MUTATING_STEPS.includes(id) || options.apply === true, "apply_required");
    const invocationCivil = now();
    const lastObservation = Math.max(manifest.createdAtMs, manifest.deployment.verifiedAtMs, manifest.restore?.restoredAtMs ?? 0,
      ...manifest.steps.map(record => record.dispatchedAtMs ?? 0));
    requireThat(isTime(invocationCivil) && invocationCivil >= lastObservation && invocationCivil < manifest.expiresAtMs, "fence_run_expired");
    let record = manifest.steps[index];
    if (record?.state === "dispatched") { record.state = "ambiguous"; record.replyHex = null; await saveManifest(path, manifest); }
    if (record?.state === "refused") return fail("fence_step_refused");
    if (options.retry) requireThat(record?.state === "ambiguous" && record.attemptCount < 3, "exact_retry_refused");
    else requireThat(!record || record.state === "prepared", "ambiguous_dispatch_requires_review");
    const request = fenceStepRequest(manifest.intent, id), requestBytes = jsonBytes(request, FENCE_CONTROL_REQUEST_BYTES), requestHex = byteHex(requestBytes);
    if (!record) {
      record = { id, requestHex, state: "prepared", attemptCount: 0, dispatchedAtMs: null, replyHex: null, reconcileHex: null, error: null, polls: 0 };
      manifest.steps.push(record); await saveManifest(path, manifest);
    }
    requireThat(record.requestHex === requestHex);
    const dispatchCivil = now();
    requireThat(isTime(dispatchCivil) && dispatchCivil >= invocationCivil && dispatchCivil < manifest.expiresAtMs, "fence_run_expired");
    record.state = "dispatched"; record.attemptCount++; record.dispatchedAtMs = dispatchCivil;
    record.replyHex = null; record.reconcileHex = null; record.error = null; record.polls = 0;
    await saveManifest(path, manifest); // Durable intent precedes any possible service effect.
    const controller = new AbortController(); let platform: FencePlatform | undefined, timedOut = false;
    let disposal: Promise<void> | undefined;
    const disposePlatform = (): Promise<void> => {
      if (!platform) return Promise.resolve();
      const owned = platform;
      return disposal ??= Promise.resolve().then(() => owned.dispose());
    };
    const monotonicNow = options.monotonicNow ?? (() => performance.now()), monotonicStart = monotonicNow();
    const deadlineMs = id === "drain" ? (options.drainWaitMs ?? FENCE_DRAIN_WAIT_MS) + 15_000 : options.deadlineMs ?? FENCE_CONTROL_ATTEMPT_MS;
    const acceptanceOpen = () => {
      const elapsed = monotonicNow() - monotonicStart, civilNow = now();
      requireThat(!timedOut && !controller.signal.aborted && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < deadlineMs
        && isTime(civilNow) && civilNow >= record.dispatchedAtMs! && civilNow < manifest.expiresAtMs, "fence_attempt_deadline");
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error("fence_attempt_deadline")); }, deadlineMs);
    });
    const call = async (stepRequest: FenceControlRequest): Promise<{ replyHex: string; view: FenceControlView }> => {
      const body = jsonBytes(stepRequest, FENCE_CONTROL_REQUEST_BYTES);
      const response = await platform!.env.FENCE_CONTROL.fetch(FENCE_CONTROL_URL, { method: "POST", redirect: "error", signal: controller.signal,
        headers: { accept: "application/json", "content-type": "application/json", "content-length": String(body.byteLength) }, body });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); fail(); }
      const result = await readFenceControlResponse(response, stepRequest, controller.signal);
      acceptanceOpen();
      if (!result.reply.ok) return refuse(result.reply.error);
      return { replyHex: result.replyHex, view: result.reply.value };
    };
    const operation = (async () => {
      acceptanceOpen();
      platform = await (options.factory ?? installedPlatform)(join(path, configNames.driver));
      if (controller.signal.aborted) { void disposePlatform().catch(() => {}); fail(); }
      acceptanceOpen();
      if (id === "drain") {
        const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
        const waitMs = options.drainWaitMs ?? FENCE_DRAIN_WAIT_MS, pollMs = options.drainPollMs ?? FENCE_DRAIN_POLL_MS;
        for (let poll = 1; poll <= FENCE_DRAIN_POLLS; poll++) {
          const outcome = await call(request);
          record.polls = poll;
          if (stepAccepts(manifest.intent, "drain", outcome.view)) return { replyHex: outcome.replyHex };
          // Still draining: the fence must keep reporting closed at the pinned epoch.
          const observed = outcome.view.record;
          if (observed === null || observed.phase !== "closed" || observed.epoch !== manifest.intent.fromEpoch
            || observed.generation !== manifest.intent.generation || observed.accountId !== manifest.intent.accountId) return refuse("unexpected_state");
          const elapsed = monotonicNow() - monotonicStart;
          requireThat(elapsed >= 0, "drain_clock_regressed");
          if (elapsed + pollMs >= waitMs) return refuse("drain_incomplete");
          await sleep(pollMs); acceptanceOpen();
        }
        return refuse("drain_incomplete");
      }
      if (id === "publish") {
        // Reconcile by read first; a publish is never blind-retried. An open
        // record at the pinned target is the idempotent-completion evidence.
        const reconcile = await call(fenceStepRequest(manifest.intent, "read-initial"));
        record.reconcileHex = reconcile.replyHex;
        if (publishedTarget(manifest.intent, reconcile.view)) return { replyHex: null };
        const observed = reconcile.view.record;
        if (observed === null || observed.phase !== "closed" || observed.epoch !== manifest.intent.fromEpoch
          || observed.generation !== manifest.intent.generation || observed.accountId !== manifest.intent.accountId
          || reconcile.view.inFlight !== 0) return refuse("unexpected_state");
        const published = await call(request);
        if (!stepAccepts(manifest.intent, "publish", published.view)) return refuse("unexpected_state");
        return { replyHex: published.replyHex };
      }
      const outcome = await call(request);
      if (!stepAccepts(manifest.intent, id, outcome.view)) return refuse("unexpected_state");
      return { replyHex: outcome.replyHex };
    })();
    try {
      const result = await Promise.race([operation, timeout]); acceptanceOpen();
      record.replyHex = result.replyHex; record.state = "complete";
    } catch (error) {
      if (error instanceof FenceRefusal) { record.state = "refused"; record.error = error.code; record.replyHex = null; }
      else { record.replyHex = null; record.state = "ambiguous"; }
    } finally {
      clearTimeout(timer); controller.abort();
      // Persist before cleanup, which can itself be interrupted. A late response
      // never changes the retained result or causes another request.
      await saveManifest(path, manifest);
      await options.afterOutcomePersisted?.();
      await disposePlatform();
    }
    return manifest;
  });
}

function plannedTransition(manifest: FenceRunManifest, id: FenceStepId) {
  const { intent } = manifest;
  switch (id) {
    case "close": return { step: id, operation: "close" as FenceControlOperation, epoch: intent.fromEpoch, workerVersion: intent.fromWorkerVersion };
    case "publish": return { step: id, operation: "publish" as FenceControlOperation, epoch: intent.toEpoch, workerVersion: intent.toWorkerVersion };
    default: return { step: id, operation: "read" as FenceControlOperation };
  }
}

async function main(args: readonly string[]): Promise<number> {
  const [command, path, extra, last] = args; requireThat(path && isAbsolute(path));
  let manifest: FenceRunManifest;
  if (command === "prepare" && args.length === 4) {
    requireThat(isAbsolute(last));
    const target: unknown = JSON.parse(await readRegular(last, 4_096, true)); manifest = await prepareFenceRun(path, extra, target);
  }
  else if (command === "summary" && args.length === 2) manifest = await loadFenceRun(path);
  else if (command === "plan" && args.length === 2) { console.log(JSON.stringify(fenceControlPlan(await loadFenceRun(path)))); return 0; }
  else if ((command === "record-deployment" || command === "record-restore") && args.length === 3) {
    requireThat(isAbsolute(extra) && dirname(extra) === path);
    const receipt: unknown = JSON.parse(await readRegular(extra, 4_096, true));
    manifest = command === "record-deployment" ? await recordFenceDeployment(path, receipt) : await recordFenceRestore(path, receipt);
  } else if ((command === "step" || command === "retry") && (args.length === 2 || (args.length === 3 && extra === "--apply"))) {
    manifest = await loadFenceRun(path);
    const summary = fenceControlSummary(manifest);
    if (summary.state === "refused") { console.log(JSON.stringify(summary)); return 1; }
    if (summary.mutatingNext && extra !== "--apply") {
      // Default-safe: a mutating transition prints its plan, never dispatches.
      console.log(JSON.stringify({ schemaVersion: 1, dryRun: true, state: summary.state,
        plannedTransition: summary.nextStep === null ? null : plannedTransition(manifest, summary.nextStep) }));
      return summary.state === "ambiguous" ? 1 : 0;
    }
    manifest = await dispatchFenceStep(path, { retry: command === "retry", apply: extra === "--apply" });
  }
  else return fail("invalid_fence_control_command");
  const summary = fenceControlSummary(manifest); console.log(JSON.stringify(summary));
  return summary.state === "ambiguous" || summary.state === "refused" ? 1 : 0;
}
if (import.meta.main) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch { console.error("usage-restore-fence-control: stopped; inspect the private manifest and recorded evidence"); process.exitCode = 1; }
}
