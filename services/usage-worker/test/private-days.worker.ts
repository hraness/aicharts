import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { decodeAdmissionBatch, encodeAdmissionBatch, encodeAdmissionOperation, type AdmissionBatch } from "../../../lib/usage/admission";
import { parsePrivateDaysValue, type PrivateDaysRequestV1 } from "../../../lib/usage/private-days-contract";
import { DAY_MS, encodeUsageBatch } from "../../../lib/usage/wire";
import { ADMISSION_POLICY_V1 } from "../src/admission-policy";
import { admissionIdBytes } from "../src/admission-state";
import { enrollmentAccountName, type EnrollmentProof } from "../src/enrollment-contract";
import { namespaceAnchorKey } from "../src/namespace-anchor";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";

const NOW = Date.UTC(2026, 8, 11, 12), DAY = Math.floor(NOW / DAY_MS);
let serial = 0, account = "", intent = 0;
const hex = (value: number, width = 32) => value.toString(16).padStart(width * 2, "0");
const stub = () => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account));
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(`synthetic fixture: ${result.error}`);
  return result.value;
};
const query = (fields: Partial<PrivateDaysRequestV1> = {}): PrivateDaysRequestV1 => ({ schemaVersion: 1, accountId: account,
  sessionExpiresAtMs: NOW + PAIRING_TTL_MS, firstUtcDay: DAY - 1, dayCount: 3, ...fields });
const totals = (count = 0, total = "0", output = "0") => ({ usageOccurrences: count, observedAccountedTokens: total, observedOutputTokens: output });
beforeEach(() => {
  account = `acct_${hex(++serial, 16)}`; intent = serial * 100;
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
async function prepare(): Promise<EnrollmentProof> {
  const proof = { intentId: hex(++intent), pollSecret: hex(intent + 1_000_000), uploadSecret: hex(intent + 2_000_000) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), nonce = hex(intent + 3_000_000);
  const uploadCommitment = success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret));
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce: nonce }));
  const browser = { intentId: proof.intentId, attemptId: attempt.attemptId, browserNonce: nonce, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId: account, authTimeMs: NOW, sessionExpiresAtMs: NOW + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId: account, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: account }));
  success(await pairing.reserveEnrollment(proof)); return proof;
}
async function enroll(): Promise<Device> {
  const proof = await prepare();
  return { proof, id: admissionIdBytes(success(await stub().enroll(proof)).receipt.deviceId) };
}
type Member = { id: number; expected?: Uint8Array; provider?: 1 | 2 | 3; output?: bigint; input?: bigint; cache?: bigint;
  write5m?: bigint; write1h?: bigint; reasoning?: bigint; tombstone?: boolean; day?: number };
function batch(device: Device, sequence = 1, members: Member[] = [{ id: 1 }]): AdmissionBatch {
  const operations = members.map((member, index) => {
    const id = admissionIdBytes(hex(member.id, 16));
    const frame = member.tombstone ? new Uint8Array() : success(encodeUsageBatch({ utcDay: member.day ?? DAY, registryRevision: 1,
      usage: [{ id, executionId: new Uint8Array(16), accountId: new Uint8Array(16), offsetMs: 1,
        provider: member.provider ?? 1, authMode: 0, evidence: 1, modelId: 0, contextTier: 0,
        tokens: { inputUncached: member.input ?? 10n, cacheRead: member.cache ?? 0n, cacheWrite5m: member.write5m ?? 0n,
          cacheWrite1h: member.write1h ?? 0n, output: member.output ?? 5n, reasoningOutput: member.reasoning ?? 0n } }],
      prompts: [], intervals: [] }, ADMISSION_POLICY_V1));
    return success(encodeAdmissionOperation({ accountId: admissionIdBytes(account.slice(5)), deviceId: device.id,
      generation: admissionIdBytes(env.USAGE_ENROLLMENT_GENERATION), action: member.tombstone ? 2 : 1,
      sequence: sequence + index, occurrenceId: id, expectedHeadHash: member.expected ?? new Uint8Array(32), frame }, ADMISSION_POLICY_V1));
  });
  return success(decodeAdmissionBatch(success(encodeAdmissionBatch(operations, ADMISSION_POLICY_V1)), ADMISSION_POLICY_V1));
}
const upload = (device: Device, value: AdmissionBatch) => stub().admitBatch({ uploadSecret: device.proof.uploadSecret, batch: value.bytes });
async function read(input = query()) {
  const result = success(await stub().readImportedDays(input));
  expect(parsePrivateDaysValue(input, result)).toEqual(result); return result;
}
function sqlRows(sql: SqlStorage) {
  return Object.fromEntries(["account_enrollment", "usage_admission_control", "usage_admission_devices", "usage_admission_pending", "usage_admission_heads", "usage_admission_days"]
    .map(table => [table, sql.exec(`SELECT * FROM ${table}`).toArray()]));
}
async function snapshot() {
  const sql = await runInDurableObject(stub(), (_instance, state) => sqlRows(state.storage.sql));
  const objects = [];
  for (const bucket of [env.CONTROL, env.STAGING]) for (const item of (await bucket.list()).objects) {
    const object = await bucket.get(item.key);
    if (!object) throw new Error("synthetic fixture missing object");
    objects.push({ key: item.key, bytes: new Uint8Array(await object.arrayBuffer()), http: object.httpMetadata, custom: object.customMetadata, etag: object.etag });
  }
  return { sql, objects };
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
  const entered = new Promise<void>(resolve => { enter = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
  return { enter, release, entered, released };
}

describe("dormant private imported days", () => {
  test("empty active account returns explicit partial zeros and preserves every stored field", async () => {
    await enroll(); const before = await snapshot(); vi.setSystemTime(NOW + 1_000);
    const result = await read();
    expect(result).toEqual({ schemaVersion: 1, measurementProfile: "imported-tokens-v1", coverage: "partial",
      journalRevision: 0, journalCommittedAtMs: null, firstUtcDay: DAY - 1,
      days: [DAY - 1, DAY, DAY + 1].map(utcDay => ({ utcDay, codex: totals(), claudeCode: totals(), devin: totals() })) });
    expect(await snapshot()).toEqual(before);
  });

  test("malformed inputs, wrong account and expiry refuse before anchor access", async () => {
    await enroll(); const before = await snapshot();
    await runInDurableObject(stub(), async instance => {
      let calls = 0;
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucketProxy(original.CONTROL, async (_method, _args, invoke) => { calls++; return invoke(); }) }));
      try {
        for (const input of [null, { ...query(), uploadSecret: "PRIVATE_CANARY" }, query({ dayCount: 32 }), query({ firstUtcDay: 100_000_000, dayCount: 2 })]) {
          expect(await instance.readImportedDays(input)).toEqual({ ok: false, error: "invalid_input" });
        }
        expect(await instance.readImportedDays(query({ accountId: `acct_${hex(999_999, 16)}` }))).toEqual({ ok: false, error: "unauthorized" });
        expect(await instance.readImportedDays(query({ sessionExpiresAtMs: NOW }))).toEqual({ ok: false, error: "expired" });
        expect(calls).toBe(0);
      } finally { restore(); }
    });
    expect(await snapshot()).toEqual(before);
  });

  test("an uninitialized account has no invented enrolled zero snapshot", async () => {
    expect(await stub().readImportedDays(query())).toMatchObject({ ok: false, error: "not_enrolled" });
  });

  test("pending genesis cannot produce a private snapshot", async () => {
    const proof = await prepare();
    await runInDurableObject(stub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucketProxy(original.CONTROL, async () => { throw new Error("PRIVATE_CANARY"); }) }));
      try { expect(await instance.enroll(proof)).toMatchObject({ ok: false, error: "storage_unavailable" }); }
      finally { restore(); }
    });
    const before = await snapshot();
    expect(await stub().readImportedDays(query())).toMatchObject({ ok: false, error: "not_enrolled" });
    expect(await snapshot()).toEqual(before);
  });

  test("all three providers retain exact imported totals with reasoning counted only once", async () => {
    const device = await enroll();
    success(await upload(device, batch(device, 1, [{ id: 1, input: 10n, cache: 7n, output: 5n, reasoning: 5n },
      { id: 2, provider: 2, day: DAY - 1, input: 10n, cache: 7n, write5m: 3n, write1h: 4n, output: 5n, reasoning: 2n },
      { id: 3, provider: 3, input: 6n, cache: 3n, output: 2n }])));
    const before = await snapshot(), result = await read();
    expect(result.days[0]).toEqual({ utcDay: DAY - 1, codex: totals(), claudeCode: totals(1, "29", "5"), devin: totals() });
    expect(result.days[1]).toEqual({ utcDay: DAY, codex: totals(1, "22", "5"), claudeCode: totals(), devin: totals(1, "11", "2") });
    expect(result.days[2]).toEqual({ utcDay: DAY + 1, codex: totals(), claudeCode: totals(), devin: totals() });
    expect(result.journalRevision).toBe(1); expect(result.journalCommittedAtMs).toBe(NOW);
    expect(await snapshot()).toEqual(before);
  });

  test("corrections decrease totals, move days/provider and tombstones stay excluded", async () => {
    const device = await enroll(), first = batch(device);
    success(await upload(device, first));
    const corrected = batch(device, 2, [{ id: 1, expected: first.operations[0].operationHash, provider: 2, day: DAY - 1, input: 1n, output: 1n }]);
    success(await upload(device, corrected));
    let result = await read();
    expect(result.days[0].claudeCode).toEqual(totals(1, "2", "1")); expect(result.days[1].codex).toEqual(totals());
    const removed = batch(device, 3, [{ id: 1, expected: corrected.operations[0].operationHash, tombstone: true }]);
    success(await upload(device, removed));
    const tombstone = await read();
    expect(tombstone.days.every(day => day.codex.usageOccurrences === 0 && day.claudeCode.usageOccurrences === 0 && day.devin.usageOccurrences === 0)).toBe(true);
    success(await upload(device, batch(device, 4, [{ id: 1, expected: removed.operations[0].operationHash }])));
    result = await read(); expect(result.days).toEqual(tombstone.days); expect(result.journalRevision).toBe(4);
  });

  test("cross-device duplicates and rejected batches advance journal revision without adding totals", async () => {
    const firstDevice = await enroll(), secondDevice = await enroll(), first = batch(firstDevice);
    success(await upload(firstDevice, first)); const initial = await read();
    success(await upload(secondDevice, batch(secondDevice)));
    expect((await read()).days).toEqual(initial.days);
    success(await upload(firstDevice, batch(firstDevice, 2, [{ id: 1, expected: first.operations[0].operationHash, output: 1n },
      { id: 2, tombstone: true, expected: admissionIdBytes(hex(99)) }])));
    const rejected = await read(); expect(rejected.days).toEqual(initial.days); expect(rejected.journalRevision).toBe(3);
  });

  for (const phase of [1, 2] as const) test(`phase ${phase} remains invisible until atomic publication`, async () => {
    const device = await enroll(), first = batch(device); success(await upload(device, first));
    const corrected = batch(device, 2, [{ id: 1, expected: first.operations[0].operationHash, output: 1n }]);
    await runInDurableObject(stub(), async instance => {
      const gate = barrier(), binding = phase === 1 ? "STAGING" : "CONTROL";
      const restore = replaceEnvironment(instance, original => ({ ...original, [binding]: bucketProxy(original[binding], async (method, _args, invoke) => {
        if (method === "put") { gate.enter(); await gate.released; }
        return invoke();
      }) }));
      const pending = instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: corrected.bytes });
      try {
        await gate.entered;
        const result = success(await instance.readImportedDays(query()));
        expect(result.journalRevision).toBe(1); expect(result.days[1].codex).toEqual(totals(1, "15", "5"));
      } finally { gate.release(); success(await pending); restore(); }
    });
    const published = await read(); expect(published.journalRevision).toBe(2); expect(published.days[1].codex).toEqual(totals(1, "11", "1"));
  });

  test("a durable journal with a lost reply contributes only after retained retry publishes", async () => {
    const device = await enroll(), candidate = batch(device);
    await runInDurableObject(stub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucketProxy(original.CONTROL, async (method, _args, invoke) => {
        const result = await invoke(); if (method === "put") throw new Error("PRIVATE_CANARY"); return result;
      }) }));
      try {
        expect(await instance.admitBatch({ uploadSecret: device.proof.uploadSecret, batch: candidate.bytes })).toMatchObject({ ok: false, error: "storage_unavailable" });
        expect(success(await instance.readImportedDays(query())).journalRevision).toBe(0);
      } finally { restore(); }
    });
    success(await upload(device, candidate)); expect((await read()).days[1].codex).toEqual(totals(1, "15", "5"));
  });

  test("revoking every device preserves the owner's accepted history and restart snapshot", async () => {
    const device = await enroll(); success(await upload(device, batch(device)));
    success(await stub().revokeEnrollment(device.proof)); const before = await snapshot(), expected = await read();
    expect(expected.days[1].codex).toEqual(totals(1, "15", "5")); expect(await snapshot()).toEqual(before);
    await abortAllDurableObjects(); expect(await read()).toEqual(expected); expect(await snapshot()).toEqual(before);
  });

  test("policy range endpoints and 31-day requests are inclusive and bounded", async () => {
    await enroll();
    for (const input of [query({ firstUtcDay: 0, dayCount: 1 }), query({ firstUtcDay: 99_999_970, dayCount: 31 })]) {
      const result = await read(input); expect(result.days.length).toBe(input.dayCount);
      expect(result.days.at(-1)?.utcDay).toBe(input.firstUtcDay + input.dayCount - 1);
    }
  });

  test("BigInt accumulation survives actual accepted totals above 2^53", async () => {
    const device = await enroll(), unit = 1_000_000_000_000n;
    for (let offset = 0; offset < 2_048; offset += 256) {
      success(await upload(device, batch(device, offset + 1, Array.from({ length: 256 }, (_, index) => ({ id: offset + index + 1,
        provider: 2, input: unit, cache: unit, write5m: unit, write1h: unit, output: unit, reasoning: unit })))));
    }
    const result = await read();
    expect(result.days[1].claudeCode).toEqual(totals(2_048, "10240000000000000", "2048000000000000"));
  }, 30_000);

  for (const change of ["session", "generation", "quarantine", "clock", "anchor"] as const) test(`${change} changes during anchor await refuse the snapshot`, async () => {
    await enroll();
    await runInDurableObject(stub(), async (instance, state) => {
      const gate = barrier(), supplied = query(); let replacementGeneration: string = env.USAGE_ENROLLMENT_GENERATION;
      const restore = replaceEnvironment(instance, original => ({ ...original,
        get USAGE_ENROLLMENT_GENERATION() { return replacementGeneration as Env["USAGE_ENROLLMENT_GENERATION"]; },
        CONTROL: bucketProxy(original.CONTROL, async (method, args, invoke) => {
          if (method === "get" && args[0] === namespaceAnchorKey(account)) { gate.enter(); await gate.released; }
          return invoke();
        }) }));
      const pending = instance.readImportedDays(supplied);
      try {
        await gate.entered;
        if (change === "session") vi.setSystemTime(supplied.sessionExpiresAtMs);
        if (change === "generation") replacementGeneration = hex(77);
        if (change === "quarantine") state.storage.sql.exec("UPDATE usage_admission_control SET quarantined = 1 WHERE id = 1");
        if (change === "clock") vi.setSystemTime(NOW - 1);
        if (change === "anchor") {
          const row = state.storage.sql.exec("SELECT payload FROM account_enrollment WHERE id = 1").one();
          const payload = JSON.parse(row.payload as string); payload.anchor.namespaceKey = hex(77);
          state.storage.sql.exec("UPDATE account_enrollment SET payload = ? WHERE id = 1", JSON.stringify(payload));
        }
        const before = sqlRows(state.storage.sql); gate.release();
        expect(await pending).toEqual({ ok: false, error: change === "session" ? "expired" : change === "clock" ? "clock_regressed" : "recovery_required" });
        expect(sqlRows(state.storage.sql)).toEqual(before);
      } finally { gate.release(); await pending; restore(); }
    });
  });

  test("request mutations during anchor await cannot change the authorized account or range", async () => {
    await enroll();
    await runInDurableObject(stub(), async instance => {
      const gate = barrier(), supplied = { ...query() };
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucketProxy(original.CONTROL, async (_method, _args, invoke) => { gate.enter(); await gate.released; return invoke(); }) }));
      const pending = instance.readImportedDays(supplied);
      try {
        await gate.entered; supplied.accountId = `acct_${hex(999_999, 16)}`; supplied.firstUtcDay = 0; supplied.dayCount = 31; supplied.sessionExpiresAtMs = 0;
        gate.release(); const result = success(await pending);
        expect(result.firstUtcDay).toBe(DAY - 1); expect(result.days).toHaveLength(3);
      } finally { gate.release(); await pending; restore(); }
    });
  });

  test("missing and failed anchor reads remain closed and never repair storage", async () => {
    await enroll();
    await runInDurableObject(stub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucketProxy(original.CONTROL, async () => { throw new Error("PRIVATE_CANARY"); }) }));
      try { expect(await instance.readImportedDays(query())).toEqual({ ok: false, error: "storage_unavailable" }); }
      finally { restore(); }
    });
    await env.CONTROL.delete(namespaceAnchorKey(account)); const before = await snapshot();
    expect(await stub().readImportedDays(query())).toMatchObject({ ok: false, error: "recovery_required" });
    expect(await snapshot()).toEqual(before);
  });

  for (const fault of ["day-count", "row-day", "row-revision", "row-identity"] as const) test(`selected ${fault} corruption fails without mutation`, async () => {
    const device = await enroll(); success(await upload(device, batch(device)));
    await runInDurableObject(stub(), async (instance, state) => {
      if (fault === "day-count") state.storage.sql.exec("UPDATE usage_admission_days SET live_count = 2");
      if (fault === "row-day") state.storage.sql.exec("UPDATE usage_admission_heads SET utc_day = ?", DAY - 1);
      if (fault === "row-revision") state.storage.sql.exec("UPDATE usage_admission_heads SET journal_revision = 2");
      if (fault === "row-identity") state.storage.sql.exec("UPDATE usage_admission_heads SET occurrence_id = ?", admissionIdBytes(hex(77, 16)));
      const before = sqlRows(state.storage.sql);
      expect(await instance.readImportedDays(query())).toEqual({ ok: false, error: "storage_invalid" });
      expect(sqlRows(state.storage.sql)).toEqual(before);
    });
  });
});
