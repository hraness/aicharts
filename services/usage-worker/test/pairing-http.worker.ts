import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext, reset } from "cloudflare:test";
import { afterEach, expect, test } from "vitest";
import { createPairingHttpHandler, type PairingHttpEnvironment, type PairingHttpVerifier } from "../src/pairing-http";
import { createPairingCoordinator } from "../src/pairing-coordinator";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import { decodePairingTransportResponse, encodePairingTransportRequest, type PairingTransportOperation } from "../../../lib/usage/pairing-transport-contract";
import { PAIRING_HTTP_URL, PAIRING_HTTP_MEDIA } from "../../../lib/usage/pairing-http-contract";

const ID = "11".repeat(32), POLL = "22".repeat(32), UPLOAD = "33".repeat(32), NONCE = "44".repeat(32);
const ACCOUNT = `acct_${"aa".repeat(16)}`;
afterEach(async () => { await reset(); });

test("real namespace is assignable and four pairing operations cross the owned RPC disposal boundary", async () => {
  // The production composition is constructible in the real Worker graph. Its
  // factory is dormant: construction performs no request or namespace lookup.
  const coordinator = createPairingCoordinator();
  expect(typeof coordinator).toBe("function");
  // Compile-time proof against the generated, actual namespace—not a type cast.
  const actual: PairingHttpEnvironment = env;
  expect(actual.PAIRINGS).toBe(env.PAIRINGS);
  const commitment = await uploadSecretCommitment(ID, UPLOAD);
  expect(commitment.ok).toBe(true);
  if (!commitment.ok) throw new Error("synthetic_commitment");
  const { raw } = await new Promise<{ raw: unknown }>((resolve, reject) => {
    void env.PAIRINGS.getByName(ID).initialize({ intentId: ID, pollSecret: POLL, uploadCommitment: commitment.value })
      .then(raw => { resolve({ raw }); }, reject);
  });
  expect(raw !== null && typeof raw === "object").toBe(true);
  const disposal = Object.getOwnPropertyDescriptor(raw as object, Symbol.dispose);
  expect(typeof disposal?.value).toBe("function");
  let expiry: number;
  try {
    expect(Object.getOwnPropertyDescriptor(raw as object, "ok")?.value).toBe(true);
    const value: unknown = Object.getOwnPropertyDescriptor(raw as object, "value")?.value;
    expiry = Object.getOwnPropertyDescriptor(value as object, "expiresAtMs")?.value as number;
    expect(Number.isSafeInteger(expiry)).toBe(true);
    expect(expiry).toBeGreaterThan(Date.now());
  } finally { Reflect.apply(disposal!.value, raw, []); }

  let finished = 0;
  // This fixed synthetic verifier qualifies RPC composition, never JWT/provider identity.
  const verifier: PairingHttpVerifier = { beginRequest() {
    let open = true; const handle = Object.freeze({});
    return {
      async verify(token) { return token === "a.b.c" ? { ok: true, value: handle } : { ok: false, error: "unauthorized" }; },
      isCurrent(value) { return open && value === handle; },
      finish() { expect(open).toBe(true); open = false; finished++; },
    };
  } };
  const handle = createPairingHttpHandler({ verifier, now: Date.now,
    setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  async function call(operation: PairingTransportOperation, input: unknown) {
    const captured = { schemaVersion: 1, operation, input };
    const encoded = encodePairingTransportRequest(captured);
    if (!encoded.ok) throw new Error("synthetic_request");
    const ctx = createExecutionContext();
    try {
      const response = await handle(new Request(PAIRING_HTTP_URL, { method: "POST", body: new Uint8Array(encoded.value),
        headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer a.b.c" },
      }), actual, ctx);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(PAIRING_HTTP_MEDIA);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const decoded = decodePairingTransportResponse(new Uint8Array(await response.arrayBuffer()), captured);
      if (!decoded.ok) throw new Error("synthetic_response");
      return decoded.value;
    } finally { await waitOnExecutionContext(ctx); }
  }
  const begin = await call("beginBrowserAttempt", { intentId: ID, browserNonce: NONCE });
  if (!begin.ok || !("attemptId" in begin.value)) throw new Error("synthetic_begin");
  expect(begin.value.expiresAtMs).toBe(expiry);
  expect(begin.value.expiresAtMs - begin.value.startedAtMs).toBeLessThanOrEqual(PAIRING_TTL_MS);
  const proof = { intentId: ID, attemptId: begin.value.attemptId, browserNonce: NONCE, contextToken: begin.value.contextToken };
  expect(await call("recordVerifiedAuthentication", { ...proof, accountId: ACCOUNT,
    authTimeMs: Math.floor(begin.value.startedAtMs / 1000) * 1000, sessionExpiresAtMs: expiry,
  })).toEqual({ ok: true, value: { recorded: true } });
  expect(await call("browserStatus", proof)).toEqual({ ok: true, value: {
    state: "pending", expiresAtMs: expiry, accountId: ACCOUNT, authenticationExpiresAtMs: expiry,
  } });
  expect(await call("decideBrowser", { ...proof, accountId: ACCOUNT, liveSessionExpiresAtMs: expiry, decision: "approve" }))
    .toEqual({ ok: true, value: { state: "browser-approved", expiresAtMs: expiry, accountId: ACCOUNT, authenticationExpiresAtMs: expiry } });
  expect(await call("browserStatus", { ...proof, contextToken: "55".repeat(32) })).toEqual({ ok: false, error: "unauthorized" });
  expect(finished).toBe(5);
});
