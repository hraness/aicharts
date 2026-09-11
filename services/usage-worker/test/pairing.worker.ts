import { env } from "cloudflare:workers";
import { abortAllDurableObjects, evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
    expect(await stub().deny(first)).toEqual({ ok: false, error: "unauthorized" });
  });

  test("no authentication, a switched account or another browser cannot approve", async () => {
    await initialize();
    const proof = await browser();
    expect(await stub().approve({ ...proof, accountId: ACCOUNT })).toEqual({ ok: false, error: "invalid_transition" });
    const { proof: active } = await authenticated();
    expect(await stub().approve({ ...active, accountId: OTHER_ACCOUNT })).toEqual({ ok: false, error: "unauthorized" });
    expect(await stub().approve({ ...active, browserNonce: OTHER, accountId: ACCOUNT })).toEqual({ ok: false, error: "unauthorized" });
    expect(await stub().approve({ ...active, contextToken: OTHER, accountId: ACCOUNT })).toEqual({ ok: false, error: "unauthorized" });
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
    const approve = { ...proof, accountId: ACCOUNT };
    const first = await stub().approve(approve);
    expect(first.ok && first.value.state).toBe("browser-approved");
    await abortAllDurableObjects();
    expect(await stub().approve(approve)).toEqual(first);
    expect(await stub().confirm({ ...pollInput, accountId: OTHER_ACCOUNT })).toEqual({ ok: false, error: "unauthorized" });
    const confirmed = await stub().confirm({ ...pollInput, accountId: ACCOUNT });
    expect(confirmed.ok && confirmed.value.state).toBe("terminal-confirmed");
    await evictDurableObject(stub());
    expect(await stub().confirm({ ...pollInput, accountId: ACCOUNT })).toEqual(confirmed);
    expect(await stub().deny(proof)).toEqual({ ok: false, error: "invalid_transition" });
    expect((await env.STAGING.list()).objects).toEqual([]);
    expect(JSON.stringify(confirmed)).not.toMatch(/credential|namespace|token|secret/i);
  });

  test("expired authenticated session cannot approve or confirm", async () => {
    await initialize();
    const proof = await browser();
    expect((await stub().recordVerifiedAuthentication({ ...proof, accountId: ACCOUNT, authTimeMs: Math.floor(NOW / 1_000) * 1_000, sessionExpiresAtMs: NOW + 10_000 })).ok).toBe(true);
    expect((await stub().approve({ ...proof, accountId: ACCOUNT })).ok).toBe(true);
    vi.setSystemTime(NOW + 10_000);
    expect(await stub().approve({ ...proof, accountId: ACCOUNT })).toEqual({ ok: false, error: "authentication_not_fresh" });
    expect(await stub().confirm({ ...pollInput, accountId: ACCOUNT })).toEqual({ ok: false, error: "authentication_not_fresh" });
  });

  test("denial is terminal and cannot be overwritten by a raced approval", async () => {
    await initialize();
    const { proof } = await authenticated();
    expect((await stub().deny(proof)).ok).toBe(true);
    await abortAllDurableObjects();
    expect(await stub().approve({ ...proof, accountId: ACCOUNT })).toEqual({ ok: false, error: "invalid_transition" });
    expect(await stub().confirm({ ...pollInput, accountId: ACCOUNT })).toEqual({ ok: false, error: "invalid_transition" });
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
    await runInDurableObject(stub(), (_instance, state) => state.storage.sql.exec("UPDATE pairing_state SET schema_version = 2").toArray());
    await abortAllDurableObjects();
    expect(await stub().poll(pollInput)).toEqual({ ok: false, error: "storage_invalid" });
    await runInDurableObject(stub(), (_instance, state) => { state.storage.sql.exec("UPDATE pairing_state SET schema_version = 1"); state.storage.sql.exec("DELETE FROM pairing_state"); });
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
    expect((await stub().approve({ ...proof, accountId: ACCOUNT })).ok).toBe(true);
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
