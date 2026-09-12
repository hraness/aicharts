import { env } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { abortAllDurableObjects, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { enrollmentAccountName, type EnrollmentProof } from "../src/enrollment-contract";
import type { EnrollmentView } from "../src/enrollment";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";

// Exact local fixture reset only. Dropping just enrollment in schema3 now means
// corrupt partial state, not the completely empty restore these tests exercise.
function removeSyntheticAdmissionTables(sql: SqlStorage): void {
  sql.exec("DROP TABLE usage_admission_control");
  sql.exec("DROP TABLE usage_admission_devices");
  sql.exec("DROP TABLE usage_admission_pending");
  sql.exec("DROP TABLE usage_admission_heads");
  sql.exec("DROP TABLE usage_admission_days");
}
async function eraseSyntheticAccount() {
  await runInDurableObject(accountStub(), (_instance, state) => {
    removeSyntheticAdmissionTables(state.storage.sql);
    state.storage.sql.exec("DROP TABLE account_enrollment");
  });
}

let ID = "11".repeat(32);
const POLL = "22".repeat(32);
const UPLOAD = "33".repeat(32);
const NONCE = "44".repeat(32);
const OTHER = "55".repeat(32);
let SECOND_ID = "66".repeat(32);
let ACCOUNT = `acct_${"aa".repeat(16)}`;
const OTHER_ACCOUNT = `acct_${"bb".repeat(16)}`;
const NOW = Date.UTC(2026, 8, 11, 12, 0, 0, 456);
let proof: EnrollmentProof = { intentId: ID, pollSecret: POLL, uploadSecret: UPLOAD };
const accountStub = (accountId = ACCOUNT) => env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(accountId));
const pairingStub = (intentId = ID) => env.PAIRINGS.getByName(intentId);
const hex = /^[0-9a-f]{64}$/u;

let fixtureNumber = 0;
beforeEach(() => {
  fixtureNumber++;
  ID = (fixtureNumber * 2).toString(16).padStart(64, "0");
  SECOND_ID = (fixtureNumber * 2 + 1).toString(16).padStart(64, "0");
  ACCOUNT = `acct_${fixtureNumber.toString(16).padStart(32, "0")}`;
  proof = { intentId: ID, pollSecret: POLL, uploadSecret: UPLOAD };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  // Per-test object names and explicit local control cleanup provide additional
  // deterministic isolation alongside the framework's attached-storage reset.
  const control = (await env.CONTROL.list()).objects.map(object => object.key);
  if (control.length !== 0) await env.CONTROL.delete(control);
  await reset();
});

function success<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  expect(result, result.ok ? undefined : result.error).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(`synthetic enrollment failed: ${result.error}`);
  return result.value;
}

async function confirmed(input = proof, accountId = ACCOUNT, sessionExpiresAtMs = NOW + PAIRING_TTL_MS) {
  const pairing = pairingStub(input.intentId);
  const uploadCommitment = success(await uploadSecretCommitment(input.intentId, input.uploadSecret));
  success(await pairing.initialize({ intentId: input.intentId, pollSecret: input.pollSecret, uploadCommitment }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: input.intentId, browserNonce: NONCE }));
  const browser = { intentId: input.intentId, attemptId: attempt.attemptId, browserNonce: NONCE, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId, authTimeMs: Math.floor(Date.now() / 1_000) * 1_000, sessionExpiresAtMs }));
  success(await pairing.decideBrowser({ ...browser, accountId, liveSessionExpiresAtMs: sessionExpiresAtMs, decision: "approve" }));
  success(await pairing.confirm({ intentId: input.intentId, pollSecret: input.pollSecret, accountId }));
  return input;
}

async function reserved(input = proof, accountId = ACCOUNT, sessionExpiresAtMs = NOW + PAIRING_TTL_MS) {
  await confirmed(input, accountId, sessionExpiresAtMs);
  return success(await pairingStub(input.intentId).reserveEnrollment(input));
}

function privateProjection(value: unknown, extra: readonly string[] = []) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [POLL, UPLOAD, NONCE, "private-provider-failure-canary", "transcript-canary", ...extra]) {
    expect(serialized).not.toContain(forbidden);
  }
}

async function anchor() {
  const objects = (await env.CONTROL.list()).objects;
  expect(objects).toHaveLength(1);
  const object = await env.CONTROL.get(objects[0].key);
  if (object === null) throw new Error("synthetic anchor missing");
  const bytes = new Uint8Array(await object.arrayBuffer());
  expect(bytes.byteLength).toBe(160);
  return { key: object.key, version: object.version, bytes };
}

async function accountRow() {
  return runInDurableObject(accountStub(), (_instance, state) => state.storage.sql.exec("SELECT schema_version, revision, payload FROM account_enrollment").one());
}

async function accountPayload(): Promise<Record<string, unknown>> {
  const row = await accountRow();
  if (typeof row.payload !== "string") throw new Error("synthetic account payload missing");
  const value: unknown = JSON.parse(row.payload);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("synthetic account payload malformed");
  return value as Record<string, unknown>;
}

// Only local-runtime fault injection: production methods still call the actual
// Pairing DO and R2 binding. Proxies alter an observed reply, never authority.
function replaceEnvironment(instance: unknown, change: (original: Env) => Env): () => void {
  const owned = instance as { env: Env };
  const original = owned.env;
  owned.env = change(original);
  return () => { owned.env = original; };
}

function withGeneration(original: Env, generation: unknown): Env {
  const changed = { ...original };
  // Wrangler types a checked literal; the test deliberately injects invalid or
  // rotated runtime configuration without claiming it is valid configuration.
  Object.defineProperty(changed, "USAGE_ENROLLMENT_GENERATION", { value: generation, writable: true, enumerable: true, configurable: true });
  return changed;
}

function bucketReplies(change: {
  get?: (bucket: R2Bucket, key: string) => Promise<R2ObjectBody | null>;
  put?: (bucket: R2Bucket, args: Parameters<R2Bucket["put"]>) => Promise<R2Object | null>;
}): R2Bucket {
  return new Proxy(env.CONTROL, {
    get(target, property) {
      if (property === "get" && change.get) return (key: string) => change.get!(target, key);
      if (property === "put" && change.put) return (...args: Parameters<R2Bucket["put"]>) => change.put!(target, args);
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function pairingReplies(change: (result: unknown) => unknown | Promise<unknown>): Env["PAIRINGS"] {
  return new Proxy(env.PAIRINGS, {
    get(target, property) {
      if (property === "getByName") return (name: string) => new Proxy(target.getByName(name), {
        get(stub, method) {
          if (method === "readEnrollmentReservation") return async (input: unknown) => {
            const original = await stub.readEnrollmentReservation(input);
            let changed: unknown;
            try { changed = await change(original); }
            catch (error) { original[Symbol.dispose](); throw error; }
            if (changed !== original) {
              // Preserve real RPC custody so malformed nested DTO cases cannot
              // pass merely because a replacement omitted transport disposal.
              if (changed !== null && typeof changed === "object" && !Object.hasOwn(changed, Symbol.dispose)) {
                Object.defineProperty(changed, Symbol.dispose, { value: () => original[Symbol.dispose](), configurable: true });
              } else {
                const disposer = changed !== null && typeof changed === "object" ? Object.getOwnPropertyDescriptor(changed, Symbol.dispose) : undefined;
                if (disposer === undefined || !("value" in disposer) || typeof disposer.value !== "function") original[Symbol.dispose]();
              }
            }
            return changed;
          };
          const value: unknown = Reflect.get(stub, method, stub);
          return typeof value === "function" ? value.bind(stub) : value;
        },
      });
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function pendingGenesis(committed = true) {
  const reservation = await reserved(proof, ACCOUNT, NOW + 30_000);
  const result = await runInDurableObject(accountStub(), async instance => {
    const bucket = bucketReplies({ put: async (target, args) => {
      if (committed) await target.put(...args);
      throw new Error("private-provider-failure-canary");
    } });
    const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
    try { return await instance.enroll(proof); } finally { restore(); }
  });
  expect(result).toEqual({ ok: false, error: "storage_unavailable" });
  expect(await accountPayload()).toMatchObject({ phase: "pending", genesisCompletion: null, devices: [] });
  return reservation;
}

describe("explicit retained-genesis recovery", () => {
  test.each([true, false])("fresh recovery keeps the namespace when anchor committed=%s", async committed => {
    const origin = await pendingGenesis(committed);
    const pending = await accountPayload();
    const original = committed ? await anchor() : null;
    vi.setSystemTime(origin.expiresAtMs);
    const fresh = { ...proof, intentId: SECOND_ID };
    const reservation = await reserved(fresh);
    expect(await accountStub().enroll(fresh)).toEqual({ ok: false, error: "recovery_required" });
    const recovered = success(await accountStub().recoverPendingEnrollment(fresh));
    privateProjection(recovered);
    expect(recovered.receipt).toMatchObject({ intentId: SECOND_ID, reservationId: reservation.reservationId });
    expect(await accountPayload()).toMatchObject({ phase: "active", anchor: pending.anchor,
      genesisCompletion: { mode: "fresh-recovery", intentId: SECOND_ID, reservationId: reservation.reservationId, completedAtMs: origin.expiresAtMs },
      devices: [expect.objectContaining({ deviceId: recovered.receipt.deviceId })] });
    if (original !== null) expect(await anchor()).toEqual(original);
    const namespace = success(await accountStub().namespaceForEnrollment(fresh));
    expect(namespace.namespaceKey).toBe((pending.anchor as { namespaceKey: string }).namespaceKey);
    expect(await accountStub().enroll(proof)).toEqual({ ok: false, error: "expired" });
    expect((await accountStub().namespaceForEnrollment(proof)).ok).toBe(false);
    vi.setSystemTime(reservation.expiresAtMs);
    await abortAllDurableObjects();
    expect(success(await accountStub().recoverPendingEnrollment(fresh))).toEqual(recovered);
    expect(await accountStub().namespaceForEnrollment(fresh)).toEqual({ ok: false, error: "expired" });
    success(await accountStub().revokeEnrollment(fresh));
    expect(success(await accountStub().recoverPendingEnrollment(fresh))).toEqual({ receipt: recovered.receipt, deviceState: "revoked" });
  });

  test("recovery never initializes empty state or adopts an orphan anchor", async () => {
    await reserved();
    expect(await accountStub().recoverPendingEnrollment(proof)).toEqual({ ok: false, error: "recovery_required" });
    expect(await accountRow()).toMatchObject({ revision: 0, payload: null });
    expect((await env.CONTROL.list()).objects).toEqual([]);
    success(await accountStub().enroll(proof));
    const original = await anchor();
    await eraseSyntheticAccount();
    await abortAllDurableObjects();
    expect(await accountStub().recoverPendingEnrollment(proof)).toEqual({ ok: false, error: "recovery_required" });
    expect(await accountRow()).toMatchObject({ revision: 0, payload: null });
    expect(await anchor()).toEqual(original);
  });

  test("original proof, unrelated account and expired fresh proof cannot recover", async () => {
    const origin = await pendingGenesis();
    const original = await anchor();
    expect(await accountStub().recoverPendingEnrollment(proof)).toEqual({ ok: false, error: "recovery_required" });
    const fresh = { ...proof, intentId: SECOND_ID };
    const reservation = await reserved(fresh);
    expect(await accountStub(OTHER_ACCOUNT).recoverPendingEnrollment(fresh)).toEqual({ ok: false, error: "unauthorized" });
    vi.setSystemTime(Math.max(origin.expiresAtMs, reservation.expiresAtMs));
    expect(await accountStub().recoverPendingEnrollment(fresh)).toEqual({ ok: false, error: "expired" });
    expect(await accountPayload()).toMatchObject({ phase: "pending", genesisCompletion: null, devices: [] });
    expect(await anchor()).toEqual(original);
  });

  test("lost recovery anchor reply reconciles without a replacement or duplicate device", async () => {
    await pendingGenesis(false);
    const pending = await accountPayload();
    const fresh = { ...proof, intentId: SECOND_ID };
    await reserved(fresh);
    const failed = await runInDurableObject(accountStub(), async instance => {
      const bucket = bucketReplies({ put: async (target, args) => { await target.put(...args); throw new Error("private-provider-failure-canary"); } });
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      try { return await instance.recoverPendingEnrollment(fresh); } finally { restore(); }
    });
    expect(failed).toEqual({ ok: false, error: "storage_unavailable" });
    const original = await anchor();
    expect(await accountPayload()).toMatchObject({ phase: "pending", devices: [], anchor: pending.anchor });
    await abortAllDurableObjects();
    const recovered = success(await accountStub().recoverPendingEnrollment(fresh));
    expect(success(await accountStub().recoverPendingEnrollment(fresh))).toEqual(recovered);
    expect(await anchor()).toEqual(original);
    expect(await accountPayload()).toMatchObject({ devices: [expect.objectContaining({ deviceId: recovered.receipt.deviceId })] });
  });

  test.each(["expiry", "generation", "clock"] as const)("%s during recovery anchor I/O leaves genesis pending", async fault => {
    await pendingGenesis();
    const fresh = { ...proof, intentId: SECOND_ID };
    const reservation = await reserved(fresh);
    const original = await anchor();
    const result = await runInDurableObject(accountStub(), async instance => {
      const owned = instance as unknown as { env: Env };
      const bucket = bucketReplies({ get: async (target, key) => {
        const response = await target.get(key);
        if (fault === "expiry") vi.setSystemTime(reservation.expiresAtMs);
        else if (fault === "clock") vi.setSystemTime(NOW - 1);
        else owned.env = withGeneration(owned.env, "88".repeat(32));
        return response;
      } });
      const restore = replaceEnvironment(instance, originalEnv => ({ ...originalEnv, CONTROL: bucket }));
      try { return await instance.recoverPendingEnrollment(fresh); } finally { restore(); }
    });
    expect(result).toEqual({ ok: false, error: fault === "expiry" ? "expired" : fault === "clock" ? "clock_regressed" : "recovery_required" });
    expect(await accountPayload()).toMatchObject({ phase: "pending", genesisCompletion: null, devices: [] });
    expect(await anchor()).toEqual(original);
  });

  test("fresh recovery supersedes an original enrollment still awaiting anchor I/O", async () => {
    await reserved();
    const fresh = { ...proof, intentId: SECOND_ID };
    await reserved(fresh);
    await runInDurableObject(accountStub(), async instance => {
      let signal: () => void = () => { throw new Error("uninitialized barrier"); };
      let release: () => void = () => { throw new Error("uninitialized barrier"); };
      const entered = new Promise<void>(resolve => { signal = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      const bucket = bucketReplies({ put: async (target, args) => { const response = await target.put(...args); signal(); await released; return response; } });
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      const original = instance.enroll(proof);
      await entered;
      // Recovery sees already persisted exact bytes, so no second put is needed.
      try {
        const winner = success(await instance.recoverPendingEnrollment(fresh));
        release();
        expect(await original).toEqual({ ok: false, error: "recovery_required" });
        expect(winner.receipt.intentId).toBe(SECOND_ID);
      } finally { release(); await original; restore(); }
    });
    expect(await accountPayload()).toMatchObject({ genesisCompletion: { mode: "fresh-recovery" }, devices: [expect.objectContaining({ reservation: expect.objectContaining({ intentId: SECOND_ID }) })] });
  });

  test("original completion winning a race is never overwritten by recovery", async () => {
    await pendingGenesis();
    const fresh = { ...proof, intentId: SECOND_ID };
    await reserved(fresh);
    await runInDurableObject(accountStub(), async instance => {
      let signal: () => void = () => { throw new Error("uninitialized barrier"); };
      let release: () => void = () => { throw new Error("uninitialized barrier"); };
      const entered = new Promise<void>(resolve => { signal = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      let first = true;
      const bucket = bucketReplies({ get: async (target, key) => {
        const response = await target.get(key);
        if (first) { first = false; signal(); await released; }
        return response;
      } });
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      const recovery = instance.recoverPendingEnrollment(fresh);
      await entered;
      try {
        success(await instance.enroll(proof));
        release();
        expect(await recovery).toEqual({ ok: false, error: "recovery_required" });
      } finally { release(); await recovery; restore(); }
    });
    expect(await accountPayload()).toMatchObject({ genesisCompletion: { mode: "original", intentId: ID },
      devices: [expect.objectContaining({ reservation: expect.objectContaining({ intentId: ID }) })] });
  });

  test("a reservation made before pending genesis is not fresh recovery authority", async () => {
    const fresh = { ...proof, intentId: SECOND_ID };
    await reserved(fresh);
    vi.setSystemTime(NOW + 1_000);
    await pendingGenesis();
    const before = await accountPayload();
    const original = await anchor();
    expect(await accountStub().recoverPendingEnrollment(fresh)).toEqual({ ok: false, error: "recovery_required" });
    expect(await accountPayload()).toMatchObject({ phase: "pending", genesisCompletion: null, anchor: before.anchor, devices: [] });
    expect(await anchor()).toEqual(original);
  });

  test("two fresh recoveries commit exactly one completion", async () => {
    await pendingGenesis();
    const first = { ...proof, intentId: SECOND_ID };
    const second = { ...proof, intentId: "ff".repeat(32) };
    await reserved(first);
    await reserved(second);
    const results = await Promise.all([accountStub().recoverPendingEnrollment(first), accountStub().recoverPendingEnrollment(second)]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toEqual([{ ok: false, error: "recovery_required" }]);
    const payload = await accountPayload();
    expect(payload.devices).toHaveLength(1);
    expect(payload.genesisCompletion).toMatchObject({ mode: "fresh-recovery" });
  });

  test.each(["empty", "pending", "active", "revoked", "multiple"] as const)("schema1 %s migrates additively without changing prior fields or revision", async phase => {
    if (phase === "empty") { await accountRow(); }
    else if (phase === "pending") await pendingGenesis();
    else {
      await reserved(); success(await accountStub().enroll(proof));
      if (phase === "revoked") success(await accountStub().revokeEnrollment(proof));
      if (phase === "multiple") {
        const fresh = { ...proof, intentId: SECOND_ID };
        await reserved(fresh); success(await accountStub().enroll(fresh));
      }
    }
    const before = await accountRow();
    const legacy = typeof before.payload === "string" ? JSON.parse(before.payload) as Record<string, unknown> : null;
    if (legacy !== null) delete legacy.genesisCompletion;
    await runInDurableObject(accountStub(), (_instance, state) => {
      removeSyntheticAdmissionTables(state.storage.sql);
      state.storage.sql.exec("UPDATE account_enrollment SET schema_version = 1, payload = ?", legacy === null ? null : JSON.stringify(legacy));
    });
    await abortAllDurableObjects();
    const after = await accountRow();
    expect(after).toMatchObject({ schema_version: 3, revision: before.revision });
    if (legacy === null) expect(after.payload).toBeNull();
    else {
      const payload = await accountPayload();
      expect(payload.genesisCompletion).toEqual(phase === "pending" ? null : { mode: "original", intentId: ID, reservationId: (legacy.anchor as { reservationId: string }).reservationId, completedAtMs: NOW });
      delete payload.genesisCompletion;
      expect(payload).toEqual(legacy);
    }
  });

  test.each(["mode", "time", "missing", "superseded device"] as const)("corrupt recovery completion %s cannot release namespace or be repaired", async corruption => {
    const origin = await pendingGenesis();
    const fresh = { ...proof, intentId: SECOND_ID };
    await reserved(fresh);
    success(await accountStub().recoverPendingEnrollment(fresh));
    const payload = await accountPayload();
    const completion = payload.genesisCompletion as Record<string, unknown>;
    if (corruption === "mode") completion.mode = "original";
    else if (corruption === "time") completion.completedAtMs = NOW - 1;
    else if (corruption === "missing") payload.genesisCompletion = null;
    else (payload.devices as unknown[]).push({ reservation: origin,
      deviceId: createHash("sha256").update(["aicharts:enrollment:v1", "device", ACCOUNT, ID, origin.reservationId].join("\0")).digest("hex"),
      enrolledAtMs: NOW, revokedAtMs: null });
    const corrupted = JSON.stringify(payload);
    await runInDurableObject(accountStub(), (_instance, state) => state.storage.sql.exec("UPDATE account_enrollment SET payload = ?", corrupted).toArray());
    await abortAllDurableObjects();
    for (const input of [proof, fresh]) {
      for (const method of ["enroll", "recoverPendingEnrollment", "namespaceForEnrollment", "revokeEnrollment"] as const)
        expect(await accountStub()[method](input)).toEqual({ ok: false, error: "storage_invalid" });
    }
    expect((await accountRow()).payload).toBe(corrupted);
  });
});

describe("dormant account enrollment with real local pairing and R2", () => {
  test("a confirmed terminal is not an enrollment reservation", async () => {
    await confirmed();
    expect((await accountStub().enroll(proof)).ok).toBe(false);
    expect((await accountStub().namespaceForEnrollment(proof)).ok).toBe(false);
    expect((await accountStub().revokeEnrollment(proof)).ok).toBe(false);
    expect((await env.CONTROL.list()).objects).toEqual([]);
    expect((await env.STAGING.list()).objects).toEqual([]);
  });

  test("first reservation creates one immutable receipt and retrieves its namespace separately", async () => {
    const reservation = await reserved();
    const enrolled = success(await accountStub().enroll(proof));
    expect(enrolled).toEqual({
      receipt: { schemaVersion: 1, accountId: ACCOUNT, intentId: ID, reservationId: reservation.reservationId,
        deviceId: expect.stringMatching(hex), enrolledAtMs: NOW, namespaceVersion: 1 },
      deviceState: "active",
    });
    expect(enrolled.receipt.deviceId).not.toBe("0".repeat(64));
    privateProjection(enrolled);
    const namespace = success(await accountStub().namespaceForEnrollment(proof));
    expect(namespace).toEqual({ schemaVersion: 1, namespaceVersion: 1, namespaceKey: expect.stringMatching(hex), receipt: enrolled.receipt });
    expect(namespace.namespaceKey).not.toBe("0".repeat(64));
    const firstAnchor = await anchor();
    privateProjection(firstAnchor.key, [namespace.namespaceKey]);
    expect((await env.STAGING.list()).objects).toEqual([]);
  });

  test("receipt replay and restart never rotate the namespace, device or anchor", async () => {
    await reserved();
    const enrolled = await accountStub().enroll(proof);
    const namespace = await accountStub().namespaceForEnrollment(proof);
    const original = await anchor();
    vi.setSystemTime(NOW + 1_000);
    await abortAllDurableObjects();
    expect(await accountStub().enroll(proof)).toEqual(enrolled);
    expect(await accountStub().namespaceForEnrollment(proof)).toEqual(namespace);
    expect(await anchor()).toEqual(original);
  });

  test("multiple independently reserved intents share one account namespace and have distinct receipts", async () => {
    await reserved();
    const first = success(await accountStub().enroll(proof));
    const firstNamespace = success(await accountStub().namespaceForEnrollment(proof));
    const original = await anchor();
    const secondProof = { ...proof, intentId: SECOND_ID };
    await reserved(secondProof);
    const second = success(await accountStub().enroll(secondProof));
    const secondNamespace = success(await accountStub().namespaceForEnrollment(secondProof));
    expect(second.receipt.intentId).toBe(SECOND_ID);
    expect(second.receipt.deviceId).not.toBe(first.receipt.deviceId);
    expect(second.receipt.reservationId).not.toBe(first.receipt.reservationId);
    expect(secondNamespace.namespaceKey).toBe(firstNamespace.namespaceKey);
    expect(secondNamespace.receipt).toEqual(second.receipt);
    expect(await accountStub().enroll(proof)).toEqual({ ok: true, value: first });
    expect(await anchor()).toEqual(original);
  });

  test("the owner object is derived from the reserved account, never the caller's chosen object", async () => {
    await reserved();
    for (const method of ["enroll", "namespaceForEnrollment", "revokeEnrollment"] as const) {
      const result = await accountStub(OTHER_ACCOUNT)[method](proof);
      expect(result).toEqual({ ok: false, error: "unauthorized" });
      privateProjection(result, [ACCOUNT]);
    }
    expect((await env.CONTROL.list()).objects).toEqual([]);
    expect((await accountStub().enroll(proof)).ok).toBe(true);
  });

  test("the exact expiry denies new enrollment and never creates an anchor", async () => {
    const reservation = await reserved(proof, ACCOUNT, NOW + 30_000);
    vi.setSystemTime(reservation.expiresAtMs);
    expect(await accountStub().enroll(proof)).toEqual({ ok: false, error: "expired" });
    expect((await accountStub().namespaceForEnrollment(proof)).ok).toBe(false);
    expect((await env.CONTROL.list()).objects).toEqual([]);
  });

  test("expired proof can read its existing receipt but cannot retrieve the namespace", async () => {
    const reservation = await reserved(proof, ACCOUNT, NOW + 30_000);
    const enrolled = await accountStub().enroll(proof);
    const namespace = success(await accountStub().namespaceForEnrollment(proof));
    vi.setSystemTime(reservation.expiresAtMs);
    await abortAllDurableObjects();
    expect(await accountStub().enroll(proof)).toEqual(enrolled);
    const rejected = await accountStub().namespaceForEnrollment(proof);
    expect(rejected).toEqual({ ok: false, error: "expired" });
    privateProjection(rejected, [namespace.namespaceKey]);
  });

  test("lost successful enrollment response reconciles after restart without another device", async () => {
    await reserved();
    const captured: { committed: EnrollmentView | null } = { committed: null };
    await expect((async () => {
      captured.committed = success(await accountStub().enroll(proof));
      throw new Error("synthetic reply lost after durable commit");
    })()).rejects.toThrow("synthetic reply lost after durable commit");
    if (captured.committed === null) throw new Error("synthetic enrollment did not commit");
    const original = await anchor();
    await abortAllDurableObjects();
    expect(await accountStub().enroll(proof)).toEqual({ ok: true, value: captured.committed });
    expect(success(await accountStub().namespaceForEnrollment(proof)).receipt).toEqual(captured.committed.receipt);
    expect(await anchor()).toEqual(original);
  });

  test("revocation is existing-only, exact-proof scoped and irreversible on enrollment retries", async () => {
    await reserved();
    expect(await accountStub().revokeEnrollment(proof)).toEqual({ ok: false, error: "not_enrolled" });
    expect((await env.CONTROL.list()).objects).toEqual([]);
    const enrolled = success(await accountStub().enroll(proof));
    const original = await anchor();
    const expected = { ok: true, value: { receipt: enrolled.receipt, deviceState: "revoked" } };
    expect(await accountStub().revokeEnrollment(proof)).toEqual(expected);
    await abortAllDurableObjects();
    expect(await accountStub().revokeEnrollment(proof)).toEqual(expected);
    expect(await accountStub().enroll(proof)).toEqual(expected);
    expect(await accountStub().namespaceForEnrollment(proof)).toEqual({ ok: false, error: "revoked" });
    expect(await anchor()).toEqual(original);
  });

  test("an expired original proof can revoke only its own device without rotating the account namespace", async () => {
    const reservation = await reserved(proof, ACCOUNT, NOW + 30_000);
    const first = success(await accountStub().enroll(proof));
    const namespace = success(await accountStub().namespaceForEnrollment(proof));
    const secondProof = { ...proof, intentId: SECOND_ID };
    await reserved(secondProof);
    const second = success(await accountStub().enroll(secondProof));
    vi.setSystemTime(reservation.expiresAtMs);
    expect(await accountStub().revokeEnrollment(proof)).toEqual({ ok: true, value: { receipt: first.receipt, deviceState: "revoked" } });
    expect(await accountStub().enroll(secondProof)).toEqual({ ok: true, value: second });
    expect(success(await accountStub().namespaceForEnrollment(secondProof)).namespaceKey).toBe(namespace.namespaceKey);
  });

  test("closed proof DTOs cannot inject account grants, transcript fields or reused secrets", async () => {
    await reserved();
    for (const input of [null, [], "transcript-canary", {}, { ...proof, accountId: ACCOUNT },
      { ...proof, reservationId: OTHER }, { ...proof, chat: "transcript-canary" },
      { ...proof, uploadSecret: POLL }, ...["", "0".repeat(64), "A".repeat(64), "1".repeat(63), 17]
        .map(intentId => ({ ...proof, intentId }))]) {
      for (const method of ["enroll", "namespaceForEnrollment", "revokeEnrollment"] as const) {
        expect(await accountStub()[method](input)).toEqual({ ok: false, error: "invalid_input" });
      }
    }
    expect((await env.CONTROL.list()).objects).toEqual([]);
    expect((await accountStub().enroll(proof)).ok).toBe(true);
  });

  test("both original preimages are required, including after an enrollment already exists", async () => {
    await reserved();
    success(await accountStub().enroll(proof));
    for (const change of [{ pollSecret: OTHER }, { uploadSecret: OTHER }, { pollSecret: UPLOAD, uploadSecret: POLL }]) {
      for (const method of ["enroll", "namespaceForEnrollment", "revokeEnrollment"] as const) {
        const result = await accountStub()[method]({ ...proof, ...change });
        expect(result.ok).toBe(false);
        privateProjection(result);
      }
    }
  });

  test("DO-local DTO snapshot rejects accessors without evaluating them", async () => {
    await reserved();
    await runInDurableObject(accountStub(), async instance => {
      let called = 0;
      const accessor = Object.defineProperty({ ...proof }, "pollSecret", { get() { called++; return POLL; } });
      const proxy = new Proxy({}, { ownKeys() { throw new Error("private-provider-failure-canary"); } });
      expect(await instance.enroll(accessor)).toEqual({ ok: false, error: "invalid_input" });
      expect(await instance.namespaceForEnrollment(proxy)).toEqual({ ok: false, error: "invalid_input" });
      expect(called).toBe(0);
      const mutable = { ...proof };
      const operation = instance.enroll(mutable);
      mutable.intentId = SECOND_ID;
      mutable.pollSecret = OTHER;
      expect((await operation).ok).toBe(true);
    });
  });

  test("lost conditional-anchor reply retains pending genesis and reconciles exact bytes after restart", async () => {
    await reserved();
    let puts = 0;
    const bucket = bucketReplies({ put: async (target, args) => {
      puts++;
      await target.put(...args);
      throw new Error("private-provider-failure-canary");
    } });
    const failed = await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      try { return await instance.enroll(proof); } finally { restore(); }
    });
    expect(failed).toEqual({ ok: false, error: "storage_unavailable" });
    privateProjection(failed);
    expect(puts).toBe(1);
    const original = await anchor();
    const secondProof = { ...proof, intentId: SECOND_ID };
    await reserved(secondProof);
    await abortAllDurableObjects();
    expect(await accountStub().enroll(secondProof)).toEqual({ ok: false, error: "recovery_required" });
    expect((await accountStub().namespaceForEnrollment(proof)).ok).toBe(false);
    const enrolled = success(await accountStub().enroll(proof));
    expect(success(await accountStub().namespaceForEnrollment(proof)).receipt).toEqual(enrolled.receipt);
    expect(await anchor()).toEqual(original);
    expect((await accountStub().enroll(secondProof)).ok).toBe(true);
  });

  test("an uncommitted anchor write leaves durable pending genesis without a namespace grant", async () => {
    await reserved();
    let puts = 0;
    const bucket = bucketReplies({ put: async () => { puts++; throw new Error("private-provider-failure-canary"); } });
    const failed = await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      try { return await instance.enroll(proof); } finally { restore(); }
    });
    expect(failed).toEqual({ ok: false, error: "storage_unavailable" });
    expect(puts).toBe(1);
    expect((await env.CONTROL.list()).objects).toEqual([]);
    expect((await accountStub().namespaceForEnrollment(proof)).ok).toBe(false);
    await abortAllDurableObjects();
    expect((await accountStub().enroll(proof)).ok).toBe(true);
    await anchor();
  });

  test.each(["get", "put"] as const)("expiry reached after the actual R2 %s withholds first enrollment", async operation => {
    const reservation = await reserved(proof, ACCOUNT, NOW + 30_000);
    let calls = 0;
    const bucket = bucketReplies(operation === "get" ? {
      get: async (target, key) => { const result = await target.get(key); calls++; vi.setSystemTime(reservation.expiresAtMs); return result; },
    } : {
      put: async (target, args) => { const result = await target.put(...args); calls++; vi.setSystemTime(reservation.expiresAtMs); return result; },
    });
    const failed = await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      try { return await instance.enroll(proof); } finally { restore(); }
    });
    expect(failed).toEqual({ ok: false, error: "expired" });
    expect(calls).toBe(1);
    privateProjection(failed);
    await abortAllDurableObjects();
    expect((await accountStub().namespaceForEnrollment(proof)).ok).toBe(false);
    expect(await accountStub().enroll(proof)).toEqual({ ok: false, error: "expired" });
    expect((await env.CONTROL.list()).objects).toHaveLength(operation === "put" ? 1 : 0);
  });

  test("clock regression during R2 read cannot initialize an account", async () => {
    await reserved();
    const bucket = bucketReplies({ get: async (target, key) => {
      const result = await target.get(key);
      vi.setSystemTime(NOW - 1);
      return result;
    } });
    const failed = await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      try { return await instance.enroll(proof); } finally { restore(); }
    });
    expect(failed).toEqual({ ok: false, error: "clock_regressed" });
    expect((await env.CONTROL.list()).objects).toEqual([]);
  });

  test.each(["enroll", "namespaceForEnrollment", "revokeEnrollment"] as const)("%s fails closed if the external generation changes", async method => {
    await reserved();
    success(await accountStub().enroll(proof));
    const originalAnchor = await anchor();
    const result = await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, original => withGeneration(original, OTHER));
      try { return await instance[method](proof); } finally { restore(); }
    });
    expect(result).toEqual({ ok: false, error: "recovery_required" });
    privateProjection(result);
    expect(await anchor()).toEqual(originalAnchor);
  });

  test("an external-generation change during the conditional write cannot activate pending genesis", async () => {
    await reserved();
    const result = await runInDurableObject(accountStub(), async instance => {
      const owned = instance as unknown as { env: Env };
      const bucket = bucketReplies({ put: async (target, args) => {
        const result = await target.put(...args);
        owned.env = withGeneration(owned.env, OTHER);
        return result;
      } });
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      try { return await instance.enroll(proof); } finally { restore(); }
    });
    expect(result).toEqual({ ok: false, error: "recovery_required" });
    await anchor();
    expect((await accountStub().namespaceForEnrollment(proof)).ok).toBe(false);
  });

  test("expiry during the authoritative reservation RPC prevents every first-device write", async () => {
    const reservation = await reserved(proof, ACCOUNT, NOW + 30_000);
    let calls = 0;
    const pairings = pairingReplies(result => { calls++; vi.setSystemTime(reservation.expiresAtMs); return result; });
    const rejected = await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, PAIRINGS: pairings }));
      try { return await instance.enroll(proof); } finally { restore(); }
    });
    expect(rejected).toEqual({ ok: false, error: "expired" });
    expect(calls).toBe(1);
    expect((await env.CONTROL.list()).objects).toEqual([]);
  });

  test("a failed authoritative RPC is not retried or treated as a caller-supplied grant", async () => {
    await reserved();
    let calls = 0;
    const pairings = pairingReplies(() => { calls++; throw new Error("private-provider-failure-canary"); });
    const rejected = await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, PAIRINGS: pairings }));
      try { return await instance.enroll(proof); } finally { restore(); }
    });
    expect(rejected).toEqual({ ok: false, error: "storage_unavailable" });
    privateProjection(rejected);
    expect(calls).toBe(1);
    expect((await env.CONTROL.list()).objects).toEqual([]);
    expect((await accountStub().enroll(proof)).ok).toBe(true);
  });

  test("malformed authoritative replies cannot bootstrap or project their private fields", async () => {
    const reservation = await reserved();
    const malformed: unknown[] = [null, [], {}, "transcript-canary", { ok: true },
      { ok: true, value: reservation, chat: "transcript-canary" },
      { ok: true, value: { ...reservation, chat: "transcript-canary" } },
      ...[{ schemaVersion: 2 }, { accountId: OTHER }, { intentId: OTHER }, { reservationId: "0".repeat(64) },
        { expiresAtMs: reservation.reservedAtMs }, { reservedAtMs: NOW + 1 }, { expiresAtMs: NOW + PAIRING_TTL_MS + 1 },
        { recoveryGeneration: "0".repeat(64) }, { uploadCommitment: reservation.pollCommitment }]
        .map(change => ({ ok: true, value: { ...reservation, ...change } }))];
    for (const reply of malformed) {
      const result = await runInDurableObject(accountStub(), async instance => {
        const restore = replaceEnvironment(instance, original => ({ ...original, PAIRINGS: pairingReplies(() => reply) }));
        try { return await instance.enroll(proof); } finally { restore(); }
      });
      expect(result.ok).toBe(false);
      privateProjection(result);
      expect((await env.CONTROL.list()).objects).toEqual([]);
    }
    expect((await accountStub().enroll(proof)).ok).toBe(true);
  });

  test("namespace recovery rechecks the live deadline after the control-anchor read", async () => {
    const reservation = await reserved(proof, ACCOUNT, NOW + 30_000);
    success(await accountStub().enroll(proof));
    const namespace = success(await accountStub().namespaceForEnrollment(proof));
    const bucket = bucketReplies({ get: async (target, key) => {
      const object = await target.get(key);
      vi.setSystemTime(reservation.expiresAtMs);
      return object;
    } });
    const result = await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      try { return await instance.namespaceForEnrollment(proof); } finally { restore(); }
    });
    expect(result).toEqual({ ok: false, error: "expired" });
    privateProjection(result, [namespace.namespaceKey]);
  });

  test("persistent rows and ordinary receipts retain commitments, not terminal or browser secrets", async () => {
    await reserved();
    const enrolled = success(await accountStub().enroll(proof));
    const namespace = success(await accountStub().namespaceForEnrollment(proof));
    const row = await accountRow();
    privateProjection(row);
    privateProjection(enrolled, [namespace.namespaceKey]);
    expect(row.payload).not.toMatch(/pollSecret|uploadSecret|browserNonce|contextToken|transcript|credential/u);
    const pairingRow = await runInDurableObject(pairingStub(), (_instance, state) => state.storage.sql.exec("SELECT payload FROM pairing_state").one());
    privateProjection(pairingRow, [namespace.namespaceKey]);
    const binary = await anchor();
    const asHex = Array.from(binary.bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    for (const forbidden of [POLL, UPLOAD, NONCE]) expect(asHex).not.toContain(forbidden);
    expect(new TextDecoder().decode(binary.bytes)).not.toContain("transcript-canary");
    expect((await env.STAGING.list()).objects).toEqual([]);
    await runInDurableObject(accountStub(), instance => {
      for (const method of ["upload", "authorizeUpload", "activate", "reset", "recover", "rotateNamespace"]) expect(method in instance).toBe(false);
    });
  });

  test("empty restored DO with an existing control anchor refuses a second namespace", async () => {
    await reserved();
    success(await accountStub().enroll(proof));
    const original = await anchor();
    await eraseSyntheticAccount();
    await abortAllDurableObjects();
    expect(await accountStub().enroll(proof)).toEqual({ ok: false, error: "recovery_required" });
    expect((await accountStub().namespaceForEnrollment(proof)).ok).toBe(false);
    expect((await accountStub().revokeEnrollment(proof)).ok).toBe(false);
    expect(await accountRow()).toMatchObject({ schema_version: 3, revision: 0, payload: null });
    expect(await anchor()).toEqual(original);
  });

  test("an active account with a missing anchor cannot release a namespace or enroll another device", async () => {
    await reserved();
    success(await accountStub().enroll(proof));
    const original = await anchor();
    const payload = await accountPayload();
    const secondProof = { ...proof, intentId: SECOND_ID };
    await reserved(secondProof);
    await env.CONTROL.delete(original.key);
    await abortAllDurableObjects();
    expect(await accountStub().namespaceForEnrollment(proof)).toEqual({ ok: false, error: "recovery_required" });
    expect(await accountStub().enroll(secondProof)).toEqual({ ok: false, error: "recovery_required" });
    expect((await accountPayload()).anchor).toEqual(payload.anchor);
    expect((await accountPayload()).devices).toEqual(payload.devices);
    expect((await env.CONTROL.list()).objects).toEqual([]);
  });

  test("simultaneous synthetic data erasure still requires the external restore fence", async () => {
    await reserved();
    success(await accountStub().enroll(proof));
    const original = await anchor();
    await env.CONTROL.delete(original.key);
    await eraseSyntheticAccount();
    await abortAllDurableObjects();
    // Neither store can prove that an erased account was previously enrolled.
    // Restore must disable the independently managed generation before traffic;
    // this tests that prerequisite, not automatic detection of total data loss.
    await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, originalEnv => withGeneration(originalEnv, ""));
      try {
        for (const method of ["enroll", "namespaceForEnrollment", "revokeEnrollment"] as const) {
          expect(await instance[method](proof)).toEqual({ ok: false, error: "recovery_required" });
        }
      } finally { restore(); }
    });
    expect(await accountRow()).toMatchObject({ revision: 0, payload: null });
    expect((await env.CONTROL.list()).objects).toEqual([]);
  });

  test.each(["malformed payload", "future schema", "missing row", "extra table", "extra index"] as const)("%s is preserved without reset or namespace regeneration", async corruption => {
    await reserved();
    success(await accountStub().enroll(proof));
    const original = await anchor();
    await runInDurableObject(accountStub(), (_instance, state) => {
      switch (corruption) {
        case "malformed payload": state.storage.sql.exec("UPDATE account_enrollment SET payload = ?", '{"chat":"transcript-canary"}'); break;
        case "future schema": state.storage.sql.exec("UPDATE account_enrollment SET schema_version = 4"); break;
        case "missing row": state.storage.sql.exec("DELETE FROM account_enrollment"); break;
        case "extra table": state.storage.sql.exec("CREATE TABLE unexpected_account_state (marker INTEGER)"); break;
        case "extra index": state.storage.sql.exec("CREATE INDEX unexpected_account_index ON account_enrollment (revision)"); break;
      }
    });
    const before = await runInDurableObject(accountStub(), (_instance, state) => ({
      schema: state.storage.sql.exec("SELECT name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' ORDER BY name").toArray(),
      rows: state.storage.sql.exec("SELECT schema_version, revision, payload FROM account_enrollment").toArray(),
    }));
    await abortAllDurableObjects();
    for (const method of ["enroll", "namespaceForEnrollment", "revokeEnrollment"] as const) {
      const result = await accountStub()[method](proof);
      expect(result).toEqual({ ok: false, error: "storage_invalid" });
      privateProjection(result);
    }
    const after = await runInDurableObject(accountStub(), (_instance, state) => ({
      schema: state.storage.sql.exec("SELECT name, sql FROM sqlite_schema WHERE name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' ORDER BY name").toArray(),
      rows: state.storage.sql.exec("SELECT schema_version, revision, payload FROM account_enrollment").toArray(),
    }));
    expect(after).toEqual(before);
    expect(await anchor()).toEqual(original);
  });

  test("interrupted account transaction preserves namespace, devices and revision together", async () => {
    await reserved();
    success(await accountStub().enroll(proof));
    const before = await accountRow();
    const original = await anchor();
    const rolledBack = await runInDurableObject(accountStub(), (_instance, state) => {
      try {
        state.storage.transactionSync(() => {
          state.storage.sql.exec("UPDATE account_enrollment SET revision = revision + 1, payload = ?", "{}");
          throw new Error("synthetic interrupted transaction");
        });
        return false;
      } catch { return true; }
    });
    expect(rolledBack).toBe(true);
    await abortAllDurableObjects();
    expect(await accountRow()).toEqual(before);
    expect(await anchor()).toEqual(original);
    expect((await accountStub().namespaceForEnrollment(proof)).ok).toBe(true);
  });

  test.each(["short", "oversized", "magic", "zero namespace", "wrong account", "missing checksum", "extra metadata"] as const)("a %s control anchor is not accepted, overwritten or repaired", async corruption => {
    await reserved();
    success(await accountStub().enroll(proof));
    const namespace = success(await accountStub().namespaceForEnrollment(proof));
    const original = await anchor();
    let bytes = original.bytes.slice();
    if (corruption === "short") bytes = bytes.slice(0, -1);
    if (corruption === "oversized") bytes = new Uint8Array([...bytes, 0]);
    if (corruption === "magic") bytes[0] ^= 1;
    if (corruption === "zero namespace") bytes.fill(0, 24, 56);
    if (corruption === "wrong account") bytes[8] ^= 1;
    await env.CONTROL.put(original.key, bytes, {
      ...(corruption === "missing checksum" ? {} : { sha256: await crypto.subtle.digest("SHA-256", bytes) }),
      httpMetadata: { contentType: "application/vnd.aicharts.namespace-v1" },
      customMetadata: corruption === "extra metadata" ? { schemaVersion: "1", chat: "transcript-canary" } : { schemaVersion: "1" },
    });
    const corruptVersion = (await env.CONTROL.head(original.key))?.version;
    const result = await accountStub().namespaceForEnrollment(proof);
    expect(result.ok).toBe(false);
    privateProjection(result, [namespace.namespaceKey]);
    expect((await env.CONTROL.head(original.key))?.version).toBe(corruptVersion);
    const retained = await env.CONTROL.get(original.key);
    if (retained === null) throw new Error("synthetic corrupt anchor was removed");
    expect(new Uint8Array(await retained.arrayBuffer())).toEqual(bytes);
  });

  test("an immediate empty-chunk anchor stream is cancelled without a renewable timeout", async () => {
    await reserved();
    success(await accountStub().enroll(proof));
    let pulls = 0;
    let cancellations = 0;
    const bucket = bucketReplies({ get: async (target, key) => {
      const object = await target.get(key);
      if (object === null) throw new Error("synthetic anchor missing");
      await object.body.cancel();
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { pulls++; controller.enqueue(new Uint8Array()); },
        cancel() { cancellations++; },
      });
      return new Proxy(object, { get(targetObject, property) {
        if (property === "body") return body;
        const value: unknown = Reflect.get(targetObject, property, targetObject);
        return typeof value === "function" ? value.bind(targetObject) : value;
      } });
    } });
    const result = await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      try { return await instance.namespaceForEnrollment(proof); } finally { restore(); }
    });
    expect(result).toEqual({ ok: false, error: "storage_unavailable" });
    expect(pulls).toBeLessThanOrEqual(2);
    expect(cancellations).toBe(1);
    expect((await accountStub().namespaceForEnrollment(proof)).ok).toBe(true);
  });

  test("lost anchor readback after commit does not produce a receipt and reconciles without overwrite", async () => {
    await reserved();
    let committedReads = 0;
    const bucket = bucketReplies({ get: async (target, key) => {
      const object = await target.get(key);
      if (object !== null) {
        committedReads++;
        await object.body.cancel();
        throw new Error("private-provider-failure-canary");
      }
      return object;
    } });
    const failed = await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      try { return await instance.enroll(proof); } finally { restore(); }
    });
    expect(failed).toEqual({ ok: false, error: "storage_unavailable" });
    expect(committedReads).toBe(1);
    expect(await accountPayload()).toMatchObject({ phase: "pending", devices: [] });
    const original = await anchor();
    await abortAllDurableObjects();
    expect((await accountStub().enroll(proof)).ok).toBe(true);
    expect(await anchor()).toEqual(original);
  });

  test("a different authoritative reservation for an enrolled intent cannot replace its receipt", async () => {
    const reservation = await reserved();
    const enrolled = success(await accountStub().enroll(proof));
    const namespace = success(await accountStub().namespaceForEnrollment(proof));
    const original = await anchor();
    await runInDurableObject(accountStub(), async instance => {
      const pairings = pairingReplies(() => ({ ok: true, value: { ...reservation, reservationId: OTHER } }));
      const restore = replaceEnvironment(instance, originalEnv => ({ ...originalEnv, PAIRINGS: pairings }));
      try {
        for (const method of ["enroll", "namespaceForEnrollment", "revokeEnrollment"] as const) {
          const result = await instance[method](proof);
          expect(result).toEqual({ ok: false, error: "conflict" });
          privateProjection(result, [namespace.namespaceKey]);
        }
      } finally { restore(); }
    });
    expect(await accountStub().enroll(proof)).toEqual({ ok: true, value: enrolled });
    expect(await anchor()).toEqual(original);
  });

  test("missing control storage still permits non-secret receipt readback and self-revocation", async () => {
    const reservation = await reserved(proof, ACCOUNT, NOW + 30_000);
    const enrolled = success(await accountStub().enroll(proof));
    const original = await anchor();
    await env.CONTROL.delete(original.key);
    vi.setSystemTime(reservation.expiresAtMs);
    await abortAllDurableObjects();
    expect(await accountStub().enroll(proof)).toEqual({ ok: true, value: enrolled });
    const revoked = { ok: true, value: { receipt: enrolled.receipt, deviceState: "revoked" } };
    expect(await accountStub().revokeEnrollment(proof)).toEqual(revoked);
    expect(await accountStub().enroll(proof)).toEqual(revoked);
    expect((await accountStub().namespaceForEnrollment(proof)).ok).toBe(false);
    expect((await env.CONTROL.list()).objects).toEqual([]);
  });

  test.each(["changed device ID", "missing genesis device"] as const)("valid-shape state with %s is rejected without identity repair", async corruption => {
    await reserved();
    success(await accountStub().enroll(proof));
    const secondProof = { ...proof, intentId: SECOND_ID };
    await reserved(secondProof);
    success(await accountStub().enroll(secondProof));
    const original = await anchor();
    const payload = await accountPayload();
    if (!Array.isArray(payload.devices) || payload.devices.length !== 2) throw new Error("synthetic devices missing");
    if (corruption === "missing genesis device") payload.devices = payload.devices.slice(1);
    else {
      const device: unknown = payload.devices[1];
      if (device === null || typeof device !== "object" || Array.isArray(device)) throw new Error("synthetic device malformed");
      payload.devices[1] = { ...device, deviceId: OTHER };
    }
    const corrupted = JSON.stringify(payload);
    await runInDurableObject(accountStub(), (_instance, state) => state.storage.sql.exec("UPDATE account_enrollment SET payload = ?", corrupted).toArray());
    await abortAllDurableObjects();
    for (const input of [proof, secondProof]) {
      for (const method of ["enroll", "namespaceForEnrollment", "revokeEnrollment"] as const) {
        expect(await accountStub()[method](input)).toEqual({ ok: false, error: "storage_invalid" });
      }
    }
    expect((await accountRow()).payload).toBe(corrupted);
    expect(await anchor()).toEqual(original);
  });

  test("existing receipt readback persists its successful observation then rejects clock regression", async () => {
    await reserved();
    success(await accountStub().enroll(proof));
    const before = await accountRow();
    vi.setSystemTime(NOW + 1_000);
    const pairings = pairingReplies(result => {
      let reads = 0;
      vi.spyOn(Date, "now").mockImplementation(() => ++reads === 1 ? NOW + 1_000 : NOW + 500);
      return result;
    });
    const result = await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, PAIRINGS: pairings }));
      try { return await instance.enroll(proof); } finally { restore(); }
    });
    vi.restoreAllMocks();
    vi.setSystemTime(NOW + 1_000);
    expect(result).toEqual({ ok: false, error: "clock_regressed" });
    if (typeof before.payload !== "string" || typeof before.revision !== "number") throw new Error("synthetic missing account");
    expect(await accountRow()).toEqual({ ...before, revision: before.revision + 1,
      payload: JSON.stringify({ ...JSON.parse(before.payload) as Record<string, unknown>, observedAtMs: NOW + 1_000 }) });
    await runInDurableObject(accountStub(), (_instance, state) => {
      expect(state.storage.sql.exec("SELECT observed_at_ms FROM usage_admission_control").one().observed_at_ms).toBe(NOW + 1_000);
    });
  });

  test("extra symbols, accessors and invalid RPC disposal descriptors never widen the grant schema", async () => {
    const reservation = await reserved();
    let getterCalls = 0;
    const replies: unknown[] = [
      { ok: true, value: reservation, [Symbol("private-provider-failure-canary")]: 1 },
      Object.defineProperty({ ok: true, value: reservation }, Symbol.dispose, { value: 7 }),
      Object.defineProperty({ ok: true, value: reservation }, Symbol.dispose, { get() { getterCalls++; return () => {}; } }),
      Object.defineProperty({ ok: true }, "value", { get() { getterCalls++; return reservation; } }),
      { ok: true, value: { ...reservation, [Symbol.dispose]: () => {} } },
    ];
    for (const reply of replies) {
      const result = await runInDurableObject(accountStub(), async instance => {
        const restore = replaceEnvironment(instance, original => ({ ...original, PAIRINGS: pairingReplies(() => reply) }));
        try { return await instance.enroll(proof); } finally { restore(); }
      });
      expect(result).toEqual({ ok: false, error: "storage_unavailable" });
      privateProjection(result);
    }
    expect(getterCalls).toBe(0);
    expect((await env.CONTROL.list()).objects).toEqual([]);
  });

  test.each(["success", "failure", "malformed"] as const)("immediate %s reservation replies release their RPC custody exactly once", async mode => {
    const reservation = await reserved();
    let disposals = 0;
    const pairings = pairingReplies(raw => {
      const descriptor = Object.getOwnPropertyDescriptor(raw, Symbol.dispose);
      if (descriptor === undefined || typeof descriptor.value !== "function") throw new Error("synthetic RPC disposer missing");
      const reply = mode === "failure" ? { ok: false, error: "not_reserved" }
        : mode === "malformed" ? { ok: true, value: { ...reservation, chat: "transcript-canary" } }
          : { ok: true, value: reservation };
      return Object.defineProperty(reply, Symbol.dispose, { value: () => {
        disposals++;
        Reflect.apply(descriptor.value, raw, []);
      } });
    });
    const result = await runInDurableObject(accountStub(), async instance => {
      const restore = replaceEnvironment(instance, original => ({ ...original, PAIRINGS: pairings }));
      try { return await instance.enroll(proof); } finally { restore(); }
    });
    expect(disposals).toBe(1);
    if (mode === "success") expect(result.ok).toBe(true);
    else expect(result).toEqual({ ok: false, error: mode === "failure" ? "not_reserved" : "storage_unavailable" });
    privateProjection(result);
    expect((await env.CONTROL.list()).objects).toHaveLength(mode === "success" ? 1 : 0);
  });

  test("a timed-out reservation reply is later disposed without continuing enrollment", async () => {
    const reservation = await reserved();
    const arrived = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const disposed = Promise.withResolvers<void>();
    let disposals = 0;
    let rpcCalls = 0;
    const pairings = pairingReplies(async raw => {
      rpcCalls++;
      const descriptor = Object.getOwnPropertyDescriptor(raw, Symbol.dispose);
      if (descriptor === undefined || typeof descriptor.value !== "function") throw new Error("synthetic RPC disposer missing");
      arrived.resolve();
      await release.promise;
      return Object.defineProperty({ ok: true, value: reservation }, Symbol.dispose, { value: () => {
        disposals++;
        Reflect.apply(descriptor.value, raw, []);
        disposed.resolve();
      } });
    });
    await runInDurableObject(accountStub(), async (instance, state) => {
      const restore = replaceEnvironment(instance, original => ({ ...original, PAIRINGS: pairings }));
      try {
        // The fault wrapper owns an already-returned real RPC result. Keep its
        // owning test invocation alive through disposal while proving that the
        // enrollment method itself returns before the delayed reply is released.
        const operation = instance.enroll(proof);
        await arrived.promise;
        try {
          expect(await operation).toEqual({ ok: false, error: "storage_unavailable" });
          expect(disposals).toBe(0);
          expect(rpcCalls).toBe(1);
          expect((await env.CONTROL.list()).objects).toEqual([]);
          expect(state.storage.sql.exec("SELECT revision, payload FROM account_enrollment").one()).toMatchObject({ revision: 0, payload: null });
        } finally { release.resolve(); }
        await disposed.promise;
        expect(disposals).toBe(1);
        expect(state.storage.sql.exec("SELECT revision, payload FROM account_enrollment").one()).toMatchObject({ revision: 0, payload: null });
      } finally { restore(); }
    });
    expect(await accountRow()).toMatchObject({ revision: 0, payload: null });
    expect((await env.CONTROL.list()).objects).toEqual([]);
    // Only an explicit fresh call, not delivery of the late response, can enroll.
    expect((await accountStub().enroll(proof)).ok).toBe(true);
  });

  test("revocation during anchor read withholds a namespace at the final transaction", async () => {
    await reserved();
    const enrolled = success(await accountStub().enroll(proof));
    const namespace = success(await accountStub().namespaceForEnrollment(proof));
    const result = await runInDurableObject(accountStub(), async instance => {
      const bucket = bucketReplies({ get: async (target, key) => {
        const object = await target.get(key);
        expect(await instance.revokeEnrollment(proof)).toEqual({ ok: true, value: { receipt: enrolled.receipt, deviceState: "revoked" } });
        return object;
      } });
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      try { return await instance.namespaceForEnrollment(proof); } finally { restore(); }
    });
    expect(result).toEqual({ ok: false, error: "revoked" });
    privateProjection(result, [namespace.namespaceKey]);
    expect(await accountStub().enroll(proof)).toEqual({ ok: true, value: { receipt: enrolled.receipt, deviceState: "revoked" } });
  });

  test("concurrent first-device attempts retain one device and one anchor with exact retry readback", async () => {
    await reserved();
    const results = await Promise.all(Array.from({ length: 3 }, () => accountStub().enroll(proof)));
    expect(results.some(result => result.ok)).toBe(true);
    const original = await anchor();
    const enrolled = success(await accountStub().enroll(proof));
    for (const result of results) {
      if (result.ok) expect(result.value).toEqual(enrolled);
      else expect(["conflict", "recovery_required", "storage_unavailable"]).toContain(result.error);
    }
    expect(await accountPayload()).toMatchObject({ phase: "active", devices: [expect.objectContaining({ deviceId: enrolled.receipt.deviceId })] });
    expect(success(await accountStub().namespaceForEnrollment(proof)).receipt).toEqual(enrolled.receipt);
    expect(await anchor()).toEqual(original);
  });

  test("expired pending genesis cannot be finished by an unrelated fresh reservation", async () => {
    const firstReservation = await reserved(proof, ACCOUNT, NOW + 30_000);
    const failed = await runInDurableObject(accountStub(), async instance => {
      const bucket = bucketReplies({ put: async (target, args) => {
        await target.put(...args);
        throw new Error("private-provider-failure-canary");
      } });
      const restore = replaceEnvironment(instance, original => ({ ...original, CONTROL: bucket }));
      try { return await instance.enroll(proof); } finally { restore(); }
    });
    expect(failed).toEqual({ ok: false, error: "storage_unavailable" });
    const pending = await accountPayload();
    const original = await anchor();
    expect(pending).toMatchObject({ phase: "pending", devices: [] });
    vi.setSystemTime(firstReservation.expiresAtMs);
    const freshProof = { ...proof, intentId: SECOND_ID };
    await reserved(freshProof);
    await abortAllDurableObjects();
    expect(await accountStub().enroll(proof)).toEqual({ ok: false, error: "expired" });
    expect(await accountStub().enroll(freshProof)).toEqual({ ok: false, error: "recovery_required" });
    expect((await accountStub().namespaceForEnrollment(proof)).ok).toBe(false);
    expect((await accountStub().namespaceForEnrollment(freshProof)).ok).toBe(false);
    expect(await accountPayload()).toMatchObject({ phase: "pending", devices: [], anchor: pending.anchor });
    expect(await anchor()).toEqual(original);
  });
});
