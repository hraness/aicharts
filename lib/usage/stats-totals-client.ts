import { usageAccountId } from "./account-public";
import { decodeStatsTotalsPublicReply, statsTotalsPublicStatus, STATS_TOTALS_ACCOUNT_HEADER, STATS_TOTALS_PATH, STATS_TOTALS_PUBLIC_MAX_BYTES,
  STATS_TOTALS_PUBLIC_MEDIA, type StatsTotalsPublicReply } from "./stats-totals-public";

export type StatsTotalsReadReply = StatsTotalsPublicReply & Readonly<{ accountId: string | null }>;
const unavailable = () => new Error("usage_unavailable");
/** Fixed same-origin read; bounded decoded bytes, finite reads, no persistence. */
export async function readPrivateTotals(signal: AbortSignal, fetcher: typeof fetch = globalThis.fetch): Promise<StatsTotalsReadReply> {
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, complete = false;
  try {
    if (signal.aborted) throw unavailable();
    response = await fetcher(STATS_TOTALS_PATH, { method: "GET", headers: { accept: "application/json" },
      credentials: "same-origin", cache: "no-store", redirect: "error", signal });
    if (signal.aborted || response.redirected || response.body === null || response.headers.get("content-type") !== STATS_TOTALS_PUBLIC_MEDIA
      || ![200, 400, 401, 403, 405, 503].includes(response.status)) throw unavailable();
    const responseAccount = response.headers.get(STATS_TOTALS_ACCOUNT_HEADER);
    const accountId = usageAccountId(responseAccount) ? responseAccount : null;
    const encoding = response.headers.get("content-encoding");
    const length = encoding === null || encoding.trim().toLowerCase() === "identity" ? response.headers.get("content-length") : null;
    if (length !== null && (!/^[1-9][0-9]{0,6}$/u.test(length) || Number(length) > STATS_TOTALS_PUBLIC_MAX_BYTES)) throw unavailable();
    reader = response.body.getReader();
    const bytes = new Uint8Array(STATS_TOTALS_PUBLIC_MAX_BYTES); let size = 0;
    for (let reads = 0; reads <= 4_096; reads++) {
      const chunk = await reader.read();
      if (signal.aborted) throw unavailable();
      if (chunk.done) { complete = true; break; }
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength === 0 || chunk.value.byteLength > bytes.length - size) throw unavailable();
      bytes.set(chunk.value, size); size += chunk.value.byteLength;
    }
    const reply = complete && (length === null || Number(length) === size) ? decodeStatsTotalsPublicReply(bytes.subarray(0, size)) : null;
    if (reply === null || statsTotalsPublicStatus(reply) !== response.status || signal.aborted) throw unavailable();
    return Object.freeze({ ...reply, accountId });
  } catch { throw unavailable(); }
  finally {
    if (reader) {
      if (!complete) { try { await reader.cancel(); } catch { /* No disclosure. */ } }
      reader.releaseLock();
    } else { try { await response?.body?.cancel(); } catch { /* Browser owns disposal. */ } }
  }
}
