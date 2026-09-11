import { env } from "cloudflare:workers";
import { abortAllDurableObjects, evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fc from "fast-check";
import { MAX_BROWSER_ATTEMPTS, MAX_FAILED_ATTEMPTS, PAIRING_TTL_MS, POLL_INTERVAL_MS, uploadSecretCommitment } from "../src/pairing";

const ID = "11".repeat(32);
const POLL = "22".repeat(32);
const UPLOAD = "33".repeat(32);
const NONCE = "44".repeat(32);
const OTHER = "55".repeat(32);
const ACCOUNT = `acct_${"aa".repeat(16)}`;
const OTHER_ACCOUNT = `acct_${"bb".repeat(16)}`;
const NOW = Date.UTC(2026, 8, 10, 12, 0, 0, 456);
const stub = () => env.PAIRINGS.getByName(ID);
const pollInput = { intentId: ID, pollSecret: POLL };
const enrollmentInput = { ...pollInput, uploadSecret: UPLOAD };

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(async () => { vi.useRealTimers(); await reset(); });

async function initialize() {
  const commitment = await uploadSecretCommitment(ID, UPLOAD);
  if (!commitment.ok) throw new Error("synthetic commitment failed");
  const input = { ...pollInput, uploadCommitment: commitment.value };
  expect(await stub().initialize(input)).toEqual({ ok: true, value: { expiresAtMs: NOW + PAIRING_TTL_MS } });
  return input;
}

async function browser() {
  const attempt = await stub().beginBrowserAttempt({ intentId: ID, browserNonce: NONCE });
  if (!attempt.ok) throw new Error(`synthetic attempt failed: ${attempt.error}`);
  return { intentId: ID, attemptId: attempt.value.attemptId, browserNonce: NONCE, contextToken: attempt.value.contextToken };
}

async function authenticated() {
  const proof = await browser();
  const authentication = { ...proof, accountId: ACCOUNT, authTimeMs: Math.floor(NOW / 1_000) * 1_000, sessionExpiresAtMs: NOW + PAIRING_TTL_MS };
  expect(await stub().recordVerifiedAuthentication(authentication)).toEqual({ ok: true, value: { recorded: true } });
  return { proof, authentication };
}

function decisionInput(proof: Awaited<ReturnType<typeof browser>>, decision: "approve" | "deny" = "approve") {
  return { ...proof, accountId: ACCOUNT, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision };
}

async function retainedPayload(): Promise<unknown> {
  const value = await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT payload FROM pairing_state").one().payload);
  if (typeof value !== "string") throw new Error("synthetic state missing");
  return JSON.parse(value) as unknown;
}

function fixtureRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("synthetic record missing");
  return value as Record<string, unknown>;
}

async function retainedRow() {
  return await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT schema_version, revision, payload FROM pairing_state").one());
}

async function legacyFixture() {
  const legacy = Object.fromEntries(Object.entries(fixtureRecord(await retainedPayload())).filter(([key]) => key !== "enrollment"));
  await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE pairing_state SET schema_version = 1, payload = ?", JSON.stringify(legacy)).toArray());
  return { legacy, row: await retainedRow() };
}

async function confirmed(authenticationExpiresAtMs = NOW + PAIRING_TTL_MS) {
  await initialize();
  const proof = await browser();
  expect(await stub().recordVerifiedAuthentication({ ...proof, accountId: ACCOUNT,
    authTimeMs: Math.floor(NOW / 1_000) * 1_000, sessionExpiresAtMs: authenticationExpiresAtMs,
  })).toEqual({ ok: true, value: { recorded: true } });
  expect((await stub().decideBrowser(decisionInput(proof))).ok).toBe(true);
  expect((await stub().confirm({ ...pollInput, accountId: ACCOUNT })).ok).toBe(true);
  return proof;
}

describe("internal pairing lifecycle, with no credential activation", () => {
  test("uninitialized polling fails closed", async () => {
    expect(await stub().poll(pollInput)).toEqual({ ok: false, error: "not_initialized" });
  });

  test("initialization replays without extending expiry or replacing commitments", async () => {
    const input = await initialize();
    vi.setSystemTime(NOW + 30_000);
    await abortAllDurableObjects();
    expect(await stub().initialize(input)).toEqual({ ok: true, value: { expiresAtMs: NOW + PAIRING_TTL_MS } });
    expect(await stub().initialize({ ...input, uploadCommitment: OTHER })).toEqual({ ok: false, error: "conflict" });
    expect(await stub().initialize({ ...input, intentId: OTHER })).toEqual({ ok: false, error: "conflict" });
  });

  test("concurrent initialization retains exactly one immutable commitment set", async () => {
    const commitment = await uploadSecretCommitment(ID, UPLOAD);
    if (!commitment.ok) throw new Error("synthetic commitment failed");
    const original = { ...pollInput, uploadCommitment: commitment.value };
    const alternate = { ...original, uploadCommitment: OTHER };
    const results = await Promise.all([stub().initialize(original), stub().initialize(alternate)]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok && result.error === "conflict")).toHaveLength(1);
    await abortAllDurableObjects();
    expect((await stub().initialize(results[0].ok ? original : alternate)).ok).toBe(true);
  });

  test("independent secret domains cannot substitute for each other", async () => {
    const reused = await uploadSecretCommitment(ID, POLL);
    if (!reused.ok) throw new Error("synthetic hash failed");
    expect(await stub().initialize({ ...pollInput, uploadCommitment: reused.value })).toEqual({ ok: false, error: "invalid_input" });
    const initialized = await initialize();
    expect(await stub().poll({ intentId: ID, pollSecret: UPLOAD })).toEqual({ ok: false, error: "unauthorized" });
    expect(await stub().poll({ intentId: ID, pollSecret: initialized.uploadCommitment })).toEqual({ ok: false, error: "unauthorized" });
    expect((await stub().poll(pollInput)).ok).toBe(true);
  });

  test("poll throttling survives graceful eviction at its exact boundary", async () => {
    await initialize();
    expect(await stub().poll(pollInput)).toEqual({ ok: true, value: { state: "pending", expiresAtMs: NOW + PAIRING_TTL_MS, pollAfterMs: POLL_INTERVAL_MS, approvedAccountId: null } });
    await evictDurableObject(stub());
    vi.setSystemTime(NOW + POLL_INTERVAL_MS - 1);
    expect(await stub().poll(pollInput)).toEqual({ ok: false, error: "throttled" });
    vi.setSystemTime(NOW + POLL_INTERVAL_MS);
    expect((await stub().poll(pollInput)).ok).toBe(true);
  });

  test("expiry is enforced without an alarm and cannot reopen after clock regression", async () => {
    await initialize();
    vi.setSystemTime(NOW + PAIRING_TTL_MS);
    expect(await stub().poll(pollInput)).toEqual({ ok: false, error: "expired" });
    await abortAllDurableObjects();
    expect(await stub().beginBrowserAttempt({ intentId: ID, browserNonce: NONCE })).toEqual({ ok: false, error: "expired" });
    vi.setSystemTime(NOW);
    expect(await stub().poll(pollInput)).toEqual({ ok: false, error: "clock_regressed" });
  });

  test("failed proofs persist and deny after a bounded count", async () => {
    await initialize();
    for (let index = 0; index < MAX_FAILED_ATTEMPTS; index++) {
      expect(await stub().poll({ intentId: ID, pollSecret: OTHER })).toEqual({ ok: false, error: "unauthorized" });
      await abortAllDurableObjects();
    }
    const result = await stub().poll(pollInput);
    expect(result.ok && result.value.state).toBe("denied");
    expect(await stub().beginBrowserAttempt({ intentId: ID, browserNonce: NONCE })).toEqual({ ok: false, error: "invalid_transition" });
  });

  test("browser attempts are bounded and replacement invalidates earlier capabilities", async () => {
    await initialize();
    const first = await browser();
    for (let index = 1; index < MAX_BROWSER_ATTEMPTS; index++) await browser();
    await abortAllDurableObjects();
    expect(await stub().beginBrowserAttempt({ intentId: ID, browserNonce: NONCE })).toEqual({ ok: false, error: "attempt_limit" });
    expect(await stub().decideBrowser(decisionInput(first, "deny"))).toEqual({ ok: false, error: "unauthorized" });
  });

  test("no authentication, a switched account or another browser cannot approve", async () => {
    await initialize();
    const proof = await browser();
    expect(await stub().decideBrowser(decisionInput(proof))).toEqual({ ok: false, error: "invalid_transition" });
    const { proof: active } = await authenticated();
    expect(await stub().decideBrowser({ ...decisionInput(active), accountId: OTHER_ACCOUNT })).toEqual({ ok: false, error: "unauthorized" });
    expect(await stub().decideBrowser({ ...decisionInput(active), browserNonce: OTHER })).toEqual({ ok: false, error: "unauthorized" });
    expect(await stub().decideBrowser({ ...decisionInput(active), contextToken: OTHER })).toEqual({ ok: false, error: "unauthorized" });
  });

  test("authentication records require fresh integer-second auth_time and live expiry", async () => {
    await initialize();
    const proof = await browser();
    const auth = { ...proof, accountId: ACCOUNT, authTimeMs: Math.floor(NOW / 1_000) * 1_000, sessionExpiresAtMs: NOW + 60_000 };
    for (const change of [{ authTimeMs: auth.authTimeMs - 1_000 }, { authTimeMs: auth.authTimeMs + 1_000 }, { sessionExpiresAtMs: NOW }]) {
      expect(await stub().recordVerifiedAuthentication({ ...auth, ...change })).toEqual({ ok: false, error: "authentication_not_fresh" });
    }
    for (const authTimeMs of [NOW, NaN, Infinity, -1]) {
      expect(await stub().recordVerifiedAuthentication({ ...auth, authTimeMs })).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(await stub().recordVerifiedAuthentication(auth)).toEqual({ ok: true, value: { recorded: true } });
  });

  test("concurrent authentication records bind one account and replay only exact facts", async () => {
    await initialize();
    const proof = await browser();
    const auth = { ...proof, accountId: ACCOUNT, authTimeMs: Math.floor(NOW / 1_000) * 1_000, sessionExpiresAtMs: NOW + 60_000 };
    const results = await Promise.all([stub().recordVerifiedAuthentication(auth), stub().recordVerifiedAuthentication({ ...auth, accountId: OTHER_ACCOUNT })]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok && result.error === "conflict")).toHaveLength(1);
    const winning = results[0].ok ? auth : { ...auth, accountId: OTHER_ACCOUNT };
    await abortAllDurableObjects();
    expect(await stub().recordVerifiedAuthentication(winning)).toEqual({ ok: true, value: { recorded: true } });
    expect(await stub().recordVerifiedAuthentication({ ...winning, sessionExpiresAtMs: NOW + 90_000 })).toEqual({ ok: false, error: "conflict" });
  });

  test("approval and account confirmation survive lost replies and restart", async () => {
    await initialize();
    const { proof } = await authenticated();
    const approve = decisionInput(proof);
    const first = await stub().decideBrowser(approve);
    expect(first.ok && first.value.state).toBe("browser-approved");
    await abortAllDurableObjects();
    expect(await stub().decideBrowser(approve)).toEqual(first);
    expect(await stub().confirm({ ...pollInput, accountId: OTHER_ACCOUNT })).toEqual({ ok: false, error: "unauthorized" });
    const confirmed = await stub().confirm({ ...pollInput, accountId: ACCOUNT });
    expect(confirmed.ok && confirmed.value.state).toBe("terminal-confirmed");
    await evictDurableObject(stub());
    expect(await stub().confirm({ ...pollInput, accountId: ACCOUNT })).toEqual(confirmed);
    expect(await stub().decideBrowser(decisionInput(proof, "deny"))).toEqual({ ok: false, error: "invalid_transition" });
    expect((await env.STAGING.list()).objects).toEqual([]);
    expect(JSON.stringify(confirmed)).not.toMatch(/credential|namespace|token|secret/i);
  });

  test("expired authenticated session cannot approve or confirm", async () => {
    await initialize();
    const proof = await browser();
    expect((await stub().recordVerifiedAuthentication({ ...proof, accountId: ACCOUNT, authTimeMs: Math.floor(NOW / 1_000) * 1_000, sessionExpiresAtMs: NOW + 10_000 })).ok).toBe(true);
    expect((await stub().decideBrowser(decisionInput(proof))).ok).toBe(true);
    vi.setSystemTime(NOW + 10_000);
    expect(await stub().decideBrowser(decisionInput(proof))).toEqual({ ok: false, error: "authentication_not_fresh" });
    expect(await stub().confirm({ ...pollInput, accountId: ACCOUNT })).toEqual({ ok: false, error: "authentication_not_fresh" });
  });

  test("denial is terminal and cannot be overwritten by a raced approval", async () => {
    await initialize();
    const { proof } = await authenticated();
    expect((await stub().decideBrowser(decisionInput(proof, "deny"))).ok).toBe(true);
    await abortAllDurableObjects();
    expect(await stub().decideBrowser(decisionInput(proof))).toEqual({ ok: false, error: "invalid_transition" });
    expect(await stub().confirm({ ...pollInput, accountId: ACCOUNT })).toEqual({ ok: false, error: "invalid_transition" });
  });

  test("browser readback projects only the current attempt's recorded account and expiry", async () => {
    await initialize();
    const proof = await browser();
    const pending = { state: "pending", expiresAtMs: NOW + PAIRING_TTL_MS, accountId: null, authenticationExpiresAtMs: null };
    expect(await stub().browserStatus(proof)).toEqual({ ok: true, value: pending });
    await stub().recordVerifiedAuthentication({ ...proof, accountId: ACCOUNT, authTimeMs: Math.floor(NOW / 1_000) * 1_000, sessionExpiresAtMs: NOW + 60_000 });
    const recorded = { ...pending, accountId: ACCOUNT, authenticationExpiresAtMs: NOW + 60_000 };
    expect(await stub().browserStatus(proof)).toEqual({ ok: true, value: recorded });
    await abortAllDurableObjects();
    expect(await stub().browserStatus(proof)).toEqual({ ok: true, value: recorded });
    expect(await retainedPayload()).toMatchObject({ status: "pending", failedAttempts: 0, approvedAccountId: null });
    expect(JSON.stringify(recorded)).not.toMatch(/nonce|proof|commitment|secret|token|credential|namespace/i);
    expect((await env.STAGING.list()).objects).toEqual([]);
  });

  test("uninitialized and stale browser readback cannot reveal another account or exhaust guesses", async () => {
    const missing = { intentId: ID, attemptId: OTHER, browserNonce: NONCE, contextToken: OTHER };
    expect(await stub().browserStatus(missing)).toEqual({ ok: false, error: "not_initialized" });
    await initialize();
    const { proof: stale } = await authenticated();
    const { proof: current } = await authenticated();
    for (let index = 0; index <= MAX_FAILED_ATTEMPTS; index++) {
      expect(await stub().browserStatus(stale)).toEqual({ ok: false, error: "unauthorized" });
      expect(await stub().decideBrowser(decisionInput(stale, index % 2 === 0 ? "approve" : "deny"))).toEqual({ ok: false, error: "unauthorized" });
    }
    for (const change of [{ intentId: OTHER }, { attemptId: OTHER }, { browserNonce: OTHER }, { contextToken: OTHER }]) {
      expect(await stub().browserStatus({ ...current, ...change })).toEqual({ ok: false, error: "unauthorized" });
    }
    expect(await retainedPayload()).toMatchObject({ status: "pending", failedAttempts: 0, approvedAccountId: null });
    expect((await stub().decideBrowser(decisionInput(current))).ok).toBe(true);
  });

  test.each(["approve", "deny"] as const)("%s requires recorded authentication and the same live account without spending guesses", async decision => {
    await initialize();
    const proof = await browser();
    expect(await stub().decideBrowser(decisionInput(proof, decision))).toEqual({ ok: false, error: "invalid_transition" });
    const { proof: current } = await authenticated();
    for (let index = 0; index <= MAX_FAILED_ATTEMPTS; index++) {
      expect(await stub().decideBrowser({ ...decisionInput(current, decision), accountId: OTHER_ACCOUNT })).toEqual({ ok: false, error: "unauthorized" });
    }
    expect(await retainedPayload()).toMatchObject({ status: "pending", failedAttempts: 0, approvedAccountId: null });
    expect((await stub().decideBrowser(decisionInput(current, decision))).ok).toBe(true);
  });

  test.each(["approve", "deny"] as const)("%s rechecks both independent session deadlines at the durable commit", async decision => {
    for (const limit of ["recorded", "live"] as const) {
      await reset();
      vi.setSystemTime(NOW);
      await initialize();
      const proof = await browser();
      const expiresAtMs = NOW + 10_000;
      await stub().recordVerifiedAuthentication({
        ...proof, accountId: ACCOUNT, authTimeMs: Math.floor(NOW / 1_000) * 1_000,
        sessionExpiresAtMs: limit === "recorded" ? expiresAtMs : NOW + PAIRING_TTL_MS,
      });
      const input = { ...decisionInput(proof, decision), liveSessionExpiresAtMs: limit === "live" ? expiresAtMs : NOW + PAIRING_TTL_MS };
      // The caller obtained a live session before transport/hash work. Advance
      // time only after the actual DO method has entered its async hash boundary.
      const result = await runInDurableObject(stub(), async instance => {
        const operation = instance.decideBrowser(input);
        vi.setSystemTime(expiresAtMs);
        return await operation;
      });
      expect(result).toEqual({ ok: false, error: "authentication_not_fresh" });
      expect(await retainedPayload()).toMatchObject({ status: "pending", failedAttempts: 0, approvedAccountId: null });
    }
  });

  test.each(["approve", "deny"] as const)("%s rejects expired live-session inputs without changing a prior decision", async decision => {
    await initialize();
    const { proof } = await authenticated();
    expect((await stub().decideBrowser(decisionInput(proof))).ok).toBe(true);
    for (const liveSessionExpiresAtMs of [NOW - 1, NOW]) {
      expect(await stub().decideBrowser({ ...decisionInput(proof, decision), liveSessionExpiresAtMs })).toEqual({ ok: false, error: "authentication_not_fresh" });
    }
    expect(await retainedPayload()).toMatchObject({ status: "browser-approved", approvedAccountId: ACCOUNT, failedAttempts: 0 });
  });

  test.each(["approve", "deny"] as const)("%s reply loss is reconciled by readback and exact live replay", async decision => {
    await initialize();
    const { proof } = await authenticated();
    const input = decisionInput(proof, decision);
    await expect((async () => {
      const committed = await stub().decideBrowser(input);
      expect(committed.ok).toBe(true);
      throw new Error("synthetic reply lost after commit");
    })()).rejects.toThrow("synthetic reply lost after commit");
    await abortAllDurableObjects();
    const expected = { ok: true, value: { state: decision === "approve" ? "browser-approved" : "denied", expiresAtMs: NOW + PAIRING_TTL_MS, accountId: ACCOUNT, authenticationExpiresAtMs: NOW + PAIRING_TTL_MS } };
    expect(await stub().browserStatus(proof)).toEqual(expected);
    expect(await stub().decideBrowser(input)).toEqual(expected);
    if (decision === "deny") expect(await stub().decideBrowser(decisionInput(proof))).toEqual({ ok: false, error: "invalid_transition" });
    expect((await env.STAGING.list()).objects).toEqual([]);
  });

  test("terminal confirmation survives browser approval replay and rejects browser denial", async () => {
    await initialize();
    const { proof } = await authenticated();
    await stub().decideBrowser(decisionInput(proof));
    await stub().confirm({ ...pollInput, accountId: ACCOUNT });
    const expected = { ok: true, value: { state: "terminal-confirmed", expiresAtMs: NOW + PAIRING_TTL_MS, accountId: ACCOUNT, authenticationExpiresAtMs: NOW + PAIRING_TTL_MS } };
    expect(await stub().browserStatus(proof)).toEqual(expected);
    expect(await stub().decideBrowser(decisionInput(proof))).toEqual(expected);
    expect(await stub().decideBrowser(decisionInput(proof, "deny"))).toEqual({ ok: false, error: "invalid_transition" });
    vi.setSystemTime(NOW + PAIRING_TTL_MS);
    expect(await stub().browserStatus(proof)).toEqual(expected);
    expect(await stub().decideBrowser(decisionInput(proof))).toEqual({ ok: false, error: "expired" });
  });

  test("expired readback preserves recorded evidence but cannot approve or deny", async () => {
    await initialize();
    const { proof } = await authenticated();
    vi.setSystemTime(NOW + PAIRING_TTL_MS);
    expect(await stub().browserStatus(proof)).toEqual({ ok: true, value: { state: "expired", expiresAtMs: NOW + PAIRING_TTL_MS, accountId: ACCOUNT, authenticationExpiresAtMs: NOW + PAIRING_TTL_MS } });
    for (const decision of ["approve", "deny"] as const) {
      expect(await stub().decideBrowser(decisionInput(proof, decision))).toEqual({ ok: false, error: "expired" });
    }
    await abortAllDurableObjects();
    vi.setSystemTime(NOW);
    expect(await stub().browserStatus(proof)).toEqual({ ok: false, error: "clock_regressed" });
  });

  test("concurrent opposing decisions cannot resurrect a denied attempt", async () => {
    await initialize();
    const { proof } = await authenticated();
    const decisions = await Promise.all([stub().decideBrowser(decisionInput(proof)), stub().decideBrowser(decisionInput(proof, "deny"))]);
    expect(decisions[1].ok).toBe(true);
    expect(await stub().browserStatus(proof)).toMatchObject({ ok: true, value: { state: "denied", accountId: ACCOUNT } });
    expect(await stub().decideBrowser(decisionInput(proof))).toEqual({ ok: false, error: "invalid_transition" });
  });

  test("decision ordering follows the terminal state law for arbitrary replay sequences", async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom("approve" as const, "deny" as const, "confirm" as const), { minLength: 1, maxLength: 12 }), async sequence => {
      await reset();
      vi.setSystemTime(NOW);
      await initialize();
      const { proof } = await authenticated();
      let expected: "pending" | "browser-approved" | "terminal-confirmed" | "denied" = "pending";
      for (const action of sequence) {
        const previous = expected;
        if (action === "deny" && expected !== "terminal-confirmed") expected = "denied";
        if (action === "approve" && expected === "pending") expected = "browser-approved";
        if (action === "confirm" && expected === "browser-approved") expected = "terminal-confirmed";
        const permitted = action === "deny" ? previous !== "terminal-confirmed"
          : action === "approve" ? previous !== "denied"
          : previous === "browser-approved" || previous === "terminal-confirmed";
        const result = action === "confirm" ? await stub().confirm({ ...pollInput, accountId: ACCOUNT })
          : await stub().decideBrowser(decisionInput(proof, action));
        expect(result.ok).toBe(permitted);
        expect(await stub().browserStatus(proof)).toMatchObject({ ok: true, value: { state: expected } });
      }
    }), { numRuns: 50, seed: 411 });
  });

  test("foreign browser DTOs are closed and cannot add transcript fields or omit live evidence", async () => {
    await initialize();
    const { proof } = await authenticated();
    const before = await retainedPayload();
    for (const input of [null, [], "transcript-canary", {}, { ...proof, accountId: ACCOUNT }, { ...proof, chat: "transcript-canary" }]) {
      expect(await stub().browserStatus(input)).toEqual({ ok: false, error: "invalid_input" });
    }
    for (const input of [null, [], proof, { ...decisionInput(proof), chat: "transcript-canary" }, ...[
      { decision: "maybe" }, { decision: undefined }, { accountId: OTHER }, { liveSessionExpiresAtMs: undefined },
      { liveSessionExpiresAtMs: "123" }, { liveSessionExpiresAtMs: NaN }, { liveSessionExpiresAtMs: Infinity },
      { liveSessionExpiresAtMs: -1 }, { liveSessionExpiresAtMs: NOW + 0.5 },
    ].map(change => ({ ...decisionInput(proof), ...change }))]) {
      expect(await stub().decideBrowser(input)).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(await retainedPayload()).toEqual(before);
  });

  test("browser DTO snapshots survive caller mutation and reject accessors without invoking them", async () => {
    await initialize();
    const { proof } = await authenticated();
    await runInDurableObject(stub(), async instance => {
      let getterCalls = 0;
      const accessor = Object.defineProperty({ ...decisionInput(proof) }, "accountId", { get() { getterCalls++; return ACCOUNT; } });
      const proxy = new Proxy({}, { ownKeys() { throw new Error("synthetic proxy trap"); } });
      expect(await instance.decideBrowser(accessor)).toEqual({ ok: false, error: "invalid_input" });
      expect(await instance.browserStatus(proxy)).toEqual({ ok: false, error: "invalid_input" });
      expect(getterCalls).toBe(0);
      const input = decisionInput(proof);
      const operation = instance.decideBrowser(input);
      input.accountId = OTHER_ACCOUNT;
      input.liveSessionExpiresAtMs = NOW;
      input.decision = "deny";
      input.contextToken = OTHER;
      expect(await operation).toMatchObject({ ok: true, value: { state: "browser-approved", accountId: ACCOUNT } });
      const statusInput = { ...proof };
      const status = instance.browserStatus(statusInput);
      statusInput.attemptId = OTHER;
      expect(await status).toMatchObject({ ok: true, value: { state: "browser-approved", accountId: ACCOUNT } });
      expect("approve" in instance).toBe(false);
      expect("deny" in instance).toBe(false);
    });
  });

  test("extra transcript fields and malformed capability shapes are rejected without persistence", async () => {
    for (const input of [null, [], "transcript-canary", {}, { ...pollInput, chat: "transcript-canary" }, { intentId: ID, pollSecret: "0".repeat(64) }, { ...pollInput, intentId: ID.toUpperCase().replace("1", "G") }]) {
      expect(await stub().poll(input)).toEqual({ ok: false, error: "invalid_input" });
    }
    await initialize();
    const { proof } = await authenticated();
    const payload = await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT payload FROM pairing_state").one().payload);
    expect(typeof payload).toBe("string");
    for (const forbidden of [POLL, UPLOAD, NONCE, proof.contextToken, "transcript-canary"]) expect(String(payload)).not.toContain(forbidden);
  });

  test("malformed persisted payload fails closed without resetting it", async () => {
    await initialize();
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE pairing_state SET payload = ? WHERE id = 1", '{"chat":"transcript-canary"}').toArray());
    await abortAllDurableObjects();
    expect(await stub().poll(pollInput)).toEqual({ ok: false, error: "storage_invalid" });
    const retained = await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT payload FROM pairing_state").one().payload);
    expect(retained).toBe('{"chat":"transcript-canary"}');
  });

  test("unknown schema and missing initialized row are not regenerated", async () => {
    await initialize();
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE pairing_state SET schema_version = 3").toArray());
    await abortAllDurableObjects();
    expect(await stub().poll(pollInput)).toEqual({ ok: false, error: "storage_invalid" });
    await runInDurableObject(stub(), (_instance, state) => { state.storage.sql.exec("UPDATE pairing_state SET schema_version = 2"); state.storage.sql.exec("DELETE FROM pairing_state"); });
    await abortAllDurableObjects();
    expect(await stub().poll(pollInput)).toEqual({ ok: false, error: "storage_invalid" });
  });

  test("an interrupted SQLite transaction retains both the prior payload and revision", async () => {
    await initialize();
    const { proof } = await authenticated();
    const before = await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT schema_version, revision, payload FROM pairing_state").one());
    const rolledBack = await runInDurableObject(stub(), (_instance, state) => {
      try {
        state.storage.transactionSync(() => {
          state.storage.sql.exec("UPDATE pairing_state SET revision = revision + 1, payload = ?", "{}");
          throw new Error("synthetic interruption");
        });
        return false;
      } catch { return true; }
    });
    expect(rolledBack).toBe(true);
    await abortAllDurableObjects();
    const after = await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT schema_version, revision, payload FROM pairing_state").one());
    expect(after).toEqual(before);
    expect((await stub().decideBrowser(decisionInput(proof))).ok).toBe(true);
  });

  test("unexpected preexisting schema blocks bootstrap without adding a pairing row", async () => {
    await initialize();
    await runInDurableObject(stub(), (_instance, state) => state.storage.transactionSync(() => {
      state.storage.sql.exec("DROP TABLE pairing_state");
      state.storage.sql.exec("CREATE TABLE unexpected_state (marker INTEGER NOT NULL)");
      state.storage.sql.exec("INSERT INTO unexpected_state (marker) VALUES (7)");
    }));
    await abortAllDurableObjects();
    expect(await stub().poll(pollInput)).toEqual({ ok: false, error: "storage_invalid" });
    const retained = await runInDurableObject(stub(), (_instance, state) => ({
      marker: state.storage.sql.exec("SELECT marker FROM unexpected_state").one().marker,
      pairingTables: state.storage.sql.exec("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'pairing_state'").one().count,
    }));
    expect(retained).toEqual({ marker: 7, pairingTables: 0 });
  });

  test("extra schema objects fail closed without deleting otherwise valid state", async () => {
    await initialize();
    const before = await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT payload FROM pairing_state").one().payload);
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("CREATE INDEX unexpected_index ON pairing_state (revision)").toArray());
    await abortAllDurableObjects();
    expect(await stub().poll(pollInput)).toEqual({ ok: false, error: "storage_invalid" });
    const after = await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("SELECT payload FROM pairing_state").one().payload);
    expect(after).toBe(before);
  });
});

describe("immutable internal enrollment reservations", () => {
  test("readback never creates a reservation and reserve requires terminal confirmation", async () => {
    expect(await stub().reserveEnrollment(enrollmentInput)).toEqual({ ok: false, error: "not_initialized" });
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual({ ok: false, error: "not_initialized" });
    await initialize();
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual({ ok: false, error: "not_reserved" });
    expect(await stub().reserveEnrollment(enrollmentInput)).toEqual({ ok: false, error: "invalid_transition" });
    const { proof } = await authenticated();
    expect(await stub().reserveEnrollment(enrollmentInput)).toEqual({ ok: false, error: "invalid_transition" });
    expect((await stub().decideBrowser(decisionInput(proof))).ok).toBe(true);
    expect(await stub().reserveEnrollment(enrollmentInput)).toEqual({ ok: false, error: "invalid_transition" });
    expect((await stub().decideBrowser(decisionInput(proof, "deny"))).ok).toBe(true);
    expect(await stub().reserveEnrollment(enrollmentInput)).toEqual({ ok: false, error: "invalid_transition" });
    expect(fixtureRecord(await retainedPayload()).enrollment).toBeNull();
  });

  test("concurrent live reservations retain one exact grant across lost replies and eviction", async () => {
    const proof = await confirmed();
    const results = await Promise.all(Array.from({ length: 4 }, () => stub().reserveEnrollment(enrollmentInput)));
    const first = results[0];
    if (first === undefined || !first.ok) throw new Error("synthetic reservation failed");
    for (const result of results) expect(result).toEqual(first);
    expect(first.value).toEqual({
      schemaVersion: 1, intentId: ID, accountId: ACCOUNT, reservationId: expect.stringMatching(/^[0-9a-f]{64}$/u),
      pollCommitment: expect.stringMatching(/^[0-9a-f]{64}$/u), uploadCommitment: expect.stringMatching(/^[0-9a-f]{64}$/u),
      recoveryGeneration: env.USAGE_ENROLLMENT_GENERATION, reservedAtMs: NOW, expiresAtMs: NOW + PAIRING_TTL_MS,
    });
    expect(first.value.reservationId).not.toBe("0".repeat(64));
    // Simulate a committed RPC whose response is lost, then reconcile by read.
    const lostReply = async () => { await stub().reserveEnrollment(enrollmentInput); throw new Error("synthetic lost reply"); };
    await expect(lostReply()).rejects.toThrow("synthetic lost reply");
    await abortAllDurableObjects();
    vi.setSystemTime(NOW + 45_000);
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual(first);
    expect(await stub().reserveEnrollment(enrollmentInput)).toEqual(first);
    await evictDurableObject(stub());
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual(first);
    const retained = JSON.stringify(await retainedPayload());
    for (const secret of [POLL, UPLOAD, NONCE, proof.contextToken, "transcript-canary"]) {
      expect(JSON.stringify(first)).not.toContain(secret);
      expect(retained).not.toContain(secret);
    }
    expect((await env.STAGING.list()).objects).toEqual([]);
  });

  test.each([60_000, PAIRING_TTL_MS, PAIRING_TTL_MS + 60_000])("deadline is the original minimum for authentication lifetime %i", async lifetime => {
    await confirmed(NOW + lifetime);
    const result = await stub().reserveEnrollment(enrollmentInput);
    if (!result.ok) throw new Error("synthetic reservation failed");
    const deadline = NOW + Math.min(lifetime, PAIRING_TTL_MS);
    expect(result.value.expiresAtMs).toBe(deadline);
    vi.setSystemTime(deadline - 1);
    expect(await stub().reserveEnrollment(enrollmentInput)).toEqual(result);
    vi.setSystemTime(deadline);
    expect(await stub().reserveEnrollment(enrollmentInput)).toEqual({ ok: false, error: "expired" });
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual(result);
    await abortAllDurableObjects();
    vi.setSystemTime(deadline + PAIRING_TTL_MS);
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual(result);
    expect(await stub().reserveEnrollment(enrollmentInput)).toEqual({ ok: false, error: "expired" });
  });

  test("an expired unreserved intent can never use readback to mint a grant", async () => {
    await confirmed(NOW + 20_000);
    vi.setSystemTime(NOW + 20_000);
    expect(await stub().reserveEnrollment(enrollmentInput)).toEqual({ ok: false, error: "expired" });
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual({ ok: false, error: "not_reserved" });
    expect(fixtureRecord(await retainedPayload()).enrollment).toBeNull();
  });

  test("expiry is checked at the synchronous commit after secret hashing", async () => {
    await confirmed(NOW + 20_000);
    await runInDurableObject(stub(), async instance => {
      const pending = instance.reserveEnrollment(enrollmentInput);
      vi.setSystemTime(NOW + 20_000);
      expect(await pending).toEqual({ ok: false, error: "expired" });
    });
    expect(fixtureRecord(await retainedPayload()).enrollment).toBeNull();
  });

  test.each(["first hash", "second hash", "commit"] as const)("a regressed clock at %s cannot mutate or disclose a reservation", async boundary => {
    await confirmed();
    expect((await stub().reserveEnrollment(enrollmentInput)).ok).toBe(true);
    const before = await retainedRow();
    await runInDurableObject(stub(), async instance => {
      // Every mocked time is later than persisted observedAtMs; only the
      // operation's own monotonic floor can detect this regression.
      for (const readback of [false, true]) {
        const stable = NOW + 20_000;
        const regressed = stable - 1;
        const samples = boundary === "first hash" ? [stable, regressed]
          : boundary === "second hash" ? [stable, stable, regressed]
          : [stable, stable, stable, regressed];
        const clock = vi.spyOn(Date, "now").mockImplementation(() => samples.shift() ?? regressed);
        try {
          expect(await (readback ? instance.readEnrollmentReservation(enrollmentInput) : instance.reserveEnrollment(enrollmentInput)))
            .toEqual({ ok: false, error: "clock_regressed" });
        } finally { clock.mockRestore(); }
      }
    });
    expect(await retainedRow()).toEqual(before);
  });

  test("an entry after expiry cannot regress through hashing into a live reservation", async () => {
    await confirmed(NOW + 20_000);
    const before = await retainedRow();
    await runInDurableObject(stub(), async instance => {
      vi.setSystemTime(NOW + 20_000);
      const pending = instance.reserveEnrollment(enrollmentInput);
      vi.setSystemTime(NOW + 19_999);
      expect(await pending).toEqual({ ok: false, error: "clock_regressed" });
    });
    expect(await retainedRow()).toEqual(before);
  });

  test("both original independent preimages are required without consuming the guessing budget", async () => {
    await confirmed();
    const first = await stub().reserveEnrollment(enrollmentInput);
    if (!first.ok) throw new Error("synthetic reservation failed");
    for (const change of [{ pollSecret: OTHER }, { uploadSecret: OTHER }, { pollSecret: UPLOAD, uploadSecret: POLL },
      { pollSecret: first.value.pollCommitment }, { uploadSecret: first.value.uploadCommitment }]) {
      const input = { ...enrollmentInput, ...change };
      expect(await stub().reserveEnrollment(input)).toEqual({ ok: false, error: "unauthorized" });
      expect(await stub().readEnrollmentReservation(input)).toEqual({ ok: false, error: "unauthorized" });
    }
    expect(fixtureRecord(await retainedPayload()).failedAttempts).toBe(0);
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual(first);
  });

  test("a fully confirmed intent cannot reserve through an aliased Durable Object", async () => {
    const alternate = env.PAIRINGS.getByName(OTHER);
    const commitment = await uploadSecretCommitment(ID, UPLOAD);
    if (!commitment.ok) throw new Error("synthetic commitment failed");
    expect((await alternate.initialize({ ...pollInput, uploadCommitment: commitment.value })).ok).toBe(true);
    const attempt = await alternate.beginBrowserAttempt({ intentId: ID, browserNonce: NONCE });
    if (!attempt.ok) throw new Error("synthetic attempt failed");
    const proof = { intentId: ID, browserNonce: NONCE, attemptId: attempt.value.attemptId, contextToken: attempt.value.contextToken };
    expect((await alternate.recordVerifiedAuthentication({ ...proof, accountId: ACCOUNT, authTimeMs: Math.floor(NOW / 1_000) * 1_000, sessionExpiresAtMs: NOW + PAIRING_TTL_MS })).ok).toBe(true);
    expect((await alternate.decideBrowser(decisionInput(proof))).ok).toBe(true);
    expect((await alternate.confirm({ ...pollInput, accountId: ACCOUNT })).ok).toBe(true);
    expect(await alternate.reserveEnrollment(enrollmentInput)).toEqual({ ok: false, error: "unauthorized" });
    expect(await alternate.readEnrollmentReservation(enrollmentInput)).toEqual({ ok: false, error: "unauthorized" });
  });

  test("foreign DTOs cannot supply account, generation, transcript or malformed secrets", async () => {
    await confirmed();
    const before = await retainedRow();
    const inputs: unknown[] = [null, [], {}, "transcript-canary", { ...enrollmentInput, accountId: ACCOUNT },
      { ...enrollmentInput, recoveryGeneration: OTHER }, { ...enrollmentInput, chat: "transcript-canary" },
      { ...enrollmentInput, uploadSecret: POLL }, ...[undefined, 1, "0".repeat(64), "A".repeat(64), "a".repeat(65)]
        .flatMap(value => ["intentId", "pollSecret", "uploadSecret"].map(key => ({ ...enrollmentInput, [key]: value })))];
    for (const input of inputs) {
      expect(await stub().reserveEnrollment(input)).toEqual({ ok: false, error: "invalid_input" });
      expect(await stub().readEnrollmentReservation(input)).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(await retainedRow()).toEqual(before);
  });

  test("reservation inputs are snapshotted before await without invoking accessors", async () => {
    await confirmed();
    await runInDurableObject(stub(), async instance => {
      let getterCalls = 0;
      const accessor = Object.defineProperty({ ...enrollmentInput }, "uploadSecret", { get() { getterCalls++; return UPLOAD; } });
      const proxy = new Proxy({}, { ownKeys() { throw new Error("synthetic proxy trap"); } });
      expect(await instance.reserveEnrollment(accessor)).toEqual({ ok: false, error: "invalid_input" });
      expect(await instance.readEnrollmentReservation(proxy)).toEqual({ ok: false, error: "invalid_input" });
      expect(getterCalls).toBe(0);
      const input = { ...enrollmentInput };
      const pending = instance.reserveEnrollment(input);
      input.intentId = OTHER;
      input.pollSecret = OTHER;
      input.uploadSecret = OTHER;
      expect(await pending).toMatchObject({ ok: true, value: { intentId: ID, accountId: ACCOUNT } });
      const readInput = { ...enrollmentInput };
      const readback = instance.readEnrollmentReservation(readInput);
      readInput.pollSecret = OTHER;
      expect(await readback).toMatchObject({ ok: true, value: { intentId: ID, accountId: ACCOUNT } });
    });
  });

  test("missing, malformed or mid-hash changed server generations refuse without a grant", async () => {
    await confirmed();
    await runInDurableObject(stub(), async instance => {
      const instanceEnv = fixtureRecord(Reflect.get(instance, "env"));
      const original = instanceEnv.USAGE_ENROLLMENT_GENERATION;
      try {
        for (const generation of [undefined, "", "0".repeat(64), "A".repeat(64), 1]) {
          instanceEnv.USAGE_ENROLLMENT_GENERATION = generation;
          expect(await instance.reserveEnrollment(enrollmentInput)).toEqual({ ok: false, error: "recovery_required" });
          expect(await instance.readEnrollmentReservation(enrollmentInput)).toEqual({ ok: false, error: "recovery_required" });
        }
        instanceEnv.USAGE_ENROLLMENT_GENERATION = original;
        const pending = instance.reserveEnrollment(enrollmentInput);
        instanceEnv.USAGE_ENROLLMENT_GENERATION = OTHER;
        expect(await pending).toEqual({ ok: false, error: "recovery_required" });
      } finally { instanceEnv.USAGE_ENROLLMENT_GENERATION = original; }
    });
    expect(fixtureRecord(await retainedPayload()).enrollment).toBeNull();
  });

  test("a generation rotation cannot refresh or reissue an existing reservation", async () => {
    await confirmed();
    const first = await stub().reserveEnrollment(enrollmentInput);
    expect(first.ok).toBe(true);
    await runInDurableObject(stub(), async instance => {
      const instanceEnv = fixtureRecord(Reflect.get(instance, "env"));
      const original = instanceEnv.USAGE_ENROLLMENT_GENERATION;
      try {
        instanceEnv.USAGE_ENROLLMENT_GENERATION = OTHER;
        expect(await instance.reserveEnrollment(enrollmentInput)).toEqual({ ok: false, error: "recovery_required" });
        expect(await instance.readEnrollmentReservation(enrollmentInput)).toEqual({ ok: false, error: "recovery_required" });
      } finally { instanceEnv.USAGE_ENROLLMENT_GENERATION = original; }
    });
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual(first);
  });

  test("seeded expiry orderings preserve immutable reserve and existing-only semantics", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: PAIRING_TTL_MS + 100_000 }), fc.integer({ min: 0, max: PAIRING_TTL_MS * 2 }), async (lifetime, elapsed) => {
      await reset();
      vi.setSystemTime(NOW);
      await confirmed(NOW + lifetime);
      const first = await stub().reserveEnrollment(enrollmentInput);
      if (!first.ok) throw new Error("synthetic reservation failed");
      vi.setSystemTime(NOW + elapsed);
      expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual(first);
      expect(await stub().reserveEnrollment(enrollmentInput)).toEqual(elapsed < Math.min(lifetime, PAIRING_TTL_MS)
        ? first : { ok: false, error: "expired" });
    }), { numRuns: 40, seed: 901 });
  });
});

describe("validated additive pairing schema migration", () => {
  test.each(["pending", "authenticated", "browser-approved", "terminal-confirmed", "denied", "expired"] as const)("v1 %s state retains every field and revision", async status => {
    await initialize();
    if (status !== "pending" && status !== "expired") {
      const { proof } = await authenticated();
      if (status !== "authenticated") expect((await stub().decideBrowser(decisionInput(proof, status === "denied" ? "deny" : "approve"))).ok).toBe(true);
      if (status === "terminal-confirmed") expect((await stub().confirm({ ...pollInput, accountId: ACCOUNT })).ok).toBe(true);
    }
    if (status === "expired") {
      vi.setSystemTime(NOW + PAIRING_TTL_MS);
      expect(await stub().poll(pollInput)).toEqual({ ok: false, error: "expired" });
    }
    const before = await legacyFixture();
    await abortAllDurableObjects();
    const migrated = await retainedRow();
    expect(migrated.schema_version).toBe(2);
    expect(migrated.revision).toBe(before.row.revision);
    expect(await retainedPayload()).toEqual({ ...before.legacy, enrollment: null });
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual({ ok: false, error: "not_reserved" });
    if (status === "terminal-confirmed") expect((await stub().reserveEnrollment(enrollmentInput)).ok).toBe(true);
  });

  test("the uninitialized v1 row migrates without creating an intent or revision", async () => {
    expect(await stub().poll(pollInput)).toEqual({ ok: false, error: "not_initialized" });
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE pairing_state SET schema_version = 1").toArray());
    await abortAllDurableObjects();
    expect(await retainedRow()).toEqual({ schema_version: 2, revision: 0, payload: null });
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual({ ok: false, error: "not_initialized" });
  });

  test.each(["malformed", "extra-field", "invalid-auth", "zero-revision", "null-with-revision"] as const)("corrupt v1 %s is not reset or migrated", async corruption => {
    await confirmed();
    const { legacy } = await legacyFixture();
    await runInDurableObject(stub(), (_instance, state) => {
      if (corruption === "malformed") state.storage.sql.exec("UPDATE pairing_state SET payload = ?", "{");
      if (corruption === "extra-field") state.storage.sql.exec("UPDATE pairing_state SET payload = ?", JSON.stringify({ ...legacy, chat: "transcript-canary" }));
      if (corruption === "invalid-auth") state.storage.sql.exec("UPDATE pairing_state SET payload = ?", JSON.stringify({ ...legacy, attempt: null }));
      if (corruption === "zero-revision") state.storage.sql.exec("UPDATE pairing_state SET revision = 0");
      if (corruption === "null-with-revision") state.storage.sql.exec("UPDATE pairing_state SET payload = NULL");
    });
    const before = await retainedRow();
    await abortAllDurableObjects();
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual({ ok: false, error: "storage_invalid" });
    expect(await stub().reserveEnrollment(enrollmentInput)).toEqual({ ok: false, error: "storage_invalid" });
    expect(await retainedRow()).toEqual(before);
  });

  test.each([{ accountId: OTHER_ACCOUNT }, { intentId: OTHER }, { pollCommitment: OTHER }, { uploadCommitment: OTHER },
    { reservedAtMs: NOW - 1 }, { expiresAtMs: NOW + PAIRING_TTL_MS + 1 }, { schemaVersion: 2 }])("corrupt v2 reservation binding %j fails closed without resetting", async change => {
    await confirmed();
    expect((await stub().reserveEnrollment(enrollmentInput)).ok).toBe(true);
    const payload = fixtureRecord(await retainedPayload());
    const enrollment = fixtureRecord(payload.enrollment);
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE pairing_state SET payload = ?", JSON.stringify({ ...payload, enrollment: { ...enrollment, ...change } })).toArray());
    const before = await retainedRow();
    await abortAllDurableObjects();
    expect(await stub().readEnrollmentReservation(enrollmentInput)).toEqual({ ok: false, error: "storage_invalid" });
    expect(await retainedRow()).toEqual(before);
  });
});
