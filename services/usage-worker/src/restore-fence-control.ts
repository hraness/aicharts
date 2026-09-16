import { WorkerEntrypoint } from "cloudflare:workers";
import { enrollmentSnapshot } from "./enrollment-contract";
import { enrollmentStorageCall } from "./namespace-anchor";
import { restoreFenceName } from "./restore-fence";
import dormant from "./index";
import {
  FENCE_CONTROL_ERROR_STATUS, FENCE_CONTROL_ERRORS, FENCE_CONTROL_REQUEST_BYTES, FENCE_CONTROL_URL,
  encodeFenceControlJson, parseFenceControlRequest, parseFenceControlView,
  type FenceControlError, type FenceControlReply, type FenceControlRequest, type FenceControlView,
} from "./restore-fence-control-contract";

// Separate private operator configuration only. The normal index never imports
// this file; generated operator configs declare only the RestoreFenceControl
// entrypoint and a cross-script RESTORE_FENCES binding to the fenced Worker.
// This service owns no Durable Object storage, so it exports no DO class.
export default dormant;
export type FenceControlEnvironment = Pick<Env, "RESTORE_FENCES"> & { AICHARTS_USAGE_FENCE_CONTROL_ENABLED?: unknown };
class FenceControlFault extends Error {
  constructor(readonly code: FenceControlError = "control_unavailable") { super(code); }
}
const fail = (code: FenceControlError = "control_unavailable"): never => { throw new FenceControlFault(code); };

function dispose(value: unknown): void {
  try {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
    const descriptor = Object.getOwnPropertyDescriptor(value, Symbol.dispose);
    if (descriptor && "value" in descriptor && typeof descriptor.value === "function") Reflect.apply(descriptor.value, value, []);
  } catch { /* No private exception text leaves this boundary. */ }
}

/** Exact owned enumerable keys on an RPC reply; workerd may add Symbol.dispose. */
function rpcFields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const disposal = Object.getOwnPropertyDescriptor(value, Symbol.dispose);
    if (disposal !== undefined && !("value" in disposal && typeof disposal.value === "function")) return null;
    const owned = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === Symbol.dispose) continue;
      if (typeof key !== "string") return null;
      const descriptor = descriptors[key];
      if (!("value" in descriptor) || !descriptor.enumerable) return null;
      owned[key] = descriptor.value as unknown;
    }
    return enrollmentSnapshot(owned, keys);
  } catch { return null; }
}

/** One bounded fence RPC. The Durable Object's fixed result codes pass through
 * verbatim; every other outcome is the fixed private failure. */
async function rpc(promise: Promise<unknown>): Promise<{ ok: true; value: FenceControlView } | { ok: false; error: FenceControlError }> {
  const raw = await enrollmentStorageCall(promise, dispose);
  try {
    const failure = rpcFields(raw, ["ok", "error"]);
    if (failure?.ok === false && typeof failure.error === "string" && (FENCE_CONTROL_ERRORS as readonly string[]).includes(failure.error)) {
      return { ok: false, error: failure.error as FenceControlError };
    }
    const success = rpcFields(raw, ["ok", "value"]);
    if (success?.ok === true) {
      const view = parseFenceControlView(success.value);
      if (view !== null) return { ok: true, value: view };
    }
    return fail();
  } finally { dispose(raw); }
}

async function readBytes(body: ReadableStream<Uint8Array>, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let length = 0, ended = false;
  const operation = (async () => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) { ended = true; break; }
      if (!(chunk.value instanceof Uint8Array) || chunk.value.length === 0 || chunk.value.length > maximum - length) return fail("invalid_request");
      length += chunk.value.length; chunks.push(Uint8Array.from(chunk.value));
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  })();
  try { return await enrollmentStorageCall(operation); }
  catch { return fail("invalid_request"); }
  finally { if (!ended) void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

const headers = {
  "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
};
function failure(code: FenceControlError, head = false): Response {
  const reply: FenceControlReply = { schemaVersion: 1, ok: false, error: code };
  return new Response(head ? null : encodeFenceControlJson(reply), { status: FENCE_CONTROL_ERROR_STATUS[code], headers });
}

function operationCall(binding: FenceControlEnvironment["RESTORE_FENCES"], input: FenceControlRequest): Promise<unknown> {
  const fence = binding.getByName(restoreFenceName(input.accountId));
  const account = { accountId: input.accountId, generation: input.generation };
  switch (input.operation) {
    case "read": return fence.read(account);
    case "close": return fence.close({ ...account, epoch: input.epoch, workerVersion: input.workerVersion });
    case "publish": return fence.publish({ ...account, epoch: input.epoch, workerVersion: input.workerVersion });
  }
}

/** Finite operator operations only; this contains no generic RPC, lease or
 * account proxy. The restore itself never passes through this boundary. */
export function createRestoreFenceControlHandler() {
  return async (request: Request, env: FenceControlEnvironment): Promise<Response> => {
    if (request.method !== "POST") return failure("method_not_allowed", request.method === "HEAD");
    try {
      if (env.AICHARTS_USAGE_FENCE_CONTROL_ENABLED !== "1") return failure("control_unavailable");
      let binding: FenceControlEnvironment["RESTORE_FENCES"];
      try { binding = env.RESTORE_FENCES; } catch { return failure("control_unavailable"); }
      if (typeof binding?.getByName !== "function") return failure("control_unavailable");
      let observed = Date.now();
      const started = observed;
      const guard = () => {
        const now = Date.now();
        if (!Number.isSafeInteger(now) || now < observed || now - started >= 15_000 || request.signal.aborted) return fail();
        observed = now;
      };
      guard();
      const length = request.headers.get("content-length");
      if (request.url !== FENCE_CONTROL_URL || request.headers.get("content-type") !== "application/json"
        || (request.headers.has("accept") && request.headers.get("accept") !== "application/json")
        || ["authorization", "cookie", "origin", "content-encoding", "transfer-encoding"].some(key => request.headers.has(key))
        || (length !== null && (!/^[1-9][0-9]{0,3}$/u.test(length) || Number(length) > FENCE_CONTROL_REQUEST_BYTES)) || !request.body) {
        return failure("invalid_request");
      }
      const bytes = await readBytes(request.body, FENCE_CONTROL_REQUEST_BYTES); guard();
      if (length !== null && bytes.length !== Number(length)) return failure("invalid_request");
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown; } catch { return failure("invalid_request"); }
      const input = parseFenceControlRequest(parsed);
      if (!input) return failure("invalid_request");
      const canonical = encodeFenceControlJson(input, FENCE_CONTROL_REQUEST_BYTES);
      if (!canonical || canonical.length !== bytes.length || canonical.some((value, index) => value !== bytes[index])) return failure("invalid_request");
      const result = await rpc(operationCall(binding, input)); guard();
      if (!result.ok) return failure(result.error);
      const reply: FenceControlReply = { schemaVersion: 1, operation: input.operation, ok: true, value: result.value };
      const body = encodeFenceControlJson(reply);
      if (!body || (result.value.record !== null && result.value.record.accountId !== input.accountId)) return failure("control_unavailable");
      guard();
      return new Response(body, { status: 200, headers });
    } catch (error) { return failure(error instanceof FenceControlFault ? error.code : "control_unavailable"); }
  };
}

const handler = createRestoreFenceControlHandler();
export class RestoreFenceControl extends WorkerEntrypoint<FenceControlEnvironment> {
  async fetch(request: Request): Promise<Response> { return await handler(request, this.env); }
}
