import { afterEach, describe, expect, test } from "bun:test";
import { watch } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QUALIFICATION_CLOSURE_KEYS, QUALIFICATION_ERROR_STATUS, QUALIFICATION_OBJECT_KINDS,
  QUALIFICATION_REPLY_BYTES, QUALIFICATION_RUN_MS, QUALIFICATION_URL, encodeQualificationJson,
  parseQualificationRequest, parseQualificationRun, qualificationByteHex, qualificationBytes,
  qualificationDeviceId, qualificationDigest, qualificationExpectedDays, qualificationFixture,
  type QualificationAttempt, type QualificationObject, type QualificationReply, type QualificationRequest,
  type QualificationRun, type QualificationSlot,
} from "../fixtures/usage/cloudflare-qualification";
import { encodeAdmissionJournal } from "../lib/usage/admission";
import { DAY_MS } from "../lib/usage/wire";
import { ADMISSION_POLICY_V1 } from "../services/usage-worker/src/admission-policy";
import {
  QUALIFICATION_SEQUENCE, QUALIFICATION_TARGET, checkQualificationManifest, dispatchQualificationStep,
  loadQualification, prepareQualification, qualificationConfigs, qualificationSummary,
  readQualificationResponse, recordQualificationDeployment,
  type DeploymentReceipt, type QualificationManifest, type QualificationPlatform, type QualificationPlatformFactory,
} from "./usage-cloudflare-qualification";

const accountId = "a".repeat(32), sourceSha = "b".repeat(40), sourceDigest = "c".repeat(64);
const run = parseQualificationRun({ schemaVersion: 1, runId: "d".repeat(24), createdAtMs: 20_010 * DAY_MS,
  expiresAtMs: 20_010 * DAY_MS + QUALIFICATION_RUN_MS, firstUtcDay: 20_007, generationOne: "1".repeat(64), generationTwo: "2".repeat(64) })!;
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function hex(value: unknown): string { const bytes = encodeQualificationJson(value); if (!bytes) throw new Error("test_fixture"); return qualificationByteHex(bytes); }
function receipt(manifest: QualificationManifest, phase: DeploymentReceipt["phase"]): DeploymentReceipt {
  const index = ["initial", "redeploy", "generation-two"].indexOf(phase);
  return { schemaVersion: 1, phase, accountId: manifest.accountId, ...QUALIFICATION_TARGET,
    sourceSha: manifest.sourceSha, sourceDigest: manifest.sourceDigest, runDigest: qualificationDigest(JSON.stringify(manifest.run)),
    configSha256: qualificationDigest(qualificationConfigs(manifest.run, manifest.accountId)[index === 2 ? "generationTwo" : "generationOne"]),
    versionId: String(index + 1).repeat(32), deploymentId: String(index + 4).repeat(32),
    pairingsNamespaceId: "7".repeat(32), enrollmentsNamespaceId: "8".repeat(32), workersDev: false,
    previewUrls: false, routeCount: 0, observabilityEnabled: false, trafficPercent: 100,
    verifiedAtMs: manifest.run.createdAtMs + 10_000 + QUALIFICATION_SEQUENCE.findIndex(entry => entry.phase === phase) };
}

/** This local transcript is not provider evidence. It supplies valid protocol
 * values so tests can corrupt relationships that individual DTO parsers permit. */
class SyntheticTranscript {
  revision: 0 | 1 | 2 | 3 = 0;
  enrolled = false;
  readonly attempts: Record<QualificationSlot, QualificationAttempt>;
  readonly reservations: Record<QualificationSlot, { reservationId: string; reservedAtMs: number; expiresAtMs: number; generation: string; deviceId: string }>;
  readonly enrollment;
  readonly namespace;
  readonly batches;
  constructor(readonly run: QualificationRun) {
    const attempt = (slot: QualificationSlot): QualificationAttempt => ({ attemptId: (slot === "original" ? "3" : "4").repeat(64),
      contextToken: (slot === "original" ? "5" : "6").repeat(64), startedAtMs: run.createdAtMs + 100, expiresAtMs: run.createdAtMs + 600_000 });
    this.attempts = { original: attempt("original"), closure: attempt("closure") };
    const reservation = (slot: QualificationSlot) => {
      const reservationId = (slot === "original" ? "7" : "8").repeat(64);
      return { reservationId, reservedAtMs: run.createdAtMs + 200, expiresAtMs: this.attempts[slot].expiresAtMs,
        generation: slot === "original" ? run.generationOne : run.generationTwo, deviceId: qualificationDeviceId(run, reservationId, slot) };
    };
    this.reservations = { original: reservation("original"), closure: reservation("closure") };
    this.enrollment = { deviceId: this.reservations.original.deviceId, reservationId: this.reservations.original.reservationId,
      enrolledAtMs: run.createdAtMs + 300, deviceState: "active" as const };
    this.namespace = { namespaceSha256: "9".repeat(64), anchorSha256: "a".repeat(64), deviceId: this.enrollment.deviceId };
    const fixture = qualificationFixture(run, this.enrollment.deviceId);
    this.batches = ([fixture.insert, fixture.correction, fixture.tombstone] as const).map((batch, index) => {
      const journal = encodeAdmissionJournal(batch.bytes, { status: 1, accountJournalRevision: index + 1, committedAtMs: run.createdAtMs + 1000 * (index + 1),
        receipts: batch.operations.map(operation => ({ outcome: index + 1, headOperationHash: operation.operationHash })) }, ADMISSION_POLICY_V1);
      if (!journal.ok) throw new Error("test_fixture");
      return { batchHex: qualificationByteHex(batch.bytes), journalHex: qualificationByteHex(journal.value) };
    });
  }
  objects(): QualificationObject[] {
    if (!this.enrolled) return [];
    const objects: QualificationObject[] = [{ kind: "anchor", byteLength: 160, sha256: this.namespace.anchorSha256, version: "anchor_original", bodyHex: null }];
    for (let index = 0; index < this.revision; index++) {
      for (const bodyHex of [this.batches[index].batchHex, this.batches[index].journalHex]) {
        const kind = QUALIFICATION_OBJECT_KINDS[objects.length];
        objects.push({ kind, byteLength: bodyHex.length / 2, sha256: qualificationDigest(qualificationBytes(bodyHex)), version: `${kind}_original`, bodyHex });
      }
    }
    return objects;
  }
  reply(request: QualificationRequest): QualificationReply {
    let value: unknown;
    switch (request.stage) {
      case "initialize": value = { expiresAtMs: this.attempts[request.slot].expiresAtMs }; break;
      case "begin": value = this.attempts[request.slot]; break;
      case "authenticate": value = { recorded: true, authTimeMs: Math.floor(request.attempt.startedAtMs / 1000) * 1000, sessionExpiresAtMs: request.attempt.expiresAtMs }; break;
      case "approve": value = { state: "browser-approved", expiresAtMs: request.attempt.expiresAtMs, authenticationExpiresAtMs: request.attempt.expiresAtMs }; break;
      case "confirm": value = { state: "terminal-confirmed", expiresAtMs: this.attempts[request.slot].expiresAtMs }; break;
      case "reserve": value = this.reservations[request.slot]; break;
      case "enroll-drop": this.enrolled = true; return { schemaVersion: 1, ok: false, error: "synthetic_reply_withheld" };
      case "enroll": this.enrolled = true; value = this.enrollment; break;
      case "namespace": value = this.namespace; break;
      case "insert-drop": this.revision = 1; return { schemaVersion: 1, ok: false, error: "synthetic_reply_withheld" };
      case "insert": this.revision = Math.max(this.revision, 1) as 1 | 2 | 3; value = this.batches[0]; break;
      case "correct": this.revision = 2; value = this.batches[1]; break;
      case "tombstone": this.revision = 3; value = this.batches[2]; break;
      case "read": value = qualificationExpectedDays(this.run, this.revision as 1 | 2 | 3, this.run.createdAtMs + 1000 * this.revision); break;
      case "revoke": value = { ...this.enrollment, deviceState: "revoked" }; break;
      case "revoked-probe": value = { result: "revoked" }; break;
      case "generation-probe": value = Object.fromEntries(QUALIFICATION_CLOSURE_KEYS.map(key => [key, "recovery_required"])); break;
      case "inspect": value = { objects: this.objects() }; break;
    }
    return { schemaVersion: 1, runId: this.run.runId, stage: request.stage, ok: true, value } as QualificationReply;
  }
  request(index: number): QualificationRequest {
    const entry = QUALIFICATION_SEQUENCE[index];
    const request = parseQualificationRequest(this.run, { schemaVersion: 1, runId: this.run.runId, stage: entry.stage,
      ...(entry.slot ? { slot: entry.slot } : {}),
      ...(entry.stage === "authenticate" || entry.stage === "approve" ? { attempt: this.attempts[entry.slot!] } : {}) });
    if (!request) throw new Error("test_fixture"); return request;
  }
}
function transcript(count = QUALIFICATION_SEQUENCE.length): { manifest: QualificationManifest; service: SyntheticTranscript } {
  const manifest: QualificationManifest = { schemaVersion: 1, accountId, sourceSha, sourceDigest, run, deployments: [], steps: [] }, service = new SyntheticTranscript(run);
  for (let index = 0; index < count; index++) {
    const entry = QUALIFICATION_SEQUENCE[index];
    if (!manifest.deployments.some(deployment => deployment.phase === entry.phase)) manifest.deployments.push(receipt(manifest, entry.phase));
    const request = service.request(index);
    manifest.steps.push({ id: entry.id, requestHex: hex(request), state: "complete", attemptCount: 1,
      dispatchedAtMs: run.createdAtMs + 10_000 + index, replyHex: hex(service.reply(request)) });
  }
  return { manifest: checkQualificationManifest(manifest), service };
}
const temporaryDirectories: string[] = [];
afterEach(async () => { for (const path of temporaryDirectories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function temporary(): Promise<string> {
  const parent = await realpath(tmpdir()), path = await mkdtemp(join(parent, "aicharts-qualification-driver-test-"));
  temporaryDirectories.push(path); await chmod(path, 0o700); return path;
}
async function seed(manifest: QualificationManifest): Promise<string> {
  const path = await temporary();
  await writeFile(join(path, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  const configs = qualificationConfigs(manifest.run, manifest.accountId);
  for (const [key, filename] of [["driver", "wrangler.driver.json"], ["generationOne", "wrangler.generation-one.json"], ["generationTwo", "wrangler.generation-two.json"]] as const)
    await writeFile(join(path, filename), configs[key], { mode: 0o600 });
  return path;
}
function response(reply: QualificationReply): Response {
  return new Response(qualificationBytes(hex(reply)), { status: reply.ok ? 200 : QUALIFICATION_ERROR_STATUS[reply.error], headers });
}
const now = () => run.createdAtMs + 20_000;
function appendPending(manifest: QualificationManifest, state: "prepared" | "dispatched" | "ambiguous", count = state === "prepared" ? 0 : 1): void {
  const service = transcript(manifest.steps.length).service, index = manifest.steps.length;
  manifest.steps.push({ id: QUALIFICATION_SEQUENCE[index].id, requestHex: hex(service.request(index)), state,
    attemptCount: count, dispatchedAtMs: state === "prepared" ? null : now(), replyHex: null });
}
function replaceReply(manifest: QualificationManifest, id: string, transform: (reply: QualificationReply) => unknown): void {
  const record = manifest.steps.find(record => record.id === id)!;
  record.replyHex = hex(transform(JSON.parse(Buffer.from(record.replyHex!, "hex").toString()) as QualificationReply));
}

describe("private qualification transcript and checkpoints", () => {
  test("replays the complete finite protocol, with seven unchanged objects and three exact deployment receipts", () => {
    const { manifest } = transcript();
    expect(qualificationSummary(manifest)).toEqual({ schemaVersion: 1, syntheticOnly: true, state: "complete",
      completedSteps: QUALIFICATION_SEQUENCE.length, totalSteps: QUALIFICATION_SEQUENCE.length, nextStep: null,
      deploymentCheckpoint: null, retryAllowed: false, objectCount: 7, deploymentReceipts: 3,
      providerReceipts: "caller-verified", productionActivation: false });
    const text = JSON.stringify(qualificationSummary(manifest));
    for (const privateValue of [accountId, run.runId, run.generationOne, sourceDigest, transcript().service.attempts.original.contextToken]) expect(text).not.toContain(privateValue);
  });
  test("requires each deployment exactly at its checkpoint and preserves source, namespace identities, target and configuration", async () => {
    const count = QUALIFICATION_SEQUENCE.findIndex(entry => entry.phase === "redeploy"), { manifest } = transcript(count), path = await seed(manifest);
    expect(qualificationSummary(manifest).deploymentCheckpoint).toBe("redeploy");
    const expected = receipt(manifest, "redeploy");
    for (const update of [{ sourceSha: "d".repeat(40) }, { sourceDigest: "e".repeat(64) }, { pairingsNamespaceId: "9".repeat(32) },
      { accountId: "f".repeat(32) }, { pairingsNamespaceId: "0".repeat(32) }, { workerName: "unrelated" }, { workersDev: true }, { trafficPercent: 50 },
      { recordsBucket: "other" }, { configSha256: "a".repeat(64) }, { versionId: manifest.deployments[0].versionId }, { phase: "generation-two" }]) {
      await expect(recordQualificationDeployment(path, { ...expected, ...update }, false)).rejects.toThrow();
    }
    const updated = await recordQualificationDeployment(path, expected, false);
    expect(updated.deployments).toHaveLength(2);
    expect(qualificationSummary(updated).state).toBe("ready");
    await expect(recordQualificationDeployment(path, expected, false)).rejects.toThrow("deployment_checkpoint_not_ready");
  });
  test("rejects DTO-valid evidence from another device, changed retries, stale projections and replaced R2 versions", () => {
    const { manifest, service } = transcript();
    for (const [id, transform] of [
      ["redeployed-enroll", (reply: QualificationReply) => reply.ok ? { ...reply, value: { ...service.enrollment, enrolledAtMs: service.enrollment.enrolledAtMs + 1 } } : reply],
      ["redeployed-days", (reply: QualificationReply) => reply.ok ? { ...reply, value: qualificationExpectedDays(run, 1, run.createdAtMs + 1001) } : reply],
      ["correction-days", (reply: QualificationReply) => reply.ok ? { ...reply, value: qualificationExpectedDays(run, 1, run.createdAtMs + 1000) } : reply],
      ["final-objects", (reply: QualificationReply) => reply.ok && "objects" in reply.value ? { ...reply, value: { objects: reply.value.objects.map((object, index) => index === 0 ? { ...object, version: "replaced" } : object) } } : reply],
      ["initial-empty", (reply: QualificationReply) => reply.ok ? { ...reply, value: { objects: service.objects().slice(0, 1) } } : reply],
    ] as const) {
      const changed = clone(manifest); replaceReply(changed, id, transform); expect(() => checkQualificationManifest(changed)).toThrow();
    }
    const foreign = qualificationFixture(run, "9".repeat(64)).insert;
    const foreignJournal = encodeAdmissionJournal(foreign.bytes, { status: 1, accountJournalRevision: 1, committedAtMs: run.createdAtMs + 1000,
      receipts: foreign.operations.map(operation => ({ outcome: 1, headOperationHash: operation.operationHash })) }, ADMISSION_POLICY_V1);
    expect(foreignJournal.ok).toBe(true);
    if (foreignJournal.ok) {
      const changed = clone(manifest); replaceReply(changed, "insert", reply => reply.ok ? { ...reply, value: {
        batchHex: qualificationByteHex(foreign.bytes), journalHex: qualificationByteHex(foreignJournal.value) } } : reply);
      expect(() => checkQualificationManifest(changed)).toThrow();
    }
  });
  test("retains the exact attempt context and rejects extra fields, changed request order and non-frozen steps", () => {
    const { manifest } = transcript();
    const changed = clone(manifest), request = JSON.parse(Buffer.from(changed.steps[3].requestHex, "hex").toString()) as QualificationRequest;
    expect(request.stage).toBe("authenticate");
    if (request.stage === "authenticate") changed.steps[3].requestHex = hex({ ...request, attempt: { ...request.attempt, contextToken: "e".repeat(64) } });
    expect(() => checkQualificationManifest(changed)).toThrow();
    expect(() => checkQualificationManifest({ ...manifest, qualified: true })).toThrow();
    const skipped = clone(manifest); skipped.steps.splice(8, 1); expect(() => checkQualificationManifest(skipped)).toThrow();
    const reordered = clone(manifest); reordered.steps[0].requestHex = hex({ stage: "inspect", runId: run.runId, schemaVersion: 1 });
    expect(() => checkQualificationManifest(reordered)).toThrow();
  });
});

describe("one explicit private service attempt", () => {
  test("persists dispatched exact bytes before the request, sends once and disposes once", async () => {
    const { manifest, service } = transcript(3), path = await seed(manifest); let calls = 0, disposals = 0;
    const factory: QualificationPlatformFactory = async configPath => {
      expect(configPath).toBe(join(path, "wrangler.driver.json"));
      return { env: { QUALIFICATION: { fetch: async request => {
        calls++; const saved = await loadQualification(path, false), pending = saved.steps.at(-1)!;
        expect(pending.state).toBe("dispatched"); expect(pending.attemptCount).toBe(1);
        expect(request.url).toBe(QUALIFICATION_URL); expect(request.method).toBe("POST"); expect(request.redirect).toBe("error");
        expect(request.headers.get("accept")).toBe("application/json"); expect(request.headers.get("content-type")).toBe("application/json");
        const text = await request.text(); expect(Buffer.from(text).toString("hex")).toBe(pending.requestHex);
        expect(JSON.parse(text)).toEqual(service.request(3)); return response(service.reply(service.request(3)));
      } } }, dispose: async () => { disposals++; } };
    };
    const result = await dispatchQualificationStep(path, { factory, now, verifySource: false });
    expect(result.steps.at(-1)?.state).toBe("complete"); expect(calls).toBe(1); expect(disposals).toBe(1);
    expect((await lstat(join(path, "manifest.json"))).mode & 0o777).toBe(0o600);
  });
  test("a lost begin reply is ambiguous forever: ordinary continuation and explicit retry never dispatch again", async () => {
    const { manifest } = transcript(2), path = await seed(manifest); let calls = 0;
    const factory: QualificationPlatformFactory = async () => ({ env: { QUALIFICATION: { fetch: async () => { calls++; throw new Error("synthetic_lost_reply"); } } }, dispose: async () => {} });
    const failed = await dispatchQualificationStep(path, { factory, now, verifySource: false });
    expect(qualificationSummary(failed).state).toBe("ambiguous"); expect(qualificationSummary(failed).retryAllowed).toBe(false);
    await expect(dispatchQualificationStep(path, { factory, now, verifySource: false })).rejects.toThrow("ambiguous_dispatch_requires_review");
    await expect(dispatchQualificationStep(path, { factory, now, verifySource: false, retry: true })).rejects.toThrow("exact_retry_refused");
    expect(calls).toBe(1);
  });
  test("interrupted dispatched state becomes ambiguous on resume and only the same permitted request can be explicitly retried", async () => {
    const { manifest, service } = transcript(3); appendPending(manifest, "dispatched"); const originalBytes = manifest.steps.at(-1)!.requestHex, path = await seed(manifest); let calls = 0;
    const factory: QualificationPlatformFactory = async () => ({ env: { QUALIFICATION: { fetch: async request => {
      calls++; expect(Buffer.from(await request.text()).toString("hex")).toBe(originalBytes); return response(service.reply(service.request(3)));
    } } }, dispose: async () => {} });
    expect(qualificationSummary(await loadQualification(path, false)).state).toBe("ambiguous");
    await expect(dispatchQualificationStep(path, { factory, now, verifySource: false })).rejects.toThrow("ambiguous_dispatch_requires_review");
    expect((await loadQualification(path, false)).steps.at(-1)?.state).toBe("ambiguous"); expect(calls).toBe(0);
    const retried = await dispatchQualificationStep(path, { factory, now, verifySource: false, retry: true });
    expect(retried.steps.at(-1)?.attemptCount).toBe(2); expect(retried.steps.at(-1)?.requestHex).toBe(originalBytes); expect(calls).toBe(1);
  });
  test("prepared intent resumes safely, while exhausted retries and deployment gaps make no service call", async () => {
    const { manifest, service } = transcript(3); appendPending(manifest, "prepared"); const path = await seed(manifest); let calls = 0;
    const factory: QualificationPlatformFactory = async () => ({ env: { QUALIFICATION: { fetch: async () => { calls++; return response(service.reply(service.request(3))); } } }, dispose: async () => {} });
    expect((await dispatchQualificationStep(path, { factory, now, verifySource: false })).steps.at(-1)?.state).toBe("complete"); expect(calls).toBe(1);
    const exhausted = transcript(3).manifest; appendPending(exhausted, "ambiguous", 3);
    await expect(dispatchQualificationStep(await seed(exhausted), { factory, now, verifySource: false, retry: true })).rejects.toThrow("exact_retry_refused");
    const boundary = QUALIFICATION_SEQUENCE.findIndex(entry => entry.phase === "redeploy");
    await expect(dispatchQualificationStep(await seed(transcript(boundary).manifest), { factory, now, verifySource: false })).rejects.toThrow("deployment_checkpoint_required");
    expect(calls).toBe(1);
  });
  test("the attempt deadline cancels a stalled body and persists ambiguity; late completion cannot advance it", async () => {
    const { manifest } = transcript(2), path = await seed(manifest); let canceled = 0, disposed = 0;
    const factory: QualificationPlatformFactory = async () => ({ env: { QUALIFICATION: { fetch: async () => new Response(new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => {}), cancel: () => { canceled++; },
    }), { status: 200, headers }) } }, dispose: async () => { disposed++; } });
    const result = await dispatchQualificationStep(path, { factory, now, verifySource: false, deadlineMs: 10 });
    expect(result.steps.at(-1)?.state).toBe("ambiguous"); expect(canceled).toBe(1); expect(disposed).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 15)); expect((await loadQualification(path, false)).steps.at(-1)?.state).toBe("ambiguous");
  });
  test("a factory resolving during timeout persistence has one cleanup owner and never fetches", async () => {
    const { manifest } = transcript(2), path = await seed(manifest);
    const lateFactory = Promise.withResolvers<QualificationPlatform>(), disposal = Promise.withResolvers<void>(), disposing = Promise.withResolvers<void>();
    let factoryStarted = false, released = false, fetches = 0, disposals = 0;
    const platform: QualificationPlatform = { env: { QUALIFICATION: { fetch: async () => { fetches++; throw new Error("unexpected"); } } },
      dispose: async () => { disposals++; disposing.resolve(); await disposal.promise; } };
    const watcher = watch(path, { persistent: false }, (_event, name) => {
      // The first temporary manifest created after factory startup is the
      // timeout result. Resolve while that durable save is still in progress,
      // so the late factory and outer finally both reach cleanup.
      if (factoryStarted && !released && name?.startsWith(".manifest-")) { released = true; lateFactory.resolve(platform); }
    });
    const pending = dispatchQualificationStep(path, { factory: async () => { factoryStarted = true; return await lateFactory.promise; },
      now, verifySource: false, deadlineMs: 10 });
    const timeout = Promise.withResolvers<never>(), timer = setTimeout(() => timeout.reject(new Error("test_factory_not_released")), 1000);
    let result: QualificationManifest;
    try {
      await Promise.race([disposing.promise, timeout.promise]);
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(fetches).toBe(0); expect(disposals).toBe(1);
      expect((await loadQualification(path, false)).steps.at(-1)?.state).toBe("ambiguous");
    } finally { clearTimeout(timer); watcher.close(); lateFactory.resolve(platform); disposal.resolve(); result = await pending; }
    expect(result.steps.at(-1)?.state).toBe("ambiguous"); expect(disposals).toBe(1);
  });
  test("monotonic deadline and civil expiry or rollback close acceptance even before the timer runs", async () => {
    for (const kind of ["elapsed-after-factory", "elapsed-after-fetch", "civil-rollback", "civil-expiry", "monotonic-rollback"] as const) {
      const { manifest, service } = transcript(3), path = await seed(manifest);
      let elapsed = 0, civil = now(), calls = 0;
      const factory: QualificationPlatformFactory = async () => {
        if (kind === "elapsed-after-factory") elapsed = 20_001;
        if (kind === "monotonic-rollback") elapsed = -1;
        if (kind === "civil-rollback") civil--;
        return { env: { QUALIFICATION: { fetch: async () => {
          calls++; if (kind === "elapsed-after-fetch") elapsed = 20_001;
          if (kind === "civil-expiry") civil = run.expiresAtMs;
          return response(service.reply(service.request(3)));
        } } }, dispose: async () => {} };
      };
      const result = await dispatchQualificationStep(path, { factory, now: () => civil, monotonicNow: () => elapsed, verifySource: false });
      expect(result.steps.at(-1)?.state).toBe("ambiguous");
      expect(calls).toBe(kind === "elapsed-after-fetch" || kind === "civil-expiry" ? 1 : 0);
    }
    const { manifest } = transcript(3), path = await seed(manifest); let calls = 0;
    const factory: QualificationPlatformFactory = async () => { calls++; throw new Error("unexpected"); };
    await expect(dispatchQualificationStep(path, { factory, now: () => manifest.steps.at(-1)!.dispatchedAtMs! - 1, verifySource: false })).rejects.toThrow("qualification_run_expired");
    expect(calls).toBe(0);
  });
  test("an existing lock, modified private config or environment file prevents any provider access", async () => {
    const { manifest } = transcript(3); let calls = 0;
    const factory: QualificationPlatformFactory = async () => { calls++; throw new Error("unexpected"); };
    for (const kind of ["lock", "config", "environment", "mode", "symlink"] as const) {
      const path = await seed(manifest);
      if (kind === "lock") await writeFile(join(path, "dispatch.lock"), "{}", { mode: 0o600 });
      if (kind === "config") await writeFile(join(path, "wrangler.driver.json"), "{}");
      if (kind === "environment") await writeFile(join(path, ".env.local"), "SYNTHETIC_CANARY=unused");
      if (kind === "mode") await chmod(join(path, "manifest.json"), 0o644);
      if (kind === "symlink") { await rm(join(path, "manifest.json")); await symlink("wrangler.driver.json", join(path, "manifest.json")); }
      await expect(dispatchQualificationStep(path, { factory, now, verifySource: false })).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });
});

describe("bounded canonical reply admission", () => {
  test("rejects wrong status, headers, whitespace, extra fields, mismatched stage and excessive or truncated streams", async () => {
    const service = new SyntheticTranscript(run), request = service.request(0), valid = service.reply(request), bytes = qualificationBytes(hex(valid));
    const cases = [
      new Response(bytes, { status: 201, headers }), new Response(bytes, { headers: { ...headers, "set-cookie": "private-canary=x" } }),
      new Response(bytes, { headers: { ...headers, "access-control-allow-origin": "*" } }),
      new Response(bytes, { headers: { ...headers, "content-length": "999" } }),
      new Response(bytes, { headers: { ...headers, "content-length": `0${bytes.length}` } }),
      new Response(` ${Buffer.from(bytes).toString()}`, { headers }),
      new Response(JSON.stringify({ ...valid, extra: true }), { headers }),
      new Response(JSON.stringify({ ...valid, stage: "read" }), { headers }),
      new Response(new Uint8Array(QUALIFICATION_REPLY_BYTES + 1), { headers }),
      new Response(bytes.subarray(0, bytes.length - 1), { headers }),
    ];
    for (const candidate of cases) await expect(readQualificationResponse(candidate, run, request, new AbortController().signal)).rejects.toThrow();
    expect((await readQualificationResponse(response(valid), run, request, new AbortController().signal)).reply).toEqual(valid);
  });
  test("valid error envelopes do not qualify a successful operation and do not leak raw failures", async () => {
    const { manifest } = transcript(3), path = await seed(manifest);
    const factory: QualificationPlatformFactory = async () => ({ env: { QUALIFICATION: { fetch: async () => response({ schemaVersion: 1, ok: false, error: "qualification_unavailable" }) } }, dispose: async () => {} });
    const result = await dispatchQualificationStep(path, { factory, now, verifySource: false });
    expect(result.steps.at(-1)?.state).toBe("ambiguous"); expect(result.steps.at(-1)?.replyHex).toBeNull();
    expect(qualificationSummary(result).completedSteps).toBe(3);
  });
  test("prepare uses absent private directories and frozen configs; a changed target is refused before creating anything", async () => {
    const parent = await temporary(), path = join(parent, "run"), target = { accountId, ...QUALIFICATION_TARGET };
    await expect(prepareQualification(path, sourceSha, { ...target, workerName: "unrelated" }, run.createdAtMs)).rejects.toThrow();
    await expect(lstat(path)).rejects.toThrow();
    const prepared = await prepareQualification(path, sourceSha, target, run.createdAtMs);
    expect((await lstat(path)).mode & 0o777).toBe(0o700);
    expect(prepared.run.generationOne).not.toBe(prepared.run.generationTwo);
    expect(prepared.run.expiresAtMs - prepared.run.createdAtMs).toBe(DAY_MS);
    expect(prepared.run.firstUtcDay + 3).toBe(Math.floor(prepared.run.createdAtMs / DAY_MS));
    const config = JSON.parse(await readFile(join(path, "wrangler.driver.json"), "utf8")) as Record<string, unknown>;
    expect(config.account_id).toBe(accountId); expect(config.workers_dev).toBe(false); expect(config.preview_urls).toBe(false);
    expect((await loadQualification(path)).sourceDigest).toBe(prepared.sourceDigest);
    await expect(prepareQualification(path, sourceSha, target, run.createdAtMs)).rejects.toThrow();
    expect((await loadQualification(path)).run.runId).toBe(prepared.run.runId);
    const linked = join(parent, "linked"); await symlink(path, linked); await expect(loadQualification(linked)).rejects.toThrow();
    const wide = join(parent, "wide"); await mkdir(wide, { mode: 0o755 }); await expect(loadQualification(wide)).rejects.toThrow();
  });
});
