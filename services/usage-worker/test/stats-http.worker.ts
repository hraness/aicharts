import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { STATS_HTTP_URL, STATS_UPLOAD_URL, STATS_STATUS_URL, decodeStatsHttpResponse, encodeStatsHttpRequest, parseStatsUpload, type StatsUpload } from "../../../lib/usage/stats-http-contract";
import { STATS_ABANDON_URL, parseStatsAbandonment } from "../../../lib/usage/stats-http-contract";
import { STATS_TOTALS_DEVICE_URL, STATS_TOTALS_URL, decodeStatsTotalsResponse, encodeStatsTotalsDeviceRequest, encodeStatsTotalsRequest } from "../../../lib/usage/stats-totals-contract";
import { createStatsTotalsHttpHandler } from "../src/stats-http";
import { statsHash, statsUploadText } from "../src/stats-state";
import { parseUsageStatsReport } from "../../../lib/usage/stats-contract";
import { admissionIdBytes } from "../src/admission-state";
import { enrollmentAccountName } from "../src/enrollment-contract";
import { createStatsHttpHandler, createStatsUploadHttpHandler, type StatsUploadHttpEnvironment } from "../src/stats-http";
import { AccountEnrollment } from "../src/enrollment";
import type { PairingHttpVerifier } from "../src/pairing-http";
import { PAIRING_TTL_MS, uploadSecretCommitment } from "../src/pairing";
import worker from "../src/index";
const NOW = Math.ceil(Date.now() / 86_400_000) * 86_400_000 + 43_200_000, DAY = Math.floor(NOW / 86_400_000);
let serial = 0, account = "";
const hex = (value: number, width = 32) => value.toString(16).padStart(width * 2, "0");
const success = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  expect(result).toMatchObject({ ok: true }); if (!result.ok) throw new Error(result.error); return result.value;
};
const effects = { now: () => Date.now(), setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms), clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>) };
const verifier: PairingHttpVerifier = { beginRequest() {
  const handle = Object.freeze({}); let open = true;
  return { async verify(token) { return token === "a.b.c" ? { ok: true, value: handle } : { ok: false, error: "unauthorized" }; },
    isCurrent(value) { return open && value === handle; }, finish() { open = false; } };
} };
async function enroll() {
  const proof = { intentId: hex(serial), pollSecret: hex(serial + 1_000), uploadSecret: hex(serial + 2_000) };
  const pairing = env.PAIRINGS.getByName(proof.intentId), browserNonce = hex(serial + 3_000);
  const uploadCommitment = success(await uploadSecretCommitment(proof.intentId, proof.uploadSecret));
  success(await pairing.initialize({ intentId: proof.intentId, pollSecret: proof.pollSecret, uploadCommitment }));
  const attempt = success(await pairing.beginBrowserAttempt({ intentId: proof.intentId, browserNonce }));
  const browser = { intentId: proof.intentId, browserNonce, attemptId: attempt.attemptId, contextToken: attempt.contextToken };
  success(await pairing.recordVerifiedAuthentication({ ...browser, accountId: account, authTimeMs: NOW, sessionExpiresAtMs: NOW + PAIRING_TTL_MS }));
  success(await pairing.decideBrowser({ ...browser, accountId: account, liveSessionExpiresAtMs: NOW + PAIRING_TTL_MS, decision: "approve" }));
  success(await pairing.confirm({ intentId: proof.intentId, pollSecret: proof.pollSecret, accountId: account }));
  success(await pairing.reserveEnrollment(proof));
  const stub = env.ACCOUNT_ENROLLMENTS.getByName(enrollmentAccountName(account));
  const enrolled = success(await stub.enroll(proof));
  return { proof, stub, deviceId: admissionIdBytes(enrolled.receipt.deviceId) };
}
beforeEach(() => { account = `acct_${hex(++serial, 16)}`; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await reset(); });
async function activated() {
  const device = await enroll();
  await runInDurableObject(device.stub, async (instance, state) => {
    const owner = instance as unknown as { env: Env }, next = { ...owner.env, AICHARTS_USAGE_STATS_ENABLED: "1" };
    new AccountEnrollment(state, next); owner.env = next;
    success(await instance.maintainAccount({ schemaVersion: 1, accountId: account,
      generation: env.USAGE_ENROLLMENT_GENERATION, operation: "prepare" }));
  });
  const report = parseUsageStatsReport({ schemaVersion: 2, profile: "client-stats-v2", registryRevision: 1,
    firstUtcDay: DAY, dayCount: 1, generatedAtMs: NOW, revision: 0, updatedAtMs: null,
    sources: [{ client: "cursor", status: "observed", tokenBasis: "reported", records: 1, warnings: 0, latestAtMs: NOW - 1 }],
    rows: [{ utcDay: DAY, client: "cursor", provider: null, model: null, tokens: { input: "7", cacheRead: "2", cacheWrite: "5", output: "9", reasoning: "3" },
      records: 1, reportedCostMicrousd: "1000", reportedCostRecords: 1, estimatedCostMicrousd: null, estimatedCostRecords: 0,
      durationMs: null, timedRecords: 0, timedTokens: "0", tokenBasis: "reported", breakdownCoverage: "partial" }] });
  const input = parseStatsUpload({ schemaVersion: 2, accountId: account, deviceId: [...device.deviceId].map(value => value.toString(16).padStart(2, "0")).join(""),
    generation: env.USAGE_ENROLLMENT_GENERATION, operationId: hex(serial + 10000), sequence: 1, expectedRevision: 0, mode: "replace-window", takeover: null, report });
  if (!input) throw new Error("fixture"); return { ...device, input };
}
function request(url: string, value: unknown, token: string) { return new Request(url, { method: "POST", body: JSON.stringify(value), headers: {
  "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}`,
} }); }
async function uploadCall(value: StatsUpload, token: string) {
  const ctx = createExecutionContext();
  try { return await createStatsUploadHttpHandler(effects)(request(STATS_UPLOAD_URL, value, token), env, ctx); }
  finally { await waitOnExecutionContext(ctx); }
}
test("same enrolled credential uploads through real RPC, retries and returns private stats through verified workload", async () => {
  const device = await activated(), response = await uploadCall(device.input, device.proof.uploadSecret);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);
  const receipt = await response.json(); expect(receipt).toMatchObject({ schemaVersion: 2, result: { ok: true, value: { revision: 1, client: "cursor" } } });
  expect(await (await uploadCall(device.input, device.proof.uploadSecret)).json()).toEqual(receipt);
  const query = { schemaVersion: 2, accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS, firstUtcDay: DAY, dayCount: 1 };
  const ctx = createExecutionContext();
  try {
    const reply = await createStatsHttpHandler({ ...effects, verifier })(new Request(STATS_HTTP_URL, {
      method: "POST", body: encodeStatsHttpRequest(query), headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer a.b.c" },
    }), env, ctx);
    expect(reply.status).toBe(200); const parsed = decodeStatsHttpResponse(new Uint8Array(await reply.arrayBuffer()), query);
    expect(parsed).toMatchObject({ ok: true, value: { revision: 1, rows: [{ client: "cursor", tokens: { input: "7", cacheWrite: "5" } }] } });
  } finally { await waitOnExecutionContext(ctx); }
});
test("status is authenticated and uploads reject polling secret and wrong generation", async () => {
  const device = await activated();
  const refused = await uploadCall(device.input, device.proof.pollSecret);
  expect(refused.status).toBe(401);
  expect(refused.headers.get("content-length")).toBe(String((await refused.arrayBuffer()).byteLength));
  const ctx = createExecutionContext();
  try {
    const response = await createStatsUploadHttpHandler(effects)(request(STATS_STATUS_URL, {
      schemaVersion: 2, accountId: account, deviceId: device.input.deviceId, generation: env.USAGE_ENROLLMENT_GENERATION,
      client: "cursor", firstUtcDay: DAY, dayCount: 1,
    }, device.proof.uploadSecret), env, ctx);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ result: { ok: true, value: { revision: 0, nextSequence: 1, legacyRecords: 0 } } });
  } finally { await waitOnExecutionContext(ctx); }
  expect((await uploadCall({ ...device.input, generation: hex(999999) }, device.proof.uploadSecret)).status).toBe(503);
});
test("native abandonment endpoint returns a bounded framed proof and permanently fences the old upload", async () => {
  const device = await activated(), value = device.input;
  const input = { schemaVersion: 2, accountId: value.accountId, deviceId: value.deviceId, generation: value.generation,
    operationId: value.operationId, sequence: value.sequence, expectedRevision: value.expectedRevision, bodyHash: statsHash(statsUploadText(value)) };
  const ctx = createExecutionContext();
  try {
    const response = await createStatsUploadHttpHandler(effects)(request(STATS_ABANDON_URL, input, device.proof.uploadSecret), env, ctx);
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer()); expect(response.headers.get("content-length")).toBe(String(bytes.length));
    const result = JSON.parse(new TextDecoder().decode(bytes));
    expect(parseStatsAbandonment(result.result.value)).toMatchObject({ outcome: "abandoned", fencedAtRevision: 1 });
  } finally { await waitOnExecutionContext(ctx); }
  expect((await uploadCall(value, device.proof.uploadSecret)).status).toBe(409);
});
test("malformed framing and unregistered labels never select an account", async () => {
  const device = await activated(); let calls = 0;
  const selected: StatsUploadHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { calls++; throw new Error("must not select"); } } };
  const invalid = [new Request(STATS_UPLOAD_URL, { method: "GET" }), request(STATS_UPLOAD_URL, { ...device.input,
    report: { ...device.input.report, rows: [{ ...device.input.report.rows[0], model: "PRIVATE_MODEL_CANARY" }] } }, device.proof.uploadSecret)];
  for (const input of invalid) {
    const ctx = createExecutionContext();
    try { expect((await createStatsUploadHttpHandler(effects)(input, selected, ctx)).status).toBe(400); }
    finally { await waitOnExecutionContext(ctx); }
  }
  expect(calls).toBe(0);
});
test("default production router keeps v2 closed despite legacy admission flags", async () => {
  const device = await activated(), ctx = createExecutionContext();
  try {
    const response = await worker.fetch(request(STATS_UPLOAD_URL, device.input, device.proof.uploadSecret), { ...env,
      AICHARTS_USAGE_WORKER_ENABLED: "1", AICHARTS_USAGE_ADMISSION_ENABLED: "1",
    } as Env, ctx);
    expect(response.status).toBe(503); expect(await response.text()).toBe('{"error":"usage_service_unavailable"}');
  } finally { await waitOnExecutionContext(ctx); }
});
test("shaped foreign v2 upload and abandonment receipts refuse without leaking acceptance", async () => {
  const device = await activated(), input = device.input;
  const receipt = { schemaVersion: 2, operationId: input.operationId, bodyHash: statsHash(statsUploadText(input)), sequence: input.sequence,
    revision: input.expectedRevision + 1, committedAtMs: NOW, client: input.report.sources[0].client,
    firstUtcDay: input.report.firstUtcDay, dayCount: input.report.dayCount };
  let disposed = 0;
  for (const change of [{ operationId: hex(900001) }, { bodyHash: hex(900002) }, { sequence: 2 }, { revision: 2 },
    { client: "codex" }, { firstUtcDay: DAY - 1 }, { dayCount: 2 }]) {
    const reply = (value: unknown) => ({ ok: true, value, [Symbol.dispose]() { disposed++; } });
    const selected: StatsUploadHttpEnvironment = { ACCOUNT_ENROLLMENTS: { getByName() { return {
      admitStatsSnapshot: async () => reply({ ...receipt, ...change }),
      readStatsStatus: async () => { throw new Error("unexpected status"); },
      readStatsTotals: async () => { throw new Error("unexpected totals"); },
      abandonStatsSnapshot: async () => reply({ schemaVersion: 2, outcome: "committed", receipt: { ...receipt, ...change } }),
    }; } } };
    const ctx = createExecutionContext();
    try {
      const response = await createStatsUploadHttpHandler(effects)(request(STATS_UPLOAD_URL, input, device.proof.uploadSecret), selected, ctx);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ result: { ok: false, error: "storage_unavailable" } });
      if ("operationId" in change || "bodyHash" in change || "sequence" in change || "revision" in change) {
        const abandonment = { schemaVersion: 2, accountId: input.accountId, generation: input.generation, deviceId: input.deviceId,
          operationId: input.operationId, bodyHash: receipt.bodyHash, sequence: input.sequence, expectedRevision: input.expectedRevision };
        expect((await createStatsUploadHttpHandler(effects)(request(STATS_ABANDON_URL, abandonment, device.proof.uploadSecret), selected, ctx)).status).toBe(503);
      }
    } finally { await waitOnExecutionContext(ctx); }
  }
  expect(disposed).toBe(11);
});
test("lifetime totals travel through the verified workload boundary with bounded framing", async () => {
  const device = await activated();
  expect((await uploadCall(device.input, device.proof.uploadSecret)).status).toBe(200);
  const query = { schemaVersion: 2, accountId: account, sessionExpiresAtMs: NOW + PAIRING_TTL_MS };
  const call = async (body: Uint8Array | null, token: string, headers: Record<string, string> = {}) => {
    const ctx = createExecutionContext();
    try {
      return await createStatsTotalsHttpHandler({ ...effects, verifier })(new Request(STATS_TOTALS_URL, { method: "POST", body,
        headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}`, ...headers } }), env, ctx);
    } finally { await waitOnExecutionContext(ctx); }
  };
  const reply = await call(encodeStatsTotalsRequest(query), "a.b.c");
  expect(reply.status).toBe(200); expect(reply.headers.get("cache-control")).toBe("private, no-store");
  const parsed = decodeStatsTotalsResponse(new Uint8Array(await reply.arrayBuffer()));
  expect(parsed).toMatchObject({ ok: true, value: { revision: 1, legacyComplete: true, total: { records: 1, days: 1, tokens: { input: "7", cacheWrite: "5" } },
    clients: [{ client: "cursor", basis: "snapshots", records: 1 }], devices: [{ deviceId: device.input.deviceId, records: 1 }] } });
  expect((await call(encodeStatsTotalsRequest(query), "wrong")).status).toBe(401);
  expect((await call(new TextEncoder().encode(JSON.stringify({ ...query, uploadSecret: "PRIVATE_CANARY" })), "a.b.c")).status).toBe(400);
  expect((await call(encodeStatsTotalsRequest(query), "a.b.c", { cookie: "session=PRIVATE_CANARY" })).status).toBe(400);
  const routed = await worker.fetch(new Request(STATS_TOTALS_URL, { method: "POST", body: encodeStatsTotalsRequest(query),
    headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer a.b.c" } }), env, createExecutionContext());
  expect(routed.status).toBe(503); // The production router keeps the route closed until its flags are set.
});
test("enrolled device reads its own account totals with the upload secret, never a session", async () => {
  const device = await activated();
  expect((await uploadCall(device.input, device.proof.uploadSecret)).status).toBe(200);
  const body = { schemaVersion: 2, accountId: account, deviceId: device.input.deviceId, generation: env.USAGE_ENROLLMENT_GENERATION };
  const wire = encodeStatsTotalsDeviceRequest(body); expect(wire).not.toBeNull();
  const call = async (payload: BodyInit | null, token: string, extra: Record<string, string> = {}) => {
    const ctx = createExecutionContext();
    try {
      return await createStatsUploadHttpHandler(effects)(new Request(STATS_TOTALS_DEVICE_URL, { method: "POST", body: payload,
        headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}`, ...extra } }), env, ctx);
    } finally { await waitOnExecutionContext(ctx); }
  };
  const reply = await call(wire, device.proof.uploadSecret);
  expect(reply.status).toBe(200); expect(reply.headers.get("cache-control")).toBe("private, no-store");
  expect(Number(reply.headers.get("content-length"))).toBeGreaterThan(0);
  const parsed = decodeStatsTotalsResponse(new Uint8Array(await reply.arrayBuffer()));
  expect(parsed).toMatchObject({ ok: true, value: { revision: 1, legacyComplete: true, total: { records: 1, days: 1, tokens: { input: "7", cacheWrite: "5" } },
    clients: [{ client: "cursor", basis: "snapshots", records: 1 }], devices: [{ deviceId: device.input.deviceId, records: 1 }] } });
  // The browser session credential family is meaningless here: wrong secret, polling secret, stale generation all refuse.
  expect((await call(wire, device.proof.pollSecret)).status).toBe(401);
  expect((await call(wire, "0".repeat(63) + "1")).status).toBe(401);
  expect((await call(JSON.stringify({ ...body, generation: hex(999999) }), device.proof.uploadSecret)).status).toBe(503);
  expect((await call(JSON.stringify({ ...body, extra: "PRIVATE_CANARY" }), device.proof.uploadSecret)).status).toBe(400);
  expect((await call(wire, device.proof.uploadSecret, { cookie: "session=PRIVATE_CANARY" })).status).toBe(400);
  const routed = await worker.fetch(request(STATS_TOTALS_DEVICE_URL, body, device.proof.uploadSecret), { ...env,
    AICHARTS_USAGE_WORKER_ENABLED: "1", AICHARTS_USAGE_STATS_ENABLED: "1", AICHARTS_USAGE_ADMISSION_ENABLED: "1",
  } as Env, createExecutionContext());
  expect(routed.status).toBe(200); // Device reads open with the same flags as uploads; no browser flags required.
  const gated = await worker.fetch(request(STATS_TOTALS_DEVICE_URL, body, device.proof.uploadSecret), env, createExecutionContext());
  expect(gated.status).toBe(503); // Without the admission flag the router keeps the route closed.
});
