import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, expect, test } from "vitest";
import { ADMISSION_HTTP_URL } from "../src/admission-http";
import { PAIRING_HTTP_URL } from "../../../lib/usage/pairing-http-contract";
import { PRIVATE_DAYS_HTTP_URL } from "../../../lib/usage/private-days-http-contract";
import { USAGE_CONSENT_HTTP_URL } from "../../../lib/usage/consent-http-contract";
import { LEADERBOARD_HTTP_URL } from "../../../lib/usage/leaderboard-http-contract";
import { STATS_TOTALS_URL } from "../../../lib/usage/stats-totals-contract";
import { TERMINAL_ENROLLMENT_URL } from "../../../lib/usage/terminal-enrollment-contract";
import { encodeTerminalEnrollmentRequest } from "../../../lib/usage/terminal-enrollment-contract";
import { uploadSecretCommitment } from "../src/pairing";
import { createProductionRouter, type ProductionEnvironment } from "../src/production";
import worker from "../src/index";
import type { PairingHttpVerifier } from "../src/pairing-http";

const generation = "1".repeat(64);
const context = { waitUntil() {} } as unknown as ExecutionContext;
afterEach(async () => { await reset(); });
function environment(flags: Record<string, unknown> = {}): ProductionEnvironment {
  return {
    USAGE_ENROLLMENT_GENERATION: generation,
    PAIRINGS: { getByName() {} }, ACCOUNT_ENROLLMENTS: { getByName() {} }, PUBLIC_INDEX: { getByName() {} },
    STAGING: { list() {}, head() {}, get() {}, put() {}, delete() {} },
    CONTROL: { list() {}, head() {}, get() {}, put() {}, delete() {} }, ...flags,
  } as unknown as ProductionEnvironment;
}
function handlers(calls: string[]) {
  const reply = (name: string) => async () => { calls.push(name); return new Response(name, { status: 201 }); };
  return { pairing: reply("pairing"), terminal: reply("terminal"), admission: reply("admission"),
    privateDays: reply("privateDays"), consent: reply("consent"), leaderboard: reply("leaderboard") };
}

test("production router is closed by default and never dispatches dormant handlers", async () => {
  const calls: string[] = [], route = createProductionRouter({ handlers: handlers(calls) });
  for (const url of [PAIRING_HTTP_URL, TERMINAL_ENROLLMENT_URL, ADMISSION_HTTP_URL, PRIVATE_DAYS_HTTP_URL,
    USAGE_CONSENT_HTTP_URL, LEADERBOARD_HTTP_URL, STATS_TOTALS_URL, "https://usage.aicharts.io/unknown"]) {
    const response = await route(new Request(url, { method: "POST" }), environment(), context);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"usage_service_unavailable"}');
  }
  for (const value of [true, "true", 0, "0"]) {
    const response = await route(new Request(TERMINAL_ENROLLMENT_URL), environment({ AICHARTS_USAGE_WORKER_ENABLED: value } as Record<string, unknown>), context);
    expect(response.status).toBe(503);
  }
  expect(calls).toEqual([]);
});

test("each route requires its exact feature fence and usable generation/bindings", async () => {
  const calls: string[] = [], route = createProductionRouter({ handlers: handlers(calls) });
  const common = { AICHARTS_USAGE_WORKER_ENABLED: "1" };
  const cases = [
    [PAIRING_HTTP_URL, { ...common, AICHARTS_USAGE_AUTH_ENABLED: "1", AICHARTS_USAGE_PAIRING_ENABLED: "1" }, "pairing"],
    [TERMINAL_ENROLLMENT_URL, { ...common, AICHARTS_USAGE_ENROLLMENT_ENABLED: "1" }, "terminal"],
    [ADMISSION_HTTP_URL, { ...common, AICHARTS_USAGE_ADMISSION_ENABLED: "1" }, "admission"],
    [PRIVATE_DAYS_HTTP_URL, { ...common, AICHARTS_USAGE_AUTH_ENABLED: "1", AICHARTS_USAGE_PRIVATE_READ_ENABLED: "1" }, "privateDays"],
    [USAGE_CONSENT_HTTP_URL, { ...common, AICHARTS_USAGE_AUTH_ENABLED: "1", AICHARTS_USAGE_PRIVATE_READ_ENABLED: "1" }, "consent"],
    [LEADERBOARD_HTTP_URL, { ...common, AICHARTS_USAGE_PUBLIC_READ_ENABLED: "1" }, "leaderboard"],
  ] as const;
  for (const [url, flags, expected] of cases) {
    const response = await route(new Request(url, { method: "POST" }), environment(flags), context);
    expect(response.status).toBe(201); expect(await response.text()).toBe(expected);
  }
  expect(calls).toEqual(["pairing", "terminal", "admission", "privateDays", "consent", "leaderboard"]);
  // The public read is independently gated: private collection flags do not
  // open it, and the public flag never opens consent writes or private reads.
  for (const [url, flags] of [
    [LEADERBOARD_HTTP_URL, { ...common, AICHARTS_USAGE_AUTH_ENABLED: "1", AICHARTS_USAGE_PRIVATE_READ_ENABLED: "1" }],
    [USAGE_CONSENT_HTTP_URL, { ...common, AICHARTS_USAGE_PUBLIC_READ_ENABLED: "1" }],
    [PRIVATE_DAYS_HTTP_URL, { ...common, AICHARTS_USAGE_PUBLIC_READ_ENABLED: "1" }],
    [USAGE_CONSENT_HTTP_URL, { ...common, AICHARTS_USAGE_AUTH_ENABLED: "1" }],
    [USAGE_CONSENT_HTTP_URL, { ...common, AICHARTS_USAGE_PRIVATE_READ_ENABLED: "1" }],
  ] as const) {
    const closed = await route(new Request(url, { method: "POST" }), environment(flags), context);
    expect(closed.status).toBe(503);
    expect(await closed.text()).toBe('{"error":"usage_service_unavailable"}');
  }
  expect(calls).toEqual(["pairing", "terminal", "admission", "privateDays", "consent", "leaderboard"]);
  const closed = await route(new Request(TERMINAL_ENROLLMENT_URL), environment({ ...common, AICHARTS_USAGE_ENROLLMENT_ENABLED: "1", USAGE_ENROLLMENT_GENERATION: "0".repeat(64) }), context);
  expect(closed.status).toBe(503);
});

test("a missing operation binding fails closed before handler dispatch", async () => {
  const calls: string[] = [], route = createProductionRouter({ handlers: handlers(calls) });
  const response = await route(new Request(ADMISSION_HTTP_URL), environment({ AICHARTS_USAGE_WORKER_ENABLED: "1", AICHARTS_USAGE_ADMISSION_ENABLED: "1", CONTROL: undefined }), context);
  expect(response.status).toBe(503); expect(calls).toEqual([]);
});

test("wrong binding shapes fail closed before dispatch", async () => {
  const calls: string[] = [], route = createProductionRouter({ handlers: handlers(calls) });
  const response = await route(new Request(ADMISSION_HTTP_URL), environment({ AICHARTS_USAGE_WORKER_ENABLED: "1", AICHARTS_USAGE_ADMISSION_ENABLED: "1", STAGING: { list() {} } }), context);
  expect(response.status).toBe(503); expect(calls).toEqual([]);
});

test("default Worker composition dispatches terminal initialize only with explicit enrollment activation", async () => {
  const intentId = "a1".repeat(32), pollSecret = "b2".repeat(32), uploadSecret = "c3".repeat(32);
  const commitment = await uploadSecretCommitment(intentId, uploadSecret);
  expect(commitment.ok).toBe(true);
  if (!commitment.ok) throw new Error("commitment");
  const encoded = encodeTerminalEnrollmentRequest({ schemaVersion: 1, operation: "initialize", input: {
    intentId, pollSecret, uploadCommitment: commitment.value,
  } });
  expect(encoded.ok).toBe(true);
  if (!encoded.ok) throw new Error("request");
  const routed = { PAIRINGS: env.PAIRINGS, ACCOUNT_ENROLLMENTS: env.ACCOUNT_ENROLLMENTS, STAGING: env.STAGING,
    CONTROL: env.CONTROL, USAGE_ENROLLMENT_GENERATION: env.USAGE_ENROLLMENT_GENERATION,
    AICHARTS_USAGE_WORKER_ENABLED: "1", AICHARTS_USAGE_ENROLLMENT_ENABLED: "1" } as unknown as Env;
  const ctx = createExecutionContext();
  try {
    const response = await worker.fetch(new Request(TERMINAL_ENROLLMENT_URL, { method: "POST", body: new Uint8Array(encoded.value),
      headers: { "content-type": "application/json", accept: "application/json", "content-length": String(encoded.value.byteLength) },
    }), routed, ctx);
    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text())).toMatchObject({ schemaVersion: 1, operation: "initialize", result: { ok: true } });
  } finally { await waitOnExecutionContext(ctx); }
});

test("composed authenticated routes reject an invalid workload before namespace access", async () => {
  const touched: string[] = [];
  const verifier: PairingHttpVerifier = { beginRequest() {
    return { verify: async () => ({ ok: false as const, error: "unauthorized" as const }), isCurrent: () => false, finish() {} };
  } };
  const route = createProductionRouter({ verifier });
  const routed = environment({ AICHARTS_USAGE_WORKER_ENABLED: "1", AICHARTS_USAGE_AUTH_ENABLED: "1",
    AICHARTS_USAGE_PAIRING_ENABLED: "1", AICHARTS_USAGE_PRIVATE_READ_ENABLED: "1",
    PAIRINGS: { getByName() { touched.push("pairings"); throw new Error("namespace"); } },
    ACCOUNT_ENROLLMENTS: { getByName() { touched.push("accounts"); throw new Error("namespace"); } },
  });
  for (const url of [PAIRING_HTTP_URL, PRIVATE_DAYS_HTTP_URL]) {
    const response = await route(new Request(url, { method: "POST", body: "{}", headers: {
      "content-type": "application/json", accept: "application/json", authorization: "Bearer a.b.c", "content-length": "2",
    } }), routed, context);
    expect(response.status).toBe(401);
  }
  expect(touched).toEqual([]);
});
