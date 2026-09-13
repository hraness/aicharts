import {
  decodePrivateDaysPublicResponse, privateDaysPublicPath, privateDaysPublicStatus,
  PRIVATE_DAYS_PUBLIC_MAX_BYTES, PRIVATE_DAYS_PUBLIC_MEDIA,
  type PrivateDaysPublicReply, type PrivateDaysRange,
} from "./private-days-public";

const DAY_MS = 86_400_000;
const unavailable = () => new Error("usage_unavailable");

export function utcDayInput(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar controls accept actual civil dates, not Date's overflow normalization. */
export function privateDaysInputRange(first: string, last: string): PrivateDaysRange | null {
  const day = (text: string): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return null;
    const time = Date.parse(`${text}T00:00:00.000Z`);
    if (!Number.isFinite(time) || time < 0 || utcDayInput(time / DAY_MS) !== text) return null;
    return time / DAY_MS;
  };
  const firstUtcDay = day(first), lastUtcDay = day(last);
  if (firstUtcDay === null || lastUtcDay === null) return null;
  const range = { firstUtcDay, dayCount: lastUtcDay - firstUtcDay + 1 };
  return privateDaysPublicPath(range) === null ? null : Object.freeze(range);
}

/** Only this tab's request; no browser persistence, credentials in JSON or retries. */
export async function readPrivateDays(
  range: PrivateDaysRange,
  signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<PrivateDaysPublicReply> {
  const path = privateDaysPublicPath(range);
  if (path === null || signal.aborted) throw unavailable();
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    response = await fetcher(path, { method: "GET", headers: { accept: "application/json" },
      credentials: "same-origin", cache: "no-store", redirect: "error", signal });
    if (signal.aborted || response.redirected || response.headers.get("content-type") !== PRIVATE_DAYS_PUBLIC_MEDIA
      || response.body === null || ![200, 400, 401, 403, 405, 503].includes(response.status)) throw unavailable();
    // Fetch exposes decoded bytes. An encoded Content-Length cannot describe
    // that stream; always enforce the decoded cap below, independently of it.
    const encoding = response.headers.get("content-encoding");
    const declared = encoding === null || encoding.trim().toLowerCase() === "identity"
      ? response.headers.get("content-length") : null;
    if (declared !== null && (!/^[1-9][0-9]{0,4}$/u.test(declared) || Number(declared) > PRIVATE_DAYS_PUBLIC_MAX_BYTES)) throw unavailable();
    reader = response.body.getReader();
    const bytes = new Uint8Array(PRIVATE_DAYS_PUBLIC_MAX_BYTES);
    let length = 0;
    // A separate read bound handles an endlessly empty stream without waiting
    // for the request timeout. A byte-at-a-time response still fits, including EOF.
    for (let reads = 0; reads <= PRIVATE_DAYS_PUBLIC_MAX_BYTES; reads++) {
      const chunk = await reader.read();
      if (signal.aborted) throw unavailable();
      if (chunk.done) { complete = true; break; }
      if (chunk.value.byteLength > bytes.length - length) throw unavailable();
      bytes.set(chunk.value, length); length += chunk.value.byteLength;
    }
    if (!complete || (declared !== null && Number(declared) !== length)) throw unavailable();
    const reply = decodePrivateDaysPublicResponse(bytes.subarray(0, length), range);
    if (reply === null || privateDaysPublicStatus(reply) !== response.status || signal.aborted) throw unavailable();
    return reply;
  } catch { throw unavailable(); }
  finally {
    if (reader !== undefined) {
      if (!complete) { try { await reader.cancel(); } catch { /* Browser owns disposal. */ } }
      reader.releaseLock();
    } else if (response?.body !== null && response?.body !== undefined) {
      try { await response.body.cancel(); } catch { /* No retry or response disclosure. */ }
    }
  }
}
