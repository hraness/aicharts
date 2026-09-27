import { STATS_MAX_BYTES, STATS_MAX_SOURCES, STATS_MAX_RECORDS, parseUsageStatsReport, statsInteger, statsOwnRecord, type UsageStatsReport } from "./stats-contract";
import { isStatsClient } from "./stats-registry";
import { parseMetricQuery, type MetricQuery, type MetricReportMetadata } from "./metric-explorer";
import { MAX_METRIC_REQUEST_ID, type MetricExportFormat, type MetricWorkerReply, type MetricWorkerSlot, type MetricHostedInput } from "./metric-explorer-worker-core";
import { MAX_METRIC_VIEW_BYTES, decodeMetricPresentation, type MetricPresentation } from "../../components/usage/stats-metric-presentation";
import { STATS_PUBLIC_MAX_BYTES, parseStatsPublicReply, statsPublicStatus, type StatsPublicReply } from "./stats-public";
import { parseStatsRange } from "./stats-http-contract";
import { usageAccountId } from "./account-public";

export const MAX_METRIC_WORKER_OPERATION_MS = 30_000;
type WorkerPort = Pick<Worker, "postMessage" | "terminate" | "addEventListener" | "removeEventListener">;
export type MetricWorkerFactory = () => WorkerPort;
export type HostedStatsSessionReply = Readonly<{ schemaVersion: 2; ok: true; accountId: string; session: MetricReportSession }>
  | (Extract<StatsPublicReply, { ok: false }> & Readonly<{ accountId?: string }>);
const createWorker: MetricWorkerFactory = () => new Worker(new URL("./metric-explorer-worker.ts", import.meta.url), { type: "module" });
type Pending = { receive: (reply: MetricWorkerReply) => void; reject: (reason: Error) => void; clear: () => void };
type Binding = { id: number; slot: MetricWorkerSlot };
const cancelled = () => new Error("metric_query_cancelled");
function ownMetadata(value: unknown): MetricReportMetadata {
  const metadata = statsOwnRecord(value, ["schemaVersion", "profile", "registryRevision", "firstUtcDay", "dayCount", "generatedAtMs", "revision", "updatedAtMs", "sources"]);
  if (metadata === null || !Array.isArray(metadata.sources) || metadata.sources.length > STATS_MAX_SOURCES) throw new Error("invalid_report");
  const header = parseUsageStatsReport({ ...metadata, sources: [], rows: [] });
  if (header === null) throw new Error("invalid_report");
  let previous = "";
  const sources = metadata.sources.map(value => {
    const source = statsOwnRecord(value, ["client", "status", "tokenBasis", "records", "warnings", "latestAtMs"]);
    if (source === null || !isStatsClient(source.client) || source.client <= previous
      || !["observed", "empty", "not_found", "incomplete", "unavailable"].includes(String(source.status))
      || !["reported", "estimated", "mixed", "unavailable"].includes(String(source.tokenBasis))
      || !statsInteger(source.records, 0, STATS_MAX_RECORDS) || !statsInteger(source.warnings, 0, STATS_MAX_RECORDS)
      || (source.latestAtMs !== null && !statsInteger(source.latestAtMs, 0, header.generatedAtMs))
      || (["empty", "not_found", "unavailable"].includes(String(source.status)) && (source.records !== 0 || source.latestAtMs !== null))) throw new Error("invalid_report");
    previous = source.client; return Object.freeze(source);
  });
  const { schemaVersion, profile, registryRevision, firstUtcDay, dayCount, generatedAtMs, revision, updatedAtMs } = header;
  return Object.freeze({ schemaVersion, profile, registryRevision, firstUtcDay, dayCount, generatedAtMs, revision, updatedAtMs,
    sources: Object.freeze(sources) }) as MetricReportMetadata;
}

/** Private point-to-point worker custody. The only producer is our bundled
 * worker; its source parser admits untrusted file/hosted bytes. Neither raw
 * rows nor arbitrary public postMessage traffic enter this presentation API. */
export class MetricReportSession {
  #worker: WorkerPort;
  #closed = false;
  #sequence = 0;
  #pending = new Map<number, Pending>();
  #views = new WeakMap<MetricPresentation, Binding>();
  #query: number | null = null;
  #export: number | null = null;
  #main: number | null = null;
  #metadata: MetricReportMetadata | null = null;
  get metadata(): MetricReportMetadata { if (this.#metadata === null) throw new Error("metric_session_not_ready"); return this.#metadata; }
  get closed(): boolean { return this.#closed; }
  constructor(worker: WorkerPort) {
    this.#worker = worker; worker.addEventListener("message", this.#receive); worker.addEventListener("error", this.#failed);
    worker.addEventListener("messageerror", this.#failed);
  }
  static async open(source: Blob | UsageStatsReport, signal?: AbortSignal, factory: MetricWorkerFactory = createWorker) {
    if (signal?.aborted) throw cancelled();
    if (source instanceof Blob && source.size > STATS_MAX_BYTES) throw new Error("invalid_report");
    const session = new MetricReportSession(factory());
    try {
      const reply = await session.#request("open", source, signal).promise;
      if (signal?.aborted || session.closed) throw cancelled();
      if (reply.kind !== "ready") throw new Error("invalid_report");
      session.#metadata = ownMetadata(reply.metadata);
      return session;
    } catch (error) { session.close(); throw error; }
  }
  static async openHosted(input: MetricHostedInput, signal: AbortSignal, factory: MetricWorkerFactory = createWorker): Promise<HostedStatsSessionReply> {
    if (signal.aborted) throw cancelled();
    const range = parseStatsRange(input.range);
    if (range === null || !(input.body instanceof Blob) || input.body.size === 0 || input.body.size > STATS_PUBLIC_MAX_BYTES
      || ![200, 400, 401, 403, 405, 413, 503].includes(input.status) || (input.accountId !== null && !usageAccountId(input.accountId))) throw new Error("invalid_report");
    // Capture the exact response binding before the first worker await. No
    // caller mutation can rebind the later metadata to another response.
    const binding = Object.freeze({ ...input, range }), session = new MetricReportSession(factory());
    try {
      const message = await session.#request("open-hosted", binding, signal).promise;
      if (signal.aborted || session.closed) throw cancelled();
      if (message.kind !== "hosted" || statsOwnRecord(message, ["kind", "id", "reply"]) === null) throw new Error("invalid_report");
      const success = statsOwnRecord(message.reply, ["schemaVersion", "ok", "accountId", "metadata"]);
      if (success?.schemaVersion === 2 && success.ok === true) {
        const metadata = ownMetadata(success.metadata);
        if (binding.status !== 200 || !usageAccountId(success.accountId) || success.accountId !== binding.accountId
          || metadata.firstUtcDay !== range.firstUtcDay || metadata.dayCount !== range.dayCount || metadata.revision < 1) throw new Error("invalid_report");
        session.#metadata = metadata;
        return Object.freeze({ schemaVersion: 2, ok: true, accountId: success.accountId, session });
      }
      const raw = statsOwnRecord(message.reply, Object.hasOwn(message.reply, "accountId") ? ["schemaVersion", "ok", "error", "accountId"] : ["schemaVersion", "ok", "error"]);
      const negative = raw === null ? null : parseStatsPublicReply({ schemaVersion: raw.schemaVersion, ok: raw.ok, error: raw.error });
      if (negative === null || negative.ok || statsPublicStatus(negative) !== binding.status) throw new Error("invalid_report");
      const authenticated = ["not_enrolled", "not_started", "range_too_large"].includes(negative.error);
      if (authenticated ? !usageAccountId(raw?.accountId) || raw?.accountId !== binding.accountId : Object.hasOwn(message.reply, "accountId")) throw new Error("invalid_report");
      session.close();
      return authenticated ? Object.freeze({ ...negative, accountId: raw?.accountId as string }) : negative;
    } catch (error) { session.close(); throw error; }
  }
  #next() {
    if (this.#closed || this.#sequence >= MAX_METRIC_REQUEST_ID) { this.close(); throw new Error("metric_session_closed"); }
    return ++this.#sequence;
  }
  #request(kind: "open" | "open-hosted" | "query" | "export", payload: unknown, signal?: AbortSignal) {
    const id = this.#next();
    const promise = new Promise<MetricWorkerReply>((resolve, reject) => {
      // Release candidate custody synchronously: a replacement may allocate
      // immediately after abort, before this promise's catch continuation.
      const abort = () => kind === "open" || kind === "open-hosted" ? this.close() : this.#cancel(id);
      const timer = setTimeout(() => this.close(), MAX_METRIC_WORKER_OPERATION_MS);
      const clear = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      this.#pending.set(id, { receive: resolve, reject, clear });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      try { this.#worker.postMessage({ kind, id, payload }); } catch { this.close(); }
    });
    return { id, promise };
  }
  #cancel(id: number) {
    const pending = this.#pending.get(id); if (pending === undefined) return;
    this.#pending.delete(id); pending.clear(); pending.reject(cancelled());
    if (!this.#closed) {
      try { this.#worker.postMessage({ kind: "cancel", id: this.#next(), payload: id }); } catch { this.close(); }
    }
  }
  #receive = (event: Event) => {
    if (this.#closed) return;
    const value = (event as MessageEvent<unknown>).data;
    if (value === null || typeof value !== "object") { this.close(); return; }
    const { id, kind } = value as { id?: unknown; kind?: unknown };
    if (!statsInteger(id, 1, MAX_METRIC_REQUEST_ID)) { this.close(); return; }
    const pending = this.#pending.get(id); if (pending === undefined) return;
    if (!["ready", "hosted", "result", "export", "error"].includes(String(kind))) { this.close(); return; }
    this.#pending.delete(id); pending.clear();
    const reply = value as MetricWorkerReply;
    if (reply.kind === "error") pending.reject(new Error(reply.code)); else pending.receive(reply);
  };
  #failed = () => this.close();
  async query(query: MetricQuery, options: { signal?: AbortSignal; slot?: MetricWorkerSlot; parent?: MetricPresentation } = {}): Promise<MetricPresentation> {
    const owned = parseMetricQuery(query); if (owned === null) throw new Error("metric_query_invalid");
    if (this.#query !== null) this.#cancel(this.#query);
    if (this.#export !== null) this.#cancel(this.#export);
    const slot = options.slot ?? "main", parent = options.parent === undefined ? null : this.#views.get(options.parent)?.id;
    if (slot === "main") this.#main = null;
    else if (parent === undefined || parent === null || parent !== this.#main) throw cancelled();
    const request = this.#request("query", { slot, parent, query: owned }, options.signal); this.#query = request.id;
    try {
      const reply = await request.promise;
      if (this.#closed || options.signal?.aborted || this.#query !== request.id || reply.kind !== "result" || reply.slot !== slot
        || !statsInteger(reply.viewBytes, 1, MAX_METRIC_VIEW_BYTES) || !(reply.view instanceof ArrayBuffer) || reply.view.byteLength !== reply.viewBytes) throw cancelled();
      let view: MetricPresentation;
      try { view = decodeMetricPresentation(reply.view); } catch (error) { this.close(); throw error; }
      if (JSON.stringify(view.query) !== JSON.stringify(owned) || view.snapshot.profile !== this.metadata.profile
        || view.snapshot.revision !== this.metadata.revision || view.snapshot.generatedAtMs !== this.metadata.generatedAtMs) {
        this.close(); throw cancelled();
      }
      this.#views.set(view, { id: request.id, slot });
      if (slot === "main") this.#main = request.id;
      return view;
    } finally { if (this.#query === request.id) this.#query = null; }
  }
  async export(view: MetricPresentation, format: MetricExportFormat): Promise<Blob> {
    const binding = this.#views.get(view);
    if (this.#closed || this.#query !== null || this.#export !== null || binding?.slot !== "main" || binding.id !== this.#main) throw cancelled();
    const request = this.#request("export", { resultId: binding.id, format }); this.#export = request.id;
    try {
      const reply = await request.promise;
      if (this.#closed || this.#export !== request.id || this.#main !== binding.id || reply.kind !== "export"
        || reply.resultId !== binding.id || !(reply.blob instanceof Blob) || reply.blob.size > STATS_MAX_BYTES) throw cancelled();
      return reply.blob;
    } finally { if (this.#export === request.id) this.#export = null; }
  }
  close() {
    if (this.#closed) return;
    this.#closed = true; this.#main = null; this.#metadata = null;
    this.#worker.removeEventListener("message", this.#receive); this.#worker.removeEventListener("error", this.#failed);
    this.#worker.removeEventListener("messageerror", this.#failed); this.#worker.terminate();
    for (const pending of this.#pending.values()) { pending.clear(); pending.reject(cancelled()); }
    this.#pending.clear(); this.#query = null; this.#export = null;
  }
}
