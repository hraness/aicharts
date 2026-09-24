import { env } from "cloudflare:test";
import { createExecutionContext, reset } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { enrollmentRandom } from "../src/enrollment-contract";
import production from "../src/index";
import { restoreFenceName, type RestoreFenceLease, type RestoreFenceResult } from "../src/restore-fence";
import privateDefault, {
  createRestoreFenceControlHandler, RestoreFenceControl, type FenceControlEnvironment,
} from "../src/restore-fence-control";
import {
  FENCE_CONTROL_ERROR_STATUS, FENCE_CONTROL_REPLY_BYTES, FENCE_CONTROL_REQUEST_BYTES, FENCE_CONTROL_URL,
  encodeFenceControlJson, parseFenceControlReply, type FenceControlReply, type FenceControlRequest,
} from "../src/restore-fence-control-contract";

const CANARY = "PRIVATE_RESTORE_FENCE_CONTROL_CANARY";
const VERSION = env.USAGE_WORKER_VERSION;
const NEXT_VERSION = "3333333333333333333333333333333333333333333333333333333333333333";
const account = () => `acct_${enrollmentRandom().slice(0, 32)}`;
const generation = () => enrollmentRandom();
let selected: FenceControlEnvironment;
const handler = createRestoreFenceControlHandler();
beforeEach(async () => {
  selected = { RESTORE_FENCES: env.RESTORE_FENCES, AICHARTS_USAGE_FENCE_CONTROL_ENABLED: "1" };
  await reset();
});

const stub = (accountId: string) => env.RESTORE_FENCES.getByName(restoreFenceName(accountId)) as unknown as {
  assertOpen(input: unknown): Promise<RestoreFenceResult<RestoreFenceLease>>;
  release(input: unknown): Promise<RestoreFenceResult<null>>;
};
const fenceRequest = (accountId: string, generationId: string, operation: "read"): FenceControlRequest =>
  Object.freeze({ schemaVersion: 1, operation, accountId, generation: generationId });
const closeRequest = (accountId: string, generationId: string, epoch: number): FenceControlRequest =>
  Object.freeze({ schemaVersion: 1, operation: "close", accountId, generation: generationId, epoch, workerVersion: VERSION });
const publishRequest = (accountId: string, generationId: string, epoch: number): FenceControlRequest =>
  Object.freeze({ schemaVersion: 1, operation: "publish", accountId, generation: generationId, epoch, workerVersion: NEXT_VERSION });

function request(value: unknown, headers: Record<string, string> = {}, url = FENCE_CONTROL_URL): Request {
  const bytes = encodeFenceControlJson(value, FENCE_CONTROL_REQUEST_BYTES);
  if (!bytes) throw new Error("control_fixture_failure");
  return new Request(url, { method: "POST", body: bytes, headers: { "content-type": "application/json", accept: "application/json", ...headers } });
}
async function reply(request: Request, environment = selected): Promise<{ status: number; body: string }> {
  const response = await handler(request, environment), bytes = new Uint8Array(await response.arrayBuffer());
  expect(bytes.length).toBeLessThanOrEqual(FENCE_CONTROL_REPLY_BYTES);
  for (const [name, expected] of [["content-type", "application/json; charset=utf-8"], ["cache-control", "private, no-store"],
    ["referrer-policy", "no-referrer"], ["x-content-type-options", "nosniff"], ["x-robots-tag", "noindex, nofollow"]] as const)
    expect(response.headers.get(name)).toBe(expected);
  for (const name of ["set-cookie", "access-control-allow-origin", "location", "content-encoding", "refresh"])
    expect(response.headers.has(name)).toBe(false);
  const body = new TextDecoder().decode(bytes);
  expect(body).not.toContain(CANARY);
  return { status: response.status, body };
}
async function call(input: FenceControlRequest, environment = selected): Promise<FenceControlReply> {
  const { status, body } = await reply(request(input), environment);
  const parsed = parseFenceControlReply(input, JSON.parse(body) as unknown);
  expect(parsed).not.toBeNull();
  if (!parsed) throw new Error("control_fixture_failure");
  expect(status).toBe(parsed.ok ? 200 : FENCE_CONTROL_ERROR_STATUS[parsed.error]);
  return parsed;
}
const error = async (input: FenceControlRequest, environment = selected): Promise<string> => {
  const result = await call(input, environment);
  expect(result.ok).toBe(false);
  return result.ok ? "unexpected" : result.error;
};
const view = async (input: FenceControlRequest, environment = selected) => {
  const result = await call(input, environment);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("control_fixture_failure");
  return result.value;
};

describe("restore fence control channel", () => {
  it("admits only the exact canonical POST to the fixed private URL", async () => {
    const accountId = account(), generationId = generation(), input = fenceRequest(accountId, generationId, "read");
    expect((await reply(new Request(FENCE_CONTROL_URL, { method: "GET" }))).status).toBe(405);
    const head = await handler(new Request(FENCE_CONTROL_URL, { method: "HEAD" }), selected);
    expect(head.status).toBe(405); expect(await head.text()).toBe("");
    expect((await reply(request(input, {}, `${FENCE_CONTROL_URL}?x=1`))).status).toBe(400);
    expect((await reply(request(input, {}, "https://aicharts-usage-fence-control.invalid/other"))).status).toBe(400);
    for (const headers of [{ "content-type": "text/plain" }, { accept: "text/plain" }, { authorization: "Bearer x" },
      { cookie: "a=b" }, { origin: "https://example.invalid" }, { "content-encoding": "gzip" }, { "transfer-encoding": "chunked" }] as Record<string, string>[]) {
      const r = new Request(FENCE_CONTROL_URL, { method: "POST", body: encodeFenceControlJson(input)!, headers: { "content-type": "application/json", ...headers } });
      expect((await reply(r)).status).toBe(400);
    }
    const bytes = encodeFenceControlJson(input)!;
    expect((await reply(new Request(FENCE_CONTROL_URL, { method: "POST", body: bytes,
      headers: { "content-type": "application/json", "content-length": "9999" } }))).status).toBe(400);
    expect((await reply(new Request(FENCE_CONTROL_URL, { method: "POST", body: new Uint8Array(FENCE_CONTROL_REQUEST_BYTES + 1).fill(32),
      headers: { "content-type": "application/json" } }))).status).toBe(400);
    for (const body of [Uint8Array.of(0xff, 0xfe), new TextEncoder().encode("{bad"), new TextEncoder().encode(` ${new TextDecoder().decode(bytes)}`),
      new TextEncoder().encode("[1]"), new TextEncoder().encode("null")]) {
      expect((await reply(new Request(FENCE_CONTROL_URL, { method: "POST", body, headers: { "content-type": "application/json" } }))).status).toBe(400);
    }
  });

  it("rejects malformed, out-of-contract and mistyped operations without any fence call", async () => {
    const accountId = account(), generationId = generation(), base = { schemaVersion: 1, accountId, generation: generationId };
    for (const candidate of [
      null, 0, "read", [], { ...base, operation: "release" }, { ...base, operation: "assertOpen" },
      { ...base, operation: "read", epoch: 0 }, { ...base, schemaVersion: 2, operation: "read" },
      { ...base, operation: "read", extra: true }, { operation: "read", accountId, generation: generationId },
      { ...base, operation: "close" }, { ...base, operation: "close", epoch: -1, workerVersion: VERSION },
      { ...base, operation: "close", epoch: 0, workerVersion: "not-hex" },
      { ...base, operation: "publish", epoch: 4_294_967_296, workerVersion: VERSION },
      { schemaVersion: 1, operation: "read", accountId: "other", generation: generationId },
      { schemaVersion: 1, operation: "read", accountId, generation: "short" },
    ]) {
      const encoded = encodeFenceControlJson(candidate, FENCE_CONTROL_REQUEST_BYTES);
      if (encoded === null) continue; // The encoder itself models the value out.
      const r = new Request(FENCE_CONTROL_URL, { method: "POST", body: encoded, headers: { "content-type": "application/json" } });
      expect((await reply(r)).status).toBe(400);
    }
    // Canonical encoding only: a semantically valid body with extra spacing is refused.
    const padded = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, operation: "read", accountId, generation: generationId }, null, 2));
    expect((await reply(new Request(FENCE_CONTROL_URL, { method: "POST", body: padded, headers: { "content-type": "application/json" } }))).status).toBe(400);
  });

  it("drives a full close, drain, publish cycle against the real fence, then reconciles idempotently", async () => {
    const accountId = account(), generationId = generation();
    // An unseen account reads as absent authority, not an error.
    const empty = await view(fenceRequest(accountId, generationId, "read"));
    expect(empty.record).toBeNull(); expect(empty.inFlight).toBe(0);
    expect(await error(closeRequest(accountId, generationId, 0))).toBe("recovery_required");
    // Establish epoch 0 through the adapter path (the channel has no lease op).
    const grant = await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation: generationId, epoch: 0, workerVersion: VERSION, leaseMs: 5_000 });
    expect(grant.ok).toBe(true);
    const opened = await view(fenceRequest(accountId, generationId, "read"));
    expect(opened.record?.phase).toBe("open"); expect(opened.record?.epoch).toBe(0);
    expect(opened.record?.workerVersion).toBe(VERSION); expect(opened.inFlight).toBe(1);
    // Close is operator-owned; the in-flight lease keeps its TTL.
    const closed = await view(closeRequest(accountId, generationId, 0));
    expect(closed.record?.phase).toBe("closed"); expect(closed.inFlight).toBe(1);
    expect(await error(closeRequest(accountId, generationId, 1))).toBe("recovery_required");
    // While closed, new mutating leases are refused; publish waits for drain.
    const blocked = await stub(accountId).assertOpen({ attemptId: enrollmentRandom(), accountId, generation: generationId, epoch: 0, workerVersion: VERSION, leaseMs: 5_000 });
    expect(blocked.ok).toBe(false);
    expect(await error(publishRequest(accountId, generationId, 1))).toBe("recovery_required");
    if (!grant.ok) throw new Error("control_fixture_failure");
    expect((await stub(accountId).release({ accountId, token: grant.value.token, committed: true })).ok).toBe(true);
    // Strictly greater epoch with the new Worker version reopens the fence.
    const published = await view(publishRequest(accountId, generationId, 1));
    expect(published.record?.phase).toBe("open"); expect(published.record?.epoch).toBe(1);
    expect(published.record?.workerVersion).toBe(NEXT_VERSION); expect(published.inFlight).toBe(0);
    // The identical publish reconciles instead of conflicting.
    const again = await view(publishRequest(accountId, generationId, 1));
    expect(again.record?.epoch).toBe(1);
    expect(await error(closeRequest(accountId, generationId, 0))).toBe("recovery_required");
    // Generation disagreement surfaces the fixed recovery code.
    expect(await error(fenceRequest(accountId, generation(), "read"))).toBe("recovery_required");
  });

  it("returns the fixed private failure for malformed or surprising RPC replies", async () => {
    const accountId = account(), generationId = generation(), input = fenceRequest(accountId, generationId, "read");
    const record = { schemaVersion: 1, accountId, generation: generationId, epoch: 0, workerVersion: VERSION,
      phase: "open", established: false, updatedAtMs: 1 };
    const viewFor = (value: unknown) => ({ record: value, inFlight: 0, observedAtMs: 1 });
    const cases: unknown[] = [
      undefined, null, "x", { ok: false, error: "outside_contract" }, { ok: false, error: CANARY },
      { ok: true, value: null }, { ok: true, value: { record: null, inFlight: -1, observedAtMs: 1 } },
      { ok: true, value: viewFor({ ...record, accountId: account() }) },
      { ok: true, value: viewFor({ ...record, extra: true }) }, { ok: true, value: { ...viewFor(null), extra: 1 } },
      { ok: true, value: viewFor(record), extra: 1 }, { ok: true },
    ];
    for (const candidate of cases) {
      const broken: FenceControlEnvironment = { ...selected,
        RESTORE_FENCES: { getByName: () => ({ read: async () => candidate, close: async () => candidate, publish: async () => candidate }) } as never };
      expect(await error(input, broken)).toBe("control_unavailable");
    }
    const throwing: FenceControlEnvironment = { ...selected,
      RESTORE_FENCES: { getByName: () => ({ read: async () => { throw new Error(CANARY); }, close: async () => undefined, publish: async () => undefined }) } as never };
    expect(await error(input, throwing)).toBe("control_unavailable");
    const missing = await reply(request(input), { AICHARTS_USAGE_FENCE_CONTROL_ENABLED: "1" } as FenceControlEnvironment);
    expect(missing.status).toBe(503);
    expect(await error(input, { ...selected, AICHARTS_USAGE_FENCE_CONTROL_ENABLED: "" })).toBe("control_unavailable");
    expect(await error(input, { RESTORE_FENCES: env.RESTORE_FENCES } as FenceControlEnvironment)).toBe("control_unavailable");
  });

  it("maps the fence's fixed refusal codes to fixed statuses without reflection", async () => {
    const accountId = account(), generationId = generation();
    for (const [code, expected] of [["invalid_input", 400], ["unauthorized", 403], ["not_found", 404],
      ["recovery_required", 409], ["conflict", 409], ["expired", 410], ["storage_invalid", 503],
      ["storage_unavailable", 503], ["clock_regressed", 503], ["limit", 429]] as const) {
      const failing: FenceControlEnvironment = { ...selected,
        RESTORE_FENCES: { getByName: () => ({ read: async () => ({ ok: false, error: code }),
          close: async () => ({ ok: false, error: code }), publish: async () => ({ ok: false, error: code }) }) } as never };
      const { status, body } = await reply(request(fenceRequest(accountId, generationId, "read")), failing);
      expect(status).toBe(expected); expect(JSON.parse(body)).toEqual({ schemaVersion: 1, ok: false, error: code });
    }
  });

  it("exposes the private entrypoint while the default export stays the dormant worker", async () => {
    expect(privateDefault).toBe(production);
    const entrypoint = new RestoreFenceControl(createExecutionContext(), selected);
    const accountId = account(), generationId = generation(), input = fenceRequest(accountId, generationId, "read");
    const response = await entrypoint.fetch(request(input));
    expect(response.status).toBe(200);
    const parsed = parseFenceControlReply(input, await response.json() as unknown);
    expect(parsed?.ok).toBe(true);
  });
});
