import { parseStatsPublicReply, statsPublicPath, statsPublicStatus, STATS_PUBLIC_MAX_BYTES, STATS_PUBLIC_MEDIA, type StatsPublicReply } from "./stats-public";

/** One request per user-selected range. No persistence, automatic upload or retry. */
export async function readPrivateStats(firstUtcDay: number, dayCount: number, signal: AbortSignal, fetcher: typeof fetch = globalThis.fetch): Promise<StatsPublicReply> {
  const range = { firstUtcDay, dayCount }, path = statsPublicPath(range);
  const failed: StatsPublicReply = { schemaVersion: 2, ok: false, error: "unavailable" };
  if (path === null || signal.aborted) return failed;
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, complete = false;
  try {
    response = await fetcher(path, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store", redirect: "error", signal });
    if (signal.aborted || response.redirected || response.headers.get("content-type") !== STATS_PUBLIC_MEDIA
      || response.body === null || ![200, 400, 401, 403, 405, 413, 503].includes(response.status)) return failed;
    const encoding = response.headers.get("content-encoding");
    const declared = encoding === null || encoding.trim().toLowerCase() === "identity" ? response.headers.get("content-length") : null;
    if (declared !== null && (!/^[1-9][0-9]{0,7}$/u.test(declared) || Number(declared) > STATS_PUBLIC_MAX_BYTES)) return failed;
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (let reads = 0; reads <= 65_536; reads++) {
      const chunk = await reader.read();
      if (signal.aborted) return failed;
      if (chunk.done) { complete = true; break; }
      if (chunk.value.byteLength > STATS_PUBLIC_MAX_BYTES - length || chunks.length >= 65_536) return failed;
      if (chunk.value.byteLength > 0) chunks.push(chunk.value);
      length += chunk.value.byteLength;
    }
    if (!complete || (declared !== null && Number(declared) !== length)) return failed;
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const reply = parseStatsPublicReply(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, range);
    return reply !== null && statsPublicStatus(reply) === response.status && !signal.aborted ? reply : failed;
  } catch { return failed; }
  finally {
    if (reader !== undefined) {
      if (!complete) { try { await reader.cancel(); } catch { /* Request disposal owns no retry. */ } }
      reader.releaseLock();
    } else if (response?.body) { try { await response.body.cancel(); } catch { /* No response disclosure. */ } }
  }
}
