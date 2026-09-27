import { STATS_MAX_BYTES, statsInteger, statsOwnRecord } from "./stats-contract";
import { createMetricSnapshot, createMetricSnapshotJson, createMetricPublicSnapshotJson, disposeMetricSnapshot, evaluateMetricQueryCooperatively, metricDefinition, metricReportMetadata, metricResultJson,
  parseMetricQuery, type MetricQuery, type MetricReportMetadata, type MetricResult, type MetricSnapshot } from "./metric-explorer";
import { MAX_METRIC_VIEW_BYTES, metricPresentation, encodeMetricPresentation } from "../../components/usage/stats-metric-presentation";
import { statsBoundRowsCsv } from "../../components/usage/stats-export";
import { metricCsv } from "./metric-export";
import { parseStatsRange, type StatsRange } from "./stats-http-contract";
import { STATS_PUBLIC_MAX_BYTES, statsPublicStatus, type StatsPublicReply } from "./stats-public";
import { usageAccountId } from "./account-public";

export const MAX_METRIC_WORKERS_PER_DASHBOARD = 2;
export const MAX_METRIC_PENDING_QUERIES = 1;
export const MAX_METRIC_RETAINED_RESULTS = 2;
export const MAX_METRIC_ACTIVE_EXPORTS = 1;
export const MAX_METRIC_REQUEST_ID = 2_147_483_647;
export type MetricWorkerSlot = "main" | "detail";
/** Exports: the full result as JSON, every bound source row as CSV, or one
 * metric's total and groups as a per-metric CSV (D4/D12). */
export type MetricExportFormat = "json" | "csv" | Readonly<{ metricCsv: string }>;
export function parseMetricExportFormat(value: unknown): MetricExportFormat | null {
  if (value === "json" || value === "csv") return value;
  const record = statsOwnRecord(value, ["metricCsv"]);
  return record !== null && typeof record.metricCsv === "string" && metricDefinition(record.metricCsv) !== undefined ? { metricCsv: record.metricCsv } : null;
}
export type MetricWorkerError = "invalid_request" | "invalid_report" | "query_failed" | "cancelled" | "view_limit" | "export_failed" | "closed";
export type MetricHostedInput = Readonly<{ body: Blob; status: number; accountId: string | null; range: StatsRange }>;
export type MetricHostedAdmission = Readonly<{ schemaVersion: 2; ok: true; accountId: string; metadata: MetricReportMetadata }>
  | (Extract<StatsPublicReply, { ok: false }> & Readonly<{ accountId?: string }>);
export type MetricWorkerReply =
  | { kind: "ready"; id: number; metadata: MetricReportMetadata }
  | { kind: "hosted"; id: number; reply: MetricHostedAdmission }
  | { kind: "result"; id: number; slot: MetricWorkerSlot; view: ArrayBuffer; viewBytes: number }
  | { kind: "export"; id: number; resultId: number; blob: Blob }
  | { kind: "error"; id: number; code: MetricWorkerError };
type Query = { id: number; query: MetricQuery; slot: MetricWorkerSlot; parent: number | null };

/** One actor owns one snapshot, one running query and its latest replacement,
 * two result slots, and one export continuation. It has no network or storage. */
export class MetricWorkerCore {
  #snapshot: MetricSnapshot | null = null;
  #closed = false;
  #started = false;
  #received = 0;
  #latest = 0;
  #pending: Query | null = null;
  #running = false;
  #exporting = false;
  #results = new Map<MetricWorkerSlot, { id: number; value: MetricResult }>();
  constructor(readonly send: (reply: MetricWorkerReply) => void, readonly handoff: () => Promise<void>) {}
  #reply(reply: MetricWorkerReply) { if (!this.#closed) this.send(reply); }
  #error(id: number, code: MetricWorkerError) { this.#reply({ kind: "error", id, code }); }
  close() {
    if (this.#closed) return;
    this.#closed = true; this.#pending = null; this.#results.clear();
    if (this.#snapshot !== null) disposeMetricSnapshot(this.#snapshot);
    this.#snapshot = null;
  }
  receive(value: unknown) {
    if (this.#closed) return;
    const raw = statsOwnRecord(value, ["kind", "id", "payload"]);
    if (raw === null || !statsInteger(raw.id, 1, MAX_METRIC_REQUEST_ID) || raw.id <= this.#received) return;
    const id = raw.id;
    this.#received = id;
    if (raw.kind === "open") { this.#latest = id; void this.#open(id, raw.payload); return; }
    if (raw.kind === "open-hosted") { this.#latest = id; void this.#openHosted(id, raw.payload); return; }
    if (raw.kind === "query") {
      const payload = statsOwnRecord(raw.payload, ["slot", "parent", "query"]), query = parseMetricQuery(payload?.query);
      if (payload === null || query === null || (payload.slot !== "main" && payload.slot !== "detail")
        || (payload.parent !== null && !statsInteger(payload.parent, 1, MAX_METRIC_REQUEST_ID))) { this.#error(id, "invalid_request"); return; }
      if (this.#snapshot === null || (payload.slot === "detail" && this.#results.get("main")?.id !== payload.parent)) { this.#error(id, "cancelled"); return; }
      this.#latest = id;
      if (this.#pending !== null) this.#error(this.#pending.id, "cancelled");
      this.#pending = { id, query, slot: payload.slot, parent: payload.parent };
      if (payload.slot === "main") this.#results.delete("detail");
      if (!this.#running) void this.#drain();
      return;
    }
    if (raw.kind === "export") {
      const payload = statsOwnRecord(raw.payload, ["resultId", "format"]);
      const format = payload === null ? null : parseMetricExportFormat(payload.format);
      if (payload === null || format === null || !statsInteger(payload.resultId, 1, MAX_METRIC_REQUEST_ID)) { this.#error(id, "invalid_request"); return; }
      // Export IDs do not supersede the active query generation.
      void this.#export(id, payload.resultId, format); return;
    }
    if (raw.kind === "cancel" && statsInteger(raw.payload, 1, MAX_METRIC_REQUEST_ID)) {
      if (this.#latest === raw.payload) this.#latest = id;
      if (this.#pending?.id === raw.payload) { this.#error(this.#pending.id, "cancelled"); this.#pending = null; }
      return;
    }
    this.#error(id, "invalid_request");
  }
  async #open(id: number, payload: unknown) {
    if (this.#started) { this.#error(id, "invalid_request"); return; }
    this.#started = true;
    try {
      let snapshot: MetricSnapshot | null;
      if (payload instanceof Blob) {
        if (payload.size > STATS_MAX_BYTES) { this.#error(id, "invalid_report"); return; }
        const text = await payload.text();
        if (this.#closed || this.#latest !== id) return;
        snapshot = createMetricSnapshotJson(text);
      } else snapshot = createMetricSnapshot(payload);
      if (snapshot === null) { this.#error(id, "invalid_report"); return; }
      if (this.#closed || this.#latest !== id) { disposeMetricSnapshot(snapshot); return; }
      this.#snapshot = snapshot; this.#reply({ kind: "ready", id, metadata: metricReportMetadata(snapshot) });
    } catch { this.#error(id, "invalid_report"); }
  }
  async #openHosted(id: number, value: unknown) {
    if (this.#started) { this.#error(id, "invalid_request"); return; }
    this.#started = true;
    let snapshot: MetricSnapshot | null = null;
    try {
      const payload = statsOwnRecord(value, ["body", "status", "accountId", "range"]), range = parseStatsRange(payload?.range);
      if (payload === null || range === null || !(payload.body instanceof Blob) || payload.body.size === 0
        || payload.body.size > STATS_PUBLIC_MAX_BYTES || typeof payload.status !== "number" || ![200, 400, 401, 403, 405, 413, 503].includes(payload.status)
        || (payload.accountId !== null && !usageAccountId(payload.accountId))) throw new Error("invalid_report");
      const bytes = await payload.body.arrayBuffer();
      if (this.#closed || this.#latest !== id) return;
      const reply = createMetricPublicSnapshotJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), range);
      if (reply === null) throw new Error("invalid_report");
      if (reply.ok) snapshot = reply.snapshot;
      if ((reply.ok ? 200 : statsPublicStatus(reply)) !== payload.status) throw new Error("invalid_report");
      const authenticated = reply.ok || ["not_enrolled", "not_started", "range_too_large"].includes(reply.error);
      if (authenticated && !usageAccountId(payload.accountId)) throw new Error("invalid_report");
      if (this.#closed || this.#latest !== id) return;
      if (reply.ok && usageAccountId(payload.accountId)) {
        this.#snapshot = reply.snapshot; snapshot = null;
        this.#reply({ kind: "hosted", id, reply: { schemaVersion: 2, ok: true, accountId: payload.accountId, metadata: metricReportMetadata(reply.snapshot) } });
      } else if (!reply.ok) {
        this.#reply({ kind: "hosted", id, reply: authenticated && usageAccountId(payload.accountId) ? { ...reply, accountId: payload.accountId } : reply });
      }
    } catch { this.#error(id, "invalid_report"); }
    finally { if (snapshot !== null) disposeMetricSnapshot(snapshot); }
  }
  async #drain() {
    this.#running = true;
    try {
      while (!this.#closed && this.#pending !== null && this.#snapshot !== null) {
        const request = this.#pending; this.#pending = null;
        const current = () => !this.#closed && this.#latest === request.id
          && (request.slot !== "detail" || this.#results.get("main")?.id === request.parent);
        try {
          const result = await evaluateMetricQueryCooperatively(this.#snapshot, request.query, current, this.handoff);
          if (!current() || (!result.ok && result.code === "metric_query_cancelled")) { this.#error(request.id, "cancelled"); continue; }
          if (!result.ok) { this.#error(request.id, "query_failed"); continue; }
          const view = encodeMetricPresentation(metricPresentation(result.value)), viewBytes = view.byteLength;
          if (viewBytes > MAX_METRIC_VIEW_BYTES) { this.#error(request.id, "view_limit"); continue; }
          this.#results.set(request.slot, { id: request.id, value: result.value });
          this.#reply({ kind: "result", id: request.id, slot: request.slot, view, viewBytes });
        } catch { this.#error(request.id, "query_failed"); }
      }
    } finally { this.#running = false; }
  }
  async #export(id: number, resultId: number, format: MetricExportFormat) {
    const result = this.#results.get("main");
    if (this.#exporting || this.#running || this.#pending !== null || result === undefined || result.id !== resultId) { this.#error(id, "cancelled"); return; }
    this.#exporting = true;
    const generation = this.#latest;
    try {
      const text = format === "json" ? await metricResultJson(result.value) : format === "csv" ? await statsBoundRowsCsv(result.value) : await metricCsv(result.value, format.metricCsv);
      if (this.#closed || this.#latest !== generation || this.#results.get("main") !== result) { this.#error(id, "cancelled"); return; }
      const blob = new Blob([text], { type: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8" });
      this.#reply({ kind: "export", id, resultId, blob });
    } catch { this.#error(id, "export_failed"); }
    finally { this.#exporting = false; }
  }
}
