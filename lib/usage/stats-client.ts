import { statsPublicPath, STATS_ACCOUNT_HEADER, STATS_PUBLIC_MAX_BYTES, STATS_PUBLIC_MEDIA } from "./stats-public";
import { usageAccountId } from "./account-public";
import { MetricReportSession, type HostedStatsSessionReply, type MetricWorkerFactory } from "./metric-explorer-session";

export const MAX_STATS_READ_MS = 20_000;
export const MAX_STATS_READ_CHUNKS = 65_536;
export type StatsReadReply = HostedStatsSessionReply;
const failed = Object.freeze({ schemaVersion: 2, ok: false, error: "unavailable" } as const);
const unavailable = () => new Error("usage_unavailable");
const cancelBody = (response: Response) => { try { void response.body?.cancel().catch(() => {}); } catch { /* Bounded disposal never waits on a provider. */ } };

/** One monotonic deadline, shared by the initial read, SDK recovery, and any
 * bounded retry. Every await also checks expiry before admitting its value. */
export class StatsReadDeadline {
  readonly #controller = new AbortController();
  readonly #expiresAt: number;
  readonly #timer: ReturnType<typeof setTimeout>;
  readonly signal = this.#controller.signal;
  #finished = false;
  readonly #abort = () => this.#controller.abort();
  constructor(readonly parent: AbortSignal, deadline?: StatsReadDeadline) {
    this.#expiresAt = deadline === undefined ? performance.now() + MAX_STATS_READ_MS : deadline.#expiresAt;
    this.#timer = setTimeout(this.#abort, Math.max(0, this.#expiresAt - performance.now()));
    parent.addEventListener("abort", this.#abort, { once: true });
    if (parent.aborted || performance.now() >= this.#expiresAt) this.#abort();
  }
  active(): boolean {
    if (performance.now() >= this.#expiresAt) this.#abort();
    return !this.#finished && !this.signal.aborted;
  }
  wait<T>(pending: Promise<T>, discard?: (value: T) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => { this.signal.removeEventListener("abort", abort); reject(unavailable()); };
      this.signal.addEventListener("abort", abort, { once: true });
      if (!this.active()) abort();
      void pending.then(value => {
        this.signal.removeEventListener("abort", abort);
        if (!this.active()) { discard?.(value); reject(unavailable()); } else resolve(value);
      }, () => { this.signal.removeEventListener("abort", abort); reject(unavailable()); });
    });
  }
  finish() { this.#finished = true; clearTimeout(this.#timer); this.parent.removeEventListener("abort", this.#abort); }
}

export function disposeStatsReadReply(reply: StatsReadReply): void { if (reply.ok) reply.session.close(); }

/** One same-origin acquisition. Main owns bounded immutable bytes and HTTP
 * identity; the private worker alone decodes and admits the hosted report. */
export async function readPrivateStats(firstUtcDay: number, dayCount: number, signal: AbortSignal, fetcher: typeof fetch = globalThis.fetch,
  options: Readonly<{ workerFactory?: MetricWorkerFactory; deadline?: StatsReadDeadline }> = {}): Promise<StatsReadReply> {
  const range = { firstUtcDay, dayCount }, path = statsPublicPath(range);
  if (path === null || signal.aborted) return failed;
  const deadline = options.deadline ?? new StatsReadDeadline(signal);
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, complete = false;
  try {
    if (!deadline.active()) return failed;
    response = await deadline.wait(Promise.resolve(fetcher(path, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store", redirect: "error", signal: deadline.signal })), cancelBody);
    if (!deadline.active() || response.redirected || response.headers.get("content-type") !== STATS_PUBLIC_MEDIA
      || response.body === null || ![200, 400, 401, 403, 405, 413, 503].includes(response.status)) return failed;
    const status = response.status, responseAccount = response.headers.get(STATS_ACCOUNT_HEADER);
    const accountId = usageAccountId(responseAccount) ? responseAccount : null;
    const encoding = response.headers.get("content-encoding");
    const declared = encoding === null || encoding.trim().toLowerCase() === "identity" ? response.headers.get("content-length") : null;
    if (declared !== null && (!/^[1-9][0-9]{0,7}$/u.test(declared) || Number(declared) > STATS_PUBLIC_MAX_BYTES)) return failed;
    reader = response.body.getReader();
    const chunks: Blob[] = [];
    let length = 0;
    for (let reads = 0; reads <= MAX_STATS_READ_CHUNKS; reads++) {
      const chunk = await deadline.wait(reader.read());
      if (!deadline.active()) return failed;
      if (chunk.done) { complete = true; break; }
      if (!(chunk.value instanceof Uint8Array) || !(chunk.value.buffer instanceof ArrayBuffer) || chunk.value.byteLength === 0
        || chunk.value.byteLength > STATS_PUBLIC_MAX_BYTES - length || chunks.length >= MAX_STATS_READ_CHUNKS) return failed;
      // Capture each chunk immediately; Blob parts are immutable even if a
      // stream producer reuses its input buffer on its next pull.
      chunks.push(new Blob([new Uint8Array(chunk.value.buffer, chunk.value.byteOffset, chunk.value.byteLength)]));
      length += chunk.value.byteLength;
    }
    if (!complete || length === 0 || (declared !== null && Number(declared) !== length) || !deadline.active()) return failed;
    const reply = await MetricReportSession.openHosted({ body: new Blob(chunks), status, accountId, range }, deadline.signal, options.workerFactory);
    if (!deadline.active()) { disposeStatsReadReply(reply); return failed; }
    return reply;
  } catch { return failed; }
  finally {
    if (options.deadline === undefined) deadline.finish();
    if (reader !== undefined) {
      if (!complete) { try { void reader.cancel().catch(() => {}); } catch { /* No response disclosure. */ } }
      try { reader.releaseLock(); } catch { /* A pending aborted read owns no result. */ }
    } else if (response !== undefined) cancelBody(response);
  }
}
