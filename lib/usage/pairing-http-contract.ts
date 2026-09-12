import type { PairingHttpWork } from "./pairing-http-work";

export const PAIRING_HTTP_URL = "https://usage.aicharts.io/internal/pairing";
export const PAIRING_HTTP_MEDIA = "application/json; charset=utf-8";
export const PAIRING_HTTP_CAPACITY = 8;
export const PAIRING_HTTP_CLIENT_MS = 15_000;
export const PAIRING_HTTP_WORKER_MS = 10_000;
export const PAIRING_HTTP_STAGE_MS = 5_000;
export type PairingHttpFailure = 400 | 401 | 503;

const codes = Object.freeze({ 400: "invalid_request", 401: "unauthorized_service", 503: "coordinator_unavailable" });
const encoder = new TextEncoder();
export function pairingHttpFailureBytes(status: PairingHttpFailure): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(`{"schemaVersion":1,"error":{"code":"${codes[status]}"}}`));
}
export function pairingHttpResponse(body: Uint8Array, status = 200): Response {
  return new Response(new Uint8Array(body), { status, headers: {
    "content-type": PAIRING_HTTP_MEDIA,
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow",
  } });
}
export function pairingHttpFailure(status: PairingHttpFailure): Response {
  return pairingHttpResponse(pairingHttpFailureBytes(status), status);
}
export function pairingHttpToken(input: unknown): input is string {
  return typeof input === "string" && input.length <= 8_192 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(input);
}
export function pairingHttpBearer(value: string | null): string | null {
  if (value === null || !value.startsWith("Bearer ")) return null;
  const token = value.slice(7);
  return pairingHttpToken(token) ? token : null;
}
export function pairingHttpLength(headers: Headers, cap: number): number | null {
  const text = headers.get("content-length");
  if (text === null) return null;
  if (text.length > 4 || !/^[1-9][0-9]*$/u.test(text)) throw new Error("pairing_http_framing");
  const length = Number(text);
  if (length > cap) throw new Error("pairing_http_framing");
  return length;
}

/** Byte-copy intrinsics reject shared/resizable backing and caller-overridden access. */
const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
const tag = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)!.get!;
const lengthOf = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
const fixedLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const set = Uint8Array.prototype.set;

/** Acquire only after admission. The owner retains cancellation and release settlement. */
export async function pairingHttpBody(
  stream: ReadableStream<Uint8Array> | null, cap: number, expected: number | null, work: PairingHttpWork,
): Promise<Uint8Array<ArrayBuffer>> {
  if (stream === null) throw new Error("pairing_http_body");
  const reader = stream.getReader();
  let eof = false;
  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    if (!eof && cancellation === undefined) {
      try { cancellation = reader.cancel().then(() => {}, () => {}); }
      catch { cancellation = Promise.resolve(); }
    }
    return cancellation;
  };
  const detach = work.onStop(cancel);
  try {
    return await work.stage(PAIRING_HTTP_STAGE_MS, async () => {
      const bytes = new Uint8Array(cap);
      let used = 0;
      for (let reads = 0; reads < cap + 1; reads++) {
        work.guard();
        const next = await reader.read();
        work.guard();
        if (next.done) {
          eof = true;
          if (used === 0 || (expected !== null && used !== expected)) throw new Error("pairing_http_body");
          return bytes.slice(0, used);
        }
        const chunk: unknown = next.value;
        if (tag.call(chunk) !== "Uint8Array") throw new Error("pairing_http_body");
        const buffer = bufferOf.call(chunk) as ArrayBuffer;
        fixedLength.call(buffer);
        if (resizable?.call(buffer) === true) throw new Error("pairing_http_body");
        const size = lengthOf.call(chunk) as number;
        if (size === 0 || size > cap - used) throw new Error("pairing_http_body");
        set.call(bytes, chunk as Uint8Array, used); used += size;
      }
      throw new Error("pairing_http_body");
    });
  } finally {
    try { await cancel(); } finally { detach(); reader.releaseLock(); }
  }
}

/** Own a late/unread fetch response even when refusal happened before body reading. */
export async function pairingHttpDiscard(response: Response): Promise<void> {
  if (response.body !== null && !response.body.locked) await response.body.cancel().then(() => {}, () => {});
}
