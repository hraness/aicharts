import { decodeUsageAccountReply, usageAccountStatus, USAGE_ACCOUNT_BYTES, USAGE_ACCOUNT_MEDIA, USAGE_ACCOUNT_PATH, type UsageAccountReply } from "./account-public";

const unavailable = () => new Error("usage_unavailable");
/** Fixed same-origin read; bounded decoded bytes, finite reads, no persistence. */
export async function readUsageAccount(signal: AbortSignal, fetcher: typeof fetch = globalThis.fetch): Promise<UsageAccountReply> {
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, complete = false;
  try {
    if (signal.aborted) throw unavailable();
    response = await fetcher(USAGE_ACCOUNT_PATH, { method: "GET", headers: { accept: "application/json" },
      credentials: "same-origin", cache: "no-store", redirect: "error", signal });
    if (signal.aborted || response.redirected || response.body === null || response.headers.get("content-type") !== USAGE_ACCOUNT_MEDIA
      || ![200, 400, 401, 403, 405, 503].includes(response.status)) throw unavailable();
    const encoding = response.headers.get("content-encoding");
    const length = encoding === null || encoding.trim().toLowerCase() === "identity" ? response.headers.get("content-length") : null;
    if (length !== null && (!/^[1-9][0-9]{0,2}$/u.test(length) || Number(length) > USAGE_ACCOUNT_BYTES)) throw unavailable();
    reader = response.body.getReader();
    const bytes = new Uint8Array(USAGE_ACCOUNT_BYTES); let size = 0;
    for (let reads = 0; reads <= USAGE_ACCOUNT_BYTES; reads++) {
      const chunk = await reader.read();
      if (signal.aborted) throw unavailable();
      if (chunk.done) { complete = true; break; }
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength === 0 || chunk.value.byteLength > bytes.length - size) throw unavailable();
      bytes.set(chunk.value, size); size += chunk.value.byteLength;
    }
    const reply = complete && (length === null || Number(length) === size) ? decodeUsageAccountReply(bytes.subarray(0, size)) : null;
    if (reply === null || usageAccountStatus(reply) !== response.status || signal.aborted) throw unavailable();
    return reply;
  } catch { throw unavailable(); }
  finally {
    if (reader) {
      if (!complete) { try { await reader.cancel(); } catch { /* No disclosure. */ } }
      reader.releaseLock();
    } else { try { await response?.body?.cancel(); } catch { /* Browser owns disposal. */ } }
  }
}
