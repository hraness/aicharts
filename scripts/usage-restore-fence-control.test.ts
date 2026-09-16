import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FENCE_CONTROL_ERROR_STATUS, FENCE_CONTROL_REPLY_BYTES, FENCE_CONTROL_REQUEST_BYTES, FENCE_CONTROL_URL,
  encodeFenceControlJson, parseFenceControlRequest,
  type FenceControlRecord, type FenceControlReply, type FenceControlRequest, type FenceControlView,
} from "../services/usage-worker/src/restore-fence-control-contract";
import {
  FENCE_CONTROL_RUN_MS, FENCE_CONTROL_TARGET, FENCE_STEP_SEQUENCE, checkFenceManifest, dispatchFenceStep,
  fenceControlConfigs, fenceControlPlan, fenceControlSourceDigest, fenceControlSummary, fenceStepRequest, loadFenceRun,
  parseFenceControlIntent, prepareFenceRun, readFenceControlResponse, recordFenceDeployment, recordFenceRestore,
  type FenceControlIntent, type FenceDeploymentReceipt, type FencePlatformFactory, type FenceRestoreReceipt, type FenceRunManifest,
} from "./usage-restore-fence-control";

const SOURCE_SHA = "b".repeat(40);
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" };
const CREATED = 1_760_000_000_000;
const intent = parseFenceControlIntent({ schemaVersion: 1, accountId: `acct_${"a".repeat(32)}`, generation: "1".repeat(64),
  cloudflareAccountId: "2".repeat(32), fencedWorker: "aicharts-usage-fenced-test",
  fromEpoch: 7, toEpoch: 8, fromWorkerVersion: "3".repeat(64), toWorkerVersion: "4".repeat(64) })!;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hex = (value: unknown, max = FENCE_CONTROL_REPLY_BYTES): string => {
  const bytes = encodeFenceControlJson(value, max); if (!bytes) throw new Error("test_fixture"); return Buffer.from(bytes).toString("hex");
};
const bytes = (value: unknown, max = FENCE_CONTROL_REPLY_BYTES): Uint8Array<ArrayBuffer> => {
  const encoded = encodeFenceControlJson(value, max); if (!encoded) throw new Error("test_fixture"); return encoded;
};

/** A synthetic fence with the Durable Object's exact transition semantics. This
 * transcript is not provider evidence; it supplies protocol values so tests can
 * corrupt relationships the driver must refuse. */
class SyntheticFence {
  inFlight = 0;
  record: FenceControlRecord | null;
  replies = 0;
  constructor(readonly target: FenceControlIntent, phase: "open" | "closed" | "absent" = "open") {
    this.record = phase === "absent" ? null : { schemaVersion: 1, accountId: target.accountId, generation: target.generation,
      epoch: target.fromEpoch, workerVersion: target.fromWorkerVersion, phase, established: true, updatedAtMs: CREATED };
  }
  view(): FenceControlView { return Object.freeze({ record: this.record, inFlight: this.inFlight, observedAtMs: CREATED + 1 }); }
  reply(request: FenceControlRequest): FenceControlReply {
    this.replies++;
    const record = this.record;
    if (request.operation === "read") {
      if (record !== null && record.generation !== request.generation) return { schemaVersion: 1, ok: false, error: "recovery_required" };
      return { schemaVersion: 1, operation: "read", ok: true, value: this.view() };
    }
    if (record === null || record.generation !== request.generation) return { schemaVersion: 1, ok: false, error: "recovery_required" };
    if (request.operation === "close") {
      if (record.epoch !== request.epoch) return { schemaVersion: 1, ok: false, error: "recovery_required" };
      if (record.phase !== "closed") this.record = { ...record, phase: "closed" };
      return { schemaVersion: 1, operation: "close", ok: true, value: this.view() };
    }
    if (record.phase === "open" && record.epoch === request.epoch && record.workerVersion === request.workerVersion)
      return { schemaVersion: 1, operation: "publish", ok: true, value: this.view() };
    if (record.phase !== "closed" || this.inFlight !== 0 || request.epoch <= record.epoch)
      return { schemaVersion: 1, ok: false, error: "recovery_required" };
    this.record = { ...record, epoch: request.epoch, workerVersion: request.workerVersion, phase: "open" };
    return { schemaVersion: 1, operation: "publish", ok: true, value: { record: this.record, inFlight: 0, observedAtMs: CREATED + 1 } };
  }
}
function response(reply: FenceControlReply): Response {
  return new Response(bytes(reply), { status: reply.ok ? 200 : FENCE_CONTROL_ERROR_STATUS[reply.error], headers });
}
/** Service-side admission: the control Worker re-encodes the parsed request and
 * requires byte equality with the received body, so the fake must too. */
async function admitRequest(input: string | URL, init?: RequestInit): Promise<FenceControlRequest> {
  const raw = new Uint8Array(await new Request(input, init).arrayBuffer());
  const parsed = parseFenceControlRequest(JSON.parse(new TextDecoder().decode(raw)) as unknown);
  const canonical = parsed && encodeFenceControlJson(parsed, FENCE_CONTROL_REQUEST_BYTES);
  if (!parsed || !canonical || canonical.length !== raw.length || canonical.some((byte, index) => byte !== raw[index])) throw new Error("test_fixture");
  return parsed;
}
const platform = (fence: SyntheticFence, options: { drop?: (request: FenceControlRequest) => boolean } = {}): FencePlatformFactory =>
  async () => ({ env: { FENCE_CONTROL: { fetch: async (input, init) => {
    const parsed = await admitRequest(input, init);
    if (options.drop?.(parsed)) throw new Error("synthetic_lost_reply");
    return response(fence.reply(parsed));
  } } }, dispose: async () => {} });

const temporaryDirectories: string[] = [];
afterEach(async () => { for (const path of temporaryDirectories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function temporary(): Promise<string> {
  const parent = await realpath(tmpdir()), path = await mkdtemp(join(parent, "aicharts-fence-control-test-"));
  temporaryDirectories.push(path); await chmod(path, 0o700); return path;
}
async function seed(manifest: FenceRunManifest, realSource = false): Promise<string> {
  const path = await temporary();
  // A CLI-loaded run verifies the actual source digest; unit-level callers keep
  // the placeholder and pass verifySource:false instead.
  const value = realSource ? { ...manifest, sourceDigest: await fenceControlSourceDigest() } : manifest;
  await writeFile(join(path, "manifest.json"), JSON.stringify(checkFenceManifest(value)), { mode: 0o600 });
  const configs = fenceControlConfigs(manifest.intent);
  for (const [key, filename] of [["driver", "wrangler.driver.json"], ["control", "wrangler.control.json"]] as const)
    await writeFile(join(path, filename), configs[key as keyof typeof configs], { mode: 0o600 });
  return path;
}
const now = () => CREATED + 10_000;
function deployment(manifest: FenceRunManifest): FenceDeploymentReceipt {
  return { schemaVersion: 1, accountId: manifest.intent.cloudflareAccountId, controlWorker: FENCE_CONTROL_TARGET.controlWorker,
    fencedWorker: manifest.intent.fencedWorker, versionId: "5".repeat(32), deploymentId: "6".repeat(32),
    workersDev: false, previewUrls: false, routeCount: 0, observabilityEnabled: false, trafficPercent: 100,
    verifiedAtMs: manifest.createdAtMs + 1_000 };
}
function restore(manifest: FenceRunManifest): FenceRestoreReceipt {
  const drain = manifest.steps.find(record => record.id === "drain");
  return { schemaVersion: 1, accountId: manifest.intent.accountId, generation: manifest.intent.generation,
    accountStore: "reconciled", controlStore: "reconciled", credentialsInvalidated: true, journalsReconciled: true,
    restoredAtMs: (drain?.dispatchedAtMs ?? manifest.createdAtMs) + 500 };
}
function manifest(complete = 0, fence?: SyntheticFence): FenceRunManifest {
  const service = fence ?? new SyntheticFence(intent);
  const value: FenceRunManifest = { schemaVersion: 1, runId: "d".repeat(24), sourceSha: SOURCE_SHA, sourceDigest: "c".repeat(64),
    intent, createdAtMs: CREATED, expiresAtMs: CREATED + FENCE_CONTROL_RUN_MS, deployment: null, restore: null, steps: [] };
  if (complete > 0) value.deployment = deployment(value);
  for (let index = 0; index < complete; index++) {
    const id = FENCE_STEP_SEQUENCE[index], request = fenceStepRequest(intent, id), dispatchedAtMs = CREATED + 1_000 + index * 1_000;
    if (id === "publish") {
      value.restore = restore(value);
      const reconcile = service.reply(fenceStepRequest(intent, "read-initial")), publish = service.reply(request);
      value.steps.push({ id, requestHex: hex(request, FENCE_CONTROL_REQUEST_BYTES), state: "complete", attemptCount: 1,
        dispatchedAtMs, replyHex: publish.ok ? hex(publish) : null,
        reconcileHex: hex(reconcile), error: null, polls: 0 });
      continue;
    }
    let reply: FenceControlReply = { schemaVersion: 1, ok: false, error: "invalid_input" }, polls = 0;
    if (id === "drain") {
      while (service.inFlight > 0 && polls < 45) { polls++; service.reply(fenceStepRequest(intent, "read-initial")); service.inFlight--; }
      reply = service.reply(fenceStepRequest(intent, "read-initial")); polls++;
    } else reply = service.reply(request);
    if (!reply.ok) throw new Error("test_fixture");
    value.steps.push({ id, requestHex: hex(request, FENCE_CONTROL_REQUEST_BYTES), state: "complete", attemptCount: 1,
      dispatchedAtMs, replyHex: hex(reply), reconcileHex: null, error: null, polls });
  }
  return checkFenceManifest(value);
}

describe("fence control intent, plans and manifest replay", () => {
  test("admits only an exact intent and emits the bounded close→drain→restore→publish plan", () => {
    for (const update of [{ accountId: "acct_" }, { generation: "x" }, { cloudflareAccountId: "0".repeat(32) },
      { fencedWorker: FENCE_CONTROL_TARGET.controlWorker }, { fencedWorker: "BAD" }, { toEpoch: 7 }, { fromEpoch: -1 },
      { fromWorkerVersion: "0".repeat(64) }, { toWorkerVersion: "x" }, { schemaVersion: 2 }, { extra: true }]) {
      expect(parseFenceControlIntent({ ...clone(intent), ...update })).toBeNull();
    }
    expect(parseFenceControlIntent(clone(intent))).toEqual(intent);
    const plan = fenceControlPlan(manifest());
    expect(plan.state).toBe("deployment_required");
    expect(plan.transitions.map(entry => entry.step)).toEqual([...FENCE_STEP_SEQUENCE.slice(0, 3), "restore-checkpoint", "publish", "read-final"]);
    expect(plan.transitions.filter(entry => entry.mutating).map(entry => entry.step)).toEqual(["close", "restore-checkpoint", "publish"]);
  });
  test("replays a complete run and a reconciled publish, and rejects tampered evidence", async () => {
    const complete = manifest(FENCE_STEP_SEQUENCE.length), summary = fenceControlSummary(complete);
    expect(summary).toMatchObject({ state: "complete", completedSteps: 5, nextStep: null, mutatingNext: false,
      deploymentReceipt: true, restoreReceipt: true, observed: { epoch: 8, phase: "open", inFlight: 0 }, productionActivation: false });
    const text = JSON.stringify(summary);
    for (const privateValue of [intent.accountId, intent.generation, intent.cloudflareAccountId]) expect(text).not.toContain(privateValue);
    for (const update of [{ runId: "0".repeat(24) }, { runId: "xyz" }, { sourceSha: "f".repeat(39) },
      { sourceDigest: "0".repeat(64) }, { expiresAtMs: CREATED + 1 }, { createdAtMs: -1 },
      { deployment: { extra: true } }, { restore: { accountId: "x" } }, { steps: complete.steps.slice(1) },
      { intent: { ...clone(intent), toEpoch: intent.fromEpoch } }]) {
      expect(() => checkFenceManifest({ ...clone(complete), ...update })).toThrow();
    }
    // A fabricated publish reply without the reconcile read is not evidence.
    const forged = clone(complete); forged.steps[4] = { ...forged.steps[4], id: "publish", requestHex: forged.steps[3].requestHex };
    expect(() => checkFenceManifest(forged)).toThrow();
    const reconciled = clone(complete), publish = reconciled.steps[3];
    publish.reconcileHex = hex({ schemaVersion: 1, operation: "read", ok: true,
      value: { record: { schemaVersion: 1, accountId: intent.accountId, generation: intent.generation, epoch: 8,
        workerVersion: intent.toWorkerVersion, phase: "open", established: true, updatedAtMs: CREATED + 1 }, inFlight: 2, observedAtMs: CREATED + 2 } });
    publish.replyHex = null;
    expect(checkFenceManifest(reconciled).steps[3].state).toBe("complete");
    // An incomplete sequence must keep its last non-complete record last.
    const partial = manifest(3); partial.steps[2] = { ...partial.steps[2], state: "ambiguous", replyHex: null, reconcileHex: null, error: null };
    expect(fenceControlSummary(partial).state).toBe("ambiguous");
    expect(fenceControlSummary(partial).retryAllowed).toBe(true);
  });
  test("deployment and restore receipts bind exactly and only at their checkpoints", async () => {
    const early = manifest(0), earlyPath = await seed(early);
    await expect(recordFenceRestore(earlyPath, restore(early), false)).rejects.toThrow("restore_checkpoint_not_ready");
    const receipt = deployment(early);
    for (const update of [{ controlWorker: "other" }, { fencedWorker: "other" }, { routeCount: 1 }, { workersDev: true },
      { trafficPercent: 50 }, { verifiedAtMs: early.createdAtMs - 1 }, { versionId: receipt.deploymentId }, { extra: true }]) {
      await expect(recordFenceDeployment(earlyPath, { ...receipt, ...update } as never, false)).rejects.toThrow();
    }
    expect((await recordFenceDeployment(earlyPath, receipt, false)).deployment).toEqual(receipt);
    await expect(recordFenceDeployment(earlyPath, receipt, false)).rejects.toThrow("deployment_checkpoint_not_ready");
    const drained = manifest(3), drainedPath = await seed(drained), attested = restore(drained);
    for (const update of [{ accountId: `acct_${"9".repeat(32)}` }, { accountStore: "missing" }, { credentialsInvalidated: false },
      { journalsReconciled: false }, { restoredAtMs: drained.createdAtMs }, { generation: "9".repeat(64) }]) {
      await expect(recordFenceRestore(drainedPath, { ...attested, ...update } as never, false)).rejects.toThrow();
    }
    expect((await recordFenceRestore(drainedPath, attested, false)).restore).toEqual(attested);
    await expect(recordFenceRestore(drainedPath, attested, false)).rejects.toThrow("restore_checkpoint_not_ready");
  });
});

describe("one bounded fence attempt", () => {
  test("persists the dispatched exact request before any call and sends once", async () => {
    const run = manifest(0), path = await seed(run), fence = new SyntheticFence(intent); let calls = 0, disposals = 0;
    await recordFenceDeployment(path, deployment(run), false);
    const factory: FencePlatformFactory = async configPath => {
      expect(configPath).toBe(join(path, "wrangler.driver.json"));
      return { env: { FENCE_CONTROL: { fetch: async (input, init) => {
        const parsed = await admitRequest(input, init); calls++;
        const saved = await loadFenceRun(path, false), pending = saved.steps.at(-1)!;
        expect(pending.state).toBe("dispatched"); expect(pending.attemptCount).toBe(1);
        expect(String(input)).toBe(FENCE_CONTROL_URL); expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
        return response(fence.reply(parsed));
      } } }, dispose: async () => { disposals++; } };
    };
    const result = await dispatchFenceStep(path, { factory, now, verifySource: false });
    expect(result.steps.at(-1)?.state).toBe("complete"); expect(calls).toBe(1); expect(disposals).toBe(1);
    expect((await lstat(join(path, "manifest.json"))).mode & 0o777).toBe(0o600);
  });
  test("requires --apply before close or publish, the deployment receipt first and the restore receipt before publish", async () => {
    const afterRead = manifest(1), readPath = await seed(afterRead); let calls = 0;
    const factory: FencePlatformFactory = async () => { calls++; throw new Error("unexpected"); };
    await expect(dispatchFenceStep(readPath, { factory, now, verifySource: false })).rejects.toThrow("apply_required");
    await expect(dispatchFenceStep(await seed(manifest(3)), { factory, now, verifySource: false, apply: true })).rejects.toThrow("restore_checkpoint_required");
    await expect(dispatchFenceStep(await seed(manifest(0)), { factory, now, verifySource: false })).rejects.toThrow("deployment_checkpoint_required");
    expect(calls).toBe(0);
  });
  test("drains a held lease with bounded polls and refuses a fence that never drains", async () => {
    const draining = manifest(2), drainPath = await seed(draining), fence = new SyntheticFence(intent, "closed");
    fence.inFlight = 2; let reads = 0, elapsed = 0;
    const factory: FencePlatformFactory = async () => ({ env: { FENCE_CONTROL: { fetch: async (input, init) => {
      const parsed = await admitRequest(input, init); reads++; if (reads > 1) fence.inFlight = 0;
      return response(fence.reply(parsed));
    } } }, dispose: async () => {} });
    const result = await dispatchFenceStep(drainPath, { factory, now, verifySource: false, sleep: async () => { elapsed += 1; } });
    expect(result.steps.at(-1)?.state).toBe("complete"); expect(result.steps.at(-1)?.polls).toBe(2); expect(reads).toBe(2); expect(elapsed).toBe(1);
    const stuck = manifest(2), stuckPath = await seed(stuck), held = new SyntheticFence(intent, "closed");
    held.inFlight = 1; // Never released; every read keeps reporting one lease.
    const refused = await dispatchFenceStep(stuckPath, { factory: platform(held), now, verifySource: false,
      sleep: async () => { elapsed += 1; }, monotonicNow: () => elapsed, drainWaitMs: 8, drainPollMs: 3 });
    expect(refused.steps.at(-1)?.state).toBe("refused"); expect(refused.steps.at(-1)?.error).toBe("drain_incomplete");
    expect(fenceControlSummary(refused).state).toBe("refused");
    await expect(dispatchFenceStep(stuckPath, { factory: platform(held), now, verifySource: false })).rejects.toThrow("fence_step_refused");
  });
  test("never blind-retries publish: the reconcile read either reconciles or gates the send", async () => {
    // Reply lost after the fence already reopened: retry reconciles by read and
    // completes without ever re-sending publish.
    const lost = manifest(3), lostPath = await seed(lost);
    await recordFenceRestore(lostPath, restore(lost), false);
    const reopened = new SyntheticFence(intent, "closed"); let published = false, fetches = 0;
    const factory: FencePlatformFactory = async () => ({ env: { FENCE_CONTROL: { fetch: async (input, init) => {
      const request = await admitRequest(input, init); fetches++;
      if (request.operation === "publish") { published = true; throw new Error("synthetic_lost_reply"); }
      if (fetches >= 2 && reopened.record !== null) { // The earlier publish landed.
        reopened.record = { ...reopened.record, epoch: intent.toEpoch, workerVersion: intent.toWorkerVersion, phase: "open" };
      }
      return response(reopened.reply(request));
    } } }, dispose: async () => {} });
    const ambiguous = await dispatchFenceStep(lostPath, { factory, now, verifySource: false, apply: true });
    expect(ambiguous.steps.at(-1)?.state).toBe("ambiguous"); expect(published).toBe(true); expect(fetches).toBe(2);
    const retried = await dispatchFenceStep(lostPath, { factory, now, verifySource: false, retry: true, apply: true });
    expect(retried.steps.at(-1)?.state).toBe("complete"); expect(fetches).toBe(3);
    expect(retried.steps.at(-1)?.replyHex).toBeNull(); // Read evidence reconciled it.
    // A fence still undrained at reconcile refuses rather than publishing.
    const undrained = manifest(3), undrainedPath = await seed(undrained);
    await recordFenceRestore(undrainedPath, restore(undrained), false);
    const closed = new SyntheticFence(intent, "closed"); closed.inFlight = 1; let sends = 0;
    const refused = await dispatchFenceStep(undrainedPath, { factory: async () => ({ env: { FENCE_CONTROL: { fetch: async (input, init) => {
      const request = await admitRequest(input, init);
      if (request.operation === "publish") sends++;
      return response(closed.reply(request));
    } } }, dispose: async () => {} }), now, verifySource: false, apply: true });
    expect(refused.steps.at(-1)?.state).toBe("refused"); expect(refused.steps.at(-1)?.error).toBe("unexpected_state"); expect(sends).toBe(0);
  });
  test("a restored-object surprise, fixed refusals and lost replies leave the fence closed or refused", async () => {
    const wrongEpoch = new SyntheticFence(intent); wrongEpoch.record = { ...wrongEpoch.record!, epoch: 3 };
    const cases: { fence: SyntheticFence | "throw" | "recovery"; state: "refused" | "ambiguous"; error: string | null }[] = [
      { fence: new SyntheticFence(intent, "absent"), state: "refused", error: "unexpected_state" },
      { fence: wrongEpoch, state: "refused", error: "unexpected_state" },
      { fence: "throw", state: "ambiguous", error: null },
      { fence: "recovery", state: "refused", error: "recovery_required" },
    ];
    for (const item of cases) {
      const run = manifest(0), path = await seed(run);
      await recordFenceDeployment(path, deployment(run), false);
      const factory: FencePlatformFactory = item.fence === "throw"
        ? async () => ({ env: { FENCE_CONTROL: { fetch: async () => { throw new Error("synthetic"); } } }, dispose: async () => {} })
        : item.fence === "recovery"
          ? async () => ({ env: { FENCE_CONTROL: { fetch: async () => response({ schemaVersion: 1, ok: false, error: "recovery_required" }) } }, dispose: async () => {} })
          : platform(item.fence);
      const result = await dispatchFenceStep(path, { factory, now, verifySource: false });
      expect(result.steps.at(-1)?.state).toBe(item.state);
      expect(result.steps.at(-1)?.error).toBe(item.error);
    }
  });
  test("an existing lock, modified config or environment file prevents any service access", async () => {
    const run = manifest(0); let calls = 0;
    const factory: FencePlatformFactory = async () => { calls++; throw new Error("unexpected"); };
    for (const kind of ["lock", "config", "environment", "mode", "symlink"] as const) {
      const path = await seed(run);
      if (kind === "lock") await writeFile(join(path, "dispatch.lock"), "{}", { mode: 0o600 });
      if (kind === "config") await writeFile(join(path, "wrangler.driver.json"), "{}");
      if (kind === "environment") await writeFile(join(path, ".env.local"), "CANARY=unused");
      if (kind === "mode") await chmod(join(path, "manifest.json"), 0o644);
      if (kind === "symlink") { await rm(join(path, "manifest.json")); await symlink("wrangler.driver.json", join(path, "manifest.json")); }
      await expect(dispatchFenceStep(path, { factory, now, verifySource: false })).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });
});

describe("bounded canonical reply admission", () => {
  test("rejects wrong status, headers, whitespace, extra fields and excessive or truncated streams", async () => {
    const request = fenceStepRequest(intent, "read-initial"), view: FenceControlView = { record: null, inFlight: 0, observedAtMs: CREATED };
    const valid: FenceControlReply = { schemaVersion: 1, operation: "read", ok: true, value: view }, validBytes = bytes(valid);
    const cases = [
      new Response(validBytes, { status: 201, headers }), new Response(validBytes, { headers: { ...headers, "set-cookie": "x=y" } }),
      new Response(validBytes, { headers: { ...headers, "access-control-allow-origin": "*" } }),
      new Response(validBytes, { headers: { ...headers, "content-length": "9999" } }),
      new Response(` ${new TextDecoder().decode(validBytes)}`, { headers }),
      new Response(JSON.stringify({ ...valid, extra: true }), { headers }),
      new Response(new Uint8Array(FENCE_CONTROL_REPLY_BYTES + 1), { headers }),
      new Response(validBytes.subarray(0, validBytes.length - 1), { headers }),
      new Response(bytes({ schemaVersion: 1, operation: "close", ok: true, value: view }), { headers }),
      new Response(bytes({ schemaVersion: 1, ok: false, error: "not_a_code" }), { status: 400, headers }),
    ];
    for (const candidate of cases) await expect(readFenceControlResponse(candidate, request, new AbortController().signal)).rejects.toThrow();
    const result = await readFenceControlResponse(response(valid), request, new AbortController().signal);
    expect(result.reply).toEqual(valid);
  });
  test("prepare creates an exact closed private run directory only for a valid intent", async () => {
    const path = join(await temporary(), "run");
    const prepared = await prepareFenceRun(path, SOURCE_SHA, clone(intent), CREATED);
    expect(prepared.intent).toEqual(intent);
    expect(fenceControlSummary(await loadFenceRun(path, false)).state).toBe("deployment_required");
    const configs = fenceControlConfigs(intent);
    expect(JSON.parse(configs.control)).toMatchObject({ name: FENCE_CONTROL_TARGET.controlWorker, workers_dev: false,
      vars: { AICHARTS_USAGE_FENCE_CONTROL_ENABLED: "1" } });
    expect(JSON.parse(configs.control).durable_objects.bindings[0]).toMatchObject({ name: "RESTORE_FENCES", class_name: "RestoreFence", script_name: intent.fencedWorker });
    expect(JSON.parse(configs.driver).services[0]).toMatchObject({ binding: "FENCE_CONTROL", service: FENCE_CONTROL_TARGET.controlWorker, entrypoint: "RestoreFenceControl", remote: true });
    await expect(prepareFenceRun(path, SOURCE_SHA, clone(intent), CREATED)).rejects.toThrow();
    await expect(prepareFenceRun(join(await temporary(), "other"), SOURCE_SHA, { ...clone(intent), toEpoch: intent.fromEpoch }, CREATED)).rejects.toThrow();
  });
});

describe("operator command line", () => {
  const repository = fileURLToPath(new URL("../", import.meta.url));
  const loader = new URL("./usage-cloudflare-node.mjs", import.meta.url).href;
  const driver = fileURLToPath(new URL("./usage-restore-fence-control.ts", import.meta.url));
  const options = { cwd: repository, encoding: "utf8" as const, timeout: 10_000, maxBuffer: 65_536,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "test" as const } };
  const cli = (args: string[]) => spawnSync("node", ["--experimental-transform-types", "--import", loader, driver, ...args], options);
  test("a mutating step prints its planned transition without --apply and calls no service", async () => {
    const path = await seed(manifest(1), true); // read-initial complete; close is next.
    const dry = cli(["step", path]);
    expect(dry.status).toBe(0); expect(dry.stderr).not.toContain("usage-restore-fence-control");
    const printed = JSON.parse(dry.stdout) as { dryRun: boolean; plannedTransition: { step: string; operation: string; epoch: number; workerVersion: string } };
    expect(printed.dryRun).toBe(true);
    expect(printed.plannedTransition).toEqual({ step: "close", operation: "close", epoch: intent.fromEpoch, workerVersion: intent.fromWorkerVersion });
    const summary = cli(["summary", path]);
    expect(summary.status).toBe(0);
    expect(JSON.parse(summary.stdout)).toMatchObject({ state: "ready", nextStep: "close", mutatingNext: true, productionActivation: false });
    const plan = cli(["plan", path]);
    expect(plan.status).toBe(0);
    expect(JSON.parse(plan.stdout).transitions).toHaveLength(6);
    // An ambiguous mutating step requires the same explicit --apply review.
    const crashed = clone(manifest(1));
    crashed.steps.push({ id: "close", requestHex: hex(fenceStepRequest(intent, "close"), FENCE_CONTROL_REQUEST_BYTES),
      state: "ambiguous", attemptCount: 1, dispatchedAtMs: CREATED + 6_000, replyHex: null, reconcileHex: null, error: null, polls: 0 });
    const crashedPath = await seed(crashed, true);
    const retried = cli(["retry", crashedPath]);
    expect(retried.status).toBe(1); // Ambiguity still needs review even in dry-run.
    expect(JSON.parse(retried.stdout).dryRun).toBe(true);
    expect(JSON.parse(retried.stdout).state).toBe("ambiguous");
    expect(JSON.parse(retried.stdout).plannedTransition.step).toBe("close");
  });
  test("an invalid command or a refused run exits nonzero with no secret or path detail", async () => {
    const path = await seed(manifest(0), true);
    const invalid = cli(["deploy", path]);
    expect(invalid.status).toBe(1); expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toContain("usage-restore-fence-control: stopped");
    expect(invalid.stderr).not.toContain(intent.accountId);
    const refused = clone(manifest(1));
    refused.steps.push({ id: "close", requestHex: hex(fenceStepRequest(intent, "close"), FENCE_CONTROL_REQUEST_BYTES),
      state: "refused", attemptCount: 1, dispatchedAtMs: CREATED + 6_000, replyHex: null, reconcileHex: null, error: "recovery_required", polls: 0 });
    const refusedPath = await seed(refused, true);
    const stopped = cli(["step", refusedPath, "--apply"]);
    expect(stopped.status).toBe(1);
    expect(JSON.parse(stopped.stdout)).toMatchObject({ state: "refused", refusal: "recovery_required" });
  });
});
