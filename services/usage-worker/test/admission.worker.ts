import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { decodeAdmissionBatch, decodeAdmissionJournal, encodeAdmissionBatch, encodeAdmissionOperation, type AdmissionBatch } from "../../../lib/usage/admission";
import { DAY_MS, encodeUsageBatch } from "../../../lib/usage/wire";
import { ADMISSION_POLICY_V1, decideAdmission, freezeAdmission, type AdmissionHead } from "../src/admission-policy";
import { AdmissionState, admissionIdBytes } from "../src/admission-state";
import { ADMISSION_SCHEMA } from "../src/admission-schema";
import { enrollmentAccountName, type EnrollmentProof } from "../src/enrollment-contract";
import { namespaceAnchorKey } from "../src/namespace-anchor";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0, 456);
const DAY = Math.floor(NOW / DAY_MS);
let serial = 0, account = "", intent = 0;
const hex = (number: number, width = 32) => number.toString(16).padStart(width * 2, "0");
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account));
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(`synthetic fixture: ${result.error}`);
  return result.value;
};
beforeEach(() => {
  account = `acct_${hex(++serial, 16)}`;
  intent = serial * 100;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const bucket of [env.CONTROL, env.STAGING]) {
    const keys = (await bucket.list()).objects.map(object => object.key);
    if (keys.length) await bucket.delete(keys);
  }
  await reset();
});
type Device = { proof: EnrollmentProof; id: Uint8Array };
async function enroll(): Promise<Device> {
  const proof = { intentId: hex(++intent), pollSecret: hex(intent + 1_000_000), uploadSecret: hex(intent + 2_000_000) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), nonce = hex(intent + 3_000_000);
  const uploadCommitment = success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret));
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce: nonce }));
  const browser = { intentId: proof.intentId, attemptId: attempt.attemptId, browserNonce: nonce, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId: account, authTimeMs: Math.floor(NOW / 1000) * 1000, sessionExpiresAtMs: NOW + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId: account, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: account }));
  success(await pairing.reserveEnrollment(proof));
  return { proof, id: admissionIdBytes(success(await stub().enroll(proof)).receipt.deviceId) };
}
function batch(device: Device, sequence = 1, members: { id: number; expected?: Uint8Array; output?: bigint; tombstone?: boolean; day?: number; offset?: number }[] = [{ id: 1 }]): AdmissionBatch {
  const operations = members.map((member, index) => {
    const id = admissionIdBytes(hex(member.id, 16));
    const frame = member.tombstone ? new Uint8Array() : success(encodeUsageBatch({ utcDay: member.day ?? DAY, registryRevision: 1,
      usage: [{ id, executionId: new Uint8Array(16), accountId: new Uint8Array(16), offsetMs: member.offset ?? 1,
        provider: 1, authMode: 0, evidence: 1, modelId: 0, contextTier: 0,
        tokens: { inputUncached: 10n, cacheRead: 0n, cacheWrite5m: 0n, cacheWrite1h: 0n, output: member.output ?? 5n, reasoningOutput: 0n } }], prompts: [], intervals: [] }, ADMISSION_POLICY_V1));
    return success(encodeAdmissionOperation({ accountId: admissionIdBytes(account.slice(5)), deviceId: device.id,
      generation: admissionIdBytes(env.USAGE_ENROLLMENT_GENERATION), action: member.tombstone ? 2 : 1,
      sequence: sequence + index, occurrenceId: id, expectedHeadHash: member.expected ?? new Uint8Array(32), frame }, ADMISSION_POLICY_V1));
  });
  return success(decodeAdmissionBatch(success(encodeAdmissionBatch(operations, ADMISSION_POLICY_V1)), ADMISSION_POLICY_V1));
}
async function upload(device: Device, value: AdmissionBatch) {
  return stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes });
}
function journal(bytes: Uint8Array, value: AdmissionBatch) { return success(decodeAdmissionJournal(bytes, value.bytes, ADMISSION_POLICY_V1)); }
async function snapshot() {
  return runInDurableObject(stub(), (_instance, state) => ({
    control: state.storage.sql.exec("SELECT * FROM usage_admission_control").one(),
    heads: state.storage.sql.exec("SELECT * FROM usage_admission_heads ORDER BY occurrence_id").toArray(),
    devices: state.storage.sql.exec("SELECT * FROM usage_admission_devices ORDER BY device_id").toArray(),
    pending: state.storage.sql.exec("SELECT * FROM usage_admission_pending").toArray(),
    days: state.storage.sql.exec("SELECT * FROM usage_admission_days ORDER BY utc_day").toArray(),
  }));
}
function allRows(sql: SqlStorage) {
  return {
    enrollment: sql.exec("SELECT * FROM account_enrollment ORDER BY id").toArray(),
    control: sql.exec("SELECT * FROM usage_admission_control ORDER BY id").toArray(),
    devices: sql.exec("SELECT * FROM usage_admission_devices ORDER BY device_id").toArray(),
    pending: sql.exec("SELECT * FROM usage_admission_pending ORDER BY id").toArray(),
    heads: sql.exec("SELECT * FROM usage_admission_heads ORDER BY occurrence_id").toArray(),
    days: sql.exec("SELECT * FROM usage_admission_days ORDER BY utc_day").toArray(),
  };
}
function replaceEnvironment(instance: unknown, change: (original: Env) => Env): () => void {
  const object = instance as { env: Env }, original = object.env;
  object.env = change(original); return () => { object.env = original; };
}
function bucketProxy(bucket: R2Bucket, intercept: (method: "get" | "put", args: unknown[], invoke: () => Promise<unknown>) => Promise<unknown>): R2Bucket {
  return new Proxy(bucket, { get(target, property) {
    const original: unknown = Reflect.get(target, property, target);
    if ((property === "get" || property === "put") && typeof original === "function") return (...args: unknown[]) => intercept(property, args, () => Reflect.apply(original, target, args) as Promise<unknown>);
    return typeof original === "function" ? original.bind(target) : original;
  } });
}
function barrier() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { entered, enter, release, released };
}

describe("dormant account admission", () => {
  test("decision laws hold across absent/live/deleted, CAS, payload and revocation combinations", async () => {
    const device = await enroll();
    for (const kind of ["absent", "live", "deleted"] as const) {
      const oldOperation = batch(device, 1, [{ id: 1, tombstone: kind === "deleted", expected: admissionIdBytes(hex(9000)) }]).operations[0];
      const head: AdmissionHead | null = kind === "absent" ? null : { operation: oldOperation, revision: 1, day: kind === "live" ? DAY : null };
      for (const tombstone of [false, true]) for (const expected of [new Uint8Array(32), oldOperation.operationHash, admissionIdBytes(hex(9001))]) for (const changed of [false, true]) for (const revoked of [false, true]) {
        const value = batch(device, 2, [{ id: 1, tombstone, expected, output: changed ? 1n : 5n }, { id: 2 }]);
        const retained = structuredClone({ batch: value.bytes, head: head?.operation.bytes ?? null });
        const decision = decideAdmission(value, [head, null], revoked);
        expect(decideAdmission(value, [head, null], revoked)).toEqual(decision);
        expect({ batch: value.bytes, head: head?.operation.bytes ?? null }).toEqual(retained);
        expect(journal(freezeAdmission(value, decision, 2, NOW).bytes, value).status).toBe(decision.status);
        const absentExpectation = expected.every(byte => byte === 0);
        const matchesLive = expected.every((byte, index) => byte === oldOperation.operationHash[index]);
        const expectedFirst = revoked ? 7 : kind === "deleted" ? 8 : kind === "live" && !tombstone && !changed ? 4
          : kind === "absent" ? !tombstone && absentExpectation ? 1 : 5 : matchesLive ? tombstone ? 3 : 2 : 5;
        expect(decision.status).toBe(expectedFirst <= 4 ? 1 : 2);
        expect(decision.receipts.map(item => item.outcome)).toEqual([expectedFirst, expectedFirst <= 4 ? 1 : revoked ? 7 : 6]);
        if (revoked) expect(decision.receipts.map(item => item.outcome)).toEqual([7, 7]);
        else if (kind === "deleted") expect(decision.receipts.map(item => item.outcome)).toEqual([8, 6]);
        else if (kind === "live" && !tombstone && !changed) {
          expect(decision.receipts[0]).toEqual({ outcome: 4, headOperationHash: oldOperation.operationHash });
        }
        if (decision.status === 2) expect(decision.receipts.every(item => item.outcome >= 5)).toBe(true);
        else expect(decision.receipts.every(item => item.outcome <= 4)).toBe(true);
      }
    }
  });

  test("real enrollment authenticates a numeric batch, publishes once, and survives restart", async () => {
    const device = await enroll(), value = batch(device);
    const bytes = success(await upload(device, value)), committed = journal(bytes, value);
    expect(committed).toMatchObject({ status: 1, accountJournalRevision: 1, committedAtMs: NOW, receipts: [{ outcome: 1 }] });
    const before = await snapshot();
    expect(before.control).toMatchObject({ published_revision: 1, head_count: 1, live_count: 1 });
    expect(before.pending).toEqual([]); expect(before.devices[0].settled_sequence).toBe(1);
    expect((await env.STAGING.list()).objects).toHaveLength(1);
    expect((await env.CONTROL.list()).objects).toHaveLength(2);
    expect((await env.CONTROL.get(namespaceAnchorKey(account)))?.size).toBe(160);
    await abortAllDurableObjects();
    expect(success(await upload(device, value))).toEqual(bytes);
    expect(await snapshot()).toEqual(before);
  });

  test("expired enrollment grant is not routine upload authority; polling is never called", async () => {
    const device = await enroll(), value = batch(device);
    vi.setSystemTime(NOW + PAIRING_TTL_MS + 1);
    const result = await runInDurableObject(stub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, PAIRINGS: new Proxy(original.PAIRINGS, { get() { throw new Error("private-provider-failure-canary"); } }) }));
      try { return await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes }); } finally { restore(); }
    });
    expect(journal(success(result), value).status).toBe(1);
  });

  test("wrong preimage, polling substitution, unknown device and wrong account reserve nothing", async () => {
    const device = await enroll(), value = batch(device), before = await snapshot();
    for (const secret of [hex(9999), device.proof.pollSecret]) expect(await stub().admitBatch({ uploadSecret: secret, batch: value.bytes })).toEqual({ ok: false, error: "unauthorized" });
    const wrong = batch({ ...device, id: admissionIdBytes(hex(9999)) });
    expect(await upload(device, wrong)).toEqual({ ok: false, error: "unauthorized" });
    expect((await env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(`acct_${hex(9999, 16)}`)).admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes })).ok).toBe(false);
    expect(await snapshot()).toEqual(before); expect((await env.STAGING.list()).objects).toEqual([]);
  });

  test("exact DTO and canonical bytes reject transcript-shaped extensions before effects", async () => {
    const device = await enroll(), value = batch(device), before = await snapshot();
    await runInDurableObject(stub(), async instance => {
      let read = false;
      const accessor = { uploadSecret: device.proof.uploadSecret, get batch() { read = true; return value.bytes; } };
      for (const input of [accessor, { uploadSecret: device.proof.uploadSecret, batch: value.bytes, chat: "transcript-canary" },
        { uploadSecret: device.proof.uploadSecret, batch: new Uint8Array([...value.bytes, 0]) }]) {
        expect(await instance.admitBatch(input)).toEqual({ ok: false, error: "invalid_input" });
      }
      expect(read).toBe(false);
    });
    expect(await snapshot()).toEqual(before);
  });

  test("insert, decrease, cross-device dedup and irreversible tombstone retain exact heads", async () => {
    const first = await enroll(), second = await enroll(), initial = batch(first);
    success(await upload(first, initial));
    const duplicate = batch(second);
    expect(journal(success(await upload(second, duplicate)), duplicate).receipts[0].outcome).toBe(4);
    const correction = batch(first, 2, [{ id: 1, expected: initial.operations[0].operationHash, output: 1n, day: DAY - 1 }]);
    expect(journal(success(await upload(first, correction)), correction).receipts[0].outcome).toBe(2);
    const tombstone = batch(first, 3, [{ id: 1, expected: correction.operations[0].operationHash, tombstone: true }]);
    expect(journal(success(await upload(first, tombstone)), tombstone).receipts[0].outcome).toBe(3);
    const resurrect = batch(second, 2, [{ id: 1 }]);
    expect(journal(success(await upload(second, resurrect)), resurrect).receipts[0].outcome).toBe(8);
    const state = await snapshot();
    expect(state.control).toMatchObject({ published_revision: 5, head_count: 1, live_count: 0 }); expect(state.days).toEqual([]);
    await abortAllDurableObjects(); expect(success(await upload(second, resurrect))).toEqual(success(await upload(second, resurrect)));
  });

  test("mixed conflict rejects all members and consumes the complete sequence range", async () => {
    const device = await enroll(), value = batch(device, 1, [{ id: 1 }, { id: 2, tombstone: true }]);
    const bytes = success(await upload(device, value));
    expect(journal(bytes, value).receipts.map(receipt => receipt.outcome)).toEqual([6, 5]);
    const state = await snapshot(); expect(state.heads).toEqual([]); expect(state.devices[0].settled_sequence).toBe(2);
    expect(await upload(device, batch(device, 1, [{ id: 3 }]))).toEqual({ ok: false, error: "conflict" });
    expect(await upload(device, batch(device, 4, [{ id: 3 }]))).toEqual({ ok: false, error: "conflict" });
    success(await upload(device, batch(device, 3, [{ id: 3 }])));
    await abortAllDurableObjects(); expect((await snapshot()).control.published_revision).toBe(2);
  });

  test.each(["STAGING", "CONTROL"] as const)("lost %s PUT reply preserves an exact resumable flight", async binding => {
    const device = await enroll(), value = batch(device);
    const result = await runInDurableObject(stub(), async instance => {
      const bucket = bucketProxy(env[binding], async (method, args, invoke) => {
        const result = await invoke();
        if (method === "put" && String(args[0]).startsWith("usage-admission/")) throw new Error("private-provider-failure-canary");
        return result;
      });
      const restore = replaceEnvironment(instance, original => ({ ...original, [binding]: bucket }));
      try { return await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes }); } finally { restore(); }
    });
    expect(result).toEqual({ ok: false, error: "storage_unavailable" });
    const before = await snapshot(); expect(before.heads).toEqual([]); expect(before.pending[0].phase).toBe(binding === "STAGING" ? 1 : 2);
    const objects = (await env[binding].list()).objects.map(object => ({ key: object.key, version: object.version }));
    await abortAllDurableObjects();
    expect(journal(success(await upload(device, value)), value).accountJournalRevision).toBe(1);
    expect((await env[binding].list()).objects.map(object => ({ key: object.key, version: object.version }))).toEqual(objects);
  });

  test.each(["STAGING", "CONTROL"] as const)("revocation during %s write respects the frozen decision", async binding => {
    const device = await enroll(), value = batch(device), gate = barrier();
    await runInDurableObject(stub(), async instance => {
      const bucket = bucketProxy(env[binding], async (method, args, invoke) => {
        if (method === "put" && String(args[0]).startsWith("usage-admission/")) { gate.enter(); await gate.released; }
        return invoke();
      });
      const restore = replaceEnvironment(instance, original => ({ ...original, [binding]: bucket }));
      const inflight = instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes });
      try {
        await gate.entered;
        success(await instance.revokeEnrollment(device.proof));
        gate.release();
        const result = journal(success(await inflight), value);
        expect(result.receipts[0].outcome).toBe(binding === "STAGING" ? 7 : 1);
      } finally { gate.release(); await inflight; restore(); }
    });
    expect(await upload(device, batch(device, 2, [{ id: 2 }]))).toEqual({ ok: false, error: "revoked" });
    await abortAllDurableObjects(); expect((await upload(device, value)).ok).toBe(true);
  });

  test("concurrent exact calls publish once", async () => {
    const device = await enroll(), value = batch(device);
    const results = await Promise.all([upload(device, value), upload(device, value), upload(device, value)]);
    const bytes = results.map(success);
    expect(bytes[1]).toEqual(bytes[0]); expect(bytes[2]).toEqual(bytes[0]);
    expect((await snapshot()).control.published_revision).toBe(1);
  });

  test("future inputs consume no sequence or object and may retry after time catches up", async () => {
    const device = await enroll(), value = batch(device, 1, [{ id: 1, offset: NOW % DAY_MS + 1 }]);
    const before = await snapshot(); expect(await upload(device, value)).toEqual({ ok: false, error: "invalid_input" });
    expect(await snapshot()).toEqual(before); expect((await env.STAGING.list()).objects).toEqual([]);
    vi.setSystemTime(NOW + 1); success(await upload(device, value));
  });

  test("invalid future input cannot help a different retained flight", async () => {
    const first = await enroll(), second = await enroll(), prior = batch(first);
    await runInDurableObject(stub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, STAGING: bucketProxy(env.STAGING, async (method, _args, invoke) => {
        if (method === "put") throw new Error("synthetic-before-effect"); return invoke();
      }) }));
      try { expect(await instance.admitBatch({ uploadSecret: first.proof.uploadSecret, batch: prior.bytes })).toEqual({ ok: false, error: "storage_unavailable" }); } finally { restore(); }
    });
    const before = await snapshot();
    const future = batch(second, 1, [{ id: 2, offset: NOW % DAY_MS + 1 }]);
    expect(await upload(second, future)).toEqual({ ok: false, error: "invalid_input" });
    expect(await snapshot()).toEqual(before); expect((await env.STAGING.list()).objects).toEqual([]);
    const next = batch(second, 1, [{ id: 2 }]);
    const receipt = journal(success(await upload(second, next)), next);
    expect(receipt.accountJournalRevision).toBe(2);
    expect((await snapshot()).heads).toHaveLength(2);
  });

  test("latest replay leaves a later flight intact and never returns its receipt", async () => {
    const device = await enroll(), first = batch(device), firstReceipt = success(await upload(device, first));
    const next = batch(device, 2, [{ id: 2 }]);
    await runInDurableObject(stub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, STAGING: bucketProxy(env.STAGING, async (method, _args, invoke) => {
        if (method === "put") throw new Error("synthetic-before-effect"); return invoke();
      }) }));
      try { expect((await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: next.bytes })).ok).toBe(false); } finally { restore(); }
    });
    const before = await snapshot();
    expect(success(await upload(device, first))).toEqual(firstReceipt);
    expect(await snapshot()).toEqual(before);
    expect(journal(success(await upload(device, next)), next).accountJournalRevision).toBe(2);
  });

  test("mutation after invocation cannot alter the owned request snapshot", async () => {
    const device = await enroll(), value = batch(device), mutable = Uint8Array.from(value.bytes);
    await runInDurableObject(stub(), async instance => {
      const pending = instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: mutable });
      mutable.fill(255);
      expect(journal(success(await pending), value).status).toBe(1);
    });
    expect(new Uint8Array((await snapshot()).devices[0].last_batch as ArrayBuffer)).toEqual(value.bytes);
  });

  test.each(["STAGING", "CONTROL"] as const)("material clock failure at %s fence remains a failure after concurrent publication", async binding => {
    const device = await enroll(), value = batch(device), gate = barrier();
    await runInDurableObject(stub(), async instance => {
      let first = true;
      const proxy = bucketProxy(env[binding], async (method, args, invoke) => {
        const result = await invoke();
        if (first && method === "put" && String(args[0]).startsWith("usage-admission/")) {
          first = false; gate.enter(); await gate.released;
          // Only the helper's fence sees regression. Its subsequent fresh
          // locate sees NOW and a settled result, so sticky failure is required.
          vi.spyOn(Date, "now").mockImplementation(() => NOW).mockImplementationOnce(() => NOW - 1);
        }
        return result;
      });
      const restore = replaceEnvironment(instance, original => ({ ...original, [binding]: proxy }));
      const old = instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes });
      try {
        await gate.entered;
        success(await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes }));
        gate.release();
        expect(await old).toEqual({ ok: false, error: "clock_regressed" });
      } finally { gate.release(); await old; vi.setSystemTime(NOW); restore(); }
    });
    expect((await snapshot()).control.published_revision).toBe(1);
  });

  test.each(["STAGING", "CONTROL"] as const)("generation changes across %s cannot publish stale authority", async binding => {
    const device = await enroll(), value = batch(device);
    await runInDurableObject(stub(), async instance => {
      let restoreGeneration = () => {};
      const proxy = bucketProxy(env[binding], async (method, args, invoke) => {
        const result = await invoke();
        if (method === "put" && String(args[0]).startsWith("usage-admission/")) {
          restoreGeneration = replaceEnvironment(instance, original => {
            const changed = { ...original };
            Object.defineProperty(changed, "USAGE_ENROLLMENT_GENERATION", { value: hex(90909), enumerable: true }); return changed;
          });
        }
        return result;
      });
      const restore = replaceEnvironment(instance, original => ({ ...original, [binding]: proxy }));
      try { expect(await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes })).toEqual({ ok: false, error: "recovery_required" }); }
      finally { restoreGeneration(); restore(); }
    });
    const before = await snapshot(); expect(before.control.published_revision).toBe(0); expect(before.heads).toEqual([]);
    success(await upload(device, value));
  });

  test("enrollment and admission share a durable clock floor in both directions", async () => {
    const device = await enroll(), value = batch(device);
    vi.setSystemTime(NOW + 100); success(await upload(device, value));
    vi.setSystemTime(NOW + 99); expect(await stub().revokeEnrollment(device.proof)).toEqual({ ok: false, error: "clock_regressed" });
    vi.setSystemTime(NOW + 200); success(await stub().revokeEnrollment(device.proof));
    await abortAllDurableObjects(); vi.setSystemTime(NOW + 199);
    expect(await upload(device, value)).toEqual({ ok: false, error: "clock_regressed" });
  });

  test("full restart audit refuses a contradictory published head without object effects", async () => {
    const device = await enroll(), value = batch(device); success(await upload(device, value));
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE usage_admission_control SET head_count = 2, live_count = 2").toArray());
    const before = await snapshot(); await abortAllDurableObjects();
    expect(await upload(device, value)).toEqual({ ok: false, error: "storage_invalid" });
    expect(await snapshot()).toEqual(before);
  });

  test("canonical frozen rejection cannot replace an eligible pending insert", async () => {
    const device = await enroll(), value = batch(device);
    await runInDurableObject(stub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucketProxy(env.CONTROL, async (method, args, invoke) => {
        if (method === "put" && String(args[0]).startsWith("usage-admission/")) throw new Error("synthetic-before-journal"); return invoke();
      }) }));
      try { expect((await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes })).ok).toBe(false); } finally { restore(); }
    });
    const impossible = freezeAdmission(value, { status: 2, receipts: [{ outcome: 5, headOperationHash: new Uint8Array(32) }] }, 1, NOW);
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE usage_admission_pending SET journal = ?", impossible.bytes).toArray());
    const before = await snapshot(); await abortAllDurableObjects();
    expect(await upload(device, value)).toEqual({ ok: false, error: "storage_invalid" }); expect(await snapshot()).toEqual(before);
    expect((await env.CONTROL.list()).objects).toHaveLength(1);
  });

  test("canonical latest receipts distinguish true conflicts from batch-aborted eligible members", async () => {
    const device = await enroll(), value = batch(device, 1, [{ id: 1 }, { id: 2, tombstone: true }]);
    success(await upload(device, value));
    const impossible = freezeAdmission(value, { status: 2, receipts: [{ outcome: 5, headOperationHash: new Uint8Array(32) }, { outcome: 6, headOperationHash: new Uint8Array(32) }] }, 1, NOW);
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE usage_admission_devices SET last_journal = ?", impossible.bytes).toArray());
    const before = await snapshot(); await abortAllDurableObjects();
    expect(await upload(device, value)).toEqual({ ok: false, error: "storage_invalid" }); expect(await snapshot()).toEqual(before);
  });

  test("canonical outcome6 cannot conceal an ineligible member when another true conflict remains", async () => {
    const device = await enroll(), value = batch(device, 1, [{ id: 1 }, { id: 2, tombstone: true }, { id: 3, tombstone: true }]);
    success(await upload(device, value));
    const impossible = freezeAdmission(value, { status: 2, receipts: [6, 6, 5].map(outcome => ({ outcome: outcome as 5 | 6, headOperationHash: new Uint8Array(32) })) }, 1, NOW);
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE usage_admission_devices SET last_journal = ?", impossible.bytes).toArray());
    const before = await snapshot(); await abortAllDurableObjects();
    expect(await upload(device, value)).toEqual({ ok: false, error: "storage_invalid" }); expect(await snapshot()).toEqual(before);
  });

  test.each(["zero predecessor tombstone", "reused latest sequence", "duplicate old sequence", "mixed revision owners"] as const)("full head audit rejects canonical %s", async corruption => {
    const first = await enroll(), second = await enroll();
    const origin = batch(first, 1, [{ id: 1 }, { id: 2 }]); success(await upload(first, origin));
    const next = batch(first, 3, [{ id: 3 }]); success(await upload(first, next));
    const secondOrigin = batch(second, 1, [{ id: 4 }]); success(await upload(second, secondOrigin));
    if (corruption === "mixed revision owners") {
      // Release second's old sequence1 from its current head and move its latest
      // range to2, so only the old revision-owner relation rejects the fixture.
      success(await upload(second, batch(second, 2, [{ id: 4, expected: secondOrigin.operations[0].operationHash, output: 1n }])));
    }
    let replacement: AdmissionBatch;
    switch (corruption) {
      case "zero predecessor tombstone": replacement = batch(first, 1, [{ id: 1, tombstone: true }]); break;
      case "reused latest sequence": replacement = batch(first, 3, [{ id: 1 }]); break;
      case "duplicate old sequence": replacement = batch(first, 2, [{ id: 1 }]); break;
      case "mixed revision owners": replacement = batch(second, 1, [{ id: 1 }]); break;
    }
    await runInDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("UPDATE usage_admission_heads SET operation = ?, utc_day = ? WHERE occurrence_id = ?", replacement.operations[0].bytes,
        corruption === "zero predecessor tombstone" ? null : DAY, replacement.operations[0].occurrenceId);
      if (corruption === "zero predecessor tombstone") {
        state.storage.sql.exec("UPDATE usage_admission_control SET live_count = live_count - 1");
        state.storage.sql.exec("UPDATE usage_admission_days SET live_count = live_count - 1 WHERE utc_day = ?", DAY);
      }
    });
    const before = await snapshot(); await abortAllDurableObjects();
    expect(await upload(first, next)).toEqual({ ok: false, error: "storage_invalid" }); expect(await snapshot()).toEqual(before);
  });

  test("mutually regressing retained journal times fail even beneath the latest control time", async () => {
    const devices = [await enroll(), await enroll(), await enroll()];
    const batches = devices.map((device, index) => batch(device, 1, [{ id: index + 1 }]));
    vi.setSystemTime(NOW + 30);
    for (let index = 0; index < devices.length; index += 1) success(await upload(devices[index], batches[index]));
    await runInDurableObject(stub(), (_instance, state) => {
      for (const [index, offset] of [[0, 20], [1, 10]] as const) {
        const value = batches[index], changed = freezeAdmission(value, { status: 1, receipts: [{ outcome: 1, headOperationHash: value.operations[0].operationHash }] }, index + 1, NOW + offset);
        state.storage.sql.exec("UPDATE usage_admission_devices SET last_journal = ? WHERE device_id = ?", changed.bytes, devices[index].id);
      }
    });
    const before = await snapshot(); await abortAllDurableObjects();
    expect(await upload(devices[2], batches[2])).toEqual({ ok: false, error: "storage_invalid" }); expect(await snapshot()).toEqual(before);
  });

  test.each(["before enrollment", "accepted after revocation", "revoked before revocation", "revoked without revocation"] as const)("canonical latest decision %s violates retained device lifetime", async corruption => {
    const device = await enroll(), value = batch(device);
    const rejected = corruption.startsWith("revoked");
    if (rejected) {
      await runInDurableObject(stub(), async instance => {
        const restore = replaceEnvironment(instance, original => ({ ...original, STAGING: bucketProxy(env.STAGING, async (method, _args, invoke) => {
          if (method === "put") throw new Error("synthetic-retained-flight"); return invoke();
        }) }));
        try { expect((await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes })).ok).toBe(false); } finally { restore(); }
      });
      vi.setSystemTime(NOW + 10); success(await stub().revokeEnrollment(device.proof));
      vi.setSystemTime(NOW + 11); expect(journal(success(await upload(device, value)), value).receipts[0].outcome).toBe(7);
    } else {
      success(await upload(device, value));
      if (corruption === "accepted after revocation") { vi.setSystemTime(NOW + 10); success(await stub().revokeEnrollment(device.proof)); }
    }
    const time = corruption === "before enrollment" ? NOW - 1 : corruption === "revoked before revocation" ? NOW + 9 : NOW + 11;
    const altered = freezeAdmission(value, { status: rejected ? 2 : 1, receipts: [{ outcome: rejected ? 7 : 1, headOperationHash: rejected ? new Uint8Array(32) : value.operations[0].operationHash }] }, 1, time);
    await runInDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("UPDATE usage_admission_devices SET last_journal = ?", altered.bytes);
      state.storage.sql.exec("UPDATE usage_admission_control SET committed_at_ms = ?, observed_at_ms = ?", time, NOW + 11);
      if (corruption === "revoked without revocation") {
        const raw = state.storage.sql.exec("SELECT payload FROM account_enrollment").one().payload;
        if (typeof raw !== "string") throw new Error("synthetic missing authority");
        const authority = JSON.parse(raw) as { devices: { revokedAtMs: number | null }[] };
        authority.devices[0].revokedAtMs = null;
        state.storage.sql.exec("UPDATE account_enrollment SET payload = ?", JSON.stringify(authority));
      }
    });
    const before = await snapshot(); vi.setSystemTime(NOW + 11); await abortAllDurableObjects();
    expect(await upload(device, value)).toEqual({ ok: false, error: "storage_invalid" }); expect(await snapshot()).toEqual(before);
  });

  test("a late old helper cannot remove a different successor flight", async () => {
    const device = await enroll(), first = batch(device), next = batch(device, 2, [{ id: 2 }]), gate = barrier();
    await runInDurableObject(stub(), async (instance, state) => {
      let held = false;
      const proxy = bucketProxy(env.STAGING, async (method, _args, invoke) => {
        const result = await invoke();
        if (!held && method === "put") { held = true; gate.enter(); await gate.released; }
        return result;
      });
      const restore = replaceEnvironment(instance, original => ({ ...original, STAGING: proxy }));
      const old = instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: first.bytes });
      try {
        await gate.entered;
        const receipt = success(await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: first.bytes }));
        const restoreSuccessor = replaceEnvironment(instance, original => ({ ...original, STAGING: bucketProxy(env.STAGING, async (method, _args, invoke) => {
          if (method === "put") throw new Error("synthetic-successor-retained"); return invoke();
        }) }));
        try { expect((await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: next.bytes })).ok).toBe(false); } finally { restoreSuccessor(); }
        const retained = state.storage.sql.exec("SELECT * FROM usage_admission_pending").one();
        gate.release(); expect(success(await old)).toEqual(receipt);
        expect(state.storage.sql.exec("SELECT * FROM usage_admission_pending").one()).toEqual(retained);
      } finally { gate.release(); await old; restore(); }
    });
    success(await upload(device, next));
  });

  test("revoking the requesting device while it helps a predecessor blocks its own reservation", async () => {
    const first = await enroll(), second = await enroll(), prior = batch(first), next = batch(second, 1, [{ id: 2 }]);
    await runInDurableObject(stub(), async (instance, state) => {
      const stop = replaceEnvironment(instance, original => ({ ...original, STAGING: bucketProxy(env.STAGING, async (method, _args, invoke) => {
        if (method === "put") throw new Error("synthetic-retain-predecessor"); return invoke();
      }) }));
      try { expect((await instance.admitBatch({ uploadSecret: first.proof.uploadSecret, batch: prior.bytes })).ok).toBe(false); } finally { stop(); }
      const gate = barrier();
      const restore = replaceEnvironment(instance, original => ({ ...original, STAGING: bucketProxy(env.STAGING, async (method, _args, invoke) => {
        if (method === "put") { gate.enter(); await gate.released; } return invoke();
      }) }));
      const helping = instance.admitBatch({ uploadSecret: second.proof.uploadSecret, batch: next.bytes });
      try {
        await gate.entered; success(await instance.revokeEnrollment(second.proof)); gate.release();
        expect(await helping).toEqual({ ok: false, error: "revoked" });
        expect(state.storage.sql.exec("SELECT settled_sequence FROM usage_admission_devices WHERE device_id = ?", first.id).one().settled_sequence).toBe(1);
        expect(state.storage.sql.exec("SELECT settled_sequence FROM usage_admission_devices WHERE device_id = ?", second.id).one().settled_sequence).toBe(0);
        expect(state.storage.sql.exec("SELECT * FROM usage_admission_pending").toArray()).toEqual([]);
      } finally { gate.release(); await helping; restore(); }
    });
  });

  test.each(["STAGING", "CONTROL"] as const)("conflicting %s object quarantines account admission without overwriting or settling", async binding => {
    const device = await enroll(), value = batch(device);
    let conflictingKey = "", version = "";
    await runInDurableObject(stub(), async (instance, state) => {
      let retained: ReturnType<typeof allRows> | null = null;
      const proxy = bucketProxy(env[binding], async (method, args, invoke) => {
        const key = String(args[0]);
        if (conflictingKey === "" && method === "get" && key.startsWith("usage-admission/")) {
          conflictingKey = key;
          const object = await env[binding].put(key, Uint8Array.of(42));
          if (!object) throw new Error("synthetic missing conflict"); version = object.version;
          retained = allRows(state.storage.sql);
        }
        return invoke();
      });
      const restore = replaceEnvironment(instance, original => ({ ...original, [binding]: proxy }));
      try { expect(await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes })).toEqual({ ok: false, error: "storage_invalid" }); } finally { restore(); }
      const after = allRows(state.storage.sql);
      expect(retained).not.toBeNull();
      // Observation revision is deliberately excluded: it records successful
      // server observations, not accepted usage or a device sequence.
      for (const key of ["devices", "pending", "heads", "days"] as const) expect(after[key]).toEqual(retained![key]);
      expect(after.control[0]).toEqual({ ...retained!.control[0], quarantined: 1 });
    });
    expect((await env[binding].get(conflictingKey))?.version).toBe(version);
    await abortAllDurableObjects(); expect(await upload(device, value)).toEqual({ ok: false, error: "recovery_required" });
    success(await stub().revokeEnrollment(device.proof));
    expect((await env[binding].get(conflictingKey))?.version).toBe(version);
  });

  test.each(["missing progress", "partial table", "future policy", "version rollback"] as const)("retained %s fails closed without repairing evidence", async corruption => {
    const device = await enroll(), value = batch(device);
    await runInDurableObject(stub(), (_instance, state) => {
      switch (corruption) {
        case "missing progress": state.storage.sql.exec("DELETE FROM usage_admission_devices"); break;
        case "partial table": state.storage.sql.exec("DROP TABLE usage_admission_days"); break;
        case "future policy": state.storage.sql.exec("PRAGMA ignore_check_constraints = ON"); state.storage.sql.exec("UPDATE usage_admission_control SET policy_version = 2"); state.storage.sql.exec("PRAGMA ignore_check_constraints = OFF"); break;
        case "version rollback": state.storage.sql.exec("UPDATE account_enrollment SET schema_version = 2"); break;
      }
    });
    await abortAllDurableObjects(); expect(await upload(device, value)).toEqual({ ok: false, error: "storage_invalid" });
    expect((await env.STAGING.list()).objects).toEqual([]);
  });

  test.each([false, true])("legacy schema2 migrates bytes intact with revoked=%s", async revoked => {
    const first = await enroll(), second = await enroll();
    if (revoked) success(await stub().revokeEnrollment(first.proof));
    const before = await runInDurableObject(stub(), (_instance, state) => {
      const retained = state.storage.sql.exec("SELECT revision, payload FROM account_enrollment").one();
      for (const table of Object.keys(ADMISSION_SCHEMA)) state.storage.sql.exec(`DROP TABLE ${table}`);
      state.storage.sql.exec("UPDATE account_enrollment SET schema_version = 2"); return retained;
    });
    await abortAllDurableObjects();
    await runInDurableObject(stub(), (_instance, state) => {
      expect(state.storage.sql.exec("SELECT revision, payload FROM account_enrollment").one()).toEqual(before);
      expect(state.storage.sql.exec("SELECT schema_version FROM account_enrollment").one().schema_version).toBe(3);
      expect(state.storage.sql.exec("SELECT settled_sequence FROM usage_admission_devices").toArray()).toEqual([{ settled_sequence: 0 }, { settled_sequence: 0 }]);
    });
    success(await upload(second, batch(second)));
  });

  test.each(["CREATE TABLE usage_admission_pending", "INSERT INTO usage_admission_devices"])("actual additive migration rolls back after %s", async fault => {
    await enroll();
    await runInDurableObject(stub(), (_instance, state) => {
      const retained = state.storage.sql.exec("SELECT revision, payload FROM account_enrollment").one();
      if (typeof retained.payload !== "string") throw new Error("synthetic missing authority");
      const authority = JSON.parse(retained.payload) as Parameters<AdmissionState["initialize"]>[0];
      for (const table of Object.keys(ADMISSION_SCHEMA)) state.storage.sql.exec(`DROP TABLE ${table}`);
      state.storage.sql.exec("UPDATE account_enrollment SET schema_version = 2");
      const manifest = state.storage.sql.exec("SELECT name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' ORDER BY name").toArray();
      const sql = new Proxy(state.storage.sql, { get(target, property) {
        if (property === "exec") return (query: string, ...values: SqlStorageValue[]) => {
          const result = target.exec(query, ...values); if (query.startsWith(fault)) throw new Error("synthetic-migration-fault"); return result;
        };
        const value: unknown = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
      } });
      expect(() => state.storage.transactionSync(() => new AdmissionState(sql).initialize(authority))).toThrow("synthetic-migration-fault");
      expect(state.storage.sql.exec("SELECT name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' ORDER BY name").toArray()).toEqual(manifest);
      expect(state.storage.sql.exec("SELECT revision, payload FROM account_enrollment").one()).toEqual(retained);
    });
    await abortAllDurableObjects(); expect((await snapshot()).control.published_revision).toBe(0);
  });

  test.each(["INSERT INTO usage_admission_heads", "INSERT INTO usage_admission_days", "UPDATE usage_admission_devices SET settled_sequence", "UPDATE usage_admission_control SET published_revision", "DELETE FROM usage_admission_pending"])("actual publication rolls every table back after %s", async fault => {
    const device = await enroll(), value = batch(device);
    await runInDurableObject(stub(), async (instance, state) => {
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucketProxy(env.CONTROL, async (method, args, invoke) => {
        if (method === "put" && String(args[0]).startsWith("usage-admission/")) throw new Error("synthetic-before-journal");
        return invoke();
      }) }));
      try { expect((await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes })).ok).toBe(false); } finally { restore(); }
      const payload = state.storage.sql.exec("SELECT payload FROM account_enrollment").one().payload;
      if (typeof payload !== "string") throw new Error("synthetic missing authority");
      const authority = JSON.parse(payload) as Parameters<AdmissionState["audit"]>[0];
      if (!authority) throw new Error("synthetic missing authority");
      const before = allRows(state.storage.sql);
      const sql = new Proxy(state.storage.sql, { get(target, property) {
        if (property === "exec") return (query: string, ...values: SqlStorageValue[]) => {
          const result = target.exec(query, ...values);
          if (query.startsWith(fault)) throw new Error("synthetic-publication-fault");
          return result;
        };
        const value: unknown = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
      } });
      expect(() => state.storage.transactionSync(() => {
        const admission = new AdmissionState(sql), pending = admission.pending(authority);
        if (!pending) throw new Error("synthetic missing flight");
        admission.publish(pending, authority);
      })).toThrow("synthetic-publication-fault");
      expect(allRows(state.storage.sql)).toEqual(before);
    });
    success(await upload(device, value));
  });

  test("real 100000-head audit and net day limits preserve correction, tombstone and replay", async () => {
    const device = await enroll();
    const seeded = 99_998;
    await runInDurableObject(stub(), (_instance, state) => {
      const payload = state.storage.sql.exec("SELECT payload FROM account_enrollment").one().payload;
      if (typeof payload !== "string") throw new Error("synthetic missing authority");
      const authority = JSON.parse(payload) as Parameters<AdmissionState["audit"]>[0];
      if (!authority) throw new Error("synthetic missing authority");
      // Source-only fixture history. This seeds canonical SQL via the actual
      // synchronous transitions, never fabricates R2 or claims live readback.
      state.storage.transactionSync(() => {
        const admission = new AdmissionState(state.storage.sql);
        for (let start = 1; start <= seeded; start += 256) {
          const members = Array.from({ length: Math.min(256, seeded - start + 1) }, (_, index) => ({ id: start + index, day: start + index <= 65_535 ? DAY : DAY - 1 }));
          const value = batch(device, start, members);
          admission.publish(admission.freeze(admission.reserve(value, authority, NOW), authority, NOW), authority);
        }
        admission.audit(authority);
      });
    });
    const lastSlot = batch(device, seeded + 1, [{ id: seeded + 1 }]);
    success(await upload(device, lastSlot)); // Exactly 65,536 live on DAY.
    const excessDay = batch(device, seeded + 2, [{ id: seeded + 2 }]);
    expect(await upload(device, excessDay)).toEqual({ ok: false, error: "limit" });
    const lastSubject = batch(device, seeded + 2, [{ id: seeded + 2, day: DAY - 1 }]);
    const latest = success(await upload(device, lastSubject)); // Exactly 100,000 identities.
    expect(await upload(device, batch(device, seeded + 3, [{ id: seeded + 3, day: DAY - 1 }]))).toEqual({ ok: false, error: "limit" });
    await abortAllDurableObjects(); // Executes the actual constructor's full audit.
    expect(success(await upload(device, lastSubject))).toEqual(latest);
    const removal = batch(device, seeded + 3, [{ id: seeded + 1, expected: lastSlot.operations[0].operationHash, tombstone: true }]);
    success(await upload(device, removal));
    expect(await upload(device, batch(device, seeded + 4, [{ id: seeded + 3 }]))).toEqual({ ok: false, error: "limit" }); // Tombstone never releases identity.
    const move = batch(device, seeded + 4, [{ id: seeded + 2, expected: lastSubject.operations[0].operationHash }]);
    success(await upload(device, move)); // Net day move fits after tombstone.
    await runInDurableObject(stub(), (_instance, state) => {
      expect(state.storage.sql.exec("SELECT head_count, live_count FROM usage_admission_control").one()).toEqual({ head_count: 100_000, live_count: 99_999 });
      expect(state.storage.sql.exec("SELECT live_count FROM usage_admission_days WHERE utc_day = ?", DAY).one().live_count).toBe(65_536);
    });
  }, 60_000);

  test("4096 terminal revisions exhaust new custody but retain replay and self-revocation", async () => {
    const device = await enroll();
    await runInDurableObject(stub(), (_instance, state) => {
      const payload = state.storage.sql.exec("SELECT payload FROM account_enrollment").one().payload;
      if (typeof payload !== "string") throw new Error("synthetic missing authority");
      const authority = JSON.parse(payload) as Parameters<AdmissionState["audit"]>[0];
      if (!authority) throw new Error("synthetic missing authority");
      state.storage.transactionSync(() => {
        const admission = new AdmissionState(state.storage.sql);
        for (let sequence = 1; sequence <= 4095; sequence += 1) {
          const value = batch(device, sequence);
          admission.publish(admission.freeze(admission.reserve(value, authority, NOW), authority, NOW), authority);
        }
        admission.audit(authority);
      });
    });
    const final = batch(device, 4096), bytes = success(await upload(device, final));
    expect(journal(bytes, final).accountJournalRevision).toBe(4096);
    expect(await upload(device, batch(device, 4097))).toEqual({ ok: false, error: "limit" });
    success(await stub().revokeEnrollment(device.proof));
    await abortAllDurableObjects(); expect(success(await upload(device, final))).toEqual(bytes);
  }, 60_000);
});
