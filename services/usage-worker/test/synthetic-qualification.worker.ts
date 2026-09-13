import { env } from "cloudflare:workers";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  encodeQualificationJson, parseQualificationAttempt, parseQualificationReply, parseQualificationRequest, parseQualificationRun,
  QUALIFICATION_CLOSURE_KEYS, QUALIFICATION_ERROR_STATUS, QUALIFICATION_OBJECT_KINDS, QUALIFICATION_REPLY_BYTES, QUALIFICATION_REQUEST_BYTES, QUALIFICATION_URL,
  qualificationByteHex, qualificationExpectedDays, qualificationFields, qualificationFixture, qualificationIdentity,
  type QualificationAttempt, type QualificationEnrollment, type QualificationReply, type QualificationRequest, type QualificationRun, type QualificationSlot,
} from "../../../fixtures/usage/cloudflare-qualification";
import { decodeAdmissionJournal } from "../../../lib/usage/admission";
import { DAY_MS } from "../../../lib/usage/wire";
import { ADMISSION_POLICY_V1 } from "../src/admission-policy";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { PAIRING_TTL_MS } from "../src/pairing";
import production from "../src/index";
import privateDefault, { createSyntheticQualificationHandler, type SyntheticQualificationEnvironment } from "../src/synthetic-qualification";

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0, 456);
const G2 = "22".repeat(32);
const CANARY = "PRIVATE_SYNTHETIC_QUALIFICATION_CANARY";
let serial = 0;
let run: QualificationRun;
let selected: SyntheticQualificationEnvironment;
let handler: ReturnType<typeof createSyntheticQualificationHandler>;
const success = (reply: QualificationReply) => {
  expect(reply.ok).toBe(true);
  if (!reply.ok) throw new Error("synthetic_fixture_failure");
  return reply.value;
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  const value = parseQualificationRun({ schemaVersion: 1, runId: (++serial).toString(16).padStart(24, "0"), createdAtMs: NOW, expiresAtMs: NOW + DAY_MS,
    firstUtcDay: Math.floor(NOW / DAY_MS) - 3, generationOne: env.USAGE_ENROLLMENT_GENERATION, generationTwo: G2 });
  if (!value) throw new Error("synthetic_fixture_failure");
  run = value;
  selected = { ...env, AICHARTS_USAGE_SYNTHETIC_RUN: JSON.stringify(run) };
  handler = createSyntheticQualificationHandler();
});
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await reset(); });

function request(value: unknown, headers: Record<string, string> = {}): Request {
  const bytes = encodeQualificationJson(value, QUALIFICATION_REQUEST_BYTES);
  if (!bytes) throw new Error("synthetic_fixture_failure");
  return new Request(QUALIFICATION_URL, { method: "POST", body: bytes, headers: { "content-type": "application/json", accept: "application/json", ...headers } });
}
function stage(value: Record<string, unknown>): QualificationRequest {
  const result = parseQualificationRequest(run, { schemaVersion: 1, runId: run.runId, ...value });
  if (!result) throw new Error("synthetic_fixture_failure");
  return result;
}
async function call(input: QualificationRequest, environment = selected) {
  const response = await handler(request(input), environment), bytes = new Uint8Array(await response.arrayBuffer());
  expect(bytes.length).toBeLessThanOrEqual(QUALIFICATION_REPLY_BYTES);
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  for (const header of ["set-cookie", "access-control-allow-origin", "location", "content-encoding"]) expect(response.headers.has(header)).toBe(false);
  const text = new TextDecoder().decode(bytes), reply = parseQualificationReply(run, input, JSON.parse(text) as unknown);
  expect(text).not.toContain(CANARY);
  expect(reply).not.toBeNull();
  if (!reply) throw new Error("synthetic_fixture_failure");
  expect(response.status).toBe(reply.ok ? 200 : QUALIFICATION_ERROR_STATUS[reply.error]);
  return reply;
}
async function pairing(slot: QualificationSlot = "original"): Promise<QualificationAttempt> {
  success(await call(stage({ stage: "initialize", slot })));
  vi.setSystemTime(Date.now() + 1_000);
  const attempt = parseQualificationAttempt(run, success(await call(stage({ stage: "begin", slot }))));
  if (!attempt) throw new Error("synthetic_fixture_failure");
  vi.setSystemTime(Date.now() + 1_000);
  for (const name of ["authenticate", "approve"] as const) success(await call(stage({ stage: name, slot, attempt })));
  success(await call(stage({ stage: "confirm", slot })));
  success(await call(stage({ stage: "reserve", slot })));
  return attempt;
}
async function enroll(): Promise<QualificationEnrollment> {
  await pairing();
  return success(await call(stage({ stage: "enroll" }))) as QualificationEnrollment;
}
async function completeBatches() {
  const enrollment = await enroll();
  for (const name of ["insert", "correct", "tombstone"] as const) success(await call(stage({ stage: name })));
  return enrollment;
}
function account() { return env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(qualificationIdentity(run).accountId)); }
async function rows() {
  return runInDurableObject(account(), (_instance, state) => ({
    enrollment: state.storage.sql.exec("SELECT revision, payload FROM account_enrollment").one(),
    control: state.storage.sql.exec("SELECT published_revision, committed_at_ms, head_count, live_count FROM usage_admission_control").one(),
    heads: state.storage.sql.exec("SELECT * FROM usage_admission_heads ORDER BY occurrence_id").toArray(),
    pending: state.storage.sql.exec("SELECT * FROM usage_admission_pending").toArray(),
    devices: state.storage.sql.exec("SELECT * FROM usage_admission_devices ORDER BY device_id").toArray(),
  }));
}
async function r2() {
  const data = [];
  for (const [name, bucket] of [["staging", env.STAGING], ["control", env.CONTROL]] as const) {
    for (const object of (await bucket.list()).objects) data.push({ bucket: name, key: object.key, version: object.version, size: object.size });
  }
  return data.sort((left, right) => left.key.localeCompare(right.key));
}
async function pairingPayload(slot: QualificationSlot = "original") {
  return runInDurableObject(env.PAIRINGS.getByName(qualificationIdentity(run)[slot].intentId), (_instance, state) => state.storage.sql.exec("SELECT payload FROM pairing_state").one().payload);
}
async function generation(value: string) {
  const identity = qualificationIdentity(run);
  for (const stub of [account(), env.PAIRINGS.getByName(identity.original.intentId), env.PAIRINGS.getByName(identity.closure.intentId)]) {
    await runInDurableObject(stub, instance => {
      const owned = instance as unknown as { env: Env };
      const next = { ...owned.env };
      Object.defineProperty(next, "USAGE_ENROLLMENT_GENERATION", { value, enumerable: true });
      owned.env = next;
    });
  }
  selected = { ...selected, USAGE_ENROLLMENT_GENERATION: value };
}

test("both entrypoint defaults remain the existing private 503", async () => {
  for (const target of [production, privateDefault]) {
    const response = target.fetch();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "usage_service_unavailable" });
  }
});

test("closed configuration, wrong method and expired run touch no provider binding", async () => {
  let resources = 0;
  const unavailable = new Proxy({} as SyntheticQualificationEnvironment, { get(_target, key) {
    if (key === "AICHARTS_USAGE_SYNTHETIC_RUN") return undefined;
    resources++; throw new Error(CANARY);
  } });
  expect((await call(stage({ stage: "inspect" }), unavailable))).toEqual({ schemaVersion: 1, ok: false, error: "qualification_unavailable" });
  const head = await handler(new Request(QUALIFICATION_URL, { method: "HEAD" }), unavailable);
  expect(head.status).toBe(405); expect(await head.text()).toBe("");
  expect(resources).toBe(0);
  const noEffects = new Proxy(selected, { get(target, key) {
    if (key === "AICHARTS_USAGE_SYNTHETIC_RUN" || key === "USAGE_ENROLLMENT_GENERATION") return Reflect.get(target, key);
    resources++; throw new Error(CANARY);
  } });
  vi.setSystemTime(run.expiresAtMs);
  expect(await call(stage({ stage: "inspect" }), noEffects)).toEqual({ schemaVersion: 1, ok: false, error: "run_expired" });
  expect(resources).toBe(0);
});

test("cancelled requests touch no provider and do not initialize account state", async () => {
  const controller = new AbortController(); controller.abort();
  const req = new Request(request(stage({ stage: "inspect" })), { signal: controller.signal });
  const noEffects = new Proxy(selected, { get(target, key) {
    if (key === "AICHARTS_USAGE_SYNTHETIC_RUN" || key === "USAGE_ENROLLMENT_GENERATION") return Reflect.get(target, key);
    throw new Error(CANARY);
  } });
  const response = await handler(req, noEffects);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ schemaVersion: 1, ok: false, error: "qualification_unavailable" });
});

test("run and requests own one account, exact time range and finite stages", async () => {
  expect(qualificationIdentity(run).accountId).toBe(`acct_7175616c${run.runId}`);
  for (const value of [{ ...run, accountId: "acct_" + "ff".repeat(16) }, { ...run, expiresAtMs: run.expiresAtMs + 1 }, { ...run, createdAtMs: -0 },
    { ...run, firstUtcDay: run.firstUtcDay + 1 }, { ...run, generationTwo: run.generationOne }, { ...run, runId: "0".repeat(24) }]) expect(parseQualificationRun(value)).toBeNull();
  for (const extra of [{ accountId: "acct_" + "ff".repeat(16) }, { objectKey: "unrelated" }, { stage: "delete" }, { runId: "f".repeat(24) }, { slot: "original" }, { transcript: CANARY }]) {
    const response = await handler(request({ schemaVersion: 1, runId: run.runId, stage: "inspect", ...extra }), selected);
    expect(response.status).toBe(400);
  }
  expect(await r2()).toEqual([]);
});

test("strict framing rejects oversize, malformed bytes and browser authority headers", async () => {
  const input = stage({ stage: "inspect" });
  const invalidHeaders: Record<string, string>[] = [{ authorization: "Bearer " + CANARY }, { cookie: CANARY }, { origin: "https://aicharts.io" },
    { "content-encoding": "gzip" }, { "content-type": "text/plain" }, { "content-length": "1" }, { "content-length": "020" }];
  for (const headers of invalidHeaders) {
    expect((await handler(request(input, headers), selected)).status).toBe(400);
  }
  for (const body of [new Uint8Array(QUALIFICATION_REQUEST_BYTES + 1).fill(32), Uint8Array.of(0xff, 0xfe), new TextEncoder().encode("{bad")]) {
    const response = await handler(new Request(QUALIFICATION_URL, { method: "POST", headers: { "content-type": "application/json" }, body }), selected);
    expect(response.status).toBe(400);
  }
  const wrong = request(input);
  expect((await handler(new Request(QUALIFICATION_URL + "?accountId=canary", wrong), selected)).status).toBe(400);
  expect(await r2()).toEqual([]);
});

test("wire requests require canonical owned bytes before any provider access", async () => {
  const canonical = JSON.stringify(stage({ stage: "inspect" }));
  const noEffects = new Proxy(selected, { get(target, key) {
    if (key === "AICHARTS_USAGE_SYNTHETIC_RUN" || key === "USAGE_ENROLLMENT_GENERATION") return Reflect.get(target, key);
    throw new Error(CANARY);
  } });
  const cases = ["\ufeff" + canonical, canonical + "\n", " " + canonical,
    canonical.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    canonical.replace('"schemaVersion":1', '"schemaVersion":1.0'),
    JSON.stringify({ runId: run.runId, schemaVersion: 1, stage: "inspect" }),
    canonical.replace('"inspect"', '"in\\u0073pect"')];
  for (const body of cases) {
    const response = await handler(new Request(QUALIFICATION_URL, { method: "POST", headers: { "content-type": "application/json" }, body }), noEffects);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ schemaVersion: 1, ok: false, error: "invalid_request" });
  }
  expect(await r2()).toEqual([]);
});

test("pairing retains exact server attempt times and never cascades on a later retry", async () => {
  const attempt = await pairing();
  const before = await pairingPayload();
  vi.setSystemTime(Date.now() + 10_000);
  const repeated = await call(stage({ stage: "authenticate", slot: "original", attempt }));
  expect(success(repeated)).toEqual({ recorded: true, authTimeMs: Math.floor(attempt.startedAtMs / 1000) * 1000, sessionExpiresAtMs: attempt.expiresAtMs });
  const first = success(await call(stage({ stage: "enroll" }))), second = success(await call(stage({ stage: "enroll" })));
  expect(second).toEqual(first);
  const old = JSON.parse(before as string) as { browserAttempts: number; attempt: { id: string; authentication: unknown } };
  const current = JSON.parse(await pairingPayload() as string) as typeof old;
  expect(current.browserAttempts).toBe(1); expect(current.attempt).toEqual(old.attempt);
  // Mutating an already recorded time is not a refreshed authentication grant.
  expect((await call(stage({ stage: "authenticate", slot: "original", attempt: { ...attempt, startedAtMs: attempt.startedAtMs + 1_000 } }))).ok).toBe(false);
});

test("a missing pairing step is refused instead of restarting completed phases", async () => {
  expect((await call(stage({ stage: "enroll" }))).ok).toBe(false);
  expect((await call(stage({ stage: "reserve", slot: "original" }))).ok).toBe(false);
  success(await call(stage({ stage: "initialize", slot: "original" })));
  expect((await call(stage({ stage: "confirm", slot: "original" }))).ok).toBe(false);
  expect(await r2()).toEqual([]);
  expect(JSON.parse(await pairingPayload() as string)).toMatchObject({ status: "pending", browserAttempts: 0, attempt: null });
});

test("lost completed enrollment reply reconciles the exact receipt and namespace after restart", async () => {
  await pairing();
  expect(await call(stage({ stage: "enroll-drop" }))).toEqual({ schemaVersion: 1, ok: false, error: "synthetic_reply_withheld" });
  const before = await r2(); expect(before).toHaveLength(1); expect(before[0].size).toBe(160);
  const namespace = success(await call(stage({ stage: "namespace" })));
  await abortAllDurableObjects();
  const receipt = success(await call(stage({ stage: "enroll" })));
  expect(success(await call(stage({ stage: "enroll" })))).toEqual(receipt);
  expect(success(await call(stage({ stage: "namespace" })))).toEqual(namespace);
  expect(await r2()).toEqual(before);
  const state = await rows();
  expect((JSON.parse(state.enrollment.payload as string) as { devices: unknown[] }).devices).toHaveLength(1);
});

test("lost completed admission reply preserves exact bytes, one publication and real R2 readback", async () => {
  const enrollment = await enroll(), fixture = qualificationFixture(run, enrollment.deviceId);
  expect(await call(stage({ stage: "insert-drop" }))).toEqual({ schemaVersion: 1, ok: false, error: "synthetic_reply_withheld" });
  const before = await r2(); expect(before).toHaveLength(3);
  const objects = success(await call(stage({ stage: "inspect" }))) as { objects: readonly { kind: string; bodyHex: string | null }[] };
  expect(objects.objects.map(object => object.kind)).toEqual(QUALIFICATION_OBJECT_KINDS.slice(0, 3));
  expect(objects.objects[0].bodyHex).toBeNull();
  expect(objects.objects[1].bodyHex).toBe(qualificationByteHex(fixture.insert.bytes));
  await abortAllDurableObjects();
  const replay = success(await call(stage({ stage: "insert" }))) as { batchHex: string; journalHex: string };
  expect(replay.batchHex).toBe(qualificationByteHex(fixture.insert.bytes));
  expect(replay.journalHex).toBe(objects.objects[2].bodyHex);
  expect(success(await call(stage({ stage: "insert" })))).toEqual(replay);
  const query = success(await call(stage({ stage: "read" }))) as { journalCommittedAtMs: number };
  expect(query).toEqual(qualificationExpectedDays(run, 1, query.journalCommittedAtMs));
  expect(await r2()).toEqual(before);
  const state = await rows(); expect(state.control).toMatchObject({ published_revision: 1, head_count: 2, live_count: 2 }); expect(state.pending).toEqual([]);
});

test("correction and tombstone project exact current provider totals in seven immutable objects", async () => {
  const enrollment = await enroll(), fixture = qualificationFixture(run, enrollment.deviceId);
  for (const [index, name] of ["insert", "correct", "tombstone"].entries()) {
    const admitted = success(await call(stage({ stage: name }))) as { batchHex: string; journalHex: string };
    const batch = index === 0 ? fixture.insert : index === 1 ? fixture.correction : fixture.tombstone;
    const journal = decodeAdmissionJournal(Uint8Array.from(Buffer.from(admitted.journalHex, "hex")), batch.bytes, ADMISSION_POLICY_V1);
    expect(journal.ok).toBe(true); if (!journal.ok) throw new Error("synthetic_fixture_failure");
    expect(success(await call(stage({ stage: "read" })))).toEqual(qualificationExpectedDays(run, (index + 1) as 1 | 2 | 3, journal.value.committedAtMs));
  }
  const objects = success(await call(stage({ stage: "inspect" }))) as { objects: readonly { kind: string; byteLength: number }[] };
  expect(objects.objects.map(object => object.kind)).toEqual(QUALIFICATION_OBJECT_KINDS);
  expect(objects.objects.reduce((total, object) => total + object.byteLength, 0)).toBe(3_152);
  expect(await r2()).toHaveLength(7);
  const state = await rows(); expect(state.control).toMatchObject({ published_revision: 3, head_count: 2, live_count: 1 });
  expect(state.heads).toHaveLength(2); expect(state.pending).toEqual([]);
});

test("out-of-order revoked probe cannot publish a fourth batch for an active device", async () => {
  await completeBatches();
  const beforeObjects = await r2(), before = await rows();
  expect(await call(stage({ stage: "revoked-probe" }))).toEqual({ schemaVersion: 1, ok: false, error: "qualification_failed" });
  expect(await r2()).toEqual(beforeObjects);
  const after = await rows();
  expect(after.control).toEqual(before.control); expect(after.heads).toEqual(before.heads);
  expect(after.pending).toEqual(before.pending); expect(after.devices).toEqual(before.devices);
  expect(after.enrollment.payload).toEqual(before.enrollment.payload);
  expect(after.control).toMatchObject({ published_revision: 3, head_count: 2, live_count: 1 });
  expect(beforeObjects).toHaveLength(7);
});

test("revocation remains exact after restart; latest retry succeeds while a new batch is refused", async () => {
  await completeBatches();
  const journal = success(await call(stage({ stage: "tombstone" }))), query = success(await call(stage({ stage: "read" }))), before = await r2();
  const revoked = success(await call(stage({ stage: "revoke" })));
  await abortAllDurableObjects();
  expect(success(await call(stage({ stage: "revoke" })))).toEqual(revoked);
  expect(success(await call(stage({ stage: "revoked-probe" })))).toEqual({ result: "revoked" });
  expect(success(await call(stage({ stage: "tombstone" })))).toEqual(journal);
  expect(success(await call(stage({ stage: "read" })))).toEqual(query);
  expect(await r2()).toEqual(before);
  expect((await rows()).control).toMatchObject({ published_revision: 3, head_count: 2, live_count: 1 });
});

test("expired pairing is never refreshed; committed receipt and routine upload remain valid", async () => {
  const attempt = await pairing(), enrolled = success(await call(stage({ stage: "enroll" })));
  vi.setSystemTime(NOW + PAIRING_TTL_MS + 1);
  expect((await call(stage({ stage: "authenticate", slot: "original", attempt }))).ok).toBe(false);
  expect((await call(stage({ stage: "reserve", slot: "original" }))).ok).toBe(false);
  expect((await call(stage({ stage: "namespace" }))).ok).toBe(false);
  expect(success(await call(stage({ stage: "enroll" })))).toEqual(enrolled);
  success(await call(stage({ stage: "insert" })));
  success(await call(stage({ stage: "read" })));
});

test("actual generation fences close old authority and refuse fresh-generation reopening", async () => {
  await completeBatches(); success(await call(stage({ stage: "revoke" })));
  const before = await r2();
  await generation(G2);
  expect(await call(stage({ stage: "initialize", slot: "original" }))).toEqual({ schemaVersion: 1, ok: false, error: "qualification_unavailable" });
  await pairing("closure");
  expect(success(await call(stage({ stage: "generation-probe" })))).toEqual(Object.fromEntries(QUALIFICATION_CLOSURE_KEYS.map(key => [key, "recovery_required"])));
  expect(success(await call(stage({ stage: "inspect" })))).toMatchObject({ objects: expect.any(Array) });
  expect(await r2()).toEqual(before);
  const state = await rows(); expect(state.control).toMatchObject({ published_revision: 3, head_count: 2, live_count: 1 });
  expect((JSON.parse(state.enrollment.payload as string) as { devices: unknown[] }).devices).toHaveLength(1);
});

test("configuration changes during R2 work suppress the pending reply and cancel its body", async () => {
  await enroll();
  let calls = 0, cancelled = false;
  const bucket = new Proxy(env.CONTROL, { get(target, key) {
    if (key === "get") return async (...args: Parameters<R2Bucket["get"]>) => {
      const object = await target.get(...args);
      if (++calls !== 2 || object === null) return object;
      await object.body.cancel();
      selected.USAGE_ENROLLMENT_GENERATION = G2;
      return { ...object, body: new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }) };
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  selected = { ...selected, CONTROL: bucket };
  expect(await call(stage({ stage: "inspect" }))).toEqual({ schemaVersion: 1, ok: false, error: "qualification_unavailable" });
  expect(cancelled).toBe(true);
});

test("R2 metadata corruption produces only a fixed failure and preserves provider objects", async () => {
  await enroll(); success(await call(stage({ stage: "insert" })));
  const before = await r2();
  const bucket = new Proxy(env.STAGING, { get(target, key) {
    if (key === "get") return async (...args: Parameters<R2Bucket["get"]>) => {
      const object = await target.get(...args);
      return object && new Proxy(object, { get(stored, property) {
        if (property === "customMetadata") return { schemaVersion: "1", transcript: CANARY };
        const value: unknown = Reflect.get(stored, property, stored);
        return typeof value === "function" ? value.bind(stored) : value;
      } });
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  expect(await call(stage({ stage: "inspect" }), { ...selected, STAGING: bucket })).toEqual({ schemaVersion: 1, ok: false, error: "qualification_failed" });
  expect(await r2()).toEqual(before);
});

test("inspect refuses orphan records and reads only the fixed run prefixes", async () => {
  const identity = qualificationIdentity(run), prefix = `usage-admission/v1/${identity.accountId.slice(5)}/${run.generationOne}`;
  await env.STAGING.put(`${prefix}/batches/orphan.aicb`, Uint8Array.of(1));
  await env.STAGING.put("unrelated-private-object", Uint8Array.of(2));
  const before = await r2();
  const prefixes: string[] = [];
  const bucket = new Proxy(env.STAGING, { get(target, key) {
    if (key === "list") return async (options: R2ListOptions) => { prefixes.push(options.prefix!); expect(options.limit).toBe(4); return target.list(options); };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  expect(await call(stage({ stage: "inspect" }), { ...selected, STAGING: bucket })).toEqual({ schemaVersion: 1, ok: false, error: "qualification_failed" });
  expect(prefixes).toEqual([`${prefix}/batches/`]);
  expect(await r2()).toEqual(before);
});

test("elapsed acceptance deadline suppresses an R2 result without renewing the stage", async () => {
  let reads = 0;
  const bucket = new Proxy(env.CONTROL, { get(target, key) {
    if (key === "get") return async (...args: Parameters<R2Bucket["get"]>) => {
      const value = await target.get(...args); reads++; vi.setSystemTime(Date.now() + 15_000); return value;
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  expect(await call(stage({ stage: "inspect" }), { ...selected, CONTROL: bucket })).toEqual({ schemaVersion: 1, ok: false, error: "qualification_unavailable" });
  expect(reads).toBe(1); expect(await r2()).toEqual([]);
});

test("owned codecs reject extensions and never execute inherited JSON hooks", async () => {
  const input = stage({ stage: "inspect" });
  const good = { schemaVersion: 1, runId: run.runId, stage: "inspect", ok: true, value: { objects: [] } };
  expect(parseQualificationReply(run, input, good)).not.toBeNull();
  expect(parseQualificationReply(run, input, { ...good, transcript: CANARY })).toBeNull();
  expect(parseQualificationReply(run, input, { ...good, value: { objects: [], contextToken: CANARY } })).toBeNull();
  const objectHook = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON"), arrayHook = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
  let executed = 0;
  try {
    for (const prototype of [Object.prototype, Array.prototype]) Object.defineProperty(prototype, "toJSON", { configurable: true, value() { executed++; throw new Error(CANARY); } });
    const reply = parseQualificationReply(run, input, good), bytes = encodeQualificationJson(reply);
    expect(reply).not.toBeNull(); expect(bytes).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(bytes!))).toEqual(good);
    expect(executed).toBe(0);
  } finally {
    if (objectHook) Object.defineProperty(Object.prototype, "toJSON", objectHook); else Reflect.deleteProperty(Object.prototype, "toJSON");
    if (arrayHook) Object.defineProperty(Array.prototype, "toJSON", arrayHook); else Reflect.deleteProperty(Array.prototype, "toJSON");
  }
  let accessor = false;
  expect(qualificationFields({ get stage() { accessor = true; return "inspect"; } }, ["stage"])).toBeNull();
  expect(accessor).toBe(false);
  expect(encodeQualificationJson(new Map([["transcript", CANARY]]))).toBeNull();
  expect(encodeQualificationJson([, 1])).toBeNull();
  expect(encodeQualificationJson(Object.assign([], { transcript: CANARY }))).toBeNull();
});
